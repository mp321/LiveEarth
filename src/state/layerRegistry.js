// Single source of truth for every data layer. ControlPanel renders a toggle per
// entry and MapView projects each by its `type`. Adding a layer means: add an
// entry here, then a matching fetcher (for data types) or source builder.
//
// type -> MapView render channel:
//   aircraft   heading-rotated plane symbols (flights)
//   markers    surface circles (buoys, EONET, air quality)
//   points     circles sized for orbit context (satellites)
//   rings      magnitude-scaled pulsing circles (earthquakes)
//   raster     streamed tile imagery (clouds, radar, SST)
//   particles  animated flow field (wind)
//
// Fields: id, label, type, defaultActive, color, description, optional note.
// A note with `noteUntilData: true` is a setup hint — the ControlPanel hides
// it once the layer's fetcher returns its first non-empty result.
// sourceUrl / sourceLabel power the "More from source" drill-down link the
// ControlPanel renders under each toggle's expandable details.
// `icon` is an SVG path (24×24 viewBox, stroke-rendered) the ControlPanel
// draws in the layer's color; toggles fall back to a plain dot without one.
// `group` drives the ControlPanel's collapsible section headers — it lives
// here (not hardcoded in the component) so adding a layer automatically
// places it in the right group without any UI changes.

export const LAYER_REGISTRY = [
  {
    id: 'clouds',
    group: 'Weather',
    icon: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z',
    label: 'Cloud Cover (Near Real-Time)',
    type: 'raster',
    defaultActive: false,
    color: '#e2e8f0',
    description: "Today's VIIRS true-color imagery from NASA GIBS.",
    sourceUrl: 'https://worldview.earthdata.nasa.gov/',
    sourceLabel: 'NASA Worldview',
  },
  {
    id: 'radar',
    group: 'Weather',
    icon: 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2 M16 14v6 M8 14v6 M12 16v6',
    label: 'Precipitation Radar',
    type: 'raster',
    defaultActive: false,
    color: '#22d3ee',
    description: 'Animated rain and snow radar from RainViewer.',
    sourceUrl: 'https://www.rainviewer.com/map.html',
    sourceLabel: 'RainViewer map',
  },
  {
    id: 'wind',
    group: 'Weather',
    icon: 'M12.8 19.6A2 2 0 1 0 14 16H2 M17.5 8a2.5 2.5 0 1 1 2 4H2 M9.8 4.4A2 2 0 1 1 11 8H2',
    label: 'Global Wind',
    type: 'particles',
    defaultActive: false,
    color: '#67e8f9',
    description: 'Animated wind flow from the NOAA GFS forecast model.',
    sourceUrl: 'https://earth.nullschool.net/',
    sourceLabel: 'earth.nullschool.net',
  },
  {
    id: 'sst',
    group: 'Ocean & Water',
    icon: 'M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z',
    label: 'Sea Surface Temperature',
    type: 'raster',
    defaultActive: false,
    color: '#fb7185',
    description: 'Daily GHRSST MUR ocean-temperature analysis (NASA/JPL).',
    sourceUrl: 'https://worldview.earthdata.nasa.gov/',
    sourceLabel: 'NASA Worldview',
  },
  {
    id: 'mountains',
    group: 'Ground & Events',
    icon: 'M8 3l4 8 5-5 5 15H2L8 3z M4.1 15.1c2.6-1.6 5.3-1.4 7.9.4 2.7 1.9 5.5 2 8.2.2',
    label: 'Snow & Mountains',
    type: 'markers',
    defaultActive: false,
    color: '#93c5fd',
    description: 'Snow forecast & winter alerts for major US mountains.',
    sourceUrl: 'https://www.weather.gov/',
    sourceLabel: 'National Weather Service',
  },
  {
    id: 'flights',
    group: 'Sky & Space',
    icon: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
    label: 'Live ADS-B Flights',
    type: 'aircraft',
    defaultActive: false,
    color: '#38bdf8',
    description:
      'Global real-time aircraft positions via the OpenSky Network (airplanes.live fallback).',
    sourceUrl: 'https://globe.airplanes.live/',
    sourceLabel: 'airplanes.live globe',
  },
  {
    id: 'airquality',
    group: 'Ground & Events',
    icon: 'M5.2 6.2l1.4 1.4 M2 13h2 M20 13h2 M17.4 7.6l1.4-1.4 M22 17H2 M22 21H2 M16 13a4 4 0 0 0-8 0',
    label: 'Air Quality (PM2.5)',
    type: 'markers',
    defaultActive: false,
    color: '#a3e635',
    description: 'Ground-station particulate readings from OpenAQ.',
    note: 'Configure OPENAQ_KEY in Vercel for this layer.',
    noteUntilData: true,
    sourceUrl: 'https://explore.openaq.org/',
    sourceLabel: 'OpenAQ Explorer',
  },
  {
    id: 'earthquakes',
    group: 'Ground & Events',
    icon: 'M22 12h-2.5a2 2 0 0 0-1.9 1.5l-2.4 8.3a.25.25 0 0 1-.5 0L9.2 2.2a.25.25 0 0 0-.5 0L6.4 10.5A2 2 0 0 1 4.5 12H2',
    label: 'Live Global Earthquakes',
    type: 'rings',
    defaultActive: false,
    color: '#ef4444',
    description: 'Seismic activity over the past 24 hours from USGS.',
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/map/',
    sourceLabel: 'USGS earthquake map',
  },
  {
    id: 'eonet',
    group: 'Ground & Events',
    icon: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
    label: 'NASA Active Natural Events',
    type: 'markers',
    defaultActive: false,
    color: '#fb923c',
    description: 'Live tracking of severe storms, wildfires, and volcanoes.',
    sourceUrl: 'https://eonet.gsfc.nasa.gov/',
    sourceLabel: 'NASA EONET',
  },
  {
    id: 'buoys',
    group: 'Ocean & Water',
    icon: 'M12 22V8 M5 12H2a10 10 0 0 0 20 0h-3 M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    label: 'NOAA Weather Buoys',
    type: 'markers',
    defaultActive: false,
    color: '#fbbf24',
    description: 'Live ocean observation stations from the NOAA NDBC catalog.',
    sourceUrl: 'https://www.ndbc.noaa.gov/',
    sourceLabel: 'NOAA NDBC',
  },
  {
    id: 'satellites',
    group: 'Sky & Space',
    icon: 'M13 7 9 3 5 7l4 4 M17 11l4 4-4 4-4-4 M8 12l4 4 6-6-4-4 M16 8l3-3 M9 21a6 6 0 0 0-6-6',
    label: 'Active Satellites (LEO)',
    type: 'points',
    defaultActive: false,
    color: '#a78bfa',
    description: 'Live orbital positions calculated from CelesTrak TLEs.',
    sourceUrl: 'https://celestrak.org/',
    sourceLabel: 'CelesTrak',
  },
];

export const LAYER_BY_ID = LAYER_REGISTRY.reduce((acc, layer) => {
  acc[layer.id] = layer;
  return acc;
}, {});

// Quick-select layer sets. A chip shows "active" styling only when activeLayers
// exactly equals the preset — intentional: hand-toggling after a preset
// deselects the chip; presets are shortcuts, not modes.
export const LAYER_PRESETS = [
  { id: 'storm',    label: 'Storm watch', layers: ['radar', 'wind', 'clouds', 'mountains'] },
  { id: 'ocean',    label: 'Ocean',       layers: ['sst', 'buoys'] },
  { id: 'aviation', label: 'Aviation',    layers: ['flights', 'wind', 'clouds'] },
  { id: 'clear',    label: 'Clear',       layers: [] },
];

// Render-channel groupings used by MapView.
export const RASTER_TYPES = new Set(['raster']);
export const PARTICLE_TYPES = new Set(['particles']);
export const VECTOR_TYPES = new Set(['aircraft', 'markers', 'points', 'rings']);
