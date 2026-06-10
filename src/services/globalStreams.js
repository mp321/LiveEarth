import * as satellite from 'satellite.js';

// Convert any fetcher's normalized entities into a MapLibre-ready GeoJSON
// FeatureCollection. Styling-relevant fields are promoted to top-level
// properties (expressions can only read those); the full entity is serialized
// under `_entity` so a click can rebuild it for the telemetry sidebar.
export function entitiesToGeoJSON(entities) {
  return {
    type: 'FeatureCollection',
    features: (entities || [])
      .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng))
      .map((e) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
        properties: {
          id: e.id,
          label: e.label,
          layer: e.layer,
          kind: e.kind ?? '',
          heading: Number.isFinite(e.meta?.heading_deg) ? e.meta.heading_deg : 0,
          magnitude: Number(e.meta?.magnitude) || 0,
          value: Number(e.meta?.pm25 ?? e.meta?.value) || 0,
          altitude_km: Number.isFinite(e.altitude_km) ? e.altitude_km : 0,
          _entity: JSON.stringify(e),
        },
      })),
  };
}

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
// bans). Keep UI polling at 10-15s MINIMUM (MapView refreshes every 30s).
const FLIGHTS_URL = 'https://api.airplanes.live/v2/point/39.8/-98.6/250';

// Per-callsign route lookup (origin/destination). ADS-B doesn't broadcast route,
// so the TelemetrySidebar resolves it lazily on click via hexdb.io (CORS-enabled),
// keeping the bulk flight poll light instead of one request per aircraft.
export const flightRouteUrl = (callsign) =>
  `https://hexdb.io/api/v1/route/icao/${encodeURIComponent(callsign)}`;

// Airport details (name, country, coordinates) by ICAO code, also from hexdb
// (CORS-enabled). Used to label a selected flight's departure/arrival and to
// draw the route arc on the globe.
export const airportInfoUrl = (icao) =>
  `https://hexdb.io/api/v1/airport/icao/${encodeURIComponent(icao)}`;

/**
 * Resolve an airport's name and coordinates from its ICAO code (best-effort —
 * resolves to null if hexdb has no record or the request fails).
 *
 * @returns {Promise<{icao:string,iata:?string,name:?string,region:?string,lat:?number,lng:?number}|null>}
 */
export async function fetchAirport(icao) {
  if (!icao) return null;
  try {
    const res = await fetch(airportInfoUrl(icao));
    if (!res.ok) return null;
    const d = await res.json();
    const lat = Number(d?.latitude);
    const lng = Number(d?.longitude);
    return {
      icao: String(d?.icao || icao).toUpperCase(),
      iata: d?.iata || null,
      name: d?.airport || null,
      region: d?.region_name || d?.country_code || null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    };
  } catch {
    return null;
  }
}

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

// ADS-B emitter "category" (wake-turbulence class) code -> readable label.
const WAKE_CATEGORY = {
  A1: 'Light',
  A2: 'Small',
  A3: 'Large',
  A4: 'High-vortex large',
  A5: 'Heavy',
  A6: 'High performance',
  A7: 'Rotorcraft',
  B1: 'Glider / sailplane',
  B2: 'Lighter-than-air',
  B4: 'Ultralight',
  B6: 'UAV / drone',
  B7: 'Space / trans-atmospheric',
  C1: 'Surface — emergency vehicle',
  C2: 'Surface — service vehicle',
};

