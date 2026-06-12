// Wind field for the particle layer, as a VECTOR texture (R = U, G = V) over the
// globe. Data is live NOAA GFS 10 m wind from Open-Meteo (free, keyless, CORS),
// sampled on a coarse global grid; GPU cubic sampling plus particle advection
// smooth it into continuous flow. Falls back to the last good field persisted
// in localStorage (up to 6 h stale), then to a synthetic zonal field, so the
// layer always renders something.
//
// RATE BUDGET (measured empirically): Open-Meteo enforces ~600 location-units
// per minute per IP, and EVERY point of a multi-location request counts as one
// unit. The previous 5° grid (2,520 points) tripped the limiter mid-fetch on
// every load, so the layer silently rendered the synthetic fallback (uniform
// westerlies). The grid must fit one minutely window WITH headroom for the
// snow layer's Open-Meteo calls: 36 lons × 15 lats = 540 units. Do not enlarge
// it without re-measuring the budget.

export const WIND_BOUNDS = [-180, -90, 180, 90]; // [west, south, east, north]
export const WIND_UNSCALE = [-40, 40]; // m/s packed into the 0..255 byte

const LON_RES = 10; // grid spacing in degrees
const LAT_RES = 10;
const LONS = buildRange(-180, 180, LON_RES); // 36 cols, west -> east
// Live rows span 70N..70S (texture row order north -> south); the polar rows
// are padded by replicating the nearest live row so high-latitude particles
// still move plausibly without spending budget on them.
const FETCH_LATS = buildRange(70, -80, -LAT_RES); // 15 rows
const PAD_ROWS = 2; // 90/80 above, -80/-90 below
const WIDTH = LONS.length;
const HEIGHT = FETCH_LATS.length + PAD_ROWS * 2;
const GFS_URL = 'https://api.open-meteo.com/v1/gfs';
const CACHE_TTL_MS = 30 * 60 * 1000; // GFS "current" only updates ~hourly
const STALE_MAX_MS = 6 * 60 * 60 * 1000; // stale real wind still beats synthetic
const STORE_KEY = 'liveearth:wind';

let cache = { at: 0, value: null };

function buildRange(start, stop, step) {
  const out = [];
  for (let v = start; step > 0 ? v < stop : v > stop; v += step) out.push(v);
  return out;
}

const encode = (val) => {
  const t = (val - WIND_UNSCALE[0]) / (WIND_UNSCALE[1] - WIND_UNSCALE[0]);
  return Math.max(0, Math.min(255, Math.round(t * 255)));
};

// Meteorological wind (speed km/h, direction degrees FROM) -> U/V components m/s.
function toUV(speedKmh, dirDeg) {
  if (!Number.isFinite(speedKmh) || !Number.isFinite(dirDeg)) return [0, 0];
  const spd = speedKmh / 3.6;
  const rad = (dirDeg * Math.PI) / 180;
  return [-spd * Math.sin(rad), -spd * Math.cos(rad)];
}

// Pack fetched U/V rows (FETCH_LATS coverage) into the full-height texture,
// replicating the first/last live row into the polar padding rows.
function packTexture(u, v) {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let r = 0; r < HEIGHT; r++) {
    const src = Math.min(Math.max(r - PAD_ROWS, 0), FETCH_LATS.length - 1);
    for (let c = 0; c < WIDTH; c++) {
      const i = (r * WIDTH + c) * 4;
      const j = src * WIDTH + c;
      data[i] = encode(u[j]);
      data[i + 1] = encode(v[j]);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return { data, width: WIDTH, height: HEIGHT };
}

function syntheticField() {
  const u = new Float32Array(WIDTH * FETCH_LATS.length);
  const v = new Float32Array(WIDTH * FETCH_LATS.length);
  for (let r = 0; r < FETCH_LATS.length; r++) {
    const phi = (FETCH_LATS[r] * Math.PI) / 180;
    const zonal = 12 * Math.sin(3 * phi);
    for (let c = 0; c < WIDTH; c++) {
      const lam = (LONS[c] * Math.PI) / 180;
      const i = r * WIDTH + c;
      u[i] = zonal + 4 * Math.sin(2 * lam + phi);
      v[i] = 3 * Math.cos(lam) * Math.cos(phi);
    }
  }
  return packTexture(u, v);
}

// ---- localStorage persistence ----------------------------------------------
// A reload inside the TTL must NOT refetch: the upstream budget is per-IP (so
// shared across tabs and reloads) and the model only updates hourly anyway.

function readStored() {
  try {
    const { at, w, h, b64 } = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!Number.isFinite(at) || w !== WIDTH || h !== HEIGHT) return null;
    const bin = atob(b64);
    if (bin.length !== WIDTH * HEIGHT * 4) return null;
    const data = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return { at, image: { data, width: w, height: h } };
  } catch {
    return null; // absent, malformed, or storage unavailable
  }
}

function writeStored(image) {
  try {
    let bin = '';
    for (let i = 0; i < image.data.length; i++) {
      bin += String.fromCharCode(image.data[i]);
    }
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ at: Date.now(), w: image.width, h: image.height, b64: btoa(bin) })
    );
  } catch {
    /* quota exceeded / private mode — the module cache still works */
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchLiveField() {
  const pts = [];
  for (const lat of FETCH_LATS) for (const lon of LONS) pts.push([lat, lon]);

  const BATCH = 180; // 540 points -> 3 sequential requests
  const u = new Float32Array(pts.length);
  const v = new Float32Array(pts.length);

  for (let start = 0; start < pts.length; start += BATCH) {
    const slice = pts.slice(start, start + BATCH);
    const lat = slice.map((p) => p[0].toFixed(2)).join(',');
    const lon = slice.map((p) => p[1].toFixed(2)).join(',');
    const url =
      `${GFS_URL}?latitude=${lat}&longitude=${lon}` +
      `&current=wind_speed_10m,wind_direction_10m`;
    let res = await fetch(url);
    if (res.status === 429) {
      // This minutely window is already burned (e.g. a quick reload) — wait
      // out the reset once instead of abandoning the whole field.
      await sleep(61_000);
      res = await fetch(url);
    }
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const rows = await res.json();
    (Array.isArray(rows) ? rows : [rows]).forEach((row, k) => {
      const idx = start + k;
      const [uu, vv] = toUV(
        row?.current?.wind_speed_10m,
        row?.current?.wind_direction_10m
      );
      u[idx] = uu;
      v[idx] = vv;
    });
  }
  return packTexture(u, v);
}

const asResult = (image, live) => ({
  image,
  bounds: WIND_BOUNDS,
  imageUnscale: WIND_UNSCALE,
  live,
});

export async function loadWindData() {
  if (cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const stored = readStored();
  if (stored && Date.now() - stored.at < CACHE_TTL_MS) {
    cache = { at: stored.at, value: asResult(stored.image, true) };
    return cache.value;
  }

  try {
    const image = await fetchLiveField();
    writeStored(image);
    cache = { at: Date.now(), value: asResult(image, true) };
  } catch (err) {
    console.warn('[windData] GFS unavailable:', err.message);
    if (stored && Date.now() - stored.at < STALE_MAX_MS) {
      // Hours-old real wind still beats the synthetic field.
      cache = { at: Date.now(), value: asResult(stored.image, true) };
    } else {
      console.warn('[windData] no stored field — using synthetic fallback');
      cache = { at: Date.now(), value: asResult(syntheticField(), false) };
    }
  }
  return cache.value;
}
