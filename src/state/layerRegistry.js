// -----------------------------------------------------------------------------
// The Extensible Layer Registry
// -----------------------------------------------------------------------------
// This is the single source of truth for every data layer the dashboard can
// render. The UI (ControlPanel) and the engine (GlobeView) both iterate over
// this array — nothing about a layer is hardcoded anywhere else.
//
// To add a new open-source layer:
//   1. Add a profile object below.
//   2. Add a matching `fetch` function in src/services/globalStreams.js.
//   3. Register that fetcher in LAYER_FETCHERS (also in globalStreams.js).
//
// Profile fields:
//   id            - unique key, also used as the activeLayers membership token
//   label         - human-readable name shown in the ControlPanel
//   type          - how GlobeView projects the data:
//                     'points'  -> heading-oriented airplane glyphs (uses
//                                  meta.heading_deg), for moving craft like flights
//                     'markers' -> flat dots on the surface, for fixed stations
//   defaultActive - whether the layer is toggled on at first load
//   color         - accent color used for the rendered geometry + UI dot
//   description    - short blurb shown under the toggle
// -----------------------------------------------------------------------------

export const LAYER_REGISTRY = [
  {
    id: 'flights',
    label: 'Live ADSB Flights',
    type: 'points',
    defaultActive: false,
    color: '#38bdf8',
    description: 'Real-time aircraft positions via the OpenSky Network.',
  },
  {
    id: 'buoys',
    label: 'NOAA Weather Buoys',
    type: 'markers',
    defaultActive: false,
    color: '#fbbf24',
    description: 'Live ocean observation stations from the NOAA NDBC catalog.',
  },
];

// Convenience lookup so consumers can resolve a profile from an id in O(1).
export const LAYER_BY_ID = LAYER_REGISTRY.reduce((acc, layer) => {
  acc[layer.id] = layer;
  return acc;
}, {});
