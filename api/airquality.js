// Vercel serverless function: OpenAQ v3 PM2.5 latest readings, key proxied.
//
// OpenAQ v3 requires an API key. It used to live in the client as
// VITE_OPENAQ_KEY (inlined into the public bundle); this proxy moves it
// server-side as OPENAQ_KEY (Vercel project env var — never VITE_-prefixed).
// The JSON body passes through untouched; the client's fetchLiveAirQuality
// parses `results` exactly as it did against api.openaq.org directly.
//
// Without the key configured this returns 503 and the layer degrades to
// empty — the registry note tells the operator to set OPENAQ_KEY in Vercel.

const OPENAQ_URL = 'https://api.openaq.org/v3/parameters/2/latest?limit=1000';

export default async function handler(req, res) {
  const key = process.env.OPENAQ_KEY;
  if (!key) {
    res.status(503).json({ error: 'OPENAQ_KEY not configured' });
    return;
  }

  try {
    const upstream = await fetch(OPENAQ_URL, { headers: { 'X-API-Key': key } });
    if (!upstream.ok) {
      res.status(502).json({ error: `OpenAQ responded ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    // Ground-station "latest" values update on the order of an hour; 5 min of
    // CDN sharing keeps us well inside OpenAQ's rate limits.
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
