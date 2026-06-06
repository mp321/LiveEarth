import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Globe from 'react-globe.gl';
import { LAYER_REGISTRY, LAYER_BY_ID } from '../state/layerRegistry';
import { LAYER_FETCHERS } from '../services/globalStreams';
import { useAppContext } from '../state/AppContext';

// Open-source base textures (NASA / CartoDB via the three-globe CDN bundle).
// Use the high-contrast blue-marble surface so the globe is clearly visible
// against the night-sky background (earth-dark is nearly black and vanishes).
const GLOBE_IMAGE = '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const BUMP_IMAGE = '//unpkg.com/three-globe/example/img/earth-topology.png';
const BACKGROUND_IMAGE = '//unpkg.com/three-globe/example/img/night-sky.png';

// How often (ms) to re-pull live streams for layers that are toggled on.
const REFRESH_MS = 30_000;

// Default camera target so the globe is framed on a known location instead of
// an empty point in space. Iowa, USA — altitude is the camera distance in globe
// radii (higher = further out / more zoomed out).
const DEFAULT_POV = { lat: 42.0, lng: -93.6, altitude: 2.2 };

export default function GlobeView() {
  const { activeLayers, selectEntity } = useAppContext();
  const globeRef = useRef();

  // Per-layer entity cache: { [layerId]: Entity[] }.
  const [layerData, setLayerData] = useState({});

  // Track viewport so the canvas always fills the screen.
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const onResize = () =>
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---------------------------------------------------------------------------
  // Registry-driven data loading.
  // For every layer in the registry: if it's active, fetch (and keep polling)
  // its stream; if it's inactive, drop its cached data. Nothing here is
  // hardcoded per-layer — it all flows from LAYER_REGISTRY + LAYER_FETCHERS.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const timers = [];
    let cancelled = false;

    LAYER_REGISTRY.forEach((layer) => {
      const isActive = activeLayers.has(layer.id);
      const fetcher = LAYER_FETCHERS[layer.id];

      if (!isActive || !fetcher) {
        // Prune data for layers that have been switched off.
        setLayerData((prev) => {
          if (!(layer.id in prev)) return prev;
          const next = { ...prev };
          delete next[layer.id];
          return next;
        });
        return;
      }

      const load = async () => {
        const entities = await fetcher();
        if (cancelled) return;
        setLayerData((prev) => ({ ...prev, [layer.id]: entities }));
      };

      load();
      timers.push(setInterval(load, REFRESH_MS));
    });

    return () => {
      cancelled = true;
      timers.forEach(clearInterval);
    };
  }, [activeLayers]);

  // Flatten the active layers' entities, then split by how the registry says to
  // project each layer: `points` layers (e.g. flights) render as heading-oriented
  // airplane glyphs in the html layer; `markers` layers (e.g. buoys) render as
  // flat dots in the points layer.
  const allEntities = useMemo(
    () => Object.values(layerData).flat(),
    [layerData]
  );
  const markerEntities = useMemo(
    () => allEntities.filter((d) => LAYER_BY_ID[d.layer]?.type !== 'points'),
    [allEntities]
  );
  const flightEntities = useMemo(
    () => allEntities.filter((d) => LAYER_BY_ID[d.layer]?.type === 'points'),
    [allEntities]
  );

  const colorFor = useCallback(
    (d) => LAYER_BY_ID[d.layer]?.color ?? '#ffffff',
    []
  );

  // Dots sit flat on the surface; airplane glyphs lift a touch so airborne
  // traffic reads as "above" it.
  const MARKER_ALTITUDE = 0.01;
  const FLIGHT_ALTITUDE = 0.06;

  const handleClick = useCallback(
    (point) => selectEntity(point),
    [selectEntity]
  );

  // Build a clickable, heading-rotated airplane icon as a DOM node for the
  // html-elements layer. Inline SVG (no emoji) so it stays crisp and inherits
  // the layer color; rotation is clockwise-from-north to match ADS-B heading.
  const planeElement = useCallback(
    (d) => {
      const color = LAYER_BY_ID[d.layer]?.color ?? '#ffffff';
      const heading = Number.isFinite(d.meta?.heading_deg)
        ? d.meta.heading_deg
        : 0;
      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'auto';
      el.title = `${d.label} — ${LAYER_BY_ID[d.layer]?.label ?? ''}`;
      el.innerHTML = `
        <svg viewBox="0 0 24 24" width="22" height="22"
             style="display:block;transform:rotate(${heading}deg);
                    filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">
          <path fill="${color}" d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
        </svg>`;
      el.addEventListener('click', () => selectEntity(d));
      return el;
    },
    [selectEntity]
  );

  // Once the globe's WebGL scene is ready, frame the camera on the default
  // location and make sure the orbit controls allow zooming/panning.
  const handleGlobeReady = useCallback(() => {
    const globe = globeRef.current;
    if (!globe) return;

    globe.pointOfView(DEFAULT_POV, 0);

    const controls = globe.controls();
    if (controls) {
      controls.enableZoom = true;
      controls.enableRotate = true;
      controls.enablePan = false;
      // Clamp how close/far the user can zoom (camera distance in globe radii).
      controls.minDistance = 110;
      controls.maxDistance = 800;
    }
  }, []);

  return (
    <div className="fixed inset-0 z-0">
      <Globe
        ref={globeRef}
        width={dimensions.width}
        height={dimensions.height}
        globeImageUrl={GLOBE_IMAGE}
        bumpImageUrl={BUMP_IMAGE}
        backgroundImageUrl={BACKGROUND_IMAGE}
        atmosphereColor="#3a93d6"
        atmosphereAltitude={0.18}
        pointsData={markerEntities}
        pointLat={(d) => d.lat}
        pointLng={(d) => d.lng}
        pointColor={colorFor}
        pointAltitude={MARKER_ALTITUDE}
        pointRadius={0.22}
        pointResolution={6}
        pointLabel={(d) => `${d.label} — ${LAYER_BY_ID[d.layer]?.label ?? ''}`}
        onPointClick={handleClick}
        htmlElementsData={flightEntities}
        htmlLat={(d) => d.lat}
        htmlLng={(d) => d.lng}
        htmlAltitude={FLIGHT_ALTITUDE}
        htmlElement={planeElement}
        onGlobeReady={handleGlobeReady}
      />
    </div>
  );
}
