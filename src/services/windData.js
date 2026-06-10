// Wind field for the particle layer, as a VECTOR texture (R = U, G = V) over the
// globe. Data is live NOAA GFS 10 m wind from Open-Meteo (free, keyless, CORS),
// sampled on a coarse global grid in a few batched requests. The particle
// advection smooths the coarse grid into continuous flow. Falls back to a
// synthetic zonal field if the API is unreachable.

export const WIND_BOUNDS = [-180, -90, 180, 90]; // [west, south, east, north]
export const WIND_UNSCALE = [-40, 40]; // m/s packed into the 0..255 byte

const RES = 5; // grid spacing in degrees
const LONS = buildRange(-180, 180, RES); // west -> east
const LATS = buildRange(85, -90, -RES); // north -> south (texture row order)
const WIDTH = LONS.length;
const HEIGHT = LATS.length;
const GFS_URL = 'https://api.open-meteo.com/v1/gfs';
const CACHE_TTL_MS = 30 * 60 * 1000;

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

function packTexture(u, v) {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    data[i * 4] = encode(u[i]);
    data[i * 4 + 1] = encode(v[i]);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return { data, width: WIDTH, height: HEIGHT };
}

function syntheticField() {
  const u = new Float32Array(WIDTH * HEIGHT);
  const v = new Float32Array(WIDTH * HEIGHT);
  for (let r = 0; r < HEIGHT; r++) {
    const phi = (LATS[r] * Math.PI) / 180;
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

async function fetchLiveField() {
  // Flatten the grid into points, then split into URL-sized batches.
  const pts = [];
  for (let r = 0; r < HEIGHT; r++)
    for (let c = 0; c < WIDTH; c++) pts.push([LATS[r], LONS[c]]);

  const BATCH = 250;
  const CONCURRENCY = 3; // keep Open-Meteo happy (avoids 429 bursts)
  const u = new Float32Array(WIDTH * HEIGHT);
  const v = new Float32Array(WIDTH * HEIGHT);

  const starts = [];
  for (let s = 0; s < pts.length; s += BATCH) starts.push(s);

  const runBatch = async (start) => {
    const slice = pts.slice(start, start + BATCH);
    const lat = slice.map((p) => p[0].toFixed(2)).join(',');
    const lon = slice.map((p) => p[1].toFixed(2)).join(',');
    const url =
      `${GFS_URL}?latitude=${lat}&longitude=${lon}` +
      `&current=wind_speed_10m,wind_direction_10m`;
    const res = await fetch(url);
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
  };

  // Process batches in small concurrent waves.
  for (let i = 0; i < starts.length; i += CONCURRENCY) {
    await Promise.all(starts.slice(i, i + CONCURRENCY).map(runBatch));
  }
  return packTexture(u, v);
}

export async function loadWindData() {
  if (cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  let result;
  try {
    result = {
      image: await fetchLiveField(),
      bounds: WIND_BOUNDS,
      imageUnscale: WIND_UNSCALE,
      live: true,
    };
  } catch (err) {
    console.warn('[windData] GFS unavailable — using synthetic field:', err.message);
    result = {
      image: syntheticField(),
      bounds: WIND_BOUNDS,
      imageUnscale: WIND_UNSCALE,
      live: false,
    };
  }
  cache = { at: Date.now(), value: result };
  return result;
}
