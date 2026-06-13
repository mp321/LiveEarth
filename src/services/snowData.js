// Per-mountain snow telemetry for the Snow & Mountains layer. Three keyless,
// CORS-open upstreams per peak (all probed sending Access-Control-Allow-Origin: *):
//
//   1. NWS api.weather.gov — gridpoint snowfallAmount summed over the next
//      7 days, plus active winter alerts for the point.
//   2. Open-Meteo — 16-day daily snowfall outlook at the mountain's elevation.
//      Anything past ~day 7 is MODEL OUTLOOK, low confidence, and every string
//      that surfaces it says so — never present it as a forecast certainty.
//   3. USDA AWDB REST (SNOTEL) — current snow depth / SWE, only for peaks whose
//      config names a representative station (values arrive in inches).
//
// The mountain list itself is static config (src/config/mountains.js), so the
// layer always renders every peak; a dead upstream only blanks its own fields.
//
// Results are cached in module scope: MapView re-polls active layers every
// 30 s, but snow forecasts change hourly at best and the seed list costs ~50
// upstream requests per refresh — refetching each poll would hammer NWS.

import { MOUNTAINS } from '../config/mountains';

const SNOW_TTL_MS = 10 * 60 * 1000;
let snowCache = { at: 0, entities: null, alerts: null };

// Guard cache for the alert-only fetch path (AppContext polls every 15 min;
// this just absorbs accidental double-polls, e.g. a remount).
const ALERT_TTL_MS = 5 * 60 * 1000;
let alertCache = { at: 0, alerts: null };

// NWS asks API clients to identify themselves via User-Agent. Browsers that
// treat the header as immutable silently drop it and send their own — also fine.
const NWS_HEADERS = {
  'User-Agent': 'MP_LiveEarth (mp32196761@gmail.com)',
  Accept: 'application/geo+json',
};

// NWS alert event types that count as winter alerts for this layer.
const WINTER_EVENTS = new Set([
  'Winter Storm Warning',
  'Winter Storm Watch',
  'Blizzard Warning',
  'Winter Weather Advisory',
  'Ice Storm Warning',
  'Snow Squall Warning',
]);
const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };

// A 3-day window in the 16-day outlook totaling this much flags a storm signal.
const STORM_WINDOW_CM = 30;

const MM_PER_IN = 25.4;
const CM_PER_IN = 2.54;

async function getJSON(url, headers) {
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

const isoDay = (d) => d.toISOString().slice(0, 10);
const fmtDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

// The points -> gridpoint URL mapping never changes for a fixed lat/lng, so it
// is resolved once per mountain per session.
const gridUrlCache = new Map();

/**
 * NWS 7-day snowfall (inches) for a mountain: resolve the forecast gridpoint,
 * then sum `snowfallAmount` intervals starting within the next 7 days.
 * Resolves to null when the gridpoint carries no snowfall data.
 */
async function fetchNwsSnow7d(mtn) {
  let gridUrl = gridUrlCache.get(mtn.id);
  if (!gridUrl) {
    const pt = await getJSON(
      `https://api.weather.gov/points/${mtn.lat},${mtn.lng}`,
      NWS_HEADERS
    );
    gridUrl = pt?.properties?.forecastGridData;
    if (!gridUrl) throw new Error('no forecastGridData for point');
    gridUrlCache.set(mtn.id, gridUrl);
  }
  const grid = await getJSON(gridUrl, NWS_HEADERS);
  const values = grid?.properties?.snowfallAmount?.values;
  if (!Array.isArray(values)) return null;

  const horizon = Date.now() + 7 * 86_400_000;
  let mm = 0;
  for (const v of values) {
    // validTime is an ISO interval, e.g. "2026-06-11T12:00:00+00:00/PT6H".
    const start = Date.parse(String(v?.validTime).split('/')[0]);
    if (Number.isFinite(start) && start < horizon) mm += Number(v.value) || 0;
  }
  return mm / MM_PER_IN;
}

/**
 * Open-Meteo 16-day snowfall outlook at the mountain's elevation. Returns the
 * 16-day total, a 7-day total (fallback when NWS has no snowfall grid), and a
 * storm signal: the heaviest 3-day rolling window inside days 5–16 summing
 * ≥ STORM_WINDOW_CM. That far range is model output — callers must label it
 * low confidence.
 *
 * Results (including the in-flight promise) are cached per mountain so the
 * alert poller and the mountains-layer fetch share one upstream call instead
 * of firing a ~32-request burst at Open-Meteo's rate limiter.
 */
const outlookCache = new Map(); // mtn.id -> { at, promise }

function fetchOutlook16d(mtn) {
  const hit = outlookCache.get(mtn.id);
  if (hit && Date.now() - hit.at < SNOW_TTL_MS) return hit.promise;
  const promise = fetchOutlook16dUncached(mtn);
  outlookCache.set(mtn.id, { at: Date.now(), promise });
  promise.catch(() => outlookCache.delete(mtn.id)); // don't cache failures
  return promise;
}

/**
 * Storm-signal window math over a daily snowfall series (cm): the heaviest
 * 3-day rolling window starting on day 5 or later (index 4+ — the start of the
 * low-confidence model-outlook range) whose total is ≥ STORM_WINDOW_CM.
 * `days` are the matching ISO dates. Returns `{ totalCm, window }` or null.
 * Pure — exported for tests.
 */
export function stormSignalFrom(days, dailyCm) {
  let signal = null;
  for (let i = 4; i + 2 < dailyCm.length; i++) {
    // i = 4 is day 5 — the start of the low-confidence model-outlook range.
    const totalCm = dailyCm[i] + dailyCm[i + 1] + dailyCm[i + 2];
    if (totalCm >= STORM_WINDOW_CM && (!signal || totalCm > signal.totalCm)) {
      signal = { totalCm, window: `${fmtDay(days[i])}–${fmtDay(days[i + 2])}` };
    }
  }
  return signal;
}

async function fetchOutlook16dUncached(mtn) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${mtn.lat}&longitude=${mtn.lng}` +
    `&daily=snowfall_sum&forecast_days=16&elevation=${mtn.elev_m}`;
  const data = await getJSON(url);
  const days = data?.daily?.time;
  const cm = data?.daily?.snowfall_sum;
  if (!Array.isArray(days) || !Array.isArray(cm) || !cm.length) return null;

  const daily = cm.map((v) => Number(v) || 0);
  const signal = stormSignalFrom(days, daily);
  const sumIn = (arr) => arr.reduce((a, b) => a + b, 0) / CM_PER_IN;
  return { outlookIn: sumIn(daily), next7dIn: sumIn(daily.slice(0, 7)), signal };
}

/**
 * Active NWS winter alert headline for the point, or null. Multiple alerts
 * resolve to the most severe one.
 */
async function fetchWinterAlert(mtn) {
  const data = await getJSON(
    `https://api.weather.gov/alerts/active?point=${mtn.lat},${mtn.lng}`,
    NWS_HEADERS
  );
  const winter = (Array.isArray(data?.features) ? data.features : [])
    .map((f) => f?.properties)
    .filter((p) => p && WINTER_EVENTS.has(p.event))
    .sort(
      (a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
    );
  return winter.length ? winter[0].headline || winter[0].event : null;
}

