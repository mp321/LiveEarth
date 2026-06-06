import * as satellite from 'satellite.js';

// -----------------------------------------------------------------------------
// Data Streams
// -----------------------------------------------------------------------------
// Each fetcher returns a normalized array of entities so the globe engine can
// project them uniformly. The shape every entity should resolve to:
//
//   {
//     id:    string,            // stable unique id
//     lat:   number,            // latitude  (degrees)
//     lng:   number,            // longitude (degrees)
//     label: string,            // short display name
//     layer: string,            // owning layer id (from layerRegistry)
//     meta:  Record<string, *>  // arbitrary telemetry shown in the sidebar
//   }
//
// All network access here is free, public, client-side, and CORS-friendly.
// If an upstream API is rate-limited or down, the fetcher resolves to [] so the
// globe degrades gracefully instead of throwing.
// -----------------------------------------------------------------------------

// Routed through a same-origin proxy (vite.config.js in dev, vercel.json in
// prod) because the upstream endpoints don't send CORS headers — a direct
// cross-origin fetch is blocked by the browser and resolves to [].
const NDBC_URL = '/proxy/ndbc';

// airplanes.live community ADS-B network (free, keyless, no auth) — replaces the
// deprecated OpenSky anonymous API. It sends `Access-Control-Allow-Origin: *`,
// so we fetch it directly (no proxy needed); fetching from each browser also
// spreads requests across users' own IPs, respecting the per-client rate limit.
//
//   /v2/point/{lat}/{lon}/{radius}  — radius in nautical miles, 250 = max.
// There is no keyless global feed (airplanes.live /v2/all is 404, adsb.fi
// /api/v2/all is 400), so coverage is a 250 nm radius around this point.
//
// TODO (global live, eventually): for worldwide coverage, switch to a feed that
// allows it — OpenSky Network (free account + OAuth2 client credentials, proxied
// through a Vercel serverless function so the secret stays server-side) or a
// paid adsbexchange / RapidAPI key. Both need a backend hop, unlike this keyless
// feed — not a drop-in URL swap.
//
// Centered on the continental US; aircraft come back under `data.ac`.
//
// USAGE: airplanes.live is for personal / non-commercial use; we credit it with
// a link in the ControlPanel footer.
//
// RATE LIMIT: ~1 request per second (invalid requests trigger temporary IP
// bans). Keep UI polling at 10-15s MINIMUM (GlobeView refreshes every 30s).
const FLIGHTS_URL = 'https://api.airplanes.live/v2/point/39.8/-98.6/250';

// Per-callsign route lookup (origin/destination). ADS-B doesn't broadcast route,
// so the TelemetrySidebar resolves it lazily on click via hexdb.io (CORS-enabled),
// keeping the bulk flight poll light instead of one request per aircraft.
export const flightRouteUrl = (callsign) =>
  `https://hexdb.io/api/v1/route/icao/${encodeURIComponent(callsign)}`;

// USGS earthquakes — GeoJSON summary of the past 24h (all magnitudes).
// CORS-enabled, fetched directly.
const USGS_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

// NASA EONET active natural events. CORS-enabled. `status=open` = currently
// active events; the geometry array is chronological so its last point is the
// event's live position.
const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200';

// CelesTrak TLEs for active satellites. CORS-enabled (sends ACAO:* when an Origin
// header is present, which browsers always do). Positions are propagated
// client-side with satellite.js; the feed has 15k+ objects so we cap the set.
const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
const SAT_LIMIT = 500;

/**
 * Live aircraft positions from airplanes.live (free, keyless, no auth).
 * Filters to aircraft with valid coordinates and caps the result set for render
 * performance.
 *
 * @returns {Promise<Array>} normalized flight entities
 */
export async function fetchLiveFlights() {
  try {
    const res = await fetch(FLIGHTS_URL);
    if (!res.ok) throw new Error(`airplanes.live responded ${res.status}`);

    const data = await res.json();
    // Aircraft come back under `data.ac` (the re-api format shared by
    // airplanes.live and adsb.fi); fall back to `data.aircraft` for other
    // readsb variants so the mapping is portable across providers.
    const aircraft = Array.isArray(data?.ac)
      ? data.ac
      : Array.isArray(data?.aircraft)
        ? data.aircraft
        : [];

    const FEET_TO_M = 0.3048;
    const toNum = (v) => (Number.isFinite(v) ? v : null);

    return aircraft
      .filter((a) => a.lat != null && a.lon != null) // only entries with a fix
      .slice(0, 3000) // planes cap for render performance
      .map((a) => {
        // alt_baro is feet natively, or the literal string "ground" on surface.
        const altFt = typeof a.alt_baro === 'number' ? a.alt_baro : null;
        const gsKt = toNum(a.gs); // ground speed is reported in knots
        const callsign = (a.flight || a.hex || 'UNKNOWN').trim();
        return {
          id: a.hex,
          lat: a.lat,
          lng: a.lon,
          label: callsign,
          layer: 'flights',
          meta: {
            callsign,
            aircraft: a.desc || '—', // e.g. "BOEING 737 MAX 9"
            type: a.t || '—', // ICAO type code, e.g. "B39M"
            operator: a.ownOp || '—',
            registration: a.r || '—',
            squawk: a.squawk || '—',
            altitude_ft: altFt,
            altitude_m: altFt != null ? Math.round(altFt * FEET_TO_M) : null,
            ground_speed_kt: gsKt,
            ground_speed_mph: gsKt != null ? Math.round(gsKt * 1.15078) : null,
            heading_deg: toNum(a.track),
            status: a.alt_baro === 'ground' ? 'On Ground' : 'Airborne',
          },
        };
      });
  } catch (err) {
    console.warn('[globalStreams] fetchLiveFlights failed:', err.message);
    return [];
  }
}

