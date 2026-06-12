import { useState } from 'react';
import { LAYER_BY_ID } from '../state/layerRegistry';
import { useAppContext } from '../state/AppContext';
import { sourceLinkForEntity } from '../services/sourceLinks';

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

// One end of a flight route — ICAO/IATA code plus airport name and country when
// hexdb resolved them.
function AirportLine({ role, ap }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{role}</p>
      <p className="font-mono text-sm text-slate-100">
        {ap?.icao ?? '—'}
        {ap?.iata ? ` · ${ap.iata}` : ''}
      </p>
      {ap?.name && <p className="text-[11px] text-slate-400">{ap.name}</p>}
      {ap?.region && <p className="text-[11px] text-slate-500">{ap.region}</p>}
    </div>
  );
}

export default function TelemetrySidebar() {
  const { selectedEntity, selectEntity, selectedRoute } = useAppContext();
  const open = Boolean(selectedEntity);
  const layer = selectedEntity ? LAYER_BY_ID[selectedEntity.layer] : null;

  const isFlight = selectedEntity?.layer === 'flights';
  const callsign = selectedEntity?.meta?.callsign?.trim();
  // Only trust the resolved route if it belongs to the currently selected
  // flight — otherwise show the loading state rather than a stale route.
  const route =
    selectedRoute && selectedRoute.callsign === callsign ? selectedRoute : null;

  // Drill-down link to this specific entity's page on its source (USGS event,
  // N2YO track, airplanes.live hex, …); null for layers without a per-item page.
  const sourceLink = sourceLinkForEntity(selectedEntity);

  // Click-to-copy coordinates, with a brief confirmation.
  const lat = selectedEntity?.lat;
  const lng = selectedEntity?.lng;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const coordText = hasCoords ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : null;
  const [copied, setCopied] = useState(false);
  const copyCoords = async () => {
    if (!coordText) return;
    try {
      await navigator.clipboard?.writeText(coordText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (non-secure context) — ignore */
    }
  };

  const originCode = route?.origin?.iata || route?.origin?.icao || '—';
  const destCode = route?.destination?.iata || route?.destination?.icao || '—';

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
            {/* Drill-down to this entity's page on its data source */}
            {sourceLink && (
              <a
                href={sourceLink.url}
                target="_blank"
                rel="noreferrer"
                className="mb-3 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 transition-colors hover:bg-white/10"
              >
                View on {sourceLink.label} ↗
              </a>
            )}

            {/* Coordinate block — click to copy; links search the point */}
            <section className="mb-4 rounded-xl bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wider text-slate-400">
                  Coordinates
                </p>
                {hasCoords && (
                  <span className="text-[10px] text-slate-500">
                    {copied ? 'Copied ✓' : 'Click to copy'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={copyCoords}
                disabled={!hasCoords}
                title={coordText ? `Copy ${coordText}` : undefined}
                className="grid w-full grid-cols-2 gap-2 rounded-lg p-1 text-left text-sm transition-colors hover:bg-white/[0.05] disabled:cursor-default disabled:hover:bg-transparent"
              >
                <div>
                  <p className="text-[10px] text-slate-500">LAT</p>
                  <p className="font-mono text-slate-100">
                    {hasCoords ? `${lat.toFixed(4)}°` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">LNG</p>
                  <p className="font-mono text-slate-100">
                    {hasCoords ? `${lng.toFixed(4)}°` : '—'}
                  </p>
                </div>
              </button>
              {hasCoords && (
                <div className="mt-2 flex gap-2">
                  <a
                    href={`https://www.google.com/maps?q=${lat},${lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-[11px] text-slate-200 transition-colors hover:bg-white/10"
                  >
                    Google Maps ↗
                  </a>
                  <a
                    href={`https://www.google.com/search?q=${lat},${lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-[11px] text-slate-200 transition-colors hover:bg-white/10"
                  >
                    Search ↗
                  </a>
                </div>
              )}
            </section>

            {/* Route (flights only — lazily resolved on selection) */}
            {isFlight && (
              <section className="mb-4 rounded-xl bg-white/[0.03] p-3">
                <p className="mb-2 text-[11px] uppercase tracking-wider text-slate-400">
                  Route
                </p>
                {(!route || route.status === 'loading') && (
                  <p className="text-sm text-slate-400">Looking up route…</p>
                )}
                {route?.status === 'unknown' && (
                  <p className="text-sm text-slate-400">No route data</p>
                )}
                {route?.status === 'ok' && (
                  <div className="space-y-2.5">
                    {/* Prominent origin → destination summary */}
                    <div className="flex items-center justify-center gap-2 text-base font-semibold text-white">
                      <span className="font-mono">{originCode}</span>
                      <span className="text-slate-500">→</span>
                      <span className="font-mono">{destCode}</span>
                    </div>
                    <div className="space-y-1.5 border-t border-white/10 pt-2">
                      <AirportLine role="From (origin)" ap={route.origin} />
                      <div className="pl-0.5 text-slate-600">↓</div>
                      <AirportLine role="To (destination)" ap={route.destination} />
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Operational metrics — generic over entity.meta. Keys starting
                with `_` are structured extensions (e.g. _links), not metrics. */}
            <section>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">
                Operational Metrics
              </p>
              {Object.entries(selectedEntity.meta ?? {})
                .filter(([key]) => !key.startsWith('_'))
                .map(([key, value]) => (
                  <MetricRow
                    key={key}
                    label={humanize(key)}
                    value={formatValue(value)}
                  />
                ))}
            </section>

            {/* Curated link buttons — generic: any layer can put an array of
                {label, url} in meta._links (mountains use it for cams +
                forecast pages). */}
            {Array.isArray(selectedEntity.meta?._links) &&
              selectedEntity.meta._links.length > 0 && (
                <section className="mt-4">
                  <p className="mb-2 text-[11px] uppercase tracking-wider text-slate-400">
                    Cams & Links
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedEntity.meta._links
                      .filter((link) => link?.url && link?.label)
                      .map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 transition-colors hover:bg-white/10"
                        >
                          {link.label} ↗
                        </a>
                      ))}
                  </div>
                </section>
              )}
          </div>
        )}

        <footer className="mt-3 border-t border-white/10 pt-3 text-[10px] text-slate-500">
          ID: <span className="font-mono">{selectedEntity?.id ?? '—'}</span>
        </footer>
      </div>
    </aside>
  );
}
