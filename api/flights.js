// Vercel serverless function: global live flights via the OpenSky Network.
//
// OpenSky's anonymous API is deprecated, but a free account gets OAuth2 client
// credentials. The secret must stay server-side, so this function does the
// token dance and proxies /api/states/all, normalizing OpenSky's positional
// state vectors into the readsb-ish `{ ac: [...] }` shape that the client's
// fetchLiveFlights already parses (same shape airplanes.live returns) — the
// client needs no format branching.
//
// Secrets: OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET from the Vercel project's
// environment variables (Settings → Environment Variables). NEVER prefix these
// with VITE_ — Vite inlines VITE_* vars into the public client bundle.
//
// CACHING: the upstream response is cached in module scope for 60s (a warm
// lambda shares it across invocations) and served with `s-maxage=60` so
// Vercel's CDN collapses all visitors onto ~1 upstream call/min. OpenSky
// credits a global /states/all call at 4 credits against a daily budget, so
// do not lower the TTL.

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
// extended=1 adds the emitter category (index 17), which the client uses to
// color general-aviation traffic differently.
const STATES_URL = 'https://opensky-network.org/api/states/all?extended=1';

const STATES_TTL_MS = 60_000;
const TOKEN_MARGIN_MS = 60_000; // refresh the token a minute before expiry

// Module-scope caches persist across invocations while the lambda is warm.
let tokenCache = { token: null, expiresAt: 0 };
let statesCache = { body: null, fetchedAt: 0 };

// OpenSky → m/imperial conversions (readsb reports ft / knots / ft/min).
const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;
const MS_TO_FPM = 196.85;

// OpenSky emitter category (state vector index 17, integer) → ADS-B wake
// category code as readsb reports it. 2..8 = A1..A7, 9..15 = B1..B7,
// 16..17 = C1..C2; 0/1 mean "no info".
function wakeCategory(c) {
  if (!Number.isInteger(c) || c < 2 || c > 17) return undefined;
  if (c <= 8) return `A${c - 1}`;
  if (c <= 15) return `B${c - 8}`;
  return `C${c - 15}`;
}

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - TOKEN_MARGIN_MS) {
    return tokenCache.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.OPENSKY_CLIENT_ID,
      client_secret: process.env.OPENSKY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`OpenSky token endpoint responded ${res.status}`);
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    // expires_in is seconds (typically 1800 = 30 min).
    expiresAt: Date.now() + (Number(data.expires_in) || 1800) * 1000,
  };
  return tokenCache.token;
}

// One OpenSky state vector (positional array) → readsb-ish aircraft object.
// Indices: 0 icao24, 1 callsign, 5 longitude, 6 latitude, 7 baro_altitude (m),
// 8 on_ground, 9 velocity (m/s), 10 true_track, 11 vertical_rate (m/s),
// 14 squawk, 17 category (with extended=1). Exported for tests; Vercel only
// invokes the default export.
export function toAircraft(s) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const altM = num(s[7]);
  const gsMs = num(s[9]);
  const vrMs = num(s[11]);
  return {
    hex: s[0],
    flight: typeof s[1] === 'string' ? s[1].trim() : undefined,
    lat: num(s[6]),
    lon: num(s[5]),
    alt_baro: s[8] ? 'ground' : altM != null ? Math.round(altM * M_TO_FT) : null,
    gs: gsMs != null ? Math.round(gsMs * MS_TO_KT) : null,
    track: num(s[10]),
    baro_rate: vrMs != null ? Math.round(vrMs * MS_TO_FPM) : null,
    squawk: s[14] || undefined,
    category: wakeCategory(s[17]),
  };
}

async function fetchStates() {
  let token = await getAccessToken();
  let res = await fetch(STATES_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // Token revoked/expired early — refresh once and retry.
    tokenCache = { token: null, expiresAt: 0 };
    token = await getAccessToken();
    res = await fetch(STATES_URL, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) throw new Error(`OpenSky /states/all responded ${res.status}`);
  const data = await res.json();
  const states = Array.isArray(data?.states) ? data.states : [];
  return {
    now: data.time,
    ac: states.map(toAircraft).filter((a) => a.lat != null && a.lon != null),
  };
}

export default async function handler(req, res) {
  if (!process.env.OPENSKY_CLIENT_ID || !process.env.OPENSKY_CLIENT_SECRET) {
    res
      .status(503)
      .json({ error: 'OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET not configured' });
    return;
  }

  try {
    if (!statesCache.body || Date.now() - statesCache.fetchedAt >= STATES_TTL_MS) {
      statesCache = { body: await fetchStates(), fetchedAt: Date.now() };
    }
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    res.status(200).json(statesCache.body);
  } catch (err) {
    // Serve stale on a transient upstream failure; the client falls back to
    // airplanes.live (and ultimately []) on a 5xx, so the globe never breaks.
    if (statesCache.body) {
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      res.status(200).json(statesCache.body);
      return;
    }
    res.status(502).json({ error: String(err.message || err) });
  }
}
