# LiveEarth — Plan 2 (handoff spec: phases 7–13)

> **How to use this file:** Commit to the repo root. In Claude Code, start a
> **fresh session per phase**: "Read PLAN2.md GLOBAL RULES, then implement
> Phase N only. Run `npm run build` and `npm test` before finishing. Do not
> start other phases." Model recommendation is noted per phase — Sonnet where
> the spec is mechanical, Opus where the work cuts across MapView's render
> plumbing.

**Dependency order:** 7 → 8 → (11, 12, 13). Phases 9 and 10 are independent
and can run any time. Suggested overall order: 7, 8, 9, 10, 11, 12, 13.

---

## GLOBAL RULES (read first, every session)

**Project:** React + Vite + MapLibre GL (globe projection) live-data Earth.
Deployed on Vercel. ~2.5k LOC, JavaScript, Tailwind. See README.md
Architecture section.

**Architecture contract — do not violate:**
1. `src/state/layerRegistry.js` is the single source of truth for layers.
   New layer = new registry entry + matching fetcher or source builder. The
   ControlPanel renders toggles automatically; never hand-add UI per layer.
2. Fetchers return normalized entities `{ id, lat, lng, label, layer,
   meta: {...} }`. The TelemetrySidebar renders `meta` generically; an
   optional `meta._links` array of `{ label, url }` renders as link buttons.
3. **Degrade to empty.** Fetchers catch all errors and resolve to `[]` with a
   `console.warn`. A dead upstream must never break the globe.
4. Same-origin proxies live in BOTH `vite.config.js` (dev) and `vercel.json`
   (prod). If you add one, add it in both.
5. **No new npm dependencies.** fetch + existing libs (@turf/turf,
   satellite.js, maplibre-gl) cover everything below.

**Simplicity and complications:**
- Keep code simple. Prefer the dumbest implementation that satisfies the
  accept criteria. Every phase below has a **Skip** list of known rabbit
  holes — do not attempt anything on it.
- If you hit a complication this spec does NOT anticipate, do not engineer
  around it: take the simplest degradation (drop the sub-feature, leave a
  `// TODO: <what and why>`), and say so in your final summary.

**Comments:** wherever a future reader (human or LLM) might question a
decision — a non-obvious constant, an intentionally omitted feature, an
upstream quirk, a "why is this fetched this way" — leave a comment in the
style of the existing codebase (explain *why*, never *what*; see the header
comments in `src/services/snowData.js` for tone). This codebase is maintained
by fresh LLM sessions; uncommented oddities get "fixed" into bugs.

**Verify before finishing, every phase:** `npm run build` succeeds,
`npm test` passes, and toggling every existing layer still works in
`npm run dev`.

---

## Phase 7 — Control-panel consolidation: groups, presets, generic Alert center
**Model: Sonnet.**

The panel renders a flat list of 11 toggles and is about to grow. Three
changes, all registry-driven:

### 7a. Layer groups
- Add a `group` string to every `LAYER_REGISTRY` entry:
  - `'Weather'`: clouds, radar, wind
  - `'Ocean & Water'`: sst, buoys
  - `'Sky & Space'`: flights, satellites
  - `'Ground & Events'`: mountains, earthquakes, eonet, airquality
- ControlPanel groups toggles under collapsible section headers, preserving
  registry order within each group. Header shows the group name and an
  active-count chip (e.g. `2/3`) so a collapsed group still communicates
  state. Groups derive from whatever `group` values exist in the registry —
  never hardcode the group list in the component (future phases add new
  groups and must get headers for free).
- Persist the set of collapsed groups to localStorage
  (`liveearth:collapsedGroups`, a JSON array). Default: all expanded.

### 7b. Preset "lens" chips
- Export `LAYER_PRESETS` from `layerRegistry.js`:
  ```js
  [
    { id: 'storm',    label: 'Storm watch', layers: ['radar', 'wind', 'clouds', 'mountains'] },
    { id: 'ocean',    label: 'Ocean',       layers: ['sst', 'buoys'] },
    { id: 'aviation', label: 'Aviation',    layers: ['flights', 'wind', 'clouds'] },
    { id: 'clear',    label: 'Clear',       layers: [] },
  ]
  ```
