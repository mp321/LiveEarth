import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
// deck.gl + weatherlayers-gl are dynamic-imported inside ensureWind() so the
// wind stack (~MBs) stays out of the initial bundle until first toggle.
import { greatCircle, point } from '@turf/turf';
import {
  LAYER_REGISTRY,
  LAYER_BY_ID,
  VECTOR_TYPES,
  POLYGON_TYPES,
} from '../state/layerRegistry';
import {
  LAYER_FETCHERS,
  entitiesToGeoJSON,
  polygonsToGeoJSON,
} from '../services/globalStreams';
import {
  BASE_IMAGERY,
  DEFAULT_BASE,
  cloudsSource,
  sstSource,
  fetchRadarFrames,
} from '../services/rasterSources';
import { loadWindData } from '../services/windData';
import { loadCurrentsData } from '../services/currentsData';
import { useAppContext } from '../state/AppContext';
import { currentView, publishViewState } from '../state/urlState';
import { navigateToGround } from '../ground/route';

const REFRESH_MS = 30_000;
const RADAR_FRAME_MS = 900;
const DEFAULT_CENTER = [-93.6, 42.0]; // Iowa, USA
const DEFAULT_ZOOM = 2.4;
const EMPTY_FC = { type: 'FeatureCollection', features: [] };

const PLANE_PATH =
  'M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z';
const PLANE_KINDS = { military: '#f43f5e', ga: '#a3e635', commercial: '#38bdf8' };

const QUAKE_COLOR = [
  'step', ['get', 'magnitude'],
  '#fbbf24', 2, '#f59e0b', 4, '#f97316', 5, '#ef4444',
];
const AQ_COLOR = [
  'interpolate', ['linear'], ['get', 'value'],
  0, '#a3e635', 12, '#fde047', 35, '#fb923c', 55, '#ef4444', 150, '#a21caf',
];
// Buoys are styled off the swell channels promoted in entitiesToGeoJSON.
// Color encodes dominant swell PERIOD: cool blues for short wind chop (<8s)
// through hot reds for long-period groundswell (>14s).
const BUOY_COLOR = [
  'interpolate', ['linear'], ['get', 'swell_period'],
  6, '#3b82f6', 8, '#22d3ee', 11, '#67e8f9', 13, '#facc15', 14, '#fb923c', 16, '#ef4444',
];
// Radius encodes swell ENERGY (wave-power kW/m). interpolate clamps the long
// tail so a few high-energy stations don't blow out the scale; a 0/missing
// reading still shows a small legible dot.
const BUOY_RADIUS = [
  'interpolate', ['linear'], ['get', 'swell_energy'],
  0, 3, 5, 5, 20, 8, 50, 12, 100, 16,
];
// Severe-weather fill/outline color keyed by `event`, NOT severity: the public
// maps people recognize use a fixed color per product (red tornado warning,
// orange thunderstorm, green flash flood), and NWS severity values don't map
// onto those expectations. Fallback (last value) is the layer's own color.
const SEVERE_COLOR = [
  'match', ['get', 'event'],
  'Tornado Warning', '#ef4444',
  'Tornado Watch', '#fbbf24',
  'Severe Thunderstorm Warning', '#f97316',
  'Severe Thunderstorm Watch', '#fde047',
  'Flash Flood Warning', '#16a34a',
  '#f87171',
];

const srcId = (id) => `src-${id}`;
const lyrId = (id) => `lyr-${id}`;

// Draw the plane silhouette to an ImageData so it can back a colored symbol icon.
function makePlaneIcon(color) {
  const S = 48;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.translate(S / 2, S / 2);
  const scale = (S / 24) * 0.85;
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 2;
  ctx.fillStyle = color;
  ctx.fill(new Path2D(PLANE_PATH));
  return ctx.getImageData(0, 0, S, S);
}

