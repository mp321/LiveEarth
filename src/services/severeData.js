// US severe-weather alerts for the `severe` polygon layer, plus a tornado-only
// feed for the in-app Alerts drawer. One upstream: NWS api.weather.gov
// /alerts/active (CORS-open — the same source the mountains layer already
// hits, so no proxy is needed).
//
// WHY ONLY GEOMETRY-BEARING FEATURES: warnings (Tornado/Severe-Thunderstorm/
// Flash-Flood) carry a polygon outlining the threat. WATCHES are zone-based and
// usually arrive with `geometry: null` — their footprint is a list of forecast
// zones in `properties.affectedZones`. Resolving those is N extra requests per
// watch, so v1 keeps only features that already have geometry. The practical
// effect: zone-based Tornado Watches may be absent from both the map and the
// drawer until the optional zone-resolution step below is built.
//
// The two exports share a 60s module-scope cache (same pattern as snowCache in
// snowData.js) so the 120s layer poll and the 15-min alert feed ride one
// upstream call instead of two.

import { centroid } from '@turf/turf';
import { NWS_HEADERS } from './snowData';

// Server-side event filter — the API returns only these products, so the client
// never downloads (or maps) the full national alert firehose.
const SEVERE_EVENTS = [
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning',
  'Severe Thunderstorm Watch',
  'Flash Flood Warning',
];
const ALERTS_URL =
  'https://api.weather.gov/alerts/active?status=actual&event=' +
  encodeURIComponent(SEVERE_EVENTS.join(','));

// Tornado products are the only ones surfaced in the notification drawer:
// flash-flood and severe-thunderstorm warnings fire dozens at a time across the
// country and would bury the drawer. They still render on the map.
const TORNADO_EVENTS = new Set(['Tornado Warning', 'Tornado Watch']);

// Reference links shared by every severe entity (rendered as link buttons by the
// TelemetrySidebar via meta._links).
const SEVERE_LINKS = [
  { label: 'Storm Prediction Center', url: 'https://www.spc.noaa.gov/' },
  { label: 'NWS radar', url: 'https://radar.weather.gov/' },
  { label: 'IEM warnings map', url: 'https://mesonet.agron.iastate.edu/current/severe.phtml' },
];

const SEVERE_TTL_MS = 60 * 1000;
let severeCache = { at: 0, entities: null };

async function getJSON(url, headers) {
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

// NWS `expires` is an ISO timestamp; show it in the viewer's local time (these
// alerts are inherently local events). Locale-dependent on purpose — there is no
// single correct timezone to pin to for a nationwide audience.
function fmtExpires(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function truncate(s, n) {
  const str = String(s ?? '').trim();
  if (!str) return '—';
  return str.length > n ? `${str.slice(0, n - 1).trimEnd()}…` : str;
}

/**
 * Map an NWS alerts FeatureCollection to severe-weather entities. Features with
 * null geometry (zone-based watches — see header) are skipped, so every entity
 * has a polygon to render and a centroid for the sidebar/fly-to. Pure —
 * exported for tests.
 *
 * @returns {Array} normalized severe-weather entities (each carries `geometry`)
 */
export function severeFeaturesToEntities(fc) {
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const out = [];
  for (const f of features) {
    const geometry = f?.geometry;
    if (!geometry) continue; // zone-based watch with no polygon — see header
    const p = f.properties || {};
    let lng, lat;
    try {
      [lng, lat] = centroid({ type: 'Feature', properties: {}, geometry }).geometry.coordinates;
    } catch {
      continue; // unparseable geometry — skip rather than break the whole layer
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: p.id ?? f.id,
      lat,
      lng,
      label: p.event || 'Severe weather',
      layer: 'severe',
      geometry, // raw polygon — read by the polygons render channel in MapView
      meta: {
        event: p.event || '—',
        headline: p.headline || '—',
        area: truncate(p.areaDesc, 140),
        severity: p.severity || '—',
        expires: fmtExpires(p.expires),
        office: p.senderName || '—',
        _links: SEVERE_LINKS,
      },
    });
  }
  return out;
}

/**
 * A severe entity -> Alerts-drawer item, or null when it is not a tornado
 * product (drawer is tornado-only — see TORNADO_EVENTS). Item shape matches the
 * Phase 7 alert contract. Pure — exported for tests.
 */
export function severeAlertItem(entity) {
  const event = entity?.meta?.event;
  if (!TORNADO_EVENTS.has(event)) return null;
  return {
    id: entity.id,
    layerId: 'severe',
    name: entity.meta.area,
    headline: entity.meta.headline,
    timeframe: `until ${entity.meta.expires}`,
    lat: entity.lat,
    lng: entity.lng,
    level: event === 'Tornado Warning' ? 2 : 1, // warning outranks watch in the sort
    zoom: 7,
    entity,
  };
}

// Fetch + cache the mapped entities, shared by both exports. Degrades to the
// last good list (or []) so a dead NWS never breaks the globe (contract rule 3).
async function getSevereEntities() {
  if (severeCache.entities && Date.now() - severeCache.at < SEVERE_TTL_MS) {
    return severeCache.entities;
  }
  try {
    const data = await getJSON(ALERTS_URL, NWS_HEADERS);
    const entities = severeFeaturesToEntities(data);
    severeCache = { at: Date.now(), entities };
    return entities;
  } catch (err) {
    console.warn('[severeData] fetchSevere failed:', err.message);
    return severeCache.entities ?? [];
  }
}

// TODO: zone-resolved watch outlines — for Tornado Watch features with null
// geometry, fetch each id in properties.affectedZones (api.weather.gov/zones/...
// returns geometry), cache the static zone shapes forever in module scope, cap
// the fetch count, and union them into a watch polygon. Skipped in v1 to keep
// the upstream call count to one.

/**
 * Severe-weather polygon entities for the `severe` layer.
 *
 * @returns {Promise<Array>} normalized severe-weather entities
 */
export async function fetchSevereEntities() {
  return getSevereEntities();
}

/**
 * Tornado-only Alerts-drawer feed (registered in AppContext's ALERT_FEEDS).
 *
 * @returns {Promise<Array<{id,layerId,name,headline,timeframe,lat,lng,level,zoom,entity}>>}
 */
export async function fetchSevereAlertFeed() {
  const entities = await getSevereEntities();
  return entities.map(severeAlertItem).filter(Boolean);
}
