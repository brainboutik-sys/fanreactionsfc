const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const fixtures = require('../netlify/functions/fixtures-sync.js');
const sync = require('../netlify/functions/sync-background.js');

function headers(map) {
  const lower = {};
  for (const [key, value] of Object.entries(map || {})) lower[key.toLowerCase()] = String(value);
  return { get: (name) => lower[String(name).toLowerCase()] ?? null };
}

function jsonRes(body, status = 200, hdrs) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(hdrs),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => text,
  };
}

function kickoffMatch(overrides) {
  return {
    id: 101,
    utcDate: '2026-11-16T20:00:00Z',
    status: 'FINISHED',
    lastUpdated: '2026-11-20T08:00:00Z',
    homeTeam: { name: 'Arsenal FC' },
    awayTeam: { name: 'Chelsea FC' },
    score: { duration: 'REGULAR', fullTime: { home: 2, away: 1 } },
    ...overrides,
  };
}

test('full time is kickoff plus 105 minutes and ignores lastUpdated', () => {
  const fields = fixtures.fullTimeFields(kickoffMatch());
  assert.equal(fields.finished_at, '2026-11-16T21:45:00.000Z');
  assert.equal(fields.full_time_source, 'estimated');
  assert.equal(fields.extra_time, false);
  assert.notEqual(fields.finished_at, '2026-11-20T08:00:00Z');
});

test('extra time and penalties each add 30 minutes, not 60', () => {
  for (const duration of ['EXTRA_TIME', 'PENALTY_SHOOTOUT']) {
    const fields = fixtures.fullTimeFields(kickoffMatch({
      score: { duration, extraTime: { home: 1, away: 1 }, penalties: { home: 5, away: 4 } },
    }));
    assert.equal(fields.finished_at, '2026-11-16T22:15:00.000Z');
    assert.equal(fields.extra_time, true);
    assert.equal(fields.full_time_source, 'estimated');
  }
});

test('only a FINISHED match with a kickoff gets a full-time estimate', () => {
  for (const status of ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'POSTPONED', 'CANCELLED', 'AWARDED']) {
    assert.equal(fixtures.fullTimeFields(kickoffMatch({ status })), null);
  }
  assert.equal(fixtures.fullTimeFields(kickoffMatch({ utcDate: 'not-a-date' })), null);
  assert.equal(fixtures.fullTimeFields(kickoffMatch({ utcDate: null })), null);
});

test('a finished league match with no score.duration is still estimated at 105 minutes', () => {
  const fields = fixtures.fullTimeFields(kickoffMatch({ score: {} }));
  assert.equal(fields.finished_at, '2026-11-16T21:45:00.000Z');
  assert.equal(fields.extra_time, false);
});

test('fixture windows look back 10 days and keep the existing 8-day horizon', () => {
  const windows = fixtures.fixtureWindows(new Date('2026-11-17T04:30:00Z'));
  assert.equal(windows.dateFrom, '2026-11-07');
  assert.equal(windows.dateTo, '2026-11-25');
  assert.equal(fixtures.FINISHED_LOOKBACK_DAYS, 10);
  assert.equal(fixtures.UPCOMING_DAYS, 8);
});

test('catch-up covers the oldest 10 days and stops at the lookback', () => {
  assert.deepEqual(
    fixtures.catchUpWindow('2026-07-10T19:00:00Z', '2026-11-07'),
    { dateFrom: '2026-07-10', dateTo: '2026-07-20' }
  );
  assert.deepEqual(
    fixtures.catchUpWindow('2026-11-01T12:00:00Z', '2026-11-07'),
    { dateFrom: '2026-11-01', dateTo: '2026-11-07' }
  );
  assert.equal(fixtures.catchUpWindow('2026-11-07T00:00:00Z', '2026-11-07'), null);
  assert.equal(fixtures.catchUpWindow('2026-11-16T20:00:00Z', '2026-11-07'), null);
  assert.equal(fixtures.catchUpWindow(null, '2026-11-07'), null);
});

