import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import { LAYER_REGISTRY } from './layerRegistry';
import { flightRouteUrl, fetchAirport } from '../services/globalStreams';

// -----------------------------------------------------------------------------
// Global application state
// -----------------------------------------------------------------------------
// Shared concerns live here:
//   activeLayers   - a Set of layer ids currently toggled on
//   selectedEntity - the telemetry object for whatever the user last clicked
//   selectedRoute  - resolved departure/arrival airports for a selected flight
//
// Keeping these in a single context means the ControlPanel, MapView and
// TelemetrySidebar all read/write the same source of truth without prop drilling.
// -----------------------------------------------------------------------------

const AppContext = createContext(null);

// Seed activeLayers from any profiles marked defaultActive in the registry.
function initialActiveLayers() {
  return new Set(
    LAYER_REGISTRY.filter((layer) => layer.defaultActive).map((layer) => layer.id)
  );
}

export function AppProvider({ children }) {
  const [activeLayers, setActiveLayers] = useState(initialActiveLayers);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [baseLayer, setBaseLayer] = useState('esri'); // base imagery key
  // Current RainViewer radar frame, published by MapView's animation timer so the
  // ControlPanel can show what moment is on screen: { time, kind, index, total }.
  const [radarStatus, setRadarStatus] = useState(null);

  const toggleLayer = useCallback((layerId) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  }, []);

  const isLayerActive = useCallback(
    (layerId) => activeLayers.has(layerId),
    [activeLayers]
  );

  // Select an entity (opens the telemetry sidebar) or clear it (null).
  const selectEntity = useCallback((entity) => {
    setSelectedEntity(entity ?? null);
  }, []);

  // When a flight is selected, resolve its route (origin/destination ICAO via
  // hexdb) and each airport's name + coordinates. Both the sidebar (labels) and
  // MapView (route arc) read the result. Origin/destination isn't broadcast
  // over ADS-B, so this is a lazy per-selection lookup, not part of the bulk poll.
  const [selectedRoute, setSelectedRoute] = useState(null);

  useEffect(() => {
    const isFlight = selectedEntity?.layer === 'flights';
    const callsign = selectedEntity?.meta?.callsign?.trim();
    if (!isFlight || !callsign || callsign === 'UNKNOWN') {
      setSelectedRoute(null);
      return;
    }

    let cancelled = false;
    setSelectedRoute({ status: 'loading', callsign, origin: null, destination: null });

    (async () => {
      try {
        const res = await fetch(flightRouteUrl(callsign));
        const data = res.ok ? await res.json() : null;
        const raw = typeof data?.route === 'string' ? data.route : '';
        const parts = raw.split('-').filter(Boolean);
        if (parts.length < 2) {
          if (!cancelled) {
            setSelectedRoute({ status: 'unknown', callsign, origin: null, destination: null });
          }
          return;
        }
        // Resolve both airports in parallel (best-effort; null if unknown).
        const [origin, destination] = await Promise.all([
          fetchAirport(parts[0]),
          fetchAirport(parts[parts.length - 1]),
        ]);
        if (cancelled) return;
        setSelectedRoute({
          status: 'ok',
          callsign,
          origin: origin ?? { icao: parts[0].toUpperCase() },
          destination: destination ?? { icao: parts[parts.length - 1].toUpperCase() },
        });
      } catch {
        if (!cancelled) {
          setSelectedRoute({ status: 'unknown', callsign, origin: null, destination: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEntity]);

  const value = useMemo(
    () => ({
      activeLayers,
      toggleLayer,
      isLayerActive,
      selectedEntity,
      selectEntity,
      selectedRoute,
      baseLayer,
      setBaseLayer,
      radarStatus,
      setRadarStatus,
    }),
    [
      activeLayers,
      toggleLayer,
      isLayerActive,
      selectedEntity,
      selectEntity,
      selectedRoute,
      baseLayer,
      radarStatus,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used within an <AppProvider>');
  }
  return ctx;
}
