# MP_LiveEarth — 3D Global Data Dashboard

MP_LiveEarth is a pure, high-performance, **100% client-side** 3D globe for
visualizing live open data streams. Built with **React + Vite + Tailwind CSS + react-globe.gl** and
designed to deploy free on **Vercel** — no backend, no server, no API keys.

The architecture is **registry-driven**: every data layer is declared once in a
single registry array, and both the UI and the rendering engine derive
everything from it. Adding a new open-source layer is a 3-file change with zero
hardcoded wiring.

---

## Features

- **Full-viewport 3D globe** with open-source NASA / CartoDB night textures.
- **Glass-morphism control panel** that auto-generates a toggle per data layer.
- **Collapsible telemetry sidebar** that opens when you click any globe element.
- **Live streams** out of the box:
  - **Live ADSB Flights** — [OpenSky Network](https://opensky-network.org/) (free, anonymous).
  - **NOAA Weather Buoys** — [NOAA NDBC](https://www.ndbc.noaa.gov/) latest observations.
- **Auto-refresh** of active layers every 30 seconds.
- **Graceful degradation** — if an upstream API is rate-limited, the layer
  simply renders empty instead of crashing.

---

## Architecture

```
MP_globetrot/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json
└── src/
    ├── main.jsx                  # React entry point
    ├── App.jsx                   # Shell: provider + globe + overlays
    ├── index.css                 # Tailwind + .glass utility
    ├── state/
    │   ├── layerRegistry.js      # SINGLE SOURCE OF TRUTH for all layers
    │   └── AppContext.jsx        # Global state: activeLayers + selectedEntity
    ├── components/
    │   ├── GlobeView.jsx         # The globe engine (loops the registry)
    │   ├── ControlPanel.jsx      # Left glass menu (auto-generated toggles)
    │   └── TelemetrySidebar.jsx  # Right drawer (generic telemetry readout)
    └── services/
        └── globalStreams.js      # fetchLiveFlights() / fetchLiveBuoys()
```

### How the registry works

`src/state/layerRegistry.js` exports `LAYER_REGISTRY`, an array of layer
profiles. Everything else iterates over it:

- **`ControlPanel.jsx`** maps over it to render toggles — no hardcoded buttons.
- **`GlobeView.jsx`** maps over it to decide which streams to fetch and how to
  project them (point altitude/color come from the profile).
- **`AppContext.jsx`** seeds `activeLayers` from any profile with
  `defaultActive: true`.

### Adding a new layer (the only place you touch)

1. **`src/state/layerRegistry.js`** — add a profile:
   ```js
   { id: 'quakes', label: 'USGS Earthquakes', type: 'markers',
     defaultActive: false, color: '#f87171',
     description: 'Live seismic events from USGS.' }
   ```
2. **`src/services/globalStreams.js`** — add a fetcher returning the normalized
   entity shape, and register it:
   ```js
   export async function fetchQuakes() { /* ... return Entity[] */ }
   export const LAYER_FETCHERS = { flights, buoys, quakes: fetchQuakes };
   ```
3. Done. The toggle, rendering, refresh loop, and telemetry readout all appear
   automatically.

**Normalized entity shape** every fetcher must return:

```js
{
  id:    string,            // stable unique id
  lat:   number,            // latitude  (degrees)
  lng:   number,            // longitude (degrees)
  label: string,            // short display name
  layer: string,            // owning layer id
  meta:  Record<string, *>  // arbitrary telemetry shown in the sidebar
}
```

---

## Local development

Requires Node 18+.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
npm run preview  # serve the production build locally
```

---

## Push to GitHub + deploy on Vercel

This app is fully static — Vercel hosts it for free with zero configuration.

### 1. Create the GitHub repository

From inside `MP_globetrot/`:

```bash
git init
git add .
git commit -m "Initial commit: MP GlobeTrot 3D dashboard"
git branch -M main
```

Create an empty repo on GitHub (no README/license), then:

```bash
git remote add origin https://github.com/<your-username>/MP_globetrot.git
git push -u origin main
```


### 2. Connect to Vercel (automated hosting)

1. Go to **[vercel.com](https://vercel.com)** and sign in with GitHub.
2. **Add New → Project**, then import your `MP_globetrot` repo.
3. Vercel auto-detects **Vite**. The included `vercel.json` already sets:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Click **Deploy**.

That's it. Every `git push` to `main` now triggers an automatic production
deploy, and pull requests get preview URLs.

---

## Data sources & notes

| Layer | Source | Notes |
|-------|--------|-------|
| Flights | OpenSky Network REST API | Anonymous tier is rate-limited; the fetcher uses a bounding box + result cap. |
| Buoys | NOAA NDBC `latest_obs.txt` | Fixed-width text catalog parsed client-side. |

All sources are public and free. No API keys are stored or required.

If a stream returns empty during local dev, it's almost always upstream rate
limiting (especially OpenSky) — wait a minute and the next 30s refresh will
recover.

---

## License

MIT — base globe textures © their respective open-source projects
(three-globe / NASA / CartoDB).
