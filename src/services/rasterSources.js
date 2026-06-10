// Tile-URL builders for the raster imagery layers. Each returns a MapLibre
// `raster` source descriptor (tiles + tileSize + attribution) so MapView can
// register them uniformly.

// GIBS near-real-time imagery publishes hours-to-days late, so requesting the
// current calendar day 404s. Offset back a safe number of days per product.
const gibsDate = (offsetDays) =>
  new Date(Date.now() - offsetDays * 86400_000).toISOString().slice(0, 10);

// Deep-zoom base imagery options, keyed for the base-layer switcher.
export const BASE_IMAGERY = {
  esri: {
    label: 'ESRI World Imagery',
    source: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
  },
  sentinel2: {
    label: 'Sentinel-2 Cloudless',
    source: {
      type: 'raster',
      tiles: [
        'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Sentinel-2 cloudless © EOX IT Services (CC BY 4.0), Copernicus',
    },
  },
  gibs: {
    label: "Today's Earth (NASA GIBS)",
    source: {
      type: 'raster',
      tiles: [gibsTileUrl('MODIS_Terra_CorrectedReflectance_TrueColor', 9, 'jpg', 1)],
      tileSize: 256,
      maxzoom: 9,
      attribution: 'NASA EOSDIS GIBS — near real-time MODIS Terra',
    },
  },
};

export const DEFAULT_BASE = 'esri';

// NASA GIBS web-mercator WMTS. `levels` is the product's GoogleMapsCompatible
// level count (also bounds native zoom); `offsetDays` accounts for data latency.
export function gibsTileUrl(layer, levels, ext = 'jpg', offsetDays = 1) {
  return (
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}` +
    `/default/${gibsDate(offsetDays)}/GoogleMapsCompatible_Level${levels}/{z}/{y}/{x}.${ext}`
  );
}

// Cloud / near-real-time true-color overlay (drawn above the base, below data).
export function cloudsSource() {
  return {
    type: 'raster',
    tiles: [gibsTileUrl('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 9, 'jpg', 1)],
    tileSize: 256,
    maxzoom: 9,
    attribution: 'NASA EOSDIS GIBS — VIIRS NOAA-20',
  };
}

// Sea-surface temperature (GHRSST MUR L4), png with alpha so land stays clear.
// MUR L4 lands ~2 days late.
export function sstSource() {
  return {
    type: 'raster',
    tiles: [
      gibsTileUrl('GHRSST_L4_MUR_Sea_Surface_Temperature', 7, 'png', 2),
    ],
    tileSize: 256,
    maxzoom: 7,
    attribution: 'NASA EOSDIS GIBS / JPL MUR SST',
  };
}

// RainViewer animated precipitation radar. The catalog lists past + nowcast
// frames; fetchRadarFrames resolves them to ready-to-use tile templates that
// MapView cycles through on a timer. Free for personal/community use, no key.
const RAINVIEWER_CATALOG = 'https://api.rainviewer.com/public/weather-maps.json';

export async function fetchRadarFrames() {
  try {
    const res = await fetch(RAINVIEWER_CATALOG);
    if (!res.ok) throw new Error(`RainViewer responded ${res.status}`);
    const data = await res.json();
    const radar = data.radar || {};
    const frames = [...(radar.past || []), ...(radar.nowcast || [])];
    // Served through the same-origin proxy; color 4 = Universal Blue, 256px.
    return frames.map((f) => ({
      time: f.time,
      template: `/proxy/rainviewer${f.path}/256/{z}/{x}/{y}/4/1_1.png`,
    }));
  } catch (err) {
    console.warn('[rasterSources] fetchRadarFrames failed:', err.message);
    return [];
  }
}
