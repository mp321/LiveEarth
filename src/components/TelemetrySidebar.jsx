import { LAYER_BY_ID } from '../state/layerRegistry';
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