/**
 * Latest SNOTEL snow depth / snow-water-equivalent (both natively inches) from
 * the USDA AWDB REST API, or null when the mountain has no station configured.
 */
async function fetchSnotel(mtn) {
  if (!mtn.snotel) return null;
  const url =
    'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data' +
    `?stationTriplets=${encodeURIComponent(mtn.snotel)}` +
    `&elements=SNWD,WTEQ&duration=DAILY` +
    `&beginDate=${isoDay(new Date(Date.now() - 3 * 86_400_000))}` +
    `&endDate=${isoDay(new Date())}`;
  const data = await getJSON(url);
  const elements = data?.[0]?.data || [];
  const latest = (code) => {
    const values =
      elements.find((d) => d?.stationElement?.elementCode === code)?.values || [];
    for (let i = values.length - 1; i >= 0; i--) {
      if (Number.isFinite(values[i]?.value)) return values[i].value;
    }
    return null;
  };
  return { depthIn: latest('SNWD'), sweIn: latest('WTEQ') };
}

const formatStormSignal = (signal) =>
  `Potential storm ${signal.window}: ~${Math.round(
    signal.totalCm / CM_PER_IN
  )} in (model outlook — low confidence)`;

// Compact alert-drawer item for one peak, or null when there is nothing to
// flag. `layerId` lets the generic AlertsDrawer toggle the right layer without
// knowing what kind of alert this is. `entity` rides along so clicking the
// alert can populate the sidebar without waiting for the layer to re-fetch.
function toAlertItem(mtn, alert, signal, entity) {
  if (!alert && !signal) return null;
  return {
    id: mtn.id,
    layerId: 'mountains',
    name: mtn.name,
    lat: mtn.lat,
    lng: mtn.lng,
    level: alert ? 2 : 1,
    headline: alert
      ? alert
      : `~${Math.round(signal.totalCm / CM_PER_IN)} in possible (model outlook — low confidence)`,
    timeframe: alert ? 'Active now' : signal.window,
    entity,
  };
}

const byUrgency = (a, b) => b.level - a.level || a.name.localeCompare(b.name);

/**
 * Snow & mountain entities for every configured peak. Upstreams are fetched in
 * parallel per mountain and each degrades to null independently, so the peaks
 * always render even with every network source down.
 *
 * @returns {Promise<Array>} normalized mountain entities
 */