test('football-data calls stop at the free-tier cap and on a spent header', () => {
  assert.equal(fixtures.FD_FREE_TIER_PER_MINUTE, 10);
  assert.equal(fixtures.canRequestFootballData({ used: 8, available: null }), true);
  assert.equal(fixtures.canRequestFootballData({ used: 9, available: null }), false);
  assert.equal(fixtures.canRequestFootballData({ used: 9, available: 4 }), true);
  assert.equal(fixtures.canRequestFootballData({ used: 10, available: 4 }), false);
  assert.equal(fixtures.canRequestFootballData({ used: 3, available: 0 }), false);

  const budget = { used: 2, available: null };
  fixtures.noteFootballDataResponse(budget, { headers: headers({ 'X-Requests-Available-Minute': '0' }) });
  assert.equal(budget.used, 3);
  assert.equal(budget.available, 0);
  assert.equal(fixtures.canRequestFootballData(budget), false);
});

test('known clubs map, and clubs outside the directory stay unmapped', () => {
  const arsenal = fixtures.fixtureFromMatch(kickoffMatch({ status: 'TIMED' }), 'PL');
  assert.equal(arsenal.row.home_team, 'Arsenal');
  assert.equal(arsenal.row.away_team, 'Chelsea');
  assert.equal(arsenal.fullTime, null);

  const cardiff = fixtures.fixtureFromMatch(kickoffMatch({
    status: 'TIMED',
    awayTeam: { name: 'Cardiff City FC' },
  }), 'PL');
  assert.equal(cardiff.row.away_team, null);
  assert.equal(fixtures.mapTeamName('Cardiff City FC'), null);
});

test('publish rows come from playlist publishedAt and skip a bad timestamp', () => {
  const rows = sync.publishRowsFromVids('creator-1', [
    { videoId: 'aaaaaaaaaaa', publishedAt: '2026-11-16T22:05:00Z' },
    { videoId: 'aaaaaaaaaaa', publishedAt: '2026-11-16T22:05:00Z' },
    { videoId: 'bbbbbbbbbbb', publishedAt: 'not-a-date' },
    { videoId: 'ccccccccccc', publishedAt: null },
  ]);
  assert.deepEqual(rows, [{
    video_id: 'aaaaaaaaaaa',
    creator_id: 'creator-1',
    published_at: '2026-11-16T22:05:00.000Z',
  }]);
  const deduped = sync.dedupeVideoRows([
    { video_id: 'aaaaaaaaaaa', creator_id: 'first' },
    { video_id: 'aaaaaaaaaaa', creator_id: 'second' },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].creator_id, 'second');
});

test('schema-missing responses are the migration-not-applied guard', () => {
  const body = '{"code":"PGRST204","message":"Could not find the \'finished_at\' column of \'frfc_fixtures\' in the schema cache"}';
  assert.equal(fixtures.isSchemaMissing(400, body), true);
  assert.equal(sync.isSchemaMissing(404, '{"code":"PGRST205","message":"Could not find the table \'public.frfc_videos\' in the schema cache"}'), true);
  assert.equal(fixtures.isSchemaMissing(500, body), false);
  assert.equal(fixtures.isSchemaMissing(400, 'permission denied'), false);
});

