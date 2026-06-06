# MP_LiveEarth — 3D Global Data Dashboard

MP_LiveEarth is built with React + Vite + Tailwind CSS + react-globe.gl and deployed on Vercel.

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
## Data Sources

All sources are public and free. If a stream returns empty during local dev, it's likely upstream rate
limiting 

---

## License

MIT — base globe textures © their respective open-source projects
(three-globe / NASA / CartoDB).

Created with llm assistance - Michael Phipps, 2026