// Transponder squawks that signal an emergency, decoded for the sidebar.
const SQUAWK_ALERTS = {
  7500: 'Unlawful interference (7500)',
  7600: 'Radio failure (7600)',
  7700: 'General emergency (7700)',
};

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
        // Classify so MapView can color the glyph: military (dbFlags bit 0),
        // light general-aviation (wake category A1), else commercial.
        const military = (Number(a.dbFlags) & 1) === 1;
        const kind = military ? 'military' : a.category === 'A1' ? 'ga' : 'commercial';
        // Vertical rate (ft/min): barometric preferred, geometric as fallback.
        const vRateFpm = toNum(a.baro_rate) ?? toNum(a.geom_rate);
        const squawk = a.squawk ? String(a.squawk) : null;
        const emergency =
          (a.emergency && a.emergency !== 'none' ? a.emergency : null) ||
          (squawk ? SQUAWK_ALERTS[Number(squawk)] : null) ||
          null;
        return {
          id: a.hex,
          lat: a.lat,
          lng: a.lon,
          label: callsign,
          layer: 'flights',
          kind, // read by MapView to color the glyph (kept out of the sidebar)
          meta: {
            callsign,
            aircraft: a.desc || '—', // e.g. "BOEING 737 MAX 9"
            type: a.t || '—', // ICAO type code, e.g. "B39M"
            class: military
              ? 'Military'
              : a.category === 'A1'
                ? 'General Aviation'
                : 'Commercial',
            category: WAKE_CATEGORY[a.category] || '—',
            operator: a.ownOp || '—',
            registration: a.r || '—',
            squawk: squawk || '—',
            altitude_ft: altFt,
            altitude_m: altFt != null ? Math.round(altFt * FEET_TO_M) : null,
            ground_speed_kt: gsKt,
            ground_speed_mph: gsKt != null ? Math.round(gsKt * 1.15078) : null,
            vertical_rate_fpm: vRateFpm,
            heading_deg: toNum(a.track),
            emergency: emergency || '—',
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
 * so MapView can lift the points off the surface into orbit.
 *
 * @returns {Promise<Array>} normalized satellite entities
 */
// CelesTrak rate-limits aggressively and asks clients to CACHE, not poll. TLEs
// stay valid for hours, so we fetch the element set at most once per hour and
// re-propagate the cached TLEs to "now" on each refresh — positions still update
// every cycle without re-hitting CelesTrak (which would risk a 403 IP block).
//
// TODO (rate-limit workarounds): the satellites layer goes empty whenever
// CelesTrak returns a 403 / "GP data has not updated since your last successful
// request" body. Explore: (1) persist the last good element set to localStorage
// so reloads don't re-fetch; (2) proxy through a cached serverless function so
// all clients share one upstream hit; (3) fall back to an alternate source
// (e.g. Space-Track) when CelesTrak blocks. Guard against caching the error body.
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
          altitude_km: Math.round(gd.height), // read by MapView for orbit lift
          meta: {
            name,
            norad_id: String(satrec.satnum),
            altitude_km: Math.round(gd.height),
            altitude_mi: Number((gd.height * 0.621371).toFixed(2)), // km -> miles (0.00)
            velocity_kms: speed != null ? Number(speed.toFixed(2)) : null,
            velocity_mph: speed != null ? Math.round(speed * 2236.936) : null, // km/s -> mph
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

// Ground-level air quality (PM2.5) from OpenAQ v3. The v3 API requires a free
// key, read from VITE_OPENAQ_KEY; without it the layer resolves to [] so the
// rest of the globe is unaffected. pm25 is parameter id 2.
const OPENAQ_URL = 'https://api.openaq.org/v3/parameters/2/latest?limit=1000';
const OPENAQ_KEY = import.meta.env?.VITE_OPENAQ_KEY;

function aqiBand(pm25) {
  if (pm25 == null) return 'Unknown';
  if (pm25 <= 12) return 'Good';
  if (pm25 <= 35.4) return 'Moderate';
  if (pm25 <= 55.4) return 'Unhealthy (sensitive)';
  if (pm25 <= 150.4) return 'Unhealthy';
  if (pm25 <= 250.4) return 'Very unhealthy';
  return 'Hazardous';
}

export async function fetchLiveAirQuality() {
  if (!OPENAQ_KEY) return [];
  try {
    const res = await fetch(OPENAQ_URL, { headers: { 'X-API-Key': OPENAQ_KEY } });
    if (!res.ok) throw new Error(`OpenAQ responded ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    return results
      .filter((r) => Number.isFinite(r?.coordinates?.latitude))
      .slice(0, 2000)
      .map((r) => {
        const pm25 = Number(r.value);
        return {
          id: `aq-${r.sensorsId ?? r.locationsId}`,
          lat: r.coordinates.latitude,
          lng: r.coordinates.longitude,
          label: `PM2.5 ${Number.isFinite(pm25) ? pm25.toFixed(1) : '—'} µg/m³`,
          layer: 'airquality',
          meta: {
            pm25: Number.isFinite(pm25) ? pm25 : null,
            air_quality: aqiBand(pm25),
            location_id: r.locationsId ?? '—',
            time: r.datetime?.utc ? new Date(r.datetime.utc).toUTCString() : null,
            status: 'Ground station',
          },
        };
      });
  } catch (err) {
    console.warn('[globalStreams] fetchLiveAirQuality failed:', err.message);
    return [];
  }
}

// Fetchers keyed by layer id; MapView resolves the active layers' streams here.
// Raster and particle layers are sourced elsewhere (rasterSources / windData).
export const LAYER_FETCHERS = {
  flights: fetchLiveFlights,
  buoys: fetchLiveBuoys,
  earthquakes: fetchLiveEarthquakes,
  eonet: fetchLiveEonet,
  satellites: fetchLiveSatellites,
  airquality: fetchLiveAirQuality,
};
