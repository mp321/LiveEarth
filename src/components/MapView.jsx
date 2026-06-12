import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ParticleLayer, ImageType } from 'weatherlayers-gl';
import { greatCircle, point } from '@turf/turf';
import {
  LAYER_REGISTRY,
  LAYER_BY_ID,
  VECTOR_TYPES,
} from '../state/layerRegistry';
import { LAYER_FETCHERS, entitiesToGeoJSON } from '../services/globalStreams';
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

export default function MapView() {
  const {
    activeLayers,
    baseLayer,
    selectEntity,
    selectedRoute,
    setRadarStatus,
    reportLayerCount,
  } = useAppContext();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const pollers = useRef({}); // layerId -> interval id
  const rafRef = useRef(null); // earthquake pulse loop
  const overlayRef = useRef(null); // deck.gl overlay hosting the wind particles
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

  // Insert raster imagery just above the background, below any data layers.
  function firstAbove() {
    const map = mapRef.current;
    const layers = map.getStyle().layers || [];
    const first = layers.find(
      (l) => l.id.startsWith(lyrId('')) && VECTOR_TYPES.has(LAYER_BY_ID[l.id.slice(4)]?.type)
    );
    return first?.id;
  }

  // --- reconcile active layers -------------------------------------------------
  function syncLayers(active) {
    if (!readyRef.current) return;
    LAYER_REGISTRY.forEach((layer) => {
      const on = active.has(layer.id);
      if (VECTOR_TYPES.has(layer.type)) (on ? ensureVector : dropVector)(layer);
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
      pollers.current[layer.id] = setInterval(load, REFRESH_MS);
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
    [lyrId(layer.id), `${lyrId(layer.id)}-pulse`].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(srcId(layer.id))) map.removeSource(srcId(layer.id));
    if (layer.type === 'rings' && rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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
    if (!overlayRef.current) {
      overlayRef.current = new MapboxOverlay({ interleaved: false, layers: [] });
      map.addControl(overlayRef.current);
    }
    const wind = await loadWindData();
    overlayRef.current.setProps({
      layers: [
        new ParticleLayer({
          id: 'wind',
          image: wind.image,
          imageType: ImageType.VECTOR,
          imageUnscale: wind.imageUnscale,
          bounds: wind.bounds,
          numParticles: 4000,
          maxAge: 25,
          speedFactor: 3,
          width: 2,
          // Color particles by wind speed (m/s): calm -> gale.
          palette: [
            [0, '#e0f2fe'],
            [8, '#67e8f9'],
            [16, '#38bdf8'],
            [24, '#a78bfa'],
            [32, '#f472b6'],
            [40, '#ef4444'],
          ],
          opacity: 0.65,
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
