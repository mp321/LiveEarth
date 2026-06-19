// Tide predictions for a selected coastal buoy (Phase B). Resolves the nearest
// NOAA CO-OPS tide station to a buoy and returns a "tide strip": a height curve,
// hi/lo extremes, the level "now", and a rising/falling trend with a countdown
// to the next turn. Purely additive to the buoy layer — buoy parsing is untouched.
//
// DATA SOURCE — NOAA CO-OPS (api.tidesandcurrents.noaa.gov), keyless and
// CORS-open (verified: `Access-Control-Allow-Origin: *` on both endpoints), so
// it's fetched DIRECTLY — no proxy, unlike NDBC. Two endpoints:
//   1. Station catalog (~3450 tide-prediction stations; id/name/lat/lng/type).
//   2. Per-station datagetter: hi/lo extremes, a 30-min harmonic curve, and the
//      observed water level. datum=MLLW, time_zone=lst_ldt, units=english.
//
// GOTCHAS handled here (these are why a naive impl fails on real buoys):
//   - Subordinate stations (type "S", ~65% of the catalog) serve hi/lo ONLY.
//     They answer interval=30 and water_level with HTTP 200 + {error:{message}}.
//     So the harmonic curve can't be required: when it's absent we SYNTHESIZE the
//     curve from the hi/lo dots with a half-cosine (curveFromExtremes).
//   - "Now": prefer the latest observed water_level (exact). When the station has
//     no live sensor, interpolate the height off the curve (labelled "predicted").
//   - Timezone: every series is on the station's local wall clock (lst_ldt). We
//     don't fight it — each "YYYY-MM-DD hh:mm" stamp is projected onto a tz-free
//     timeline via Date.UTC for math (trend/ETA are pure differences, correct
//     anywhere), and clock labels render straight from the NOAA string. The only
//     approximation is sensorless "now", which uses the VIEWER's wall clock.
//   - Always Promise.allSettled the three products so a water_level failure can't
//     sink the hi/lo + curve, and check json.error before parsing (getJSON does).

import { distance } from '@turf/turf';

const CO_OPS = 'https://api.tidesandcurrents.noaa.gov';
const CATALOG_URL = `${CO_OPS}/mdapi/prod/webapi/stations.json?type=tidepredictions`;
const DATAGETTER = `${CO_OPS}/api/prod/datagetter`;

// Generic offshore cutoff: a buoy with no tide station within this many miles is
// treated as deep water (fetchTideStrip resolves null -> no tide UI). Curated
// surf buoys below BYPASS this, since the headline swell buoys sit 20-50 mi out.
const OFFSHORE_CUTOFF_MI = 25;

const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // catalog is static — cache hard
const STRIP_TTL_MS = 10 * 60 * 1000; // predictions change slowly; memoize per buoy
const CATALOG_STORE_KEY = 'liveearth:tidestations';

