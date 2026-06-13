import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import { LAYER_REGISTRY, LAYER_BY_ID } from './layerRegistry';
import { BASE_IMAGERY, DEFAULT_BASE } from '../services/rasterSources';
import { flightRouteUrl, fetchAirport } from '../services/globalStreams';
import { fetchMountainAlerts } from '../services/snowData';
import { fetchSevereAlertFeed } from '../services/severeData';
import { INITIAL_VIEW, publishViewState } from './urlState';

// Winter-alert poll cadence — only while the tab is open (notifications v1).
const ALERT_POLL_MS = 15 * 60 * 1000;

// Alert feed registry: each returns drawer items tagged with their own layerId,
// so the badge counts and Alerts drawer stay generic across feeds.
const ALERT_FEEDS = [fetchMountainAlerts, fetchSevereAlertFeed];

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

// Seed activeLayers from the restored URL/localStorage view when present
// (filtered to ids that still exist), else from the registry defaults.
function initialActiveLayers() {
  if (INITIAL_VIEW.layers) {
    return new Set(INITIAL_VIEW.layers.filter((id) => id in LAYER_BY_ID));
  }
  return new Set(
    LAYER_REGISTRY.filter((layer) => layer.defaultActive).map((layer) => layer.id)
  );
}

// Restored base imagery key, if it's still a valid option.
const initialBase =
  INITIAL_VIEW.base && BASE_IMAGERY[INITIAL_VIEW.base]
    ? INITIAL_VIEW.base
    : DEFAULT_BASE;

export function AppProvider({ children }) {
  const [activeLayers, setActiveLayers] = useState(initialActiveLayers);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [baseLayer, setBaseLayer] = useState(initialBase); // base imagery key
  // Current RainViewer radar frame, published by MapView's animation timer so the
  // ControlPanel can show what moment is on screen: { time, kind, index, total }.
  const [radarStatus, setRadarStatus] = useState(null);
  // Entity count per layer id, published by MapView after each fetch. The
  // ControlPanel uses it to hide `noteUntilData` setup hints once data flows.
  const [layerCounts, setLayerCounts] = useState({});

  const reportLayerCount = useCallback((layerId, count) => {
    setLayerCounts((prev) =>
      prev[layerId] === count ? prev : { ...prev, [layerId]: count }
    );
  }, []);

  // Active alerts across all ALERT_FEEDS, polled on load and every 15 min.
  // Powers the ControlPanel badge and Alerts drawer. Individual feeds degrade
  // to their last good list, so a dead upstream never clears all alerts.
  const [alerts, setAlerts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const settled = await Promise.allSettled(ALERT_FEEDS.map((fn) => fn()));
        if (!cancelled) {
          const all = settled
            .filter((s) => s.status === 'fulfilled')
            .flatMap((s) => s.value);
          // Sort official alerts (level 2) before outlooks (level 1); break ties
          // alphabetically. Re-sorting here handles cross-feed ordering.
          all.sort((a, b) => b.level - a.level || (a.name ?? '').localeCompare(b.name ?? ''));
          setAlerts(all);
        }
      } catch {
        /* degrade silently — alerting must never break the globe */
      }
    };
    poll();
    const id = setInterval(poll, ALERT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Generic badge counts per layer id — no layer special-casing.
  const layerBadges = useMemo(
    () =>
      alerts.reduce((acc, a) => {
        acc[a.layerId] = (acc[a.layerId] ?? 0) + 1;
        return acc;
      }, {}),
    [alerts]
  );

  // Camera fly-to requests (e.g. clicking an alert) — MapView consumes them.
  // `ts` makes repeat clicks on the same target re-trigger the effect.
  const [flyTo, setFlyTo] = useState(null);
  const requestFlyTo = useCallback((target) => {
    setFlyTo({ ...target, ts: Date.now() });
  }, []);

  // Apply a preset by replacing activeLayers with exactly the preset's layer
  // set. Filters against LAYER_BY_ID so a preset may safely name a layer from
  // a not-yet-implemented phase without breaking anything.
  const applyPreset = useCallback((layerIds) => {
    setActiveLayers(new Set(layerIds.filter((id) => id in LAYER_BY_ID)));
  }, []);

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

  // Mirror layer/base selections to the shareable URL hash + localStorage
  // (urlState debounces the writes; MapView publishes the camera the same way).
  useEffect(() => {
    publishViewState({ layers: [...activeLayers], base: baseLayer });
  }, [activeLayers, baseLayer]);

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
      applyPreset,
      selectedEntity,
      selectEntity,
      selectedRoute,
      baseLayer,
      setBaseLayer,
      radarStatus,
      setRadarStatus,
      layerCounts,
      reportLayerCount,
      alerts,
      layerBadges,
      flyTo,
      requestFlyTo,
    }),
    [
      activeLayers,
      toggleLayer,
      isLayerActive,
      applyPreset,
      selectedEntity,
      selectEntity,
      selectedRoute,
      baseLayer,
      radarStatus,
      layerCounts,
      reportLayerCount,
      alerts,
      layerBadges,
      flyTo,
      requestFlyTo,
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