function withEnv(extra, fn) {
  const prev = {};
  for (const key of Object.keys(extra)) {
    prev[key] = process.env[key];
    process.env[key] = extra[key];
  }
  const prevFetch = global.fetch;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = prevFetch;
      for (const [key, value] of Object.entries(prev)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('fixtures sync estimates full time on a second write and keeps the status write free of those columns', async () => {
  const posts = [];
  const fdUrls = [];
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    FOOTBALL_DATA_API_KEY: 'fd',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('api.football-data.org')) {
        fdUrls.push(u);
        if (u.includes('/competitions/PL/')) {
          return jsonRes({
            matches: [
              kickoffMatch(),
              kickoffMatch({
                id: 102,
                status: 'TIMED',
                utcDate: '2026-11-20T20:00:00Z',
                awayTeam: { name: 'Cardiff City FC' },
                homeTeam: { name: 'Liverpool FC' },
              }),
              kickoffMatch({ id: 103, status: 'IN_PLAY', utcDate: '2026-11-17T04:00:00Z' }),
            ],
          });
        }
        return jsonRes({ matches: [] });
      }
      if (u.includes('/frfc_fixtures?') && options.method === 'POST') {
        posts.push(JSON.parse(options.body));
        return jsonRes({});
      }
      if (u.includes('/frfc_fixtures?')) return jsonRes([]);
      return jsonRes([]);
    };
    const res = await fixtures.handler();
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.finished_matches, 1);
    assert.equal(body.migration_required, false);
    assert.equal(body.football_data_requests, 8);
    assert.equal(body.catch_up, null);
    assert.ok(body.unmatched_teams.includes('Cardiff City FC'));
  });

  const competitionCalls = fdUrls.filter(u => u.includes('/competitions/'));
  assert.equal(competitionCalls.length, 8);
  assert.equal(fdUrls.filter(u => u.includes('/v4/matches?')).length, 0);
  for (const u of competitionCalls) {
    assert.match(u, /status=SCHEDULED,TIMED,FINISHED/);
    const from = new URL(u).searchParams.get('dateFrom');
    const to = new URL(u).searchParams.get('dateTo');
    const windows = fixtures.fixtureWindows(new Date());
    assert.equal(from, windows.dateFrom);
    assert.equal(to, windows.dateTo);
  }

  assert.equal(posts.length, 2);
  const statusRows = posts[0];
  assert.equal(statusRows.some(row => Object.prototype.hasOwnProperty.call(row, 'finished_at')), false);
  assert.equal(statusRows.some(row => Object.prototype.hasOwnProperty.call(row, 'full_time_source')), false);
  assert.equal(statusRows.some(row => Object.prototype.hasOwnProperty.call(row, 'extra_time')), false);
  assert.equal(statusRows.some(row => Object.prototype.hasOwnProperty.call(row, 'trigger_sent_at')), false);
  assert.equal(statusRows.find(row => row.external_id === 101).status, 'FINISHED');
  assert.equal(statusRows.find(row => row.external_id === 102).status, 'TIMED');
  assert.equal(statusRows.find(row => row.external_id === 103).status, 'IN_PLAY');

  assert.deepEqual(posts[1], [{
    external_id: 101,
    status: 'FINISHED',
    finished_at: '2026-11-16T21:45:00.000Z',
    full_time_source: 'estimated',
    extra_time: false,
  }]);
});

test('a missing full-time column does not fail the fixture sync', async () => {
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    FOOTBALL_DATA_API_KEY: 'fd',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/competitions/PL/')) return jsonRes({ matches: [kickoffMatch()] });
      if (u.includes('api.football-data.org')) return jsonRes({ matches: [] });
      if (u.includes('/frfc_fixtures?') && options.method === 'POST') {
        const rows = JSON.parse(options.body);
        if (rows.some(row => Object.prototype.hasOwnProperty.call(row, 'finished_at'))) {
          return jsonRes({
            code: 'PGRST204',
            message: "Could not find the 'finished_at' column of 'frfc_fixtures' in the schema cache",
          }, 400);
        }
        return jsonRes({});
      }
      return jsonRes([]);
    };
    const res = await fixtures.handler();
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.migration_required, true);
    assert.equal(body.fixtures_found, 1);
    assert.equal(body.finished_matches, 1);
  });
});

test('a real full-time write failure is reported after the status upsert', async () => {
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    FOOTBALL_DATA_API_KEY: 'fd',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/competitions/PL/')) return jsonRes({ matches: [kickoffMatch()] });
      if (u.includes('api.football-data.org')) return jsonRes({ matches: [] });
      if (u.includes('/frfc_fixtures?') && options.method === 'POST') {
        const rows = JSON.parse(options.body);
        if (rows.some(row => Object.prototype.hasOwnProperty.call(row, 'finished_at'))) {
          return jsonRes('database unavailable', 500);
        }
        return jsonRes({});
      }
      return jsonRes([]);
    };
    const res = await fixtures.handler();
    assert.equal(res.statusCode, 502);
    assert.match(JSON.parse(res.body).error, /full-time upsert failed/);
  });
});

