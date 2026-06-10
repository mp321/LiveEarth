# MP_LiveEarth

A 3D live-data globe. MapLibre GL renders an Earth in globe projection with
streamed, deep-zoom satellite imagery; toggleable layers overlay real-time
flights, weather, ocean, seismic, and orbital data. Built with React, Vite,
Tailwind CSS, MapLibre GL JS, deck.gl, and WeatherLayers GL.

## Build

- `npm run dev` — local dev server (Vite).
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the production build.

Requires Node 18+. Deploys on Vercel (`vercel.json`); `npm run dev` and the
deployed app both expose the same `/proxy/*` routes for the non-CORS sources.

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

## Data sources

All free and public. Base imagery: Esri World Imagery, Sentinel-2 cloudless
(EOX), and near-real-time NASA GIBS. Layers: airplanes.live (ADS-B), NOAA NDBC
(buoys), USGS (earthquakes), NASA EONET (natural events), CelesTrak (satellites),
RainViewer (radar), NASA GIBS (cloud imagery, sea-surface temperature),
Open-Meteo GFS (wind), OpenAQ (air quality).

Air quality requires a free OpenAQ key in `VITE_OPENAQ_KEY`; without it that one
layer stays empty and the rest are unaffected. Streams that are rate-limited or
briefly unavailable degrade to empty rather than failing the globe.

## License

MIT. Imagery and data remain under their respective providers' terms; attributions
are shown in the map and control panel.