/**
 * Live weather buoy observations from the NOAA NDBC "latest observations"
 * catalog. The catalog is a fixed-width text table; we parse the header row to
 * map columns, then read lat/lon and a few headline metrics per station.
 *
 * @returns {Promise<Array>} normalized buoy entities
 */
export async function fetchLiveBuoys() {
  try {
    const res = await fetch(NDBC_URL);
    if (!res.ok) throw new Error(`NDBC responded ${res.status}`);

    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 3) return [];

    // Line 0: column names (#STN LAT LON ...). Line 1: units. Rest: data.
    const header = lines[0].replace(/^#/, '').trim().split(/\s+/);
    const col = (name) => header.indexOf(name);

    const idxStn = col('STN');
    const idxLat = col('LAT');
    const idxLon = col('LON');
    const idxWspd = col('WSPD');
    const idxWvht = col('WVHT');
    const idxDpd = col('DPD');
    const idxWtmp = col('WTMP');
    const idxAtmp = col('ATMP');
    const idxPres = col('PRES');

    const num = (v) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };

    // Imperialize NDBC's metric readings: °C -> °F, meters -> feet, m/s -> mph.
    const cToF = (c) => (c == null ? null : c * (9 / 5) + 32);
    const mToFt = (m) => (m == null ? null : m * 3.28084);
    const msToMph = (v) => (v == null ? null : v * 2.236936);

    return lines
      .slice(2)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => num(parts[idxLat]) != null && num(parts[idxLon]) != null)
      .slice(0, 800) // cap for render performance
      .map((parts) => ({
        id: parts[idxStn],
        lat: num(parts[idxLat]),
        lng: num(parts[idxLon]),
        label: `Buoy ${parts[idxStn]}`,
        layer: 'buoys',
        meta: {
          station: parts[idxStn],
          wind_speed_mph: idxWspd > -1 ? msToMph(num(parts[idxWspd])) : null,
          wave_height_ft: idxWvht > -1 ? mToFt(num(parts[idxWvht])) : null,
          wave_period_s: idxDpd > -1 ? num(parts[idxDpd]) : null,
          water_temp_f: idxWtmp > -1 ? cToF(num(parts[idxWtmp])) : null,
          air_temp_f: idxAtmp > -1 ? cToF(num(parts[idxAtmp])) : null,
          pressure_hpa: idxPres > -1 ? num(parts[idxPres]) : null,
          status: 'Reporting',
        },
      }));
  } catch (err) {
    console.warn('[globalStreams] fetchLiveBuoys failed:', err.message);
    return [];
  }
}

/**
 * Live earthquakes from the USGS GeoJSON summary feed (past 24h, all magnitudes).
 * CORS-enabled, fetched directly. Each feature's geometry.coordinates is
 * [lng, lat, depth]; properties carry mag / place / title / time.
 *
 * @returns {Promise<Array>} normalized earthquake entities
 */
export async function fetchLiveEarthquakes() {
  try {
    const res = await fetch(USGS_URL);
    if (!res.ok) throw new Error(`USGS responded ${res.status}`);

    const data = await res.json();
    const features = Array.isArray(data?.features) ? data.features : [];

    return features
      .filter((f) => Array.isArray(f?.geometry?.coordinates))
      .map((f) => {
        const [lng, lat, depthKm] = f.geometry.coordinates;
        const p = f.properties || {};
        return {
          id: f.id,
          lat,
          lng,
          label: p.title || p.place || 'Earthquake',
          layer: 'earthquakes',
          meta: {
            magnitude: p.mag,
            place: p.place || '—',
            depth_km: Number.isFinite(depthKm) ? Math.round(depthKm) : null,
            time: p.time ? new Date(p.time).toUTCString() : null,
            status: 'Seismic event',
          },
        };
      });
  } catch (err) {
    console.warn('[globalStreams] fetchLiveEarthquakes failed:', err.message);
    return [];
  }
}