test('catch-up is one date-range request for the oldest unfinished slice', async () => {
  const fdUrls = [];
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    FOOTBALL_DATA_API_KEY: 'fd',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('api.football-data.org')) {
        fdUrls.push(u);
        if (u.includes('/v4/matches?')) {
          return jsonRes({
            resultSet: { count: 1 },
            matches: [{
              ...kickoffMatch({ id: 900, utcDate: '2026-07-10T19:00:00Z' }),
              competition: { code: 'CL' },
            }],
          });
        }
        return jsonRes({ matches: [] });
      }
      if (u.includes('finished_at=is.null')) return jsonRes([]);
      if (u.includes('status=not.in.') && u.includes('kickoff_at=lt.')) {
        return jsonRes([{ kickoff_at: '2026-07-10T19:00:00Z' }]);
      }
      if (options.method === 'POST') return jsonRes({});
      return jsonRes([]);
    };
    const res = await fixtures.handler();
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.football_data_requests, 9);
    assert.equal(body.fixtures_found, 1);
    assert.deepEqual(body.catch_up, fixtures.catchUpWindow('2026-07-10T19:00:00Z', fixtures.fixtureWindows(new Date()).dateFrom));
  });

  const catchUpUrls = fdUrls.filter(u => u.includes('/v4/matches?'));
  assert.equal(catchUpUrls.length, 1);
  assert.equal(fdUrls.filter(u => u.includes('/competitions/')).length, 8);
  const params = new URL(catchUpUrls[0]).searchParams;
  assert.equal(params.get('dateFrom'), '2026-07-10');
  assert.equal(params.get('dateTo'), bodyDateTo(params));
  assert.equal(params.get('limit'), '500');
  assert.ok(params.get('competitions').split(',').includes('PL'));
  assert.equal(params.get('status'), null);
});

function bodyDateTo(params) {
  const windows = fixtures.fixtureWindows(new Date());
  const expected = fixtures.catchUpWindow('2026-07-10T19:00:00Z', windows.dateFrom);
  assert.equal(params.get('dateTo'), expected.dateTo);
  return params.get('dateTo');
}

test('catch-up still fills finished rows that have no full-time value', async () => {
  const fdUrls = [];
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    FOOTBALL_DATA_API_KEY: 'fd',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('api.football-data.org')) {
        fdUrls.push(u);
        if (u.includes('/v4/matches?')) return jsonRes({ matches: [], resultSet: { count: 0 } });
        return jsonRes({ matches: [] });
      }
      if (u.includes('finished_at=is.null')) return jsonRes([{ kickoff_at: '2026-08-01T15:00:00Z' }]);
      if (u.includes('status=not.in.')) return jsonRes([]);
      if (options.method === 'POST') return jsonRes({});
      return jsonRes([]);
    };
    const res = await fixtures.handler();
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.football_data_requests, 9);
    assert.equal(body.catch_up.dateFrom, '2026-08-01');
  });
  assert.equal(fdUrls.filter(u => u.includes('/v4/matches?')).length, 1);
});

test('a missing finished_at column falls back to open fixtures for catch-up', async () => {
  let matchListCalls = 0;
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    FOOTBALL_DATA_API_KEY: 'fd',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/v4/matches?')) {
        matchListCalls += 1;
        return jsonRes({ matches: [], resultSet: { count: 0 } });
      }
      if (u.includes('api.football-data.org')) return jsonRes({ matches: [] });
      if (u.includes('finished_at=is.null')) {
        return jsonRes({
          code: 'PGRST204',
          message: "Could not find the 'finished_at' column of 'frfc_fixtures' in the schema cache",
        }, 400);
      }
      if (u.includes('status=not.in.')) return jsonRes([{ kickoff_at: '2026-07-10T19:00:00Z' }]);
      if (options.method === 'POST') return jsonRes({});
      return jsonRes([]);
    };
    const res = await fixtures.handler();
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).catch_up.dateFrom, '2026-07-10');
  });
  assert.equal(matchListCalls, 1);
});