export async function fetchMountainSnow() {
  if (snowCache.entities && Date.now() - snowCache.at < SNOW_TTL_MS) {
    return snowCache.entities;
  }
  try {
    const results = await Promise.all(
      MOUNTAINS.map(async (mtn) => {
        const muted = Boolean(mtn.excludeFromAlerts);
        const [nws7d, outlook, snotel, alert] = await Promise.all([
          fetchNwsSnow7d(mtn).catch(() => null),
          fetchOutlook16d(mtn).catch(() => null),
          fetchSnotel(mtn).catch(() => null),
          muted ? null : fetchWinterAlert(mtn).catch(() => null),
        ]);
        const signal = muted ? null : (outlook?.signal ?? null);
        // 0 quiet / 1 model-outlook storm signal / 2 official NWS alert —
        // promoted to a feature property for data-driven marker paint.
        const alertLevel = alert ? 2 : signal ? 1 : 0;
        const inches = (v) => (v == null ? null : Number(v.toFixed(1)));
        const entity = {
          id: mtn.id,
          lat: mtn.lat,
          lng: mtn.lng,
          label: mtn.name,
          layer: 'mountains',
          alertLevel,
          meta: {
            region: `${mtn.range}, ${mtn.state}`,
            elevation_ft: Math.round(mtn.elev_m * 3.28084),
            next7d_snow_in: inches(nws7d ?? outlook?.next7dIn),
            outlook_16d_in: inches(outlook?.outlookIn),
            storm_signal: signal ? formatStormSignal(signal) : '—',
            active_alert: muted ? 'Muted (northeast US)' : (alert ?? '—'),
            snow_depth_in: snotel?.depthIn ?? null,
            snow_water_equiv_in: snotel?.sweIn ?? null,
            confidence: 'Days 1–7: forecast · days 8–16: model outlook (low confidence)',
            status: alert
              ? 'Winter alert active'
              : signal
                ? 'Storm signal (model outlook)'
                : muted
                  ? 'Alerts muted'
                  : 'No winter alerts',
            _links: [...(mtn.cams || []), ...(mtn.links || [])],
          },
        };
        return { entity, alertItem: muted ? null : toAlertItem(mtn, alert, signal, entity) };
      })
    );
    snowCache = {
      at: Date.now(),
      entities: results.map((r) => r.entity),
      alerts: results.map((r) => r.alertItem).filter(Boolean).sort(byUrgency),
    };
    return snowCache.entities;
  } catch (err) {
    console.warn('[snowData] fetchMountainSnow failed:', err.message);
    return snowCache.entities ?? [];
  }
}

// -----------------------------------------------------------------------------
// In-app alerting (notifications v1)
// -----------------------------------------------------------------------------
// AppContext calls this on load and every 15 minutes while the tab is open.
// When the full snow cache is fresh (the mountains layer is on and polling),
// alerts derive from it for free; otherwise only the two alert-relevant
// upstreams are hit per peak (~2 requests × ~16 mountains), batched with
// Promise.allSettled so one dead upstream can't sink the rest.
//
// TODO (notifications v2): Vercel Cron function evaluates the same logic
// server-side and sends Web Push (service worker) or email (e.g. Resend) to
// subscribers; requires a small KV store for subscriptions.

/**
 * Active winter alerts + storm signals across all configured (non-muted)
 * mountains, sorted official-alerts-first. Degrades to the last good list.
 *
 * @returns {Promise<Array<{id,name,lat,lng,level,headline,timeframe,entity}>>}
 */
export async function fetchMountainAlerts() {
  if (snowCache.alerts && Date.now() - snowCache.at < SNOW_TTL_MS) {
    return snowCache.alerts;
  }
  if (alertCache.alerts && Date.now() - alertCache.at < ALERT_TTL_MS) {
    return alertCache.alerts;
  }
  try {
    const settled = await Promise.allSettled(
      MOUNTAINS.filter((m) => !m.excludeFromAlerts).map(async (mtn) => {
        const [alert, outlook] = await Promise.all([
          fetchWinterAlert(mtn).catch(() => null),
          fetchOutlook16d(mtn).catch(() => null),
        ]);
        const signal = outlook?.signal ?? null;
        // Minimal sidebar-renderable entity — full telemetry (NWS 7-day,
        // SNOTEL) arrives once the mountains layer itself fetches.
        const entity = {
          id: mtn.id,
          lat: mtn.lat,
          lng: mtn.lng,
          label: mtn.name,
          layer: 'mountains',
          alertLevel: alert ? 2 : signal ? 1 : 0,
          meta: {
            region: `${mtn.range}, ${mtn.state}`,
            elevation_ft: Math.round(mtn.elev_m * 3.28084),
            outlook_16d_in:
              outlook == null ? null : Number(outlook.outlookIn.toFixed(1)),
            storm_signal: signal ? formatStormSignal(signal) : '—',
            active_alert: alert ?? '—',
            status: alert
              ? 'Winter alert active'
              : signal
                ? 'Storm signal (model outlook)'
                : 'No winter alerts',
            _links: [...(mtn.cams || []), ...(mtn.links || [])],
          },
        };
        return toAlertItem(mtn, alert, signal, entity);
      })
    );
    const alerts = settled
      .filter((s) => s.status === 'fulfilled' && s.value)
      .map((s) => s.value)
      .sort(byUrgency);
    alertCache = { at: Date.now(), alerts };
    return alerts;
  } catch (err) {
    console.warn('[snowData] fetchMountainAlerts failed:', err.message);
    return alertCache.alerts ?? [];
  }
}
