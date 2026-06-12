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

// Registry-driven layer glyph: the entry's `icon` path stroked in its color
// (glowing when active), falling back to the classic dot for entries without
// one. Shared by the toggles and the alerts drawer.
function LayerIcon({ layer, active, className = 'h-[18px] w-[18px]' }) {
  if (!layer.icon) {
    return (
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full transition-all"
        style={{
          backgroundColor: active ? layer.color : 'transparent',
          boxShadow: active ? `0 0 10px ${layer.color}` : 'none',
          border: `1px solid ${layer.color}`,
        }}
      />
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={layer.color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-all duration-200 ${className}`}
      style={{
        opacity: active ? 1 : 0.5,
        filter: active ? `drop-shadow(0 0 4px ${layer.color})` : 'none',
      }}
      aria-hidden="true"
    >
      <path d={layer.icon} />
    </svg>
  );
}

function LayerToggle({ layer }) {
  const { isLayerActive, toggleLayer, radarStatus, layerCounts, layerBadges } =
    useAppContext();
  const active = isLayerActive(layer.id);
  const [expanded, setExpanded] = useState(false);
  // Alert badge (e.g. active winter alerts on the mountains layer).
  const badge = layerBadges[layer.id] ?? 0;

  const radar =
    layer.id === 'radar' && active ? radarFrameSummary(radarStatus) : null;

  // Setup hints (noteUntilData) disappear once the layer produces data.
  const note =
    layer.noteUntilData && (layerCounts[layer.id] ?? 0) > 0 ? null : layer.note;

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
        className="group flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <LayerIcon layer={layer} active={active} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">
            {layer.label}
          </p>
          {note && (
            <p className="mt-0.5 text-[10px] leading-snug text-amber-300/80">
              {note}
            </p>
          )}
        </div>
        {badge > 0 && (
          <span
            title={`${badge} active alert${badge === 1 ? '' : 's'}`}
            className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-900"
          >
            {badge}
          </span>
        )}
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

      {/* Expandable details: description, the live radar frame time, and a
          drill-down link to the provider's own page. */}
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

// -----------------------------------------------------------------------------
// AlertsDrawer (notifications v1)
// -----------------------------------------------------------------------------
// Compact drawer listing every mountain with an active NWS winter alert or a
// model-outlook storm signal (AppContext polls these every 15 min). Clicking
// an entry turns the mountains layer on, opens the peak's telemetry, and flies
// the camera to it. Hidden entirely while there is nothing to report.
// -----------------------------------------------------------------------------

function AlertsDrawer() {
  const { mountainAlerts, requestFlyTo, selectEntity, isLayerActive, toggleLayer } =
    useAppContext();
  const [open, setOpen] = useState(true);
  if (!mountainAlerts.length) return null;

  const goTo = (alert) => {
    if (!isLayerActive('mountains')) toggleLayer('mountains');
    selectEntity(alert.entity);
    requestFlyTo({ lng: alert.lng, lat: alert.lat, zoom: 7.5 });
  };

  return (
    <div className="mb-3 rounded-xl border border-amber-300/25 bg-amber-400/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 shrink-0 text-amber-300"
          aria-hidden="true"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01" />
        </svg>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
          Mountain alerts
        </span>
        <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-900">
          {mountainAlerts.length}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3 w-3 text-amber-200/70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 8l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <ul
          className="max-h-44 space-y-1 overflow-y-auto px-1.5 pb-1.5
            [&::-webkit-scrollbar]:w-1
            [&::-webkit-scrollbar-track]:bg-transparent
            [&::-webkit-scrollbar-thumb]:rounded-full
            [&::-webkit-scrollbar-thumb]:bg-white/20"
        >
          {mountainAlerts.map((alert) => (
            <li key={alert.id}>
              <button
                type="button"
                onClick={() => goTo(alert)}
                title="Fly to mountain"
                className="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10"
              >
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-100">
                  <span className="truncate">{alert.name}</span>
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 text-[9px] uppercase tracking-wider ${
                      alert.level === 2
                        ? 'bg-amber-400/20 text-amber-200'
                        : 'bg-sky-400/15 text-sky-200'
                    }`}
                  >
                    {alert.level === 2 ? 'NWS alert' : 'outlook'}
                  </span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-300">
                  {alert.headline}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">{alert.timeframe}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ControlPanel() {
  const { activeLayers, mountainAlerts } = useAppContext();
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
            {collapsed && mountainAlerts.length > 0 && (
              <span
                title={`${mountainAlerts.length} mountain alert${mountainAlerts.length === 1 ? '' : 's'}`}
                className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-900"
              >
                {mountainAlerts.length}
              </span>
            )}
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
            <AlertsDrawer />
            <BaseImagerySelect />
            {/* Scrollable layer list — capped so the panel never overflows the viewport */}
            <div
              className="max-h-[calc(100vh-20rem)] overflow-y-auto -mr-1 pr-1 space-y-1.5
                [&::-webkit-scrollbar]:w-1
                [&::-webkit-scrollbar-track]:bg-transparent
                [&::-webkit-scrollbar-thumb]:rounded-full
                [&::-webkit-scrollbar-thumb]:bg-white/20"
            >
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
                  href="https://opensky-network.org/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-slate-400"
                >
                  OpenSky Network
                </a>{' '}
                /{' '}
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
