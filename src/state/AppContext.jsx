import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { LAYER_REGISTRY } from './layerRegistry';

// -----------------------------------------------------------------------------
// Global application state
// -----------------------------------------------------------------------------
// Two shared concerns live here:
//   activeLayers   - a Set of layer ids currently toggled on
//   selectedEntity - the telemetry object for whatever the user last clicked
//
// Keeping these in a single context means the ControlPanel, GlobeView and
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

  const value = useMemo(
    () => ({
      activeLayers,
      toggleLayer,
      isLayerActive,
      selectedEntity,
      selectEntity,
    }),
    [activeLayers, toggleLayer, isLayerActive, selectedEntity, selectEntity]
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
