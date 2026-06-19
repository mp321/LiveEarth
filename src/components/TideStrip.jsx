// TideStrip — one generic SVG slot driven by a tideStrip object (from
// services/tideData.js fetchTideStrip), so ANY coastal layer can reuse it. It
// renders: an area-filled height curve, hi/lo dots (height above, clock below),
// a dashed "now" line, a ▲/▼ trend arrow, the next-turn countdown, the level
// "now" (observed vs predicted), and the station + distance + datum line.
//
// Coordinates: strip.curve/extremes use x = tz-free timeline ms, y = feet
// (MLLW). We map those to the SVG viewBox below; nothing here re-fetches or
// recomputes tide math — that all lives in tideData.js.

const VB_W = 300;
const VB_H = 130;
const PAD_X = 12;
const PAD_TOP = 24; // room for height labels above the dots
const PAD_BOT = 18; // room for the clock labels row

const TIDE_COLOR = '#38bdf8'; // sky — matches the ocean theme
const RISING_COLOR = '#34d399'; // emerald
const FALLING_COLOR = '#fbbf24'; // amber

const fmtFt = (v) => `${v.toFixed(1)} ft`;
const fmtEta = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

export default function TideStrip({ strip }) {
  if (!strip) return null;
  const { curve, extremes, now, trend, nextTurn, station, distanceMi, datum } = strip;

  const plotL = PAD_X;
  const plotR = VB_W - PAD_X;
  const plotT = PAD_TOP;
  const plotB = VB_H - PAD_BOT;

  // Domain over every drawn point (curve + dots + now), with a little y-padding.
  const pts = curve?.length ? curve : extremes;
  const xs = pts.map((p) => p.x);
  const ys = [...pts.map((p) => p.y), ...extremes.map((e) => e.y)];
  if (now) ys.push(now.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  const yPad = (yMax - yMin || 1) * 0.12;
  yMin -= yPad;
  yMax += yPad;

  const sx = (x) => plotL + (xMax === xMin ? 0.5 : (x - xMin) / (xMax - xMin)) * (plotR - plotL);
  const sy = (y) => plotB - (yMax === yMin ? 0.5 : (y - yMin) / (yMax - yMin)) * (plotB - plotT);

  // Need at least a 2-point curve to draw the chart; otherwise show text only.
  const hasChart = Array.isArray(curve) && curve.length >= 2;
  const line = hasChart ? curve.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ') : '';
  const area = hasChart
    ? `M${sx(curve[0].x).toFixed(1)},${plotB} ${line.slice(1)} L${sx(curve[curve.length - 1].x).toFixed(1)},${plotB} Z`
    : '';

  const nowX = now ? sx(now.x) : null;
  const trendColor = trend === 'rising' ? RISING_COLOR : trend === 'falling' ? FALLING_COLOR : '#94a3b8';
  const arrow = trend === 'rising' ? '▲' : trend === 'falling' ? '▼' : '•';

  // Synthesized curves put the first/last dots at the plot edges, where a
  // middle text-anchor would clip — anchor those to start/end instead.
  const anchorFor = (i) => (i === 0 ? 'start' : i === extremes.length - 1 ? 'end' : 'middle');

  return (
    <div>
      {/* Trend headline */}
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-base font-semibold" style={{ color: trendColor }}>
          {arrow} {trend ? trend[0].toUpperCase() + trend.slice(1) : 'Tide'}
        </span>
        {nextTurn && (
          <span className="text-[11px] text-slate-400">
            next {nextTurn.type} {fmtFt(nextTurn.height)} · {fmtEta(nextTurn.etaMinutes)}
          </span>
        )}
      </div>

      {hasChart && (
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full" role="img" aria-label="Tide prediction curve">
          <defs>
            <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TIDE_COLOR} stopOpacity="0.35" />
              <stop offset="100%" stopColor={TIDE_COLOR} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <path d={area} fill="url(#tideFill)" />
          <path d={line} fill="none" stroke={TIDE_COLOR} strokeWidth="1.5" />

          {/* hi/lo dots: height above, clock below */}
          {extremes.map((e, i) => {
            const cx = sx(e.x);
            const cy = sy(e.y);
            const anchor = anchorFor(i);
            return (
              <g key={`${e.x}-${e.type}`}>
                <circle cx={cx} cy={cy} r="2.6" fill={TIDE_COLOR} />
                <text x={cx} y={cy - 6} textAnchor={anchor} fontSize="9" fill="#cbd5e1">
                  {e.y.toFixed(1)}
                </text>
                <text x={cx} y={VB_H - 5} textAnchor={anchor} fontSize="8.5" fill="#64748b">
                  {e.label}
                </text>
              </g>
            );
          })}

          {/* dashed "now" line + trend arrow */}
          {nowX != null && (
            <g>
              <line
                x1={nowX}
                y1={plotT - 4}
                x2={nowX}
                y2={plotB}
                stroke={trendColor}
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text x={nowX} y={plotT - 7} textAnchor="middle" fontSize="10" fill={trendColor}>
                {arrow}
              </text>
            </g>
          )}
        </svg>
      )}

      {/* Now + station/datum footer */}
      <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
        {now && (
          <p>
            Now <span className="font-medium text-slate-200">{fmtFt(now.y)}</span> ·{' '}
            {now.observed ? 'observed' : 'predicted'}
          </p>
        )}
        <p className="text-slate-500">
          {station?.name} · {distanceMi} mi from buoy · datum {datum}
        </p>
      </div>
    </div>
  );
}
