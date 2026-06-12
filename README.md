# MP_LiveEarth

A 3D live-data globe. MapLibre GL renders an Earth in globe projection with
streamed, deep-zoom satellite imagery; toggleable layers overlay real-time
flights, weather, ocean, seismic, and orbital data. Built with React, Vite,
Tailwind CSS, MapLibre GL JS, deck.gl, and WeatherLayers GL.

## Build

- `vercel dev` — full-stack local dev: Vite plus the `api/` serverless
  functions (flights, TLEs, air quality). This is the recommended dev command.
- `npm run dev` — Vite only. `/api/*` is proxied to `http://localhost:3000`,
  so either run `vercel dev --listen 3000` alongside for the functions, or
  accept graceful degradation: flights fall back to airplanes.live (US-area),
  satellites reuse the last cached TLE set, and air quality stays empty;
  everything else works.
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the production build.
- `npm test` — Vitest unit tests over the pure data-shaping logic (parsers,
  entity mapping, storm-signal math); no network access required.

Requires Node 18+. Deploys on Vercel (`vercel.json`); dev and the deployed app
both expose the same `/proxy/*` rewrites for the non-CORS sources, and the
deployed app serves the `api/` functions natively.

If `npm run build` fails on Linux with a missing-Rollup-binary error, install
the optional native dependency npm sometimes skips:
`npm i @rollup/rollup-linux-x64-gnu` (a known npm optional-deps bug).

## Environment variables

Secrets live in Vercel project env vars and are read by the `api/` functions
via `process.env` — never `VITE_`-prefixed (Vite inlines `VITE_*` into the
public bundle). See `.env.example` for the template.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `OPENSKY_CLIENT_ID` | `api/flights.js` | OpenSky OAuth2 client id (e.g. `you@example.com-api-client`) |
| `OPENSKY_CLIENT_SECRET` | `api/flights.js` | OpenSky OAuth2 client secret |
| `OPENAQ_KEY` | `api/airquality.js` | OpenAQ v3 API key (free at explore.openaq.org) |

Setup:

1. OpenSky: create a free account at <https://opensky-network.org/>, then
   My OpenSky → Account → create an API client to get the id + secret.
   OpenAQ: register at <https://explore.openaq.org/register> for a key.
2. Vercel dashboard → your project → **Settings → Environment Variables** →
   add each variable for the Production, Preview, and Development
   environments. (CLI: `vercel env add OPENSKY_CLIENT_ID` etc.)
3. Redeploy so the functions pick them up.
4. Local: `vercel env pull .env.local` (or copy `.env.example` to
   `.env.local` and fill it in), then run `vercel dev`. `.env*` is
   git-ignored — never commit secrets.

Missing keys degrade gracefully: without `OPENSKY_*` the flights layer falls
back to airplanes.live; without `OPENAQ_KEY` the air-quality layer stays empty
and its toggle shows a setup note.

## Architecture

- `src/state/layerRegistry.js` — single source of truth for every layer. Each
  entry's `type` selects how `MapView` renders it (`aircraft`, `markers`,
  `points`, `rings`, `raster`, `particles`). `ControlPanel` renders one toggle
  per entry automatically.
- `src/services/globalStreams.js` — per-layer fetchers returning normalized
  entities, plus `entitiesToGeoJSON` for the MapLibre sources.
- `src/services/rasterSources.js` — base imagery and weather/ocean tile sources.
- `src/services/windData.js` — global GFS wind field for the particle layer.
- `src/components/MapView.jsx` — the MapLibre globe and all render channels.
- `src/state/AppContext.jsx` — active layers, base imagery, selected entity.
- `src/state/urlState.js` — shareable view persistence: layers, base imagery,
  and camera encoded in the URL hash (debounced) and mirrored to localStorage;
  on load the hash wins over localStorage, which wins over defaults.
- `api/` — Vercel serverless functions: `flights.js` (OpenSky OAuth2 proxy,
  60s shared cache), `tle.js` (CelesTrak proxy, 2h cache, serves stale on
  rate-limit), `airquality.js` (OpenAQ proxy holding the key server-side).

## Data sources

All free and public. Base imagery: Esri World Imagery, Sentinel-2 cloudless
(EOX), and near-real-time NASA GIBS. Layers: OpenSky Network (global ADS-B,
via `api/flights.js`; airplanes.live as keyless fallback), NOAA NDBC (buoys),
USGS (earthquakes), NASA EONET (natural events), CelesTrak (satellites, via
`api/tle.js`), RainViewer (radar), NASA GIBS (cloud imagery, sea-surface
temperature), Open-Meteo GFS (wind), OpenAQ (air quality, via
`api/airquality.js`).

Streams that are rate-limited or briefly unavailable degrade to empty rather
than failing the globe; the TLE and flight proxies additionally serve stale
cached data through upstream outages.

## License

MIT. Imagery and data remain under their respective providers' terms; attributions
are shown in the map and control panel.
