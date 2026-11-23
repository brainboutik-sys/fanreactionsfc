const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sync = require('../netlify/functions/sync-background.js');

const ROOT = path.join(__dirname, '..');
const NEXT_RUN = '2026-11-17T15:00:00.000Z';

function jsonResponse(body, ok = true, status = ok ? 200 : 500) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => text,
  };
}

function scheduledEvent(body = { next_run: NEXT_RUN }, extra = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Netlify Clockwork',
      'x-nf-event': 'schedule',
    },
    body: extra.isBase64Encoded ? Buffer.from(raw, 'utf8').toString('base64') : raw,
    isBase64Encoded: Boolean(extra.isBase64Encoded),
  };
}

function withFetch(impl, fn) {
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevYt = process.env.YOUTUBE_API_KEY;
  const prevUrl = process.env.SUPABASE_URL;
  const prevFetch = global.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  process.env.YOUTUBE_API_KEY = 'yt-test-key';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const entry = {
      url: String(url),
      method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : null,
    };
    calls.push(entry);
    return impl(entry, calls);
  };
  return fn(calls).finally(() => {
    global.fetch = prevFetch;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    if (prevYt == null) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = prevYt;
    if (prevUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
  });
}

describe('sync-background schedule', { concurrency: false }, () => {
  test('07:00 and 15:00 UTC are registered in netlify.toml, and the other crons stay', () => {
    assert.equal(sync.SCHEDULE, '0 7,15 * * *');
    assert.equal(sync.config.schedule, sync.SCHEDULE);
    assert.equal(sync.JOB_TYPE, 'sync-background');
    const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
    const section = toml.split('[functions."sync-background"]')[1];
    assert.ok(section, 'sync-background schedule block missing from netlify.toml');
    const body = section.split(/\n\[/)[0];
    assert.match(body, /schedule = "0 7,15 \* \* \*"/);
    assert.match(toml, /\[functions\."rank-snapshot-background"\]\s+schedule = "0 3 \* \* 1"/);
    assert.match(toml, /\[functions\."weekly-ranking-scheduled"\]\s+schedule = "0 8 \* \* 1"/);
    const rankAt = toml.indexOf('[functions."rank-snapshot-background"]');
    const syncAt = toml.indexOf('[functions."sync-background"]');
    const weeklyAt = toml.indexOf('[functions."weekly-ranking-scheduled"]');
    assert.ok(rankAt > 0 && syncAt > rankAt && weeklyAt > syncAt);
  });

  test('the YouTube calls this job makes are unchanged', () => {
    const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/sync-background.js'), 'utf8');
    assert.match(src, /ytFetch\(ytKey, 'channels'/);
    assert.match(src, /ytFetch\(ytKey, 'playlistItems'/);
    assert.match(src, /ytFetch\(ytKey, 'videos'/);
    assert.match(src, /part: 'snippet,statistics,contentDetails'/);
    assert.match(src, /part: 'snippet'/);
    assert.match(src, /part: 'snippet,statistics,liveStreamingDetails'/);
    assert.match(src, /quota \+= 5/);
    assert.match(src, /quota \+= 3/);
    assert.match(src, /quota \+= 1/);
    assert.doesNotMatch(src, /is_verified\s*:/);
    assert.doesNotMatch(src, /verified_until\s*:/);
  });

  test('a public GET returns 403 and does not call YouTube or write a job run', async () => {
    await withFetch(() => {
      throw new Error('fetch should not run');
    }, async (calls) => {
      const res = await sync.handler({
        httpMethod: 'GET',
        headers: { 'user-agent': 'curl/8.0' },
        body: null,
      });
      assert.equal(res.statusCode, 403);
      assert.deepEqual(JSON.parse(res.body), { error: 'Forbidden' });
      assert.equal(calls.length, 0);
    });
  });

  test('a GET with a scheduler body still returns 403', async () => {
    const res = await sync.handler({
      httpMethod: 'GET',
      body: JSON.stringify({ next_run: NEXT_RUN }),
    });
    assert.equal(res.statusCode, 403);
    assert.equal(sync.scheduledNextRun({ httpMethod: 'GET', body: JSON.stringify({ next_run: NEXT_RUN }) }), null);
  });

  test('a POST without the scheduler payload returns 403 and does no work', async () => {
    await withFetch(() => {
      throw new Error('fetch should not run');
    }, async (calls) => {
      const empty = await sync.handler({ httpMethod: 'POST', body: '' });
      const junk = await sync.handler({ httpMethod: 'POST', body: '{"hello":1}' });
      const badDate = await sync.handler({ httpMethod: 'POST', body: '{"next_run":"tomorrow"}' });
      const missing = await sync.handler();
      for (const res of [empty, junk, badDate, missing]) {
        assert.equal(res.statusCode, 403);
        assert.equal(JSON.parse(res.body).error, 'Forbidden');
      }
      assert.equal(calls.length, 0);
    });
  });

  test('a scheduled run with no service key does not call YouTube or open a job', async () => {
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevYt = process.env.YOUTUBE_API_KEY;
    const prevFetch = global.fetch;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.YOUTUBE_API_KEY = 'yt-test-key';
    let called = false;
    global.fetch = async () => { called = true; return jsonResponse([]); };
    try {
      const res = await sync.handler(scheduledEvent());
      assert.equal(res.statusCode, 500);
      assert.match(JSON.parse(res.body).error, /SUPABASE_SERVICE_ROLE_KEY/);
      assert.equal(called, false);
    } finally {
      global.fetch = prevFetch;
      if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
      if (prevYt == null) delete process.env.YOUTUBE_API_KEY;
      else process.env.YOUTUBE_API_KEY = prevYt;
    }
  });

  test('the scheduler POST syncs one creator and logs the run to frfc_job_runs', async () => {
    const creators = [{
      id: 'c1',
      name: 'AFTV',
      channel_url: 'https://www.youtube.com/@aftv',
      avatar_url: 'https://example/old.jpg',
      avatar_custom: false,
    }];

    await withFetch((entry) => {
      const url = new URL(entry.url);
      if (entry.method === 'POST' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([{ id: 'job-1' }]);
      }
      if (entry.method === 'PATCH' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([], true, 204);
      }
      if (entry.method === 'GET' && url.pathname.endsWith('/frfc_streamers')) {
        return jsonResponse(creators);
      }
      if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/channels')) {
        return jsonResponse({
          items: [{
            id: 'UC123',
            statistics: { subscriberCount: '1000', viewCount: '5000', videoCount: '12' },
            snippet: {
              publishedAt: '2020-01-01T00:00:00Z',
              country: 'GB',
              thumbnails: { high: { url: 'https://yt.example/avatar.jpg' } },
            },
            contentDetails: { relatedPlaylists: { uploads: 'UU123' } },
          }],
        });
      }
      if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/playlistItems')) {
        return jsonResponse({
          items: [
            { snippet: { resourceId: { videoId: 'vid1' }, publishedAt: '2026-11-16T12:00:00Z', title: 'Reaction' } },
            { snippet: { resourceId: { videoId: 'vid2' }, publishedAt: '2026-11-10T12:00:00Z', title: 'Older' } },
          ],
        });
      }
      if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/videos')) {
        return jsonResponse({
          items: [
            {
              id: 'vid1',
              statistics: { viewCount: '100', likeCount: '4', commentCount: '1' },
              snippet: { liveBroadcastContent: 'none', title: 'Reaction' },
            },
            {
              id: 'vid2',
              statistics: { viewCount: '50', likeCount: '2', commentCount: '0' },
              snippet: { liveBroadcastContent: 'none', title: 'Older' },
            },
          ],
        });
      }
      if (entry.method === 'PATCH' && url.pathname.endsWith('/frfc_streamers')) {
        return jsonResponse([], true, 204);
      }
      if (entry.method === 'POST' && url.pathname.endsWith('/frfc_subscriber_history')) {
        return jsonResponse([], true, 201);
      }
      if (entry.method === 'POST' && url.pathname.endsWith('/frfc_video_metrics')) {
        return jsonResponse([], true, 201);
      }
      return jsonResponse({ error: 'unexpected ' + entry.method + ' ' + entry.url }, false, 500);
    }, async (calls) => {
      const res = await sync.handler(scheduledEvent());
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.total, 1);
      assert.equal(body.ok, 1);
      assert.equal(body.fail, 0);
      assert.equal(body.quota, 9);
      assert.equal(body.videoMetricsRecorded, 2);

      const channels = calls.find((c) => c.url.includes('/youtube/v3/channels'));
      const playlist = calls.find((c) => c.url.includes('/youtube/v3/playlistItems'));
      const videos = calls.find((c) => c.url.includes('/youtube/v3/videos'));
      assert.ok(channels && playlist && videos);
      assert.equal(new URL(channels.url).searchParams.get('forHandle'), 'aftv');
      assert.equal(new URL(channels.url).searchParams.get('part'), 'snippet,statistics,contentDetails');
      assert.equal(new URL(channels.url).searchParams.get('key'), 'yt-test-key');
      assert.equal(new URL(playlist.url).searchParams.get('playlistId'), 'UU123');
      assert.equal(new URL(playlist.url).searchParams.get('part'), 'snippet');
      assert.equal(new URL(playlist.url).searchParams.get('maxResults'), '5');
      assert.equal(new URL(videos.url).searchParams.get('id'), 'vid1,vid2');
      assert.equal(new URL(videos.url).searchParams.get('part'), 'snippet,statistics,liveStreamingDetails');

      const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/frfc_streamers?'));
      assert.equal(patch.body.youtube_channel_id, 'UC123');
      assert.equal(patch.body.subscriber_count, 1000);
      assert.equal(patch.body.latest_video_id, 'vid1');
      assert.equal(patch.body.latest_video_views, 100);
      assert.equal(patch.body.upcoming_video_id, null);
      assert.equal(Object.hasOwn(patch.body, 'is_verified'), false);
      assert.equal(Object.hasOwn(patch.body, 'verified_until'), false);
      assert.equal(Object.hasOwn(patch.body, 'is_live'), false);

      const history = calls.find((c) => c.method === 'POST' && c.url.includes('/frfc_subscriber_history'));
      assert.deepEqual(history.body, { creator_id: 'c1', subscriber_count: 1000 });
      const metrics = calls.find((c) => c.method === 'POST' && c.url.includes('/frfc_video_metrics'));
      assert.equal(metrics.body.length, 2);
      assert.equal(metrics.body[0].video_id, 'vid1');
      assert.equal(metrics.body[0].views, 100);

      const start = calls.find((c) => c.method === 'POST' && c.url.includes('/frfc_job_runs'));
      assert.deepEqual(start.body, { job_type: 'sync-background', status: 'running' });
      const finish = calls.find((c) => c.method === 'PATCH' && c.url.includes('/frfc_job_runs'));
      assert.equal(finish.url.includes('id=eq.job-1'), true);
      assert.equal(finish.body.status, 'success');
      assert.equal(finish.body.items_processed, 1);
      assert.equal(finish.body.items_failed, 0);
      assert.equal(finish.body.quota_used, 9);
      assert.equal(typeof finish.body.finished_at, 'string');
    });
  });

  test('a base64 scheduler body is accepted and a handle-less creator is still logged', async () => {
    await withFetch((entry) => {
      const url = new URL(entry.url);
      if (entry.method === 'POST' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([{ id: 'job-2' }]);
      }
      if (entry.method === 'PATCH' && url.pathname.endsWith('/frfc_job_runs')) {
        return jsonResponse([], true, 204);
      }
      if (entry.method === 'GET' && url.pathname.endsWith('/frfc_streamers')) {
        return jsonResponse([{
          id: 'c2',
          name: 'No handle',
          channel_url: 'https://www.youtube.com/channel/UC999',
          avatar_url: null,
          avatar_custom: false,
        }]);
      }
      return jsonResponse({ error: 'unexpected ' + entry.url }, false, 500);
    }, async (calls) => {
      const res = await sync.handler(scheduledEvent({ next_run: NEXT_RUN }, { isBase64Encoded: true }));
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, 0);
      assert.equal(body.fail, 1);
      assert.equal(body.quota, 0);
      assert.equal(calls.some((c) => c.url.includes('googleapis.com')), false);
      const finish = calls.find((c) => c.method === 'PATCH' && c.url.includes('/frfc_job_runs'));
      assert.equal(finish.body.status, 'failed');
      assert.equal(finish.body.items_processed, 0);
      assert.equal(finish.body.items_failed, 1);
      assert.equal(finish.body.quota_used, 0);
      assert.equal(typeof finish.body.finished_at, 'string');
    });
  });
});
