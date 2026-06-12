// Weekly scheduled snapshot — copies each creator's current subscriber_count
// and computed avg_rating into the _prev columns. The rankings UI diffs
// current vs _prev to render ↑N / ↓N / NEW movement badges.
//
// Runs every Monday at 03:00 UTC. Cheap: two SQL statements per run.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

exports.config = { schedule: '0 3 * * 1' };

const DEFAULT_SUPABASE_URL = 'https://dsxijgrpxsfywxuffbmt.supabase.co';

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }) };

  // 1. Aggregate current avg rating per creator from frfc_reviews.
  const ratingsRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_reviews?select=creator_id,rating`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (!ratingsRes.ok) return { statusCode: 502, body: JSON.stringify({ error: 'reviews fetch failed' }) };
  const reviews = await ratingsRes.json();

  const ratingByCreator = {};
  for (const r of reviews) {
    if (!ratingByCreator[r.creator_id]) ratingByCreator[r.creator_id] = [];
    ratingByCreator[r.creator_id].push(r.rating);
  }

  // 2. Fetch all creators.
  const creatorsRes = await fetch(
    `${supabaseUrl}/rest/v1/frfc_streamers?select=id,subscriber_count`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (!creatorsRes.ok) return { statusCode: 502, body: JSON.stringify({ error: 'creators fetch failed' }) };
  const creators = await creatorsRes.json();

  // 3. PATCH each creator's _prev columns. Small loop, runs once a week.
  const now = new Date().toISOString();
  let ok = 0, fail = 0;
  for (const c of creators) {
    const ratings = ratingByCreator[c.id] || [];
    const avgRating = ratings.length
      ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
      : null;
    const res = await fetch(
      `${supabaseUrl}/rest/v1/frfc_streamers?id=eq.${encodeURIComponent(c.id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          subscriber_count_prev: c.subscriber_count,
          avg_rating_prev: avgRating,
          rank_snapshot_at: now,
        }),
      }
    );
    if (res.ok) ok++; else fail++;
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot_at: now, ok, fail, total: creators.length }),
  };
};