test('a 429 or a spent request counter stops further football-data calls', async () => {
  const fdUrls = [];
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    FOOTBALL_DATA_API_KEY: 'fd',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.football-data.org')) {
        fdUrls.push(u);
        return jsonRes({ message: 'too many' }, 429, { 'X-RequestsAvailable': '0' });
      }
      return jsonRes([]);
    };
    const res = await fixtures.handler();
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).football_data_requests, 1);
    assert.equal(JSON.parse(res.body).fixtures_found, 0);
  });
  assert.equal(fdUrls.length, 1);
});

test('sync stores playlist publishedAt on frfc_videos and does not add a YouTube call', async () => {
  const ytUrls = [];
  const posts = [];
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    YOUTUBE_API_KEY: 'yt',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('googleapis.com/youtube')) {
        ytUrls.push(u);
        if (u.includes('/channels?')) {
          return jsonRes({
            items: [{
              id: 'UC1',
              statistics: { subscriberCount: '12', viewCount: '40', videoCount: '2' },
              snippet: { publishedAt: '2020-01-01T00:00:00Z', thumbnails: { high: { url: 'https://img.example/a.jpg' } } },
              contentDetails: { relatedPlaylists: { uploads: 'UU1' } },
            }],
          });
        }
        if (u.includes('/playlistItems?')) {
          return jsonRes({
            items: [
              { snippet: { resourceId: { videoId: 'vid00000001' }, publishedAt: '2026-11-16T22:10:00Z', title: 'Full time reaction' } },
              { snippet: { resourceId: { videoId: 'vid00000002' }, publishedAt: '2026-11-15T18:00:00Z', title: 'Older' } },
            ],
          });
        }
        if (u.includes('/videos?')) {
          return jsonRes({
            items: [{
              id: 'vid00000001',
              statistics: { viewCount: '9', likeCount: '2', commentCount: '1' },
              snippet: { liveBroadcastContent: 'none', publishedAt: '2026-11-16T22:10:00Z' },
            }],
          });
        }
        throw new Error('unexpected YouTube url ' + u);
      }
      if (options.method === 'POST' && (u.includes('/frfc_video_metrics') || u.includes('/frfc_videos'))) {
        posts.push({ url: u, body: JSON.parse(options.body) });
        return jsonRes({});
      }
      if (options.method === 'POST' && u.includes('/frfc_job_runs')) return jsonRes([{ id: 'job-1' }]);
      if (u.includes('/frfc_streamers?')) {
        return jsonRes([{ id: 'creator-1', name: 'AFTV', channel_url: 'https://www.youtube.com/@aftv', avatar_url: null, avatar_custom: false }]);
      }
      return jsonRes({});
    };

    const res = await sync.handler();
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, 1);
    assert.equal(body.videosRecorded, 2);
    assert.equal(body.videosMigrationRequired, false);
    assert.equal(body.quota, 9);
  });

  assert.equal(ytUrls.length, 3);
  const playlist = ytUrls.find(u => u.includes('/playlistItems?'));
  assert.equal(new URL(playlist).searchParams.get('part'), 'snippet');
  assert.equal(ytUrls.filter(u => u.includes('/playlistItems?')).length, 1);
  assert.equal(ytUrls.filter(u => u.includes('/videos?')).length, 1);

  const metrics = posts.find(post => post.url.includes('/frfc_video_metrics'));
  assert.ok(metrics);
  assert.equal(metrics.body.some(row => Object.prototype.hasOwnProperty.call(row, 'published_at')), false);
  assert.equal(metrics.body.some(row => Object.prototype.hasOwnProperty.call(row, 'video_published_at')), false);

  const videos = posts.find(post => post.url.includes('/frfc_videos'));
  assert.ok(videos.url.includes('on_conflict=video_id'));
  const byId = Object.fromEntries(videos.body.map(row => [row.video_id, row]));
  assert.equal(byId.vid00000001.published_at, '2026-11-16T22:10:00.000Z');
  assert.equal(byId.vid00000001.creator_id, 'creator-1');
  assert.equal(byId.vid00000002.published_at, '2026-11-15T18:00:00.000Z');
  assert.equal(typeof byId.vid00000001.updated_at, 'string');
});