/**
 * NASA EONET active natural events (severe storms, wildfires, volcanoes, etc.).
 * CORS-enabled. Each event has a chronological `geometry` array; we take the
 * latest point as the live position and descend nested coords for Polygons.
 *
 * @returns {Promise<Array>} normalized natural-event entities
 */
export async function fetchLiveEonet() {
  try {
    const res = await fetch(EONET_URL);
    if (!res.ok) throw new Error(`EONET responded ${res.status}`);

    const data = await res.json();
    const events = Array.isArray(data?.events) ? data.events : [];

    // Pull a [lng, lat] pair out of a geometry entry (Point or Polygon).
    const pointOf = (g) => {
      let c = g?.coordinates;
      while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]; // descend nesting
      return Array.isArray(c) && c.length >= 2 ? c : null;
    };

    return events
      .map((ev) => {
        // EONET v3 uses `geometry`; tolerate the older `geometries` too.
        const geom = ev.geometry || ev.geometries || [];
        const latest = geom[geom.length - 1] || geom[0];
        const coords = pointOf(latest);
        if (!coords) return null;
        return {
          id: ev.id,
          lat: coords[1],
          lng: coords[0],
          label: ev.title || 'Natural Event',
          layer: 'eonet',
          meta: {
            event: ev.title || '—',
            category: ev.categories?.[0]?.title || 'Event',
            magnitude:
              latest?.magnitudeValue != null
                ? `${latest.magnitudeValue} ${latest.magnitudeUnit || ''}`.trim()
                : null,
            status: ev.closed ? 'Closed' : 'Active',
          },
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[globalStreams] fetchLiveEonet failed:', err.message);
    return [];
  }
}

/**
 * Live satellite positions from CelesTrak active-satellite TLEs, propagated to
 * "now" with satellite.js. CORS-enabled. The feed has 15k+ objects, so we cap at
 * SAT_LIMIT to keep the renderer responsive. Altitude (km) is set on the entity
 * so GlobeView can lift the points off the surface into orbit.
 *
 * @returns {Promise<Array>} normalized satellite entities
 */
// CelesTrak rate-limits aggressively and asks clients to CACHE, not poll. TLEs
// stay valid for hours, so we fetch the element set at most once per hour and
// re-propagate the cached TLEs to "now" on each refresh — positions still update
// every cycle without re-hitting CelesTrak (which would risk a 403 IP block).
let tleCache = { text: null, fetchedAt: 0 };
const TLE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getActiveTle() {
  if (tleCache.text && Date.now() - tleCache.fetchedAt < TLE_TTL_MS) {
    return tleCache.text;
  }
  const res = await fetch(CELESTRAK_URL);
  if (!res.ok) {
    if (tleCache.text) return tleCache.text; // serve stale on a transient block
    throw new Error(`CelesTrak responded ${res.status}`);
  }
  tleCache = { text: await res.text(), fetchedAt: Date.now() };
  return tleCache.text;
}

export async function fetchLiveSatellites() {
  try {
    const text = await getActiveTle();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

    const now = new Date();
    const gmst = satellite.gstime(now);
    const out = [];

    // TLE format: every 3 lines = [name, line1, line2]. Cap at SAT_LIMIT sats.
    for (let i = 0; i + 2 < lines.length && out.length < SAT_LIMIT; i += 3) {
      const name = lines[i].trim();
      try {
        const satrec = satellite.twoline2satrec(lines[i + 1], lines[i + 2]);
        const pv = satellite.propagate(satrec, now);
        if (!pv?.position) continue;

        const gd = satellite.eciToGeodetic(pv.position, gmst);
        const lat = satellite.degreesLat(gd.latitude);
        const lng = satellite.degreesLong(gd.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const v = pv.velocity;
        const speed =
          v && Number.isFinite(v.x)
            ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
            : null;

        out.push({
          id: String(satrec.satnum),
          lat,
          lng,
          label: name,
          layer: 'satellites',
          altitude_km: Math.round(gd.height), // read by GlobeView for orbit lift
          meta: {
            name,
            norad_id: String(satrec.satnum),
            altitude_km: Math.round(gd.height),
            velocity_kms: speed != null ? Number(speed.toFixed(2)) : null,
            status: 'In orbit',
          },
        });
      } catch {
        // Skip malformed TLE triples.
      }
    }
    return out;
  } catch (err) {
    console.warn('[globalStreams] fetchLiveSatellites failed:', err.message);
    return [];
  }
}

// -----------------------------------------------------------------------------
// Registry of fetchers keyed by layer id. GlobeView reads this to resolve which
// stream to call for each active layer — add new layers here in lockstep with
// layerRegistry.js.
// -----------------------------------------------------------------------------
export const LAYER_FETCHERS = {
  flights: fetchLiveFlights,
  buoys: fetchLiveBuoys,
  earthquakes: fetchLiveEarthquakes,
  eonet: fetchLiveEonet,
  satellites: fetchLiveSatellites,
};
