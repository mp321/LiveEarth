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
// Centered on the continental US; aircraft come back under `data.ac`. There is
// no keyless global feed, so coverage is a 250 nm radius around this point.
//
// USAGE: airplanes.live is for personal / non-commercial use; we credit it with
// a link in the ControlPanel footer.
//
// RATE LIMIT: ~1 request per second (invalid requests trigger temporary IP
// bans). Keep UI polling at 10-15s MINIMUM (GlobeView refreshes every 30s).
const FLIGHTS_URL = 'https://api.airplanes.live/v2/point/39.8/-98.6/250';

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
      .slice(0, 500) // cap for render performance
      .map((a) => {
        // alt_baro is feet, or the literal string "ground" when on the surface.
        const altFt = typeof a.alt_baro === 'number' ? a.alt_baro : null;
        const callsign = (a.flight || a.hex || 'UNKNOWN').trim();
        return {
          id: a.hex,
          lat: a.lat,
          lng: a.lon,
          label: callsign,
          layer: 'flights',
          meta: {
            callsign,
            type: a.t || '—',
            alt: altFt != null ? Math.round(altFt * FEET_TO_M) : null, // meters
            ground_speed_kt: toNum(a.gs),
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

// -----------------------------------------------------------------------------
// Registry of fetchers keyed by layer id. GlobeView reads this to resolve which
// stream to call for each active layer — add new layers here in lockstep with
// layerRegistry.js.
// -----------------------------------------------------------------------------
export const LAYER_FETCHERS = {
  flights: fetchLiveFlights,
  buoys: fetchLiveBuoys,
};