- AppContext gets `applyPreset(layerIds)` → `setActiveLayers(new Set(ids))`
  (filter ids against `LAYER_BY_ID` so a preset may safely name a layer from
  a not-yet-implemented phase).
- ControlPanel renders the chips in one row above the groups. A chip shows
  "active" styling only when the current `activeLayers` set exactly equals
  the preset (comment: intentional — hand-toggling after a preset deselects
  the chip; presets are shortcuts, not modes).
- Do NOT persist which preset was clicked — `activeLayers` is already
  persisted by urlState, which captures everything.

### 7c. Generalize the alert drawer into an Alert center
- In `snowData.js#toAlertItem`, add `layerId: 'mountains'` to the item shape.
- In AppContext: rename `mountainAlerts` → `alerts`. The 15-min poll maps
  over a module-level `ALERT_FEEDS = [fetchMountainAlerts]` array with
  `Promise.allSettled`, flattens, and sorts official-alerts-first (reuse the
  level sort). Phase 8 appends a second feed here — leave a one-line comment
  saying so.
- `layerBadges` becomes a count of alerts per `layerId` (generic, no
  mountain special-casing).
- AlertsDrawer: title "Alerts"; each item renders its layer's icon via the
  existing `LayerIcon` + `LAYER_BY_ID[alert.layerId]`; `goTo` toggles
  `alert.layerId` on (not hardcoded `'mountains'`) and uses
  `alert.zoom ?? 7.5`.

**Skip:** drag-to-reorder; per-group master toggles; preset editing UI;
animations beyond the existing collapse pattern; restructuring AppContext
state management (no reducers, no external store).

**Comment:** why `group` lives in the registry (contract: panel renders from
data); why preset equality is strict; why alert items carry `layerId` and a
ready-to-select `entity`.

**Accept when:** groups render with counts and collapse-state survives
reload; each preset chip sets exactly its layer set; the alerts drawer
behaves exactly as before (badge, fly-to, sidebar selection); build + tests
pass.

---

## Phase 8 — US severe-weather layer (tornado watch/warning) + polygon render channel
**Model: Opus recommended** (new MapView render channel + click plumbing;
Sonnet workable but review the diff). **Requires Phase 7.**

### Data: `src/services/severeData.js`
- One fetch: `https://api.weather.gov/alerts/active?status=actual&event=`
  with comma-separated, URL-encoded events:
  `Tornado Warning, Tornado Watch, Severe Thunderstorm Warning, Severe
  Thunderstorm Watch, Flash Flood Warning`.
  Send the NWS `User-Agent` header — export `NWS_HEADERS` from
  `snowData.js` and import it (do not duplicate).
- Response is a GeoJSON FeatureCollection. **Warnings carry polygon
  geometry; watches usually have `geometry: null`** (zone-based). v1 keeps
  only features with non-null geometry, and a comment explains why watches
  may therefore be missing from the map (resolving `affectedZones` is N
  extra requests per watch — see optional step).
- Map each kept feature to an entity: `id` from `properties.id`, centroid
  via turf `centroid` for `lat`/`lng`, `label` = event name,
  `layer: 'severe'`, the raw `geometry` attached on the entity, and `meta`:
  `event`, `headline`, `area` (areaDesc, truncate ~140 chars), `severity`,
  `expires` (formatted local time), `office` (senderName), and `_links`:
  - `{ label: 'Storm Prediction Center', url: 'https://www.spc.noaa.gov/' }`
  - `{ label: 'NWS radar', url: 'https://radar.weather.gov/' }`
  - `{ label: 'IEM warnings map', url: 'https://mesonet.agron.iastate.edu/current/severe.phtml' }`
- Module-scope cache, 60s TTL, shared by both exports (same pattern as
  `snowCache`) so the layer poll and the alert feed share upstream calls.
- Export `fetchSevereEntities()` (the layer fetcher) and
  `fetchSevereAlertFeed()` → drawer items for **tornado events only**
  (comment: flash-flood/thunderstorm warnings are too numerous for a
  notification drawer; they still render on the map). Item shape matches
  Phase 7: `{ id, layerId: 'severe', name: area, headline, timeframe:
  'until <local expiry>', lat, lng, level: 2 for warning / 1 for watch,
  zoom: 7, entity }`. Register it in AppContext's `ALERT_FEEDS`.