// Snow-capped peak icon for the mountains layer, one variant per alert level
// (0 quiet, 1 model-outlook storm signal, 2 official NWS winter alert).
const MTN_VARIANTS = {
  'mtn-0': { fill: '#93c5fd', outline: '#0b1220' },
  'mtn-1': { fill: '#dbeafe', outline: '#1e40af' },
  'mtn-2': { fill: '#fbbf24', outline: '#451a03' },
};

function makeMountainIcon({ fill, outline }) {
  const S = 48;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.lineJoin = 'round';
  const body = new Path2D('M6 41 L24 8 L42 41 Z');
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 3;
  ctx.fillStyle = fill;
  ctx.fill(body);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2.5;
  ctx.stroke(body);
  const cap = new Path2D('M24 8 L31 21 L27.5 18 L24 22.5 L20.5 18 L17 21 Z');
  ctx.fillStyle = '#f8fafc';
  ctx.fill(cap);
  return ctx.getImageData(0, 0, S, S);
}

// Satellite icon recolored per orbital-population kind — the glyph is identical,
// COLOR is the only type signal (mirrors the plane-kind icons). Kind is set in
// globalStreams' classifySatellite and promoted to `kind` by entitiesToGeoJSON.
const SAT_KINDS = {
  starlink: '#38bdf8',
  oneweb: '#818cf8',
  station: '#f472b6',
  nav: '#fbbf24',
  weather: '#34d399',
  other: '#a78bfa',
};

function makeSatelliteIcon(color) {
  const S = 44;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.translate(S / 2, S / 2);
  ctx.scale(S / 24, S / 24); // draw in a 24-unit space centered on the origin
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 2; // dark halo so the glyph reads on bright imagery
  // Booms out to the solar-panel wings.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-3.5, 0); ctx.lineTo(-6, 0);
  ctx.moveTo(3.5, 0); ctx.lineTo(6, 0);
  ctx.stroke();
  // Solar panels (filled wings).
  ctx.fillStyle = color;
  ctx.fillRect(-10, -3.2, 4, 6.4);
  ctx.fillRect(6, -3.2, 4, 6.4);
  // Body — dark core with a colored outline so it pops against the panels.
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(-3.2, -3.6, 6.4, 7.2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(-3.2, -3.6, 6.4, 7.2);
  // Dish antenna.
  ctx.beginPath();
  ctx.moveTo(0, -3.6); ctx.lineTo(0, -5.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -6, 1.6, 0, Math.PI, true);
  ctx.fillStyle = color;
  ctx.fill();
  return ctx.getImageData(0, 0, S, S);
}

// EONET event icons: a recognizable emoji on a severity-colored disc. Red discs
// (+ slightly larger via icon-size below) flag the highest-danger categories;
// cooler discs the rest. Color is by CATEGORY — see classifyEonet() for why.
const EVENT_KINDS = {
  wildfire: { emoji: '🔥', disc: '#dc2626' },
  volcano: { emoji: '🌋', disc: '#dc2626' },
  storm: { emoji: '🌀', disc: '#e11d48' },
  flood: { emoji: '🌊', disc: '#0284c7' },
  ice: { emoji: '❄️', disc: '#38bdf8' },
  dust: { emoji: '🌫️', disc: '#d97706' },
  event: { emoji: '⚠️', disc: '#f59e0b' },
};

function makeEmojiIcon(emoji, disc) {
  const S = 44;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  // Severity-colored backing disc so the category color reads even where the
  // emoji glyph is busy, with a soft shadow + light separating ring.
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 5, 0, Math.PI * 2);
  ctx.fillStyle = disc;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 4;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  // System emoji fonts render in color on every platform we target; a Linux box
  // without one degrades to a monochrome glyph on the disc, still a legible marker.
  ctx.font = '22px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, S / 2, S / 2 + 1);
  return ctx.getImageData(0, 0, S, S);
}

