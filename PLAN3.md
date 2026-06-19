# Phase B (buoy) - adding tide feature -- add tide info on a selected buoy (rising/falling), accurate for surf buoys

> Implement THIS phase only. Run `npm run build` before finishing. Mirror existing
> patterns; do not invent new ones. Consolidated, legible, reliable code with strong comment reference for llm quick and efficient context read. 

## 0. Read first (don't over-explore). These was output of previous iteration from claude, but do consider alternatives or improvements and act on them. 

- `src/state/layerRegistry.js` — layers are registry-driven; entities use ONE normalized shape.
- `src/services/globalStreams.js` — `parseNdbcLatestObs` (buoy entities carry `lat`, `lng`,
  `meta.station`, `meta.swell_period_s`). DO NOT touch buoy parsing — tide is additive.
- `src/state/AppContext.jsx` — copy the `selectedRoute` lazy-resolution pattern verbatim
  (effect keyed on `selectedEntity`, status `loading|ok|none` kept in separate state).
- `src/components/TelemetrySidebar.jsx` — meta renders generically; `_`-prefixed keys are
  structured extensions; the flight "Route" block is the precedent for a per-selection section.
- MapView click does `selectEntity(JSON.parse(_entity))` for marker layers (incl. buoys) — unchanged.
- `@turf/turf` is already a dep (`distance` with `{units:'miles'}`).

## 1. Data-source truth (this is what makes it correct first try)
NOAA CO-OPS, keyless + CORS-ok → direct `fetch` (no proxy). Endpoints:
- Catalog (~3450 stations, fields `id,name,lat,lng`):
  `…/mdapi/prod/webapi/stations.json?type=tidepredictions`
- Per station: `…/api/prod/datagetter?station={id}&datum=MLLW&time_zone=lst_ldt&units=english`
  `&format=json&application=LiveEarth&date=today&product=…`
  with `product=predictions&interval=hilo`, `&interval=30` (curve), or `product=water_level`.

GOTCHAS (handle all — these are why a naive impl fails on real buoys):
- **Subordinate stations** (a large share of coastal stations) serve hi/lo only. They return
  HTTP 200 with body `{error:{message}}` for BOTH `interval=30` and `water_level`. So you CANNOT
  require the harmonic curve. When it's absent, SYNTHESIZE the curve from the hi/lo dots with a
  half-cosine between consecutive extremes:
      y(x) = a.y + (b.y - a.y) * (1 - cos(π·(x-a.x)/(b.x-a.x))) / 2     // sample ~every 15 min
  This passes exactly through the dots and reproduces tide shape. Prefer the harmonic curve when
  present (more accurate); else synthesize.
- **"Now":** if `water_level` returns data, use its LATEST point (exact, observed=true). Else
  interpolate height from the curve at the current time (observed=false; label it "predicted").