- **Optional, only if it stays simple:** for Tornado Watch features with
  null geometry, fetch each zone in `properties.affectedZones`
  (`api.weather.gov/zones/...` returns geometry), cache zone geometries
  forever in module scope (zone shapes are static), cap at 60 zone fetches
  per refresh, `Promise.allSettled`. If awkward, ship without and leave
  `// TODO: zone-resolved watch outlines`.

### Registry + refresh cadence
- New entry: `id: 'severe'`, `group: 'Weather'`, `type: 'polygons'`,
  `color: '#f87171'`, label `US Severe Weather`, description
  `'Active tornado, severe-thunderstorm, and flash-flood alerts (NWS).'`,
  `sourceUrl: 'https://www.spc.noaa.gov/'`, `sourceLabel: 'Storm Prediction
  Center'`, `refreshMs: 120_000`.
- Add optional `refreshMs` support: MapView's poller uses
  `layer.refreshMs ?? REFRESH_MS`. Comment: NWS asks API users to be
  gentle; alert sets don't change second-to-second.
- Add `'polygons'` to a new `POLYGON_TYPES` set in `layerRegistry.js`.
- Add `'severe'` to the `storm` preset from Phase 7.

### Rendering: new `polygons` channel in MapView
- New GeoJSON-builder for polygon entities (the existing
  `entitiesToGeoJSON` is point-only): features use `entity.geometry`,
  properties carry whatever the existing vector click handler needs to
  rebuild the entity on click — follow the exact pattern the marker
  channel uses, do not invent a second mechanism.
- Two style layers per polygon source: a `fill` (data-driven `match` on
  `event` — Tornado Warning `#ef4444`, Tornado Watch `#fbbf24`, Severe
  Thunderstorm Warning `#f97316`, Severe Thunderstorm Watch `#fde047`,
  Flash Flood Warning `#16a34a`, fallback the layer color; `fill-opacity`
  0.18) and a `line` outline (same color expression, width 1.5).
  Fill layer is clickable → `selectEntity`, like markers.
- Order polygons **below** all marker/aircraft layers and **above**
  rasters, using the same ordering approach the existing channels use.

### Tests
- Vitest, pure logic only: feature→entity mapping (event filter, null
  geometry skipped, centroid present, expiry formatting) against a small
  inline FeatureCollection fixture.

**Skip:** marine/special-weather-statement events (volume); rAF pulse
animation on polygons (quake-style pulsing stays quake-only); polygon
union/dissolve; cancel/update message-type handling (`/alerts/active`
already resolves that server-side); any state beyond the module cache.

**Comment:** why watches may be absent (null geometry); why the drawer feed
is tornado-only; why `refreshMs` exists; why fill colors are by `event`,
not severity.

**Accept when:** on a day with active alerts (if none: temporarily widen the
event list or feed the mapper a fixture in a test), toggling the layer shows
colored polygons; clicking one opens the sidebar with headline, expiry, area,
and the three links; an active Tornado Watch/Warning produces a badge +
drawer entry even with the layer off; build + tests pass.

---

## Phase 9 — Streets & labels overlay (OpenFreeMap) + street-view links
**Model: Opus** (runtime style surgery on MapLibre — several subtle
behaviors). Independent of other phases.

Goal: a Google-Maps-"Hybrid"-style toggle — OSM roads and place labels over
the satellite imagery. Source: **OpenFreeMap** (keyless, no rate limits, no
account; verified live). Style JSON: `https://tiles.openfreemap.org/styles/liberty`
(valid MapLibre v8 style; sources `ne2_shaded` + `openmaptiles`; road layers
like `road_motorway`/`highway-name-major`; labels like `label_city`,
`label_town`, `label_country_1`).

### Registry
- `id: 'streets'`, `group: 'Reference'` (new group — Phase 7's grouping
  derives groups from the registry, so the header appears automatically),
  `type: 'labels'`, `color: '#e5e7eb'`, label `Streets & Labels`,
  description `'OSM street and place names over the imagery (OpenFreeMap).'`,
  `sourceUrl: 'https://openfreemap.org/'`, `sourceLabel: 'OpenFreeMap'`.