export default function MapView() {
  const {
    activeLayers,
    baseLayer,
    selectEntity,
    selectedRoute,
    setRadarStatus,
    reportLayerCount,
    flyTo,
  } = useAppContext();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const pollers = useRef({}); // layerId -> interval id
  const rafRef = useRef(null); // earthquake pulse loop
  const overlayRef = useRef(null); // deck.gl overlay hosting the wind particles
  const currentsOverlayRef = useRef(null); // separate INTERLEAVED overlay for ocean currents
  const windLibsRef = useRef(null); // cached dynamic-import promise (deck.gl + weatherlayers)
  const interactive = useRef(new Set()); // clickable vector layer ids
  const activeRef = useRef(activeLayers);
  activeRef.current = activeLayers;
  const baseRef = useRef(baseLayer);
  baseRef.current = baseLayer;

  // --- map setup (once) --------------------------------------------------------
  useEffect(() => {
    // Restore the camera from the URL hash / localStorage when present so a
    // shared link (or reload) reproduces the exact view. currentView() (not the
    // frozen page-load snapshot) so a remount after returning from Ground View
    // restores the camera the user actually left.
    const cam = currentView().camera;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: cam ? [cam.lng, cam.lat] : DEFAULT_CENTER,
      zoom: cam?.zoom ?? DEFAULT_ZOOM,
      bearing: cam?.bearing ?? 0,
      pitch: cam?.pitch ?? 0,
      maxZoom: 17,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#05070d' } }],
      },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    // Publish the camera into the shareable URL hash whenever movement settles
    // (and once on load so the hash is complete from the start). urlState
    // debounces the actual writes.
    const publishCamera = () => {
      const c = map.getCenter();
      publishViewState({
        camera: {
          lng: c.lng,
          lat: c.lat,
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        },
      });
    };
    map.on('moveend', publishCamera);
    map.on('load', publishCamera);

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
      map.setSky({
        'sky-color': '#0a1326',
        'horizon-color': '#3a93d6',
        'fog-color': '#bcd4f0',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.5,
        'fog-ground-blend': 0.4,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 6, 0.2, 9, 0],
      });
      setBaseImagery(baseRef.current);
      Object.values(PLANE_KINDS).forEach((color, i) => {
        const name = `plane-${Object.keys(PLANE_KINDS)[i]}`;
        if (!map.hasImage(name)) map.addImage(name, makePlaneIcon(color));
      });
      Object.entries(MTN_VARIANTS).forEach(([name, colors]) => {
        if (!map.hasImage(name)) map.addImage(name, makeMountainIcon(colors));
      });
      Object.entries(SAT_KINDS).forEach(([kind, color]) => {
        const name = `sat-${kind}`;
        if (!map.hasImage(name)) map.addImage(name, makeSatelliteIcon(color));
      });
      Object.entries(EVENT_KINDS).forEach(([kind, { emoji, disc }]) => {
        const name = `evt-${kind}`;
        if (!map.hasImage(name)) map.addImage(name, makeEmojiIcon(emoji, disc));
      });
      readyRef.current = true;
      syncLayers(activeRef.current);
    });

    // One click + hover handler over all interactive vector layers.
    map.on('click', (e) => {
      const ids = [...interactive.current].filter((id) => map.getLayer(id));
      const feats = ids.length ? map.queryRenderedFeatures(e.point, { layers: ids }) : [];
      if (feats.length) {
        try {
          selectEntity(JSON.parse(feats[0].properties._entity));
        } catch {
          /* ignore malformed feature */
        }
      } else {
        selectEntity(null);
      }
    });
    map.on('mousemove', (e) => {
      const ids = [...interactive.current].filter((id) => map.getLayer(id));
      const hit = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length;
      map.getCanvas().style.cursor = hit ? 'pointer' : '';
    });

    // Right-click hands the clicked point off to Ground View (separate route +
    // engine; this map unmounts). The globe never knows what the engine does —
    // it only emits a {lat,lng}. No fetcher/registry coupling.
    map.on('contextmenu', (e) => {
      e.preventDefault?.();
      navigateToGround(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      Object.values(pollers.current).forEach(clearInterval);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- base imagery ------------------------------------------------------------
  function setBaseImagery(key) {
    const map = mapRef.current;
    const cfg = BASE_IMAGERY[key] || BASE_IMAGERY[DEFAULT_BASE];
    if (map.getLayer('base')) map.removeLayer('base');
    if (map.getSource('base')) map.removeSource('base');
    map.addSource('base', cfg.source);
    // Keep imagery at the bottom of the stack, just above the background.
    const above = (map.getStyle().layers || []).find((l) => l.id !== 'bg' && l.id !== 'base');
    map.addLayer({ id: 'base', type: 'raster', source: 'base' }, above?.id);
  }

  // Id of the first style layer whose base registry type is in `types`, used as
  // the `beforeId` anchor when inserting a new layer beneath a channel.
  // Companion layers (-halo, -pulse, -line) resolve to their parent's registry
  // entry so an insert can't slot in between a feature and its companion.
  function firstLayerOfTypes(types) {
    const map = mapRef.current;
    const layers = map.getStyle().layers || [];
    const first = layers.find((l) => {
      if (!l.id.startsWith(lyrId(''))) return false;
      const baseId = l.id.slice(4).replace(/-(halo|pulse|line)$/, '');
      return types.has(LAYER_BY_ID[baseId]?.type);
    });
    return first?.id;
  }

  // Rasters sit at the bottom of the data stack: below every polygon AND vector
  // layer. Polygons sit between — above rasters, below the markers/aircraft.
  const RASTER_BELOW = new Set([...VECTOR_TYPES, ...POLYGON_TYPES]);
  const firstAbove = () => firstLayerOfTypes(RASTER_BELOW);
  const firstVectorAbove = () => firstLayerOfTypes(VECTOR_TYPES);

  // --- reconcile active layers -------------------------------------------------
  function syncLayers(active) {
    if (!readyRef.current) return;
    LAYER_REGISTRY.forEach((layer) => {
      const on = active.has(layer.id);
      if (VECTOR_TYPES.has(layer.type)) (on ? ensureVector : dropVector)(layer);
      else if (POLYGON_TYPES.has(layer.type)) (on ? ensurePolygons : dropPolygons)(layer);
      else if (layer.type === 'raster') (on ? ensureRaster : dropRaster)(layer);
      else if (layer.type === 'particles') (on ? ensureWind : dropWind)(layer);
      else if (layer.type === 'currents') (on ? ensureCurrents : dropCurrents)(layer);
    });
  }

  function ensureVector(layer) {
    const map = mapRef.current;
    const sid = srcId(layer.id);
    if (!map.getSource(sid)) map.addSource(sid, { type: 'geojson', data: EMPTY_FC });
    if (!map.getLayer(lyrId(layer.id))) addVectorLayer(layer);
    interactive.current.add(lyrId(layer.id));
    if (!pollers.current[layer.id]) {
      const load = async () => {
        const entities = await LAYER_FETCHERS[layer.id]();
        reportLayerCount(layer.id, entities.length);
        const s = map.getSource(sid);
        if (s) s.setData(entitiesToGeoJSON(entities));
      };
      load();
      pollers.current[layer.id] = setInterval(load, layer.refreshMs ?? REFRESH_MS);
    }
  }

  function addVectorLayer(layer) {
    const map = mapRef.current;
    const id = lyrId(layer.id);
    const source = srcId(layer.id);
    if (layer.type === 'aircraft') {
      map.addLayer({
        id, source, type: 'symbol',
        layout: {
          'icon-image': ['match', ['get', 'kind'], 'military', 'plane-military', 'ga', 'plane-ga', 'plane-commercial'],
          'icon-rotate': ['get', 'heading'],
          'icon-size': 0.5,
          'icon-allow-overlap': true,
          'icon-rotation-alignment': 'map',
        },
      });
      return;
    }
    if (layer.type === 'rings') {
      map.addLayer({
        id, source, type: 'circle',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 3, 8, 28],
          'circle-color': QUAKE_COLOR,
          'circle-opacity': 0.65,
          'circle-stroke-color': QUAKE_COLOR,
          'circle-stroke-width': 1,
        },
      });
      map.addLayer({
        id: `${id}-pulse`, source, type: 'circle',
        paint: { 'circle-radius': 4, 'circle-color': QUAKE_COLOR, 'circle-opacity': 0.3, 'circle-stroke-width': 0 },
      });
      startPulse();
      return;
    }
    if (layer.id === 'mountains') {
      // Snow-capped peak icons that swap variant and grow with `alertLevel`
      // (promoted by entitiesToGeoJSON): 0 quiet, 1 model-outlook storm
      // signal, 2 official NWS winter alert — plus a soft halo behind
      // alerting peaks so they read at a glance.
      map.addLayer({
        id: `${id}-halo`, source, type: 'circle',
        filter: ['>', ['get', 'alertLevel'], 0],
        paint: {
          'circle-radius': ['step', ['get', 'alertLevel'], 11, 2, 14],
          'circle-color': ['step', ['get', 'alertLevel'], '#93c5fd', 2, '#fbbf24'],
          'circle-opacity': 0.25,
          'circle-stroke-color': ['step', ['get', 'alertLevel'], '#bfdbfe', 2, '#fbbf24'],
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.5,
        },
      });
      map.addLayer({
        id, source, type: 'symbol',
        layout: {
          'icon-image': ['match', ['get', 'alertLevel'], 1, 'mtn-1', 2, 'mtn-2', 'mtn-0'],
          'icon-size': ['step', ['get', 'alertLevel'], 0.5, 1, 0.62, 2, 0.74],
          'icon-allow-overlap': true,
        },
      });
      return;
    }
    if (layer.id === 'buoys') {
      // Swell-styled markers: color by period, radius by energy. A subtle light
      // outline keeps the dark-mode aesthetic while lifting the dots cleanly off
      // the underlying ocean-currents flow field.
      map.addLayer({
        id, source, type: 'circle',
        paint: {
          'circle-radius': BUOY_RADIUS,
          'circle-color': BUOY_COLOR,
          'circle-opacity': 0.92,
          'circle-stroke-color': '#e2e8f0',
          'circle-stroke-width': 0.8,
          'circle-stroke-opacity': 0.35,
        },
      });
      return;
    }
    if (layer.id === 'satellites') {
      // Type-colored satellite icons (`kind` set by classifySatellite, promoted
      // by entitiesToGeoJSON). Small — the set is dense — with crewed stations
      // bumped up a touch since they're the headline objects.
      map.addLayer({
        id, source, type: 'symbol',
        layout: {
          'icon-image': ['match', ['get', 'kind'],
            'starlink', 'sat-starlink', 'oneweb', 'sat-oneweb', 'station', 'sat-station',
            'nav', 'sat-nav', 'weather', 'sat-weather', 'sat-other'],
          'icon-size': ['match', ['get', 'kind'], 'station', 0.6, 0.46],
          'icon-allow-overlap': true,
        },
      });
      return;
    }
    if (layer.id === 'eonet') {
      // Emoji-on-disc event markers; the red high-danger kinds render slightly
      // larger so severity reads as "bigger + hotter" (see classifyEonet).
      map.addLayer({
        id, source, type: 'symbol',
        layout: {
          'icon-image': ['match', ['get', 'kind'],
            'wildfire', 'evt-wildfire', 'volcano', 'evt-volcano', 'storm', 'evt-storm',
            'flood', 'evt-flood', 'ice', 'evt-ice', 'dust', 'evt-dust', 'evt-event'],
          'icon-size': ['match', ['get', 'kind'],
            'wildfire', 0.62, 'volcano', 0.62, 'storm', 0.58, 0.48],
          'icon-allow-overlap': true,
        },
      });
      return;
    }
    // markers + points (incl. air quality color ramp)
    map.addLayer({
      id, source, type: 'circle',
      paint: {
        'circle-radius': layer.type === 'points' ? 2.6 : 4.5,
        'circle-color': layer.id === 'airquality' ? AQ_COLOR : layer.color,
        'circle-opacity': 0.9,
        'circle-stroke-color': '#0b1220',
        'circle-stroke-width': 0.6,
      },
    });
  }

  function dropVector(layer) {
    const map = mapRef.current;
    if (!map) return;
    clearInterval(pollers.current[layer.id]);
    delete pollers.current[layer.id];
    interactive.current.delete(lyrId(layer.id));
    [lyrId(layer.id), `${lyrId(layer.id)}-pulse`, `${lyrId(layer.id)}-halo`].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(srcId(layer.id))) map.removeSource(srcId(layer.id));
    if (layer.type === 'rings' && rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  // --- polygons channel (filled alert areas, e.g. severe weather) -------------
  function ensurePolygons(layer) {
    const map = mapRef.current;
    const sid = srcId(layer.id);
    if (!map.getSource(sid)) map.addSource(sid, { type: 'geojson', data: EMPTY_FC });
    if (!map.getLayer(lyrId(layer.id))) addPolygonLayer(layer);
    // Only the fill is clickable (the shared click handler reads _entity) — the
    // outline is decorative, so it stays out of the interactive set.
    interactive.current.add(lyrId(layer.id));
    if (!pollers.current[layer.id]) {
      const load = async () => {
        const entities = await LAYER_FETCHERS[layer.id]();
        reportLayerCount(layer.id, entities.length);
        const s = map.getSource(sid);
        if (s) s.setData(polygonsToGeoJSON(entities));
      };
      load();
      pollers.current[layer.id] = setInterval(load, layer.refreshMs ?? REFRESH_MS);
    }
  }

  function addPolygonLayer(layer) {
    const map = mapRef.current;
    const id = lyrId(layer.id);
    const source = srcId(layer.id);
    // Insert below the marker/aircraft layers but above the rasters.
    const before = firstVectorAbove();
    map.addLayer(
      { id, source, type: 'fill', paint: { 'fill-color': SEVERE_COLOR, 'fill-opacity': 0.18 } },
      before
    );
    map.addLayer(
      {
        id: `${id}-line`, source, type: 'line',
        paint: { 'line-color': SEVERE_COLOR, 'line-width': 1.5 },
      },
      before
    );
  }

  function dropPolygons(layer) {
    const map = mapRef.current;
    if (!map) return;
    clearInterval(pollers.current[layer.id]);
    delete pollers.current[layer.id];
    interactive.current.delete(lyrId(layer.id));
    [lyrId(layer.id), `${lyrId(layer.id)}-line`].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(srcId(layer.id))) map.removeSource(srcId(layer.id));
  }

  // Pulsing ring overlay for earthquakes.
  function startPulse() {
    if (rafRef.current) return;
    const map = mapRef.current;
    const tick = (t) => {
      const id = `${lyrId('earthquakes')}-pulse`;
      if (map.getLayer(id)) {
        const k = (t % 1800) / 1800; // 0..1 over 1.8s
        map.setPaintProperty(id, 'circle-radius', [
          'interpolate', ['linear'], ['get', 'magnitude'], 0, 4 + k * 14, 8, 28 + k * 30,
        ]);
        map.setPaintProperty(id, 'circle-opacity', 0.4 * (1 - k));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function ensureRaster(layer) {
    const map = mapRef.current;
    const sid = srcId(layer.id);
    if (map.getSource(sid)) return;
    if (layer.id === 'radar') {
      addRadar();
      return;
    }
    const source = layer.id === 'clouds' ? cloudsSource() : sstSource();
    map.addSource(sid, source);
    map.addLayer({ id: lyrId(layer.id), type: 'raster', source: sid, paint: { 'raster-opacity': 0.85 } }, firstAbove());
  }

  async function addRadar() {
    const map = mapRef.current;
    const frames = await fetchRadarFrames();
    if (!frames.length || !map.getStyle()) return;
    const sid = srcId('radar');
    // Publish the on-screen frame so the ControlPanel can show its timestamp.
    const publish = (idx) =>
      setRadarStatus({
        time: frames[idx].time,
        kind: frames[idx].kind,
        index: idx,
        total: frames.length,
      });
    // Start on the present moment — the newest past frame — rather than the
    // oldest (up to ~2h stale); then animate forward into the nowcast and wrap.
    const lastPast = frames.map((f) => f.kind).lastIndexOf('past');
    let i = lastPast >= 0 ? lastPast : 0;
    map.addSource(sid, { type: 'raster', tiles: [frames[i].template], tileSize: 256, attribution: 'RainViewer' });
    map.addLayer({ id: lyrId('radar'), type: 'raster', source: sid, paint: { 'raster-opacity': 0.7 } }, firstAbove());
    publish(i);
    pollers.current.radar = setInterval(() => {
      i = (i + 1) % frames.length;
      const s = map.getSource(sid);
      if (s) s.setTiles([frames[i].template]);
      publish(i);
    }, RADAR_FRAME_MS);
  }

  function dropRaster(layer) {
    const map = mapRef.current;
    if (!map) return;
    if (layer.id === 'radar') {
      clearInterval(pollers.current.radar);
      delete pollers.current.radar;
      setRadarStatus(null);
    }
    if (map.getLayer(lyrId(layer.id))) map.removeLayer(lyrId(layer.id));
    if (map.getSource(srcId(layer.id))) map.removeSource(srcId(layer.id));
  }

  async function ensureWind() {
    const map = mapRef.current;
    // The wind stack (deck.gl + weatherlayers-gl) is by far the heaviest
    // dependency, so it loads on first toggle only; the promise is cached so
    // repeated toggles don't re-import.
    windLibsRef.current ??= Promise.all([
      import('@deck.gl/mapbox'),
      import('weatherlayers-gl'),
    ]);
    const [{ MapboxOverlay }, { ParticleLayer, ImageType, ImageInterpolation }] =
      await windLibsRef.current;
    const wind = await loadWindData();
    // Bail if the layer was toggled off (or the map torn down) while loading.
    if (!mapRef.current || !activeRef.current.has('wind')) return;
    if (!overlayRef.current) {
      overlayRef.current = new MapboxOverlay({ interleaved: false, layers: [] });
      map.addControl(overlayRef.current);
    }
    overlayRef.current.setProps({
      layers: [
        new ParticleLayer({
          id: 'wind',
          image: wind.image,
          imageType: ImageType.VECTOR,
          imageUnscale: wind.imageUnscale,
          bounds: wind.bounds,
          // Cubic GPU sampling smooths the budget-constrained 10° grid (see
          // windData.js) into continuous flow between sample points.
          imageInterpolation: ImageInterpolation.CUBIC,
          numParticles: 6000,
          maxAge: 40,
          speedFactor: 3,
          width: 1.6,
          // Color particles by wind speed (m/s): calm -> gale.
          palette: [
            [0, '#e0f2fe'],
            [8, '#67e8f9'],
            [16, '#38bdf8'],
            [24, '#a78bfa'],
            [32, '#f472b6'],
            [40, '#ef4444'],
          ],
          opacity: 0.8,
        }),
      ],
    });
  }

  function dropWind() {
    if (overlayRef.current) overlayRef.current.setProps({ layers: [] });
  }

  // --- ocean currents (deck.gl flow field, beneath the buoy markers) ----------
  async function ensureCurrents() {
    const map = mapRef.current;
    // Reuse the wind stack's cached dynamic import (same deck.gl + weatherlayers
    // bundle) so toggling currents doesn't pull a second heavy chunk.
    windLibsRef.current ??= Promise.all([
      import('@deck.gl/mapbox'),
      import('weatherlayers-gl'),
    ]);
    const [{ MapboxOverlay }, { ParticleLayer, ImageType, ImageInterpolation }] =
      await windLibsRef.current;
    const currents = await loadCurrentsData();
    // Bail if the layer was toggled off (or the map torn down) while loading.
    if (!mapRef.current || !activeRef.current.has('currents')) return;
    // Z-ORDERING: this overlay is INTERLEAVED (unlike the wind overlay, which is
    // non-interleaved and rides on top of everything), so its layers composite
    // INTO the MapLibre stack. Anchoring with `beforeId` to the first vector/
    // marker layer guarantees the currents draw UNDER the buoy markers (and
    // every other marker), above the imagery. When NO marker layer is active,
    // beforeId must be undefined (top of the stack) — anchoring to 'base' here
    // would slot the flow field BENEATH the basemap and hide it entirely.
    if (!currentsOverlayRef.current) {
      currentsOverlayRef.current = new MapboxOverlay({ interleaved: true, layers: [] });
      map.addControl(currentsOverlayRef.current);
    }
    const beforeId = firstVectorAbove(); // undefined => render on top of imagery
    currentsOverlayRef.current.setProps({
      layers: [
        new ParticleLayer({
          id: 'ocean-currents',
          beforeId, // strict ordering anchor — keeps the flow field below buoys
          image: currents.image,
          imageType: ImageType.VECTOR,
          imageUnscale: currents.imageUnscale,
          bounds: currents.bounds,
          imageInterpolation: ImageInterpolation.CUBIC,
          // Distinct from wind: a slow, languid drift in a cool cyan→aqua→white
          // ocean palette so the two flow fields never read as the same thing.
          // Surface currents run ~0.1–0.5 m/s — an order of magnitude slower than
          // wind — so a HIGH speedFactor still looks calm relative to the wind
          // layer, and the palette must START bright (most currents are slow)
          // to stay legible over the dark ocean basemap.
          numParticles: 5000,
          maxAge: 200,
          speedFactor: 22.0,
          width: 2.5,
          parameters: { depthTest: true, depthMask: false },
          palette: [
            [0, '#22d3ee'],
            [0.4, '#67e8f9'],
            [1.0, '#5eead4'],
            [2.0, '#a7f3d0'],
            [3.0, '#ecfeff'],
          ],
          opacity: 0.75,
        }),
      ],
    });
  }

  function dropCurrents() {
    if (currentsOverlayRef.current) currentsOverlayRef.current.setProps({ layers: [] });
  }

  // --- react to context changes ------------------------------------------------
  useEffect(() => {
    syncLayers(activeLayers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayers]);

  useEffect(() => {
    if (readyRef.current) setBaseImagery(baseLayer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayer]);

  // Fly-to requests (alerts drawer, etc.) — smooth camera move that never
  // zooms OUT past the user's current zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: Math.max(map.getZoom(), flyTo.zoom ?? 7),
      duration: 2200,
      essential: true,
    });
  }, [flyTo]);

  // Great-circle route arc for the selected flight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const r = selectedRoute;
    const ok = r?.status === 'ok' && Number.isFinite(r.origin?.lat) && Number.isFinite(r.destination?.lat);
    const fc = ok
      ? greatCircle(point([r.origin.lng, r.origin.lat]), point([r.destination.lng, r.destination.lat]))
      : EMPTY_FC;
    const data = fc.type === 'FeatureCollection' ? fc : { type: 'FeatureCollection', features: [fc] };
    if (!map.getSource('route')) {
      map.addSource('route', { type: 'geojson', data });
      map.addLayer({
        id: 'route', type: 'line', source: 'route',
        paint: { 'line-color': '#38bdf8', 'line-width': 1.6, 'line-opacity': 0.9 },
      });
    } else {
      map.getSource('route').setData(data);
    }
  }, [selectedRoute]);

  return <div ref={containerRef} className="fixed inset-0 z-0" />;
}