// -----------------------------------------------------------------------------
// Curated surf-buoy -> reference tide station map (REQUIRED for accuracy).
// -----------------------------------------------------------------------------
// The headline users are surfers selecting the canonical NDBC swell buoys, many
// of which sit 20-50 mi offshore — past OFFSHORE_CUTOFF_MI — so a flat cutoff
// would hide tide for exactly the buoys that matter. Each entry pins a buoy to
// the coastal station its surf forecast uses. Curated wins over turf-nearest;
// turf-nearest remains the general fallback for every other coastal buoy.
//
// VERIFIED against the live catalog + predictions on 2026-06-19: each station
// returns hi/lo, and (reference stations, "R") a 30-min harmonic curve +
// observed water level. Selection rule: nearest REFERENCE station within ~35 mi
// (best accuracy), except where the only reference is on the wrong side of an
// island — there a co-located subordinate ("S") wins. True deep-water buoys
// (46047 Tanner Bank 121 nm, 51101 NW Hawaii 208 mi, 41047 NE Bahamas 350 nm,
// 41008 Grays Reef, 42040 Luke Offshore) are intentionally OMITTED so they fall
// through to "no tide UI" rather than borrow a meaningless far-away station.
export const SURF_BUOY_STATION = {
  // Pacific (US West Coast)
  '46026': '9414290', // SF Bar          -> San Francisco (Golden Gate)  [R]
  '46042': '9413450', // Monterey        -> Monterey, Monterey Bay       [R]
  '46022': '9418637', // Eel River       -> Cockrobin Island, Eel River  [R]
  '46029': '9440581', // Columbia R. Bar -> Cape Disappointment          [R]
  '46050': '9435380', // Stonewall Bank  -> South Beach, Newport         [R]
  '46086': '9410032', // San Clemente    -> Wilson Cove, San Clemente Is [R]
  '46232': '9410170', // Point Loma S.   -> San Diego (Broadway)         [R]
  '46219': '9410068', // San Nicolas Is. -> San Nicolas Island (on-isle) [S]
  '46221': '9410840', // Santa Monica B. -> Santa Monica, Municipal Pier [R]
  '46222': '9410660', // San Pedro       -> Los Angeles (Outer Harbor)   [R]
  // Hawaii
  '51201': '1612668', // Waimea Bay      -> Haleiwa, Waialua Bay (N.Shr) [S]
  '51202': '1612480', // Mokapu Point    -> Moku o Loe, Kaneohe Bay      [R]
  '51208': '1611683', // Hanalei, Kauai  -> Hanalei Bay                  [S]
  // Atlantic
  '44097': '8459338', // Block Island    -> Block Island (Old Harbor)    [R]
  '44100': '8651370', // Duck FRF, NC    -> Duck Pier                    [R]
  '44025': '8515186', // Long Island     -> Fire Island Coast Guard Sta. [R]
};

// -----------------------------------------------------------------------------
// Tz-free timeline + clock labels (see GOTCHAS above)
// -----------------------------------------------------------------------------

// Project a NOAA "YYYY-MM-DD hh:mm" wall-clock stamp onto a tz-free timeline
// (ms). Used only for differences (trend/ETA), so the absolute offset is moot.
function toTimelineMs(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(stamp ?? ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
}

// Render the clock straight from the NOAA string (station-local, as reported).
function clockLabel(stamp) {
  const m = /(\d{2}):(\d{2})/.exec(String(stamp ?? ''));
  if (!m) return '';
  let h = +m[1];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

// "Now" on the same timeline, from the VIEWER's wall clock (the one documented
// approximation — only used when a station has no live water-level sensor).
function nowOnTimeline(d = new Date()) {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
}

// -----------------------------------------------------------------------------
// Pure parsing / math helpers (exported for unit tests)
// -----------------------------------------------------------------------------

// Parse a CO-OPS height string to a number, or NaN. parseFloat (not Number) so a
// blank value reads as missing — Number('') is 0, which would forge a 0 ft dot.
const num = (v) => Number.parseFloat(v);

// Trim the catalog to the fields we use ({id,name,lat,lng,type}) so the cached
// copy is ~170 KB in localStorage instead of the raw ~2 MB response.
export function parseCatalog(json) {
  const arr = Array.isArray(json?.stations) ? json.stations : [];
  return arr
    .map((s) => ({
      id: String(s.id),
      name: s.name,
      lat: Number(s.lat),
      lng: Number(s.lng),
      type: s.type, // 'R' reference (harmonic + sensor) | 'S' subordinate (hi/lo)
    }))
    .filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

// Nearest catalog station to a point, via turf great-circle distance in miles.
// Pure: returns { station, distanceMi } or null. Threshold is applied by callers.
export function nearestStation(lat, lng, stations) {
  if (!Array.isArray(stations) || !stations.length) return null;
  const from = [lng, lat];
  let best = null;
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const d = distance(from, [s.lng, s.lat], { units: 'miles' });
    if (!best || d < best.distanceMi) best = { station: s, distanceMi: d };
  }
  return best;
}

// hi/lo predictions (interval=hilo) -> extremes [{type:'H'|'L', x, y, label}].
export function parseExtremes(json) {
  const preds = json?.predictions;
  if (!Array.isArray(preds)) return [];
  return preds
    .map((p) => ({ type: p?.type, x: toTimelineMs(p?.t), y: num(p?.v), label: clockLabel(p?.t) }))
    .filter((e) => (e.type === 'H' || e.type === 'L') && Number.isFinite(e.x) && Number.isFinite(e.y));
}

// 30-min harmonic curve (interval=30) -> [{x, y}]. [] on a subordinate {error}.
export function parseCurve(json) {
  const preds = json?.predictions;
  if (!Array.isArray(preds)) return [];
  return preds
    .map((p) => ({ x: toTimelineMs(p?.t), y: num(p?.v) }))
    .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
}

// Synthesize a curve from the hi/lo dots when no harmonic curve exists: a
// half-cosine between consecutive extremes, sampled every ~15 min. Passes
// EXACTLY through the dots and reproduces tide shape.
//   y(x) = a.y + (b.y - a.y) * (1 - cos(π·(x-a.x)/(b.x-a.x))) / 2
export function curveFromExtremes(extremes, stepMs = 15 * 60 * 1000) {
  if (!Array.isArray(extremes) || extremes.length < 2) return [];
  const out = [];
  for (let i = 0; i < extremes.length - 1; i++) {
    const a = extremes[i];
    const b = extremes[i + 1];
    if (!(b.x > a.x)) continue;
    for (let x = a.x; x < b.x; x += stepMs) {
      const f = (1 - Math.cos((Math.PI * (x - a.x)) / (b.x - a.x))) / 2;
      out.push({ x, y: a.y + (b.y - a.y) * f });
    }
  }
  const last = extremes[extremes.length - 1];
  out.push({ x: last.x, y: last.y }); // include the final dot exactly
  return out;
}

// Latest observed water level (exact "now") from the water_level product, or
// null (subordinate/sensorless stations return {error}).
export function parseObservedNow(json) {
  const data = json?.data;
  if (!Array.isArray(data)) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const y = num(data[i]?.v);
    if (Number.isFinite(y)) return { x: toTimelineMs(data[i].t), y, observed: true };
  }
  return null;
}

// Height read off the curve at nowX (predicted "now"); clamps to the curve ends.
export function interpolateNow(curve, nowX) {
  if (!Array.isArray(curve) || !curve.length) return null;
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (nowX <= first.x) return { x: first.x, y: first.y, observed: false };
  if (nowX >= last.x) return { x: last.x, y: last.y, observed: false };
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (nowX >= a.x && nowX <= b.x && b.x > a.x) {
      const f = (nowX - a.x) / (b.x - a.x);
      return { x: nowX, y: a.y + (b.y - a.y) * f, observed: false };
    }
  }
  return { x: last.x, y: last.y, observed: false };
}