### MapView: new `labels` channel
On first activation (module-cache the parsed style JSON and the in-flight
promise; on fetch failure `console.warn` and render nothing — contract rule 3):
1. `map.setGlyphs(style.glyphs)` and `map.setSprite(style.sprite)`.
   Comment: the base style defines neither, glyph/sprite assets are only
   downloaded when a symbol layer actually renders, so setting them globally
   is harmless while the overlay is off.
2. `map.addSource('openfreemap', style.sources.openmaptiles)` — keep the
   attribution that ships in the style (OSM attribution is required).
3. Filter `style.layers` to ids matching prefixes:
   `road_`, `tunnel_`, `bridge_`, `highway-name`, `highway-shield`,
   `label_`, `water_name`, `boundary`. Drop everything else (landuse,
   buildings, fills, the `ne2_shaded` raster).
4. For each kept layer: re-point `source` to `'openfreemap'`, prefix the id
   with `streets-`, and for **symbol** layers only override paint for
   legibility on satellite imagery: `text-color: '#f8fafc'`,
   `text-halo-color: 'rgba(2,6,23,0.85)'`, `text-halo-width: 1.2`. Leave
   line layers and icon paint untouched.
5. Insert all of them above the raster layers and below every data layer,
   reusing the existing layer-ordering approach.
6. Toggle off: remove the `streets-*` layers; keep the source and the
   glyph/sprite settings (comment: removal is cosmetic, re-add is instant,
   and re-fetching the style would be waste).
7. Ensure the overlay survives a base-imagery switch the same way other
   overlay layers do.

### Street-view links (tiny, zero-weight)
In TelemetrySidebar, alongside the existing `meta._links` rendering, append
two computed links for every selected entity:
- `Street View ↗` → `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lng}`
- `Mapillary ↗` → `https://www.mapillary.com/app/?lat={lat}&lng={lng}&z=17`
Comment: both open the nearest available imagery to the point; this is the
deliberate lightweight alternative to embedding a panorama viewer.

**Skip:** the RTL-text plugin (non-Latin labels may render imperfectly —
comment it, acceptable); PMTiles/self-hosting; vendoring the 150-layer style
into the repo (fetch at runtime); building footprints/landuse/parks;
per-road-class style tuning (liberty's own zoom ranges and colors are fine
as-is); sprite-merging logic (there is no existing sprite); embedding
mapillary-js.

**Accept when:** toggled on over a city at zoom ~12, roads and place names
are legible on Esri imagery; toggle off removes them cleanly; switching base
imagery keeps the overlay working; nothing is fetched if never toggled;
build + tests pass.

---

## Phase 10 — Location search (Photon geocoder)
**Model: Sonnet.** Independent.

- New `src/components/SearchBox.jsx`, rendered in ControlPanel directly
  above the Base imagery select. Compact input, placeholder "Search places…".
- Query `https://photon.komoot.io/api/?q={query}&limit=6&lang=en` —
  keyless, OSM-based, returns a GeoJSON FeatureCollection of Point features
  with `properties` like `name`, `state`, `country`, `osm_key`, `type`
  (verified live). Debounce 350 ms, minimum 3 characters, and use an
  `AbortController` to cancel superseded requests (comment: free community
  service — debounce is etiquette, abort prevents stale dropdown flashes).
- Dropdown lists `name` + a subtitle from `[state, country]`. Click (or
  Enter = first result) → `requestFlyTo({ lng, lat, zoom })` with zoom by
  `properties.type`: country 4, state 6, city/town 10, village/suburb 12,
  street/house 15, default 11. Escape or selection clears the dropdown.
- Errors/no results degrade to an empty dropdown, never an error state.

**Skip:** arrow-key result navigation; search history; reverse geocoding;
dropping a marker pin at the result (fly-to is enough — `// TODO: result
pin`); provider fallback (no Nominatim).

**Comment:** why Photon over Nominatim (CORS + no usage policy friction for
client-side autocomplete); zoom-by-type table rationale.

**Accept when:** typing `des moines` lists Des Moines, Iowa first; clicking
flies there at city zoom; fast typing never shows stale results; build +
tests pass.

---

## Phase 11 — River & lake water conditions (USGS NWIS)
**Model: Opus recommended** (introduces the viewport-driven fetch pattern;
Sonnet workable given how prescriptive this spec is). **Requires Phase 8**
only for the optional advisory rings.

