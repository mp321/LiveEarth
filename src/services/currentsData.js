// Ocean surface-current field for the deck.gl flow layer, as a VECTOR texture
// (R = U east, G = V north) packed exactly like windData. Source is the global
// RTOFS-backed surface current from Open-Meteo's Marine API (free, keyless,
// CORS). Falls back to the last good field in localStorage, then to a synthetic
// gyre field, so the layer always renders something.
//
// RATE BUDGET: Open-Meteo enforces ~600 location-units/min per IP and the wind
// layer already spends 540 of them (see windData.js). Currents drift slowly, so
// this stays well clear of that ceiling two ways: a deliberately COARSE grid
// (18 lon × 7 lat = 126 units, one request) and HARD caching (3 h memory +
// localStorage). Do not enlarge the grid without re-measuring the shared budget.

export const CURRENT_BOUNDS = [-180, -60, 180, 60]; // currents live mid-latitudes
export const CURRENT_UNSCALE = [-3, 3]; // m/s packed into the 0..255 byte

const LON_RES = 20;
const LAT_RES = 20;
const LONS = buildRange(-180, 180, LON_RES); // 18 cols, west -> east
const LATS = buildRange(60, -60, -LAT_RES); // 7 rows, north -> south (texture order)
const WIDTH = LONS.length;
const HEIGHT = LATS.length;
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // surface currents change slowly
const STALE_MAX_MS = 24 * 60 * 60 * 1000; // a day-old field still beats synthetic
const STORE_KEY = 'liveearth:currents';

let cache = { at: 0, value: null };

function buildRange(start, stop, step) {
  const out = [];
  for (let v = start; step > 0 ? v < stop : v > stop; v += step) out.push(v);
  return out;
}

const encode = (val) => {
  const t = (val - CURRENT_UNSCALE[0]) / (CURRENT_UNSCALE[1] - CURRENT_UNSCALE[0]);
  return Math.max(0, Math.min(255, Math.round(t * 255)));
};

// Oceanographic current direction is the heading the water flows TOWARD (0° =
// to North) — the opposite convention to meteorological wind (FROM) — so the
// U/V projection is NOT negated the way windData's toUV is.
function toUV(speedKmh, dirDeg) {
  if (!Number.isFinite(speedKmh) || !Number.isFinite(dirDeg)) return [0, 0];
  const spd = speedKmh / 3.6; // km/h -> m/s
  const rad = (dirDeg * Math.PI) / 180;
  return [spd * Math.sin(rad), spd * Math.cos(rad)];
}

function packTexture(u, v) {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const o = i * 4;
    data[o] = encode(u[i]);
    data[o + 1] = encode(v[i]);
    data[o + 2] = 0;
    data[o + 3] = 255;
  }
  return { data, width: WIDTH, height: HEIGHT };
}

// Gentle alternating zonal bands so the layer still reads as "flowing" when the
// Marine API is unreachable (land/NaN points decode to a calm 0 vector).
function syntheticField() {
  const u = new Float32Array(WIDTH * HEIGHT);
  const v = new Float32Array(WIDTH * HEIGHT);
  for (let r = 0; r < HEIGHT; r++) {
    const phi = (LATS[r] * Math.PI) / 180;
    for (let c = 0; c < WIDTH; c++) {
      const lam = (LONS[c] * Math.PI) / 180;
      const i = r * WIDTH + c;
      u[i] = 0.6 * Math.cos(phi) * Math.sin(2 * phi);
      v[i] = 0.25 * Math.sin(lam) * Math.cos(phi);
    }
  }
  return packTexture(u, v);
}

function readStored() {
  try {
    const { at, w, h, b64 } = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!Number.isFinite(at) || w !== WIDTH || h !== HEIGHT) return null;
    const bin = atob(b64);
    if (bin.length !== WIDTH * HEIGHT * 4) return null;
    const data = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return { at, image: { data, width: w, height: h } };
  } catch {
    return null;
  }
}

function writeStored(image) {
  try {
    let bin = '';
    for (let i = 0; i < image.data.length; i++) bin += String.fromCharCode(image.data[i]);
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ at: Date.now(), w: image.width, h: image.height, b64: btoa(bin) })
    );
  } catch {
    /* quota exceeded / private mode — the module cache still works */
  }
}

async function fetchLiveField() {
  const lats = [];
  const lons = [];
  for (const lat of LATS) for (const lon of LONS) {
    lats.push(lat.toFixed(2));
    lons.push(lon.toFixed(2));
  }
  // 126 locations fit one multi-location request (well under Open-Meteo's cap).
  const url =
    `${MARINE_URL}?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
    `&current=ocean_current_velocity,ocean_current_direction`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo marine ${res.status}`);
  const rows = await res.json();
  const arr = Array.isArray(rows) ? rows : [rows];
  const u = new Float32Array(WIDTH * HEIGHT);
  const v = new Float32Array(WIDTH * HEIGHT);
  arr.forEach((row, i) => {
    const [uu, vv] = toUV(
      row?.current?.ocean_current_velocity,
      row?.current?.ocean_current_direction
    );
    u[i] = uu;
    v[i] = vv;
  });
  return packTexture(u, v);
}

const asResult = (image, live) => ({
  image,
  bounds: CURRENT_BOUNDS,
  imageUnscale: CURRENT_UNSCALE,
  live,
});

export async function loadCurrentsData() {
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
    console.warn('[currentsData] Marine API unavailable:', err.message);
    if (stored && Date.now() - stored.at < STALE_MAX_MS) {
      cache = { at: Date.now(), value: asResult(stored.image, true) };
    } else {
      console.warn('[currentsData] no stored field — using synthetic fallback');
      cache = { at: Date.now(), value: asResult(syntheticField(), false) };
    }
  }
  return cache.value;
}