- **Timezone (don't fight it):** every series is on the same `lst_ldt` wall clock. Project each
  stamp onto a tz-free timeline with `Date.UTC(Y,M-1,D,h,m)` for math; render clock labels straight
  from the NOAA string (so they show station-local time as reported). Trend/ETA are timeline
  differences → correct anywhere. The only approximation is sensor-less "now" using the viewer's
  wall clock; document that one line and move on.
- Always check `json.error` before parsing; use `Promise.allSettled` so a water_level failure
  can't sink hi/lo + curve.

## 2. Implementation (3 small parts)

`src/services/tideData.js`
- Cache the catalog hard (module + localStorage, ~7-day TTL; the catalog is static). Memoize
  per-station results ~10 min.
- `nearestStation(lat,lng,stations)` via turf → `{station, distanceMi}`. Pure.
- Pure, exported, unit-tested helpers: `parseExtremes`, `parseCurve`, `curveFromExtremes`,
  `parseObservedNow`, `interpolateNow`, `computeTrend` (next extreme High→`rising`, Low→`falling`;
  `nextTurn={type,height,etaMinutes}`; null past last extreme).
- `fetchTideStrip(lat,lng)` → tideStrip object or `null` (offshore/unavailable). Never throws.
  Shape: `{ station:{id,name}, distanceMi, datum:'MLLW', curve:[{x,y}], extremes:[{type,x,y,label}],
  now:{x,y,observed}, trend, nextTurn }`.
- Leave the B3 TODO (current-direction arrow for co-located PORTS current stations).

`src/state/AppContext.jsx` — add `selectedTide` state + a `useEffect` cloned from `selectedRoute`:
buoy selected → `fetchTideStrip`, track `{status:'loading'|'ok'|'none', buoyId, data}`. A
fetcher-supplied `meta.tideStrip` short-circuits it. Expose in context.

`src/components/TideStrip.jsx` + sidebar — ONE generic SVG slot driven by the tideStrip object
(so any coastal layer reuses it): area-filled curve + hi/lo dots (height above, clock below) +
dashed "now" line + ▲/▼ arrow + "next {high|low} {ft} · {Hh Mm}" + "Now {ft} · observed|predicted"
+ "{station} · {dist} mi from buoy · datum MLLW", labeled **Predictions**. Anchor edge labels
`start`/`end` (synthesized curves put first/last dots at the plot edges — middle-anchor clips).
In the sidebar: render from `entity.meta.tideStrip ?? resolvedTide`; show a brief "Resolving…" on
loading; render NOTHING for `none` (offshore buoy = no tide UI, not an error); and exclude
`tideStrip` from the generic metrics loop.

## 3. Accuracy for the main surf / swell-period buoys (REQUIRED)
The headline users are surfers selecting the canonical NDBC swell buoys — many of which sit
20–50 mi OFFSHORE, so a flat 25-mi cutoff hides tide for exactly the buoys that matter.
- Keep ~25 mi as the generic offshore cutoff, but add a curated `SURF_BUOY_STATION` map pinning
  the principal swell-period buoys to the coastal **reference** tide station their surf forecasts
  actually use (reference station ⇒ observed "now" + harmonic curve ⇒ best accuracy). Curated
  buoy wins over turf-nearest; turf-nearest remains the general fallback.
- Candidate set to curate (VERIFY each against the live catalog/predictions before committing —
  do not hardcode an unverified station id): Pacific 46026, 46042, 46022, 46029, 46050, 46047,
  46086, 46232, 46219, 46221, 46222; Hawaii 51201, 51202, 51208, 51101; Atlantic/Gulf 44097,
  44100, 44025, 41008, 41047, 42040. For each, confirm the resolved station returns hi/lo and
  (ideally) a 30-min curve + water_level, and that distance/identity look right.
- Do not regress buoy swell-period (`DPD`/`SwP`) parsing — tide is purely additive.

## 4. Verify like this (efficient; don't trust the build alone)
1. `npm run build`.
2. Tiny vitest over the pure helpers (trend rising/falling/null, interpolation+clamp,
   `curveFromExtremes` passes through dots, nearest-station + threshold).
3. Live, in-browser (preview server on a NON-default port via a dedicated launch config so it
   won't collide with a running `npm run dev`): probe the RAW endpoints first to confirm shapes;
   then `fetchTideStrip` at (a) a reference-station buoy, (b) a subordinate-station coast, (c) deep
   water (expect null). Distinguish true-null from a silent fetch failure. Then mount the REAL
   `TideStrip` with live data (import react/react-dom via their `/node_modules/.vite/deps/…` URLs)
   and screenshot. Run every curated surf buoy through `fetchTideStrip` and eyeball the mappings.

## 5. Accept when
Selecting a coastal buoy (reference OR subordinate) renders a tide strip with the correct ▲/▼ and a
sane countdown; a deep-water buoy shows no tide UI (not an error); station name + distance + datum
show; every curated surf buoy resolves to its intended station with observed "now" where available;
`npm run build` passes and no secret/`VITE_` leak.