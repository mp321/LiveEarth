import { useEffect, useState } from 'react';
import { LAYER_BY_ID } from '../state/layerRegistry';
import { flightRouteUrl } from '../services/globalStreams';
import { useAppContext } from '../state/AppContext';

// -----------------------------------------------------------------------------
// TelemetrySidebar
// -----------------------------------------------------------------------------
// Collapsible right-side drawer. It is closed until `selectedEntity` holds data;
// clicking an element on the globe populates it and slides it open. The readout
// is generic — it renders whatever key/value pairs live in entity.meta, so new
// layers need no sidebar changes.
// -----------------------------------------------------------------------------

// Turn snake_case_keys into readable labels.
function humanize(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toString() : value.toFixed(2);
  }
  return String(value);
}

function MetricRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2">
      <span className="text-[11px] uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="text-right text-sm font-medium text-slate-100">
        {value}
      </span>
    </div>
  );
}

export default function TelemetrySidebar() {
  const { selectedEntity, selectEntity } = useAppContext();
  const open = Boolean(selectedEntity);
  const layer = selectedEntity ? LAYER_BY_ID[selectedEntity.layer] : null;

  // Origin/destination isn't broadcast over ADS-B, so resolve it lazily per click
  // from hexdb.io (CORS-enabled) only when a flight is selected — keeps the bulk
  // flight poll light instead of one route request per aircraft.
  const isFlight = selectedEntity?.layer === 'flights';
  const callsign = selectedEntity?.meta?.callsign?.trim();
  const [route, setRoute] = useState(null); // null | 'loading' | 'unknown' | {origin,destination}

  useEffect(() => {
    if (!isFlight || !callsign || callsign === 'UNKNOWN') {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRoute('loading');
    fetch(flightRouteUrl(callsign))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const raw = typeof data?.route === 'string' ? data.route : '';
        const parts = raw.split('-').filter(Boolean);
        if (parts.length >= 2) {
          setRoute({ origin: parts[0], destination: parts[parts.length - 1] });
        } else {
          setRoute('unknown');
        }
      })
      .catch(() => !cancelled && setRoute('unknown'));
    return () => {
      cancelled = true;
    };
  }, [isFlight, callsign]);

  return (
    <aside
      className={`pointer-events-auto fixed right-0 top-0 z-20 h-full w-80 max-w-[85vw] transform
        transition-transform duration-300 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full'}`}
      aria-hidden={!open}
    >
      <div className="glass m-3 flex h-[calc(100%-1.5rem)] flex-col rounded-2xl p-4">
        <header className="mb-4 flex items-start justify-between">
          <div className="min-w-0">
            <p
              className="text-[11px] uppercase tracking-widest"
              style={{ color: layer?.color ?? '#94a3b8' }}
            >
              {layer?.label ?? 'Entity'}
            </p>
            <h2 className="truncate text-lg font-semibold text-white">
              {selectedEntity?.label ?? '—'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => selectEntity(null)}
            className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
            aria-label="Close telemetry panel"
          >
            ×
          </button>
        </header>

        {selectedEntity && (
          <div className="flex-1 overflow-y-auto pr-1">
            {/* Coordinate block */}
            <section className="mb-4 rounded-xl bg-white/[0.03] p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-slate-400">
                Coordinates
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-[10px] text-slate-500">LAT</p>
                  <p className="font-mono text-slate-100">
                    {selectedEntity.lat?.toFixed(4)}°
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">LNG</p>
                  <p className="font-mono text-slate-100">
                    {selectedEntity.lng?.toFixed(4)}°
                  </p>
                </div>
              </div>
            </section>

            {/* Route (flights only — lazily resolved on selection) */}
            {isFlight && (
              <section className="mb-4 rounded-xl bg-white/[0.03] p-3">
                <p className="mb-2 text-[11px] uppercase tracking-wider text-slate-400">
                  Route (Origin → Destination)
                </p>
                {route === 'loading' && (
                  <p className="text-sm text-slate-400">Looking up route…</p>
                )}
                {route === 'unknown' && (
                  <p className="text-sm text-slate-400">No route data</p>
                )}
                {route && route.origin && (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-mono text-slate-100">{route.origin}</span>
                    <span className="text-slate-500">→</span>
                    <span className="font-mono text-slate-100">
                      {route.destination}
                    </span>
                  </div>
                )}
                {route === null && <p className="text-sm text-slate-500">—</p>}
              </section>
            )}

            {/* Operational metrics — generic over entity.meta */}
            <section>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">
                Operational Metrics
              </p>
              {Object.entries(selectedEntity.meta ?? {}).map(([key, value]) => (
                <MetricRow
                  key={key}
                  label={humanize(key)}
                  value={formatValue(value)}
                />
              ))}
            </section>
          </div>
        )}

        <footer className="mt-3 border-t border-white/10 pt-3 text-[10px] text-slate-500">
          ID: <span className="font-mono">{selectedEntity?.id ?? '—'}</span>
        </footer>
      </div>
    </aside>
  );
}
