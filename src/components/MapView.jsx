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
import { useAppContext } from '../state/AppContext';
import { INITIAL_VIEW, publishViewState } from '../state/urlState';

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
  const windLibsRef = useRef(null); // cached dynamic-import promise (deck.gl + weatherlayers)
  const interactive = useRef(new Set()); // clickable vector layer ids
  const activeRef = useRef(activeLayers);
  activeRef.current = activeLayers;
  const baseRef = useRef(baseLayer);
  baseRef.current = baseLayer;

  // --- map setup (once) --------------------------------------------------------
  useEffect(() => {
    // Restore the camera from the URL hash / localStorage when present so a
    // shared link (or reload) reproduces the exact view.
    const cam = INITIAL_VIEW.camera;
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