### Registry
- `id: 'water'`, `group: 'Ocean & Water'`, `type: 'markers'`,
  `color: '#34d399'`, label `Rivers & Lakes (US)`, description
  `'Live USGS gauge readings — temperature, turbidity, dissolved oxygen,
  flow.'`, `note: 'Zoom into a US region to load stations.'`,
  `noteUntilData: true`, `sourceUrl: 'https://waterdata.usgs.gov/'`,
  `sourceLabel: 'USGS Water Data'`, `viewport: true` (new field, below).

### Viewport-driven fetching (the one new mechanism — keep it minimal)
NWIS cannot be fetched nationwide (thousands of stations) and its `bBox`
parameter rejects requests where **lat-range × lon-range > 25 square
degrees**. So:
- New registry field `viewport: true`. For such layers MapView passes the
  current `map.getBounds()` to the fetcher, and re-fetches on `moveend`
  debounced 800 ms while the layer is active (listener removed on toggle
  off). Below zoom 5, skip fetching entirely and report count 0 (the
  registry note tells the user to zoom in).
- Pure helper `clampBBox(bounds, maxArea = 24)` — center-crops the box so
  width × height ≤ maxArea. Export for tests. Comment the NWIS 25-deg² rule.
- Cache responses 5 min keyed by the bbox rounded to 1 decimal place
  (comment: absorbs pan jitter without a real invalidation scheme).

### Data: `src/services/waterData.js`
- `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox={w},{s},{e},{n}`
  `&parameterCd=00010,00060,00065,00300,63680&siteStatus=active`
  (water temp °C, discharge cfs, gage height ft, dissolved oxygen mg/L,
  turbidity FNU).
- Parse `data.value.timeSeries[]`: each series has
  `sourceInfo.siteName`, `sourceInfo.geoLocation.geogLocation` (lat/lng),
  `sourceInfo.siteCode[0].value`, `variable.variableCode[0].value` (the
  param code), and `values[0].value` (take the last entry's `value` +
  `dateTime`). Group series by site code → one entity per site, `meta` keys
  named for the sidebar: `water_temp_c`, `discharge_cfs`, `gage_height_ft`,
  `dissolved_oxygen_mg_l`, `turbidity_fnu`, `observed`, and `_links`:
  - `{ label: 'USGS station page', url: 'https://waterdata.usgs.gov/monitoring-location/' + siteCode }`
  - `{ label: "EPA How's My Waterway", url: 'https://mywaterway.epa.gov/' }`
- **Honesty rule (project-wide, see PLAN.md Phase 3):** raw gauge readings
  are not swim advisories. Flag a station (`alertLevel: 1`, amber marker via
  the same promoted-property paint trick the mountains layer uses) when
  turbidity > 100 FNU or dissolved oxygen < 4 mg/L, with
  `meta.status: 'Elevated readings — check official guidance'`. Comment
  that the thresholds are rough screening values, not regulatory limits.
- **Optional, only if trivially reusing Phase 8's polygons channel:** a 3 km
  `turf.buffer` ring around flagged stations, amber fill at 0.12 opacity,
  with `meta.advisory_note: 'Illustrative radius around a station with
  elevated readings — NOT an official advisory; consult state/local
  guidance.'` If it isn't a clean fit, skip with
  `// TODO: advisory rings (polygons channel)`.

### Tests
- `clampBBox` (oversized box gets center-cropped, small box untouched).
- timeSeries→entities parser against a two-site inline fixture (grouping,
  latest-value pick, threshold flag).

**Skip:** EPA WQP/ATTAINS/BEACON API integration (links only); bacteria
data (not in the IV service); flow-direction plumes or any modeled impact
area; nationwide or state-by-state fetching; station metadata enrichment
calls.

**Accept when:** zoomed to Iowa with the layer on, stations appear with
readings in the sidebar; panning refetches after settling; zooming out
keeps the note visible and the globe responsive; build + tests pass.

---

## Phase 12 — Day/night terminator
**Model: Sonnet.** **Requires Phase 8** (reuses the polygons channel).

- Registry: `id: 'terminator'`, `group: 'Reference'`, `type: 'polygons'`,
  `color: '#020617'`, label `Day / Night`, description
  `'Current night side of the Earth, updated live.'`, plus two small generic
  registry fields honored by the polygons channel:
  `clickable: false` (skip click handler registration) and
  `fillOpacity: 0.4` (channel default stays 0.18). No outline for this
  layer (line-opacity 0 when `clickable: false`, or simply skip the line
  layer — pick the simpler).