test('a failed video-detail call still stores the playlist upload time', async () => {
  const posts = [];
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    YOUTUBE_API_KEY: 'yt',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/channels?')) {
        return jsonRes({
          items: [{
            id: 'UC1',
            statistics: { subscriberCount: '3', viewCount: '4', videoCount: '1' },
            snippet: {},
            contentDetails: { relatedPlaylists: { uploads: 'UU1' } },
          }],
        });
      }
      if (u.includes('/playlistItems?')) {
        return jsonRes({
          items: [{ snippet: { resourceId: { videoId: 'vid00000009' }, publishedAt: '2026-11-16T23:00:00Z', title: 'Reaction' } }],
        });
      }
      if (u.includes('/videos?')) return jsonRes({ error: { message: 'backend' } }, 500);
      if (options.method === 'POST' && u.includes('/frfc_videos')) {
        posts.push(JSON.parse(options.body));
        return jsonRes({});
      }
      if (options.method === 'POST' && u.includes('/frfc_job_runs')) return jsonRes([{ id: 'job-1' }]);
      if (u.includes('/frfc_streamers?select=')) {
        return jsonRes([{ id: 'creator-9', channel_url: 'https://www.youtube.com/@creator', avatar_custom: false }]);
      }
      return jsonRes({});
    };
    const res = await sync.handler();
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).videosRecorded, 1);
    assert.equal(JSON.parse(res.body).videoMetricsRecorded, 0);
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0][0].video_id, 'vid00000009');
  assert.equal(posts[0][0].published_at, '2026-11-16T23:00:00.000Z');
});

test('a missing frfc_videos table does not fail the YouTube sync', async () => {
  let metricsPosted = false;
  await withEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    YOUTUBE_API_KEY: 'yt',
    SUPABASE_URL: 'https://supabase.test',
  }, async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/channels?')) {
        return jsonRes({
          items: [{
            id: 'UC1',
            statistics: { subscriberCount: '3', viewCount: '4', videoCount: '1' },
            snippet: {},
            contentDetails: { relatedPlaylists: { uploads: 'UU1' } },
          }],
        });
      }
      if (u.includes('/playlistItems?')) {
        return jsonRes({
          items: [{ snippet: { resourceId: { videoId: 'vid00000009' }, publishedAt: '2026-11-16T23:00:00Z', title: 'Reaction' } }],
        });
      }
      if (u.includes('/videos?')) {
        return jsonRes({ items: [{ id: 'vid00000009', statistics: { viewCount: '1' }, snippet: { liveBroadcastContent: 'none' } }] });
      }
      if (options.method === 'POST' && u.includes('/frfc_video_metrics')) {
        metricsPosted = true;
        return jsonRes({});
      }
      if (options.method === 'POST' && u.includes('/frfc_videos')) {
        return jsonRes({
          code: 'PGRST205',
          message: "Could not find the table 'public.frfc_videos' in the schema cache",
        }, 404);
      }
      if (options.method === 'POST' && u.includes('/frfc_job_runs')) return jsonRes([{ id: 'job-1' }]);
      if (u.includes('/frfc_streamers?select=')) {
        return jsonRes([{ id: 'creator-9', channel_url: 'https://www.youtube.com/@creator', avatar_custom: false }]);
      }
      return jsonRes({});
    };
    const res = await sync.handler();
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, 1);
    assert.equal(body.videosRecorded, 0);
    assert.equal(body.videosMigrationRequired, true);
    assert.equal(body.videoMetricsRecorded, 1);
  });
  assert.equal(metricsPosted, true);
});

test('schedule lines this PR must not take from the concurrent schedule PR are unchanged', () => {
  const syncSrc = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/sync-background.js'), 'utf8');
  const fixtureSrc = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/fixtures-sync.js'), 'utf8');
  assert.match(syncSrc, /exports\.config = \{ schedule: '0 7,15 \* \* \*' \};/);
  assert.match(fixtureSrc, /exports\.config = \{ schedule: '30 4 \* \* \*' \};/);
  assert.equal(syncSrc.match(/ytFetch\(ytKey,\s*'playlistItems'/g).length, 1);
  assert.equal(syncSrc.match(/ytFetch\(ytKey,\s*'videos'/g).length, 1);
  assert.equal(syncSrc.match(/ytFetch\(ytKey,\s*'channels'/g).length, 1);
});
