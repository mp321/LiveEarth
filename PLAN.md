# LiveEarth — Implementation Plan (handoff spec)

> **How to use this file:** Commit it to the repo root. In Claude Code, start a
> **fresh session per phase**: "Read PLAN.md and CLAUDE-CONTEXT below. Implement
> Phase N only. Run `npm run build` before finishing. Do not start other phases."
> Sonnet is sufficient for every phase if executed one at a time.

---

## CLAUDE-CONTEXT (read first, every session)

**Project:** React + Vite + MapLibre GL (globe projection) live-data Earth.
Deployed on Vercel. ~2k LOC, JavaScript, Tailwind.

**Architecture contract — do not violate:**
1. `src/state/layerRegistry.js` is the single source of truth for layers.
   New layer = new registry entry + matching fetcher or source builder. The
   ControlPanel renders toggles automatically; never hand-add UI per layer.
2. Every data fetcher in `src/services/globalStreams.js` returns normalized
   entities: `{ id, lat, lng, label, layer, meta: {...} }`. The
   TelemetrySidebar renders `meta` generically — put display data there.
3. **Degrade to empty.** Fetchers catch all errors and resolve to `[]` with a
   `console.warn`. A dead upstream must never break the globe.
4. Same-origin proxies live in BOTH `vite.config.js` (dev) and `vercel.json`
   (prod). If you add one, add it in both.
5. Keep dependencies minimal. Prefer fetch + existing libs (turf, satellite.js).

**Verify after every phase:** `npm run build` succeeds; toggling every existing
layer still works in `npm run dev`.

---

## Phase 1 — Serverless data proxy (foundation; unblocks 2, 3, 6)

Create `api/` Vercel serverless functions (Node runtime):

- `api/flights.js` — OAuth2 client-credentials against OpenSky Network
  (`https://opensky-network.org`), fetch global `/api/states/all`, normalize
  to `{ ac: [...] }` matching the readsb-ish shape `fetchLiveFlights` already
  parses (map OpenSky state vector indices → `hex, flight, lat, lon, alt_baro,
  gs, track, squawk`). Cache the upstream response in module scope for 60s
  (and send `Cache-Control: s-maxage=60`) so all visitors share one upstream
  call. Secrets `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` from
  `process.env` — **never** `VITE_`-prefixed.
- `api/tle.js` — fetch CelesTrak active TLEs, cache 2h in module scope +
  `s-maxage=7200`. On upstream 403, serve stale if held, else 503.
- `api/airquality.js` — proxy OpenAQ v3 PM2.5 latest with `OPENAQ_KEY` from
  `process.env` (moves the key server-side).

Client changes:
- `FLIGHTS_URL` → `/api/flights` (keep airplanes.live as fallback if the
  function 5xxes — try proxy first, fall back, both already degrade to `[]`).
- `getActiveTle()` → `/api/tle`, and persist the last good TLE text +
  timestamp to `localStorage` so reloads don't refetch (resolves the in-code
  TODO).
- `fetchLiveAirQuality()` → `/api/airquality`, drop the client-side key check.
  In `layerRegistry.js`, keep a `note` on the airquality entry: shown until
  the first non-empty fetch ("Configure OPENAQ_KEY in Vercel for this layer").

Dev parity: add `server.proxy` entries in `vite.config.js` pointing `/api/*`
at `vercel dev`, or document `vercel dev` as the dev command in README.

**Accept when:** flights render globally (not just a US circle); satellites
layer survives a CelesTrak 403; AQ layer populates with key set in Vercel env;
no secret appears in `dist/`.
**README:** add env-var setup section + note the npm/Rollup optional-deps
workaround for Linux (`npm i @rollup/rollup-linux-x64-gnu` if build fails).

## Phase 2 — URL + localStorage persistence

- Encode `activeLayers`, `baseLayer`, camera (`lng,lat,zoom,bearing,pitch`)
  into the URL hash, debounced; restore on load (hash wins over localStorage,
  localStorage over defaults). Implement in `AppContext` + a small
  `src/state/urlState.js`; MapView publishes camera via `moveend`.
- Result: shareable links to an exact view.

**Accept when:** reload restores state; pasting a hash URL reproduces the view.

## Phase 3 — Snow / mountain layer (core of this iteration)

New files:
- `src/config/mountains.js` — curated, expandable config. Schema:

```js
{
  id: 'mammoth',            // stable slug
  name: 'Mammoth Mountain', // display
  state: 'CA', range: 'Sierra Nevada',
  lat: 37.6308, lng: -119.0326, elev_m: 3369,
  snotel: '1010:CA:SNTL',   // nearest SNOTEL station triplet (optional)
  cams: [                   // curated links, NOT embeds (respect TOS)
    { label: 'Caltrans US-395 Mammoth', url: 'https://...' },
    { label: 'Mammoth resort cams',     url: 'https://www.mammothmountain.com/on-the-mountain/webcams' },
  ],
  links: [
    { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=37.63&lon=-119.03' },
    { label: 'OpenSnow',           url: 'https://opensnow.com/location/mammoth' },
  ],
}
```

  Seed ~12: Mammoth, Palisades Tahoe, Heavenly (Sierra); Mt Baker, Crystal,
  Mt Hood Meadows (PNW); Alta, Snowbird, Park City (Wasatch); Vail,
  Breckenridge (Rockies); Jackson Hole; Mt Washington NH (East).
  `// TODO: expand list / load from JSON / user-added mountains`.

- `src/services/snowData.js` — per-mountain fetchers, all keyless + CORS:
  1. **NWS** `https://api.weather.gov/points/{lat},{lng}` → gridpoint forecast
     (snowfallAmount) + `https://api.weather.gov/alerts/active?point={lat},{lng}`
     filtered to winter event types (Winter Storm Watch/Warning, Blizzard
     Warning, Winter Weather Advisory). Send a descriptive `User-Agent` header
     per NWS API docs.
  2. **Open-Meteo** `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..
     &daily=snowfall_sum&forecast_days=16&elevation={elev_m}` → 16-day outlook.
     Compute `stormSignal`: any 3-day rolling window in days 5–16 with
     summed snowfall ≥ 30 cm → flag `{ window, totalCm }`.
  3. **SNOTEL** (current snowpack) via USDA AWDB REST
     (`https://wcc.sc.egov.usda.gov/awdbRestApi/...`) — **verify CORS first**;
     if blocked, add a `/proxy/snotel` rewrite (both configs). If the API
     shape is awkward, ship without it and leave `// TODO: SNOTEL depth/SWE`.

- Registry entry: `id: 'mountains'`, `type: 'markers'`, color `#93c5fd`,
  description "Snow forecast & winter alerts for major US mountains."
  Entity `meta` should include: `next7d_snow_in`, `outlook_16d_in`,
  `storm_signal` (e.g. "Potential storm Jun 18–20: ~22 in (model outlook)"),
  `active_alert` (NWS headline or '—'), `snow_depth_in` (SNOTEL, if available).

- Marker visual: scale/brighten the circle when `active_alert` or
  `storm_signal` is set (data-driven paint on a promoted `alertLevel`
  property: 0 none / 1 outlook / 2 official alert).

- Sidebar: the generic meta rendering covers the numbers. Add one generic
  extension — if `entity.meta._links` is an array of `{label,url}`, render
  them as link buttons (cams + forecast links flow through this; keep it
  generic so other layers can use it).

**Accept when:** toggling Mountains shows all seeded peaks; clicking one shows
7-day snow, 16-day outlook, alert status, and working cam/forecast links; an
NWS winter alert anywhere in the seed list renders visibly distinct.

**Honesty requirement:** label anything past day ~7 as "model outlook — low
confidence". Never present a 2-week signal as a forecast certainty.

## Phase 4 — In-app alerting (notifications v1)

- On load and every 15 min (only while the tab is open), fetch alerts +
  storm signals for all configured mountains (cheap: ~12 × 2 requests,
  batched with `Promise.allSettled`).
- ControlPanel: badge count on the Mountains toggle; a compact "Alerts"
  drawer listing `mountain — headline — timeframe`, click → fly to + select.
- `// TODO (notifications v2): Vercel Cron function evaluates the same logic
  server-side and sends Web Push (service worker) or email (e.g. Resend) to
  subscribers; requires a small KV store for subscriptions.`

**Accept when:** a real active winter alert (test against any current NWS
alert area, or mock the fetcher) produces a badge + drawer entry.

## Phase 5 — Bundle hygiene

- Dynamic-import deck.gl + weatherlayers-gl inside `ensureWind()` so the wind
  stack loads only on first toggle; `manualChunks` for maplibre.
- Target: initial JS chunk < 900 kB. Verify no regression in wind layer.

## Phase 6 — Tests (Vitest)

- `npm i -D vitest`; test pure logic only (no network): NDBC fixed-width
  parser (fixture string), `entitiesToGeoJSON` filtering/promotion, OpenSky
  state-vector → entity mapping, storm-signal window math, TLE triple parsing
  skip-on-malformed. `npm test` in CI later.

---

## Out of scope for now (parking lot)
- Global time scrubber across GIBS/USGS/TLE layers (next major feature).
- "Event lens" presets (storm watch = mountains + radar + wind + SST).
- "Ask the globe" Claude API situation summaries via `api/` function.
- Notifications v2 (push/email, cron) — see Phase 4 TODO.
