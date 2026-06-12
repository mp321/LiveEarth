// Vercel serverless function: CelesTrak active-satellite TLEs, shared-cached.
//
// CelesTrak rate-limits aggressively (403 + temporary IP block when polled too
// often) and asks clients to cache. Proxying through this function means ALL
// visitors share one upstream fetch instead of each browser hitting CelesTrak:
// the element set is cached in module scope for 2h and served with
// `s-maxage=7200` so Vercel's CDN absorbs repeat requests. TLEs stay accurate
// for hours, so 2h staleness is fine — the client re-propagates them to "now"
// on every refresh.
//
// On an upstream 403 (rate limit) we serve the stale cached set if we hold
// one, else 503 — the client then falls back to its localStorage copy and
// finally degrades to an empty layer.

const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';

const TLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Module-scope cache persists across invocations while the lambda is warm.
let tleCache = { text: null, fetchedAt: 0 };

// CelesTrak serves error prose as text too — only cache bodies that actually
// look like a TLE set (name line followed by "1 ..." / "2 ..." lines).
function looksLikeTle(text) {
  const lines = (text || '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.length >= 3 && lines[1].startsWith('1 ') && lines[2].startsWith('2 ');
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (tleCache.text && Date.now() - tleCache.fetchedAt < TLE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=7200');
    res.status(200).send(tleCache.text);
    return;
  }

  try {
    const upstream = await fetch(CELESTRAK_URL);
    const text = upstream.ok ? await upstream.text() : null;
    if (!upstream.ok || !looksLikeTle(text)) {
      throw new Error(`CelesTrak responded ${upstream.status}`);
    }
    tleCache = { text, fetchedAt: Date.now() };
    res.setHeader('Cache-Control', 'public, s-maxage=7200');
    res.status(200).send(text);
  } catch (err) {
    if (tleCache.text) {
      // Upstream blocked (403) or malformed — serve the stale set we hold.
      res.setHeader('Cache-Control', 'public, s-maxage=600');
      res.status(200).send(tleCache.text);
      return;
    }
    res.status(503).send(`TLE upstream unavailable: ${String(err.message || err)}`);
  }
}