// Trend from the first extreme AFTER now: heading to a High => rising, to a Low
// => falling. nextTurn carries that extreme's height + minutes away. Both null
// once now is past the last extreme (no future dot to head toward).
export function computeTrend(extremes, nowX) {
  const next = (Array.isArray(extremes) ? extremes : []).find((e) => e.x > nowX);
  if (!next) return { trend: null, nextTurn: null };
  return {
    trend: next.type === 'H' ? 'rising' : 'falling',
    nextTurn: {
      type: next.type === 'H' ? 'high' : 'low',
      height: next.y,
      etaMinutes: Math.round((next.x - nowX) / 60000),
    },
  };
}

// -----------------------------------------------------------------------------
// Catalog cache (module + localStorage, mirroring the TLE cache in globalStreams)
// -----------------------------------------------------------------------------

let catalogCache = { at: 0, stations: null };

function readStoredCatalog() {
  try {
    const { at, stations } = JSON.parse(localStorage.getItem(CATALOG_STORE_KEY));
    return Number.isFinite(at) && Array.isArray(stations) && stations.length ? { at, stations } : null;
  } catch {
    return null; // absent or malformed
  }
}

function writeStoredCatalog(stations) {
  try {
    localStorage.setItem(CATALOG_STORE_KEY, JSON.stringify({ at: Date.now(), stations }));
  } catch {
    /* quota exceeded / private mode — the module cache still works */
  }
}

