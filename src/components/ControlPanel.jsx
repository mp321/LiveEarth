import { useState } from 'react';
import { LAYER_REGISTRY } from '../state/layerRegistry';
import { BASE_IMAGERY } from '../services/rasterSources';
import { useAppContext } from '../state/AppContext';

function BaseImagerySelect() {
  const { baseLayer, setBaseLayer } = useAppContext();
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">
        Base imagery
      </span>
      <select
        value={baseLayer}
        onChange={(e) => setBaseLayer(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-accent/60"
      >
        {Object.entries(BASE_IMAGERY).map(([key, cfg]) => (
          <option key={key} value={key} className="bg-slate-900">
            {cfg.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// -----------------------------------------------------------------------------
// ControlPanel
// -----------------------------------------------------------------------------
// Floating glass-morphism menu on the left. It maps over LAYER_REGISTRY to
// auto-generate one toggle per data stream — there are NO hardcoded buttons, so
// adding a layer to the registry surfaces it here automatically.
// -----------------------------------------------------------------------------

// Format the live RainViewer radar frame for the expanded radar details: local
// clock time plus how far it sits from now (observed past vs predicted nowcast).
function radarFrameSummary(status) {
  if (!status?.time) return null;
  const at = new Date(status.time * 1000);
  const clock = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const deltaMin = Math.round((status.time * 1000 - Date.now()) / 60000);
  const rel =
    deltaMin === 0 ? 'now' : deltaMin < 0 ? `${-deltaMin} min ago` : `+${deltaMin} min`;
  return { clock, rel, kind: status.kind };
}

function LayerToggle({ layer }) {
  const { isLayerActive, toggleLayer, radarStatus } = useAppContext();
  const active = isLayerActive(layer.id);
  const [expanded, setExpanded] = useState(false);

  const radar =
    layer.id === 'radar' && active ? radarFrameSummary(radarStatus) : null;

  return (
    <div
      className={`rounded-xl border transition-all duration-200
        ${active
          ? 'border-white/30 bg-white/10'
          : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.06]'}`}
    >
      <button
        type="button"
        onClick={() => toggleLayer(layer.id)}
        className="group flex w-full items-center gap-3 px-3 pt-3 pb-2 text-left"
      >
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
          {layer.note && (
            <p className="mt-1 text-[10px] leading-snug text-amber-300/80">
              {layer.note}
            </p>
          )}
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
      </button>

      {/* Expandable details: full (untruncated) description, the live radar frame
          time, and a drill-down link to the provider's own page. */}
      <div className="px-3 pb-2 pl-8">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
        >
          Details
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3 w-3 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <path d="M6 8l4 4 4-4" />
          </svg>
        </button>

        {expanded && (
          <div className="mt-1.5 space-y-1.5">
            <p className="text-[11px] leading-snug text-slate-300">
              {layer.description}
            </p>
            {radar && (
              <p className="text-[11px] text-slate-300">
                <span className="text-slate-500">Frame</span>{' '}
                <span className="font-mono text-slate-100">{radar.clock}</span>{' '}
                <span
                  className={`rounded px-1 py-0.5 text-[9px] uppercase tracking-wider ${
                    radar.kind === 'nowcast'
                      ? 'bg-cyan-400/15 text-cyan-200'
                      : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {radar.kind === 'nowcast' ? 'nowcast' : 'past'}
                </span>{' '}
                <span className="text-slate-500">({radar.rel})</span>
              </p>
            )}
            {layer.sourceUrl && (
              <a
                href={layer.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-accent/90 underline-offset-2 hover:underline"
              >
                More from source: {layer.sourceLabel ?? 'open'} ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ControlPanel() {
  const { activeLayers } = useAppContext();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className="pointer-events-auto fixed left-4 top-4 z-20 w-72 max-w-[80vw]">
      <div className="glass rounded-2xl p-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white">
              MP_LiveEarth
            </h1>
            <p className="text-[11px] uppercase tracking-widest text-accent/80">
              Global Data Dashboard
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-medium text-slate-300">
              {activeLayers.size} active
            </span>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
              title={collapsed ? 'Expand panel' : 'Collapse panel'}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-4 w-4 transition-transform duration-300 ${collapsed ? '' : 'rotate-180'}`}
              >
                <path d="M6 8l4 4 4-4" />
              </svg>
            </button>
          </div>
        </header>

        <div
          className={`grid transition-all duration-300 ease-out ${
            collapsed
              ? 'grid-rows-[0fr] opacity-0'
              : 'mt-3 grid-rows-[1fr] opacity-100'
          }`}
        >
          <div className="overflow-hidden">
            <BaseImagerySelect />
            <div className="space-y-2">
              {LAYER_REGISTRY.map((layer) => (
                <LayerToggle key={layer.id} layer={layer} />
              ))}
            </div>

            <footer className="mt-4 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-slate-500">
              Data refreshes automatically while active. Zoom in for higher-
              resolution imagery; click any element to inspect its telemetry.
              <span className="mt-1.5 block text-slate-600">
                Imagery Esri / EOX / NASA GIBS · weather NOAA, RainViewer,
                WeatherLayers · flights{' '}
                <a
                  href="https://airplanes.live/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-slate-400"
                >
                  airplanes.live
                </a>
                .
              </span>
            </footer>
          </div>
        </div>
      </div>
    </aside>
  );
}