- `src/services/terminator.js`, pure math, no fetch:
  - Subsolar point from the current date: declination ≈
    `23.44° × sin(2π × (284 + dayOfYear) / 365)`; subsolar longitude from
    UTC time ≈ `−15 × (utcDecimalHours − 12)` (skip the equation of time —
    comment that this is ±4 min ≈ ±1° accurate, invisible at globe scale).
  - Night polygon = a geodesic circle of radius 90° (10 007.5 km) centered
    on the **antisolar** point: `turf.circle(antisolarPoint, 10007.5,
    { steps: 180, units: 'kilometers' })`.
  - The layer "fetcher" returns one entity carrying that polygon geometry
    (same shape Phase 8 established). Comment: the standard 30 s layer poll
    conveniently re-computes the polygon, so the terminator creeps in real
    time with zero extra machinery.
  - Antimeridian: if the fill renders inverted or torn, normalize the ring
    so consecutive longitudes never jump more than 180° (add/subtract 360 —
    MapLibre accepts coordinates outside ±180). Comment why if needed.
- Test: subsolar-point function at a known instant (an equinox at 12:00 UTC
  → declination ≈ 0°, subsolar longitude ≈ 0°, tolerance ±2°).

**Skip:** twilight bands (civil/nautical/astronomical); sun/moon icons;
higher-accuracy solar ephemeris; making the polygon clickable.

**Accept when:** toggling shows a soft night shade whose edge matches the
current UTC time (sanity-check against timeanddate.com's day/night map);
it advances over minutes; no interaction or telemetry; build + tests pass.

---

## Phase 13 — Aurora forecast (NOAA SWPC OVATION)
**Model: Sonnet.** **Requires Phase 8** only for `refreshMs` (if absent, add
the same 3-line override first).

- Registry: `id: 'aurora'`, `group: 'Sky & Space'`, `type: 'markers'`,
  `color: '#4ade80'`, label `Aurora Forecast`, `refreshMs: 300_000`,
  description `'NOAA SWPC OVATION aurora probability for the next 30–90
  minutes.'`, `sourceUrl:
  'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast'`,
  `sourceLabel: 'NOAA SWPC'`.
- Fetch `https://services.swpc.noaa.gov/json/ovation_aurora_latest.json`
  (verified live): `{ "Observation Time", "Forecast Time",
  coordinates: [[lon 0–359, lat −90..90, probability 0–100], ...] }`,
  a 1°×1° global grid (~65 k triples). SWPC services send open CORS; if a
  browser fetch is blocked anyway, add a `/proxy/swpc` rewrite in BOTH
  `vite.config.js` and `vercel.json` (existing pattern).
- Pure mapper (export for tests): keep cells with probability ≥ 10 **and**
  |lat| ≥ 40 (comment: low-latitude single-digit values are model noise and
  would triple the marker count for nothing); convert lon > 180 → lon − 360;
  entity per cell with `meta: { probability_pct, forecast_time }` and the
  probability promoted onto the GeoJSON feature the way the air-quality
  layer promotes `value`.
- Marker paint: data-driven circle color interpolating probability —
  10 `#22c55e` → 50 `#fde047` → 80 `#ef4444` — opacity ~0.5, radius scaled
  by zoom; follow `AQ_COLOR` in MapView as the template.
- Test: the mapper against a tiny fixture (threshold filter, |lat| gate,
  longitude wrap).

**Skip:** WebGL heatmap or raster reprojection (a colored circle grid reads
fine on the globe); smoothing/interpolation between cells; Kp-index or
storm-watch integration (the source link covers it); southern-hemisphere
special-casing (the gate keeps it naturally).

**Accept when:** toggling shows a green/yellow oval over the polar regions
(during quiet solar conditions it may be sparse and dim — that is correct,
not a bug; comment it); data refreshes every 5 min; clicking a cell shows
its probability; build + tests pass.

---

## Parking lot (unchanged from PLAN.md)
- Global time scrubber across GIBS/USGS/TLE layers.
- "Ask the globe" Claude API situation summaries via `api/` function.
- Notifications v2 (push/email via Vercel Cron + KV) — see snowData TODO.