async function getStations() {
  if (catalogCache.stations && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.stations;
  }
  const stored = readStoredCatalog();
  if (stored && Date.now() - stored.at < CATALOG_TTL_MS) {
    catalogCache = stored;
    return stored.stations;
  }
  try {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) throw new Error(`CO-OPS catalog ${res.status}`);
    const stations = parseCatalog(await res.json());
    if (!stations.length) throw new Error('empty catalog');
    catalogCache = { at: Date.now(), stations };
    writeStoredCatalog(stations);
    return stations;
  } catch (err) {
    if (catalogCache.stations) return catalogCache.stations; // serve stale on a transient block
    if (stored) return stored.stations;
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Per-station fetch
// -----------------------------------------------------------------------------

const stationUrl = (id, product, interval) =>
  `${DATAGETTER}?station=${id}&datum=MLLW&time_zone=lst_ldt&units=english` +
  `&format=json&application=LiveEarth&date=today&product=${product}` +
  (interval ? `&interval=${interval}` : '');

// CO-OPS answers subordinate stations with HTTP 200 + {error:{message}}, so a
// bare res.ok check isn't enough — surface json.error as a throw too.
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CO-OPS ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'CO-OPS error');
  return json;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

const stripCache = new Map(); // key -> { at, promise }

/**
 * Resolve a tide strip for a buoy, or null when it's offshore/unavailable.
 * Never throws. `buoyId` (the NDBC station id) consults SURF_BUOY_STATION first;
 * otherwise the nearest catalog station within OFFSHORE_CUTOFF_MI is used.
 *
 * Shape: { station:{id,name}, distanceMi, datum:'MLLW', curve:[{x,y}],
 *          extremes:[{type,x,y,label}], now:{x,y,observed}, trend, nextTurn }
 *
 * @returns {Promise<object|null>}
 */
export async function fetchTideStrip(lat, lng, buoyId) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = buoyId || `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = stripCache.get(key);
  if (hit && Date.now() - hit.at < STRIP_TTL_MS) return hit.promise;
  const promise = fetchTideStripUncached(lat, lng, buoyId);
  stripCache.set(key, { at: Date.now(), promise });
  promise.catch(() => stripCache.delete(key)); // don't cache failures
  return promise;
}

async function fetchTideStripUncached(lat, lng, buoyId) {
  try {
    const stations = await getStations();
    if (!stations.length) return null;

    // Curated surf buoy wins over turf-nearest (and bypasses the cutoff).
    let station = null;
    let distanceMi = null;
    const pinnedId = buoyId && SURF_BUOY_STATION[buoyId];
    if (pinnedId) {
      const s = stations.find((x) => x.id === pinnedId);
      if (s) {
        station = s;
        distanceMi = distance([lng, lat], [s.lng, s.lat], { units: 'miles' });
      }
    }
    if (!station) {
      const near = nearestStation(lat, lng, stations);
      if (!near || near.distanceMi > OFFSHORE_CUTOFF_MI) return null; // deep water
      station = near.station;
      distanceMi = near.distanceMi;
    }

    // hi/lo is required; the harmonic curve and observed level are best-effort —
    // allSettled keeps a water_level/curve failure from sinking the strip.
    const [hiloR, curveR, wlR] = await Promise.allSettled([
      getJSON(stationUrl(station.id, 'predictions', 'hilo')),
      getJSON(stationUrl(station.id, 'predictions', '30')),
      getJSON(stationUrl(station.id, 'water_level')),
    ]);

    const extremes = hiloR.status === 'fulfilled' ? parseExtremes(hiloR.value) : [];
    if (!extremes.length) return null; // nothing renderable

    const harmonic = curveR.status === 'fulfilled' ? parseCurve(curveR.value) : [];
    const curve = harmonic.length ? harmonic : curveFromExtremes(extremes);

    const observed = wlR.status === 'fulfilled' ? parseObservedNow(wlR.value) : null;
    const now = observed ?? interpolateNow(curve, nowOnTimeline());
    const { trend, nextTurn } = computeTrend(extremes, now?.x ?? nowOnTimeline());

    return {
      station: { id: station.id, name: station.name },
      distanceMi: Number(distanceMi.toFixed(1)),
      datum: 'MLLW',
      curve,
      extremes,
      now,
      trend,
      nextTurn,
      // TODO (B3): if a PORTS current station is co-located, add a current-
      // direction arrow (flood/ebb) alongside the height trend.
    };
  } catch (err) {
    console.warn('[tideData] fetchTideStrip failed:', err.message);
    return null;
  }
}
