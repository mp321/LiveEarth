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
// sourceUrl / sourceLabel power the "More from source" drill-down link the
// ControlPanel renders under each toggle's expandable details.

export const LAYER_REGISTRY = [
  {
    id: 'clouds',
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
    label: 'Sea Surface Temperature',
    type: 'raster',
    defaultActive: false,
    color: '#fb7185',
    description: 'Daily GHRSST MUR ocean-temperature analysis (NASA/JPL).',
    sourceUrl: 'https://worldview.earthdata.nasa.gov/',
    sourceLabel: 'NASA Worldview',
  },
  {
    id: 'flights',
    label: 'Live ADS-B Flights',
    type: 'aircraft',
    defaultActive: false,
    color: '#38bdf8',
    description: 'Real-time aircraft positions via the airplanes.live API.',
    sourceUrl: 'https://globe.airplanes.live/',
    sourceLabel: 'airplanes.live globe',
  },
  {
    id: 'airquality',
    label: 'Air Quality (PM2.5)',
    type: 'markers',
    defaultActive: false,
    color: '#a3e635',
    description: 'Ground-station particulate readings from OpenAQ.',
    sourceUrl: 'https://explore.openaq.org/',
    sourceLabel: 'OpenAQ Explorer',
  },
  {
    id: 'earthquakes',
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
    label: 'Active Satellites (LEO)',
    type: 'points',
    defaultActive: false,
    color: '#a78bfa',
    description: 'Live orbital positions calculated from CelesTrak TLEs.',
    note: 'May be intermittent — CelesTrak rate-limits TLE requests.',
    sourceUrl: 'https://celestrak.org/',
    sourceLabel: 'CelesTrak',
  },
];

export const LAYER_BY_ID = LAYER_REGISTRY.reduce((acc, layer) => {
  acc[layer.id] = layer;
  return acc;
}, {});

// Render-channel groupings used by MapView.
export const RASTER_TYPES = new Set(['raster']);
export const PARTICLE_TYPES = new Set(['particles']);
export const VECTOR_TYPES = new Set(['aircraft', 'markers', 'points', 'rings']);
