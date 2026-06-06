import { LAYER_REGISTRY } from '../state/layerRegistry';
import { useAppContext } from '../state/AppContext';

// -----------------------------------------------------------------------------
// ControlPanel
// -----------------------------------------------------------------------------
// Floating glass-morphism menu on the left. It maps over LAYER_REGISTRY to
// auto-generate one toggle per data stream — there are NO hardcoded buttons, so
// adding a layer to the registry surfaces it here automatically.
// -----------------------------------------------------------------------------

function LayerToggle({ layer }) {
  const { isLayerActive, toggleLayer } = useAppContext();
  const active = isLayerActive(layer.id);

  return (
    <button
      type="button"
      onClick={() => toggleLayer(layer.id)}
      className={`group w-full text-left rounded-xl border px-3 py-3 transition-all duration-200
        ${active
          ? 'border-white/30 bg-white/10'
          : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.06]'}`}
    >
      <div className="flex items-center gap-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full transition-all"
          style={{
            backgroundColor: active ? layer.color : 'transparent',
            boxShadow: active ? `0 0 10px ${layer.color}` : 'none',
            border: `1px solid ${layer.color}`,
          }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">
            {layer.label}
          </p>
          <p className="truncate text-[11px] text-slate-400">
            {layer.description}
          </p>
        </div>
        {/* Pill switch */}
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors
            ${active ? 'bg-accent/80' : 'bg-white/10'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform
              ${active ? 'translate-x-4' : 'translate-x-0.5'}`}
          />
        </span>
      </div>
    </button>
  );
}

export default function ControlPanel() {
  const { activeLayers } = useAppContext();

  return (
    <aside className="pointer-events-auto fixed left-4 top-4 z-20 w-72 max-w-[80vw]">
      <div className="glass rounded-2xl p-4">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white">
              GlobeTrot
            </h1>
            <p className="text-[11px] uppercase tracking-widest text-accent/80">
              Global Data Dashboard
            </p>
          </div>
          <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-medium text-slate-300">
            {activeLayers.size} active
          </span>
        </header>

        <div className="space-y-2">
          {LAYER_REGISTRY.map((layer) => (
            <LayerToggle key={layer.id} layer={layer} />
          ))}
        </div>

        <footer className="mt-4 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-slate-500">
          Streams refresh automatically every 30s while active. Click any element
          on the globe to inspect its telemetry.
          <span className="mt-1.5 block text-slate-600">
            Flight data{' '}
            <a
              href="https://airplanes.live/"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-slate-400"
            >
              airplanes.live
            </a>
            {' · '}buoys NOAA NDBC.
          </span>
        </footer>
      </div>
    </aside>
  );
}
