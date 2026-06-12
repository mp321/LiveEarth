// Shareable-view persistence. The active layers, base imagery, and camera are
// encoded into the URL hash (debounced) and mirrored to localStorage, so a
// reload restores the last view and pasting a link reproduces an exact one.
// Restore precedence per field: hash wins over localStorage, localStorage
// wins over app defaults.
//
// Hash format (query-string syntax inside the fragment):
//   #layers=flights,buoys&base=esri&cam=-93.6000,42.0000,2.40,0.0,0.0
// `cam` is lng,lat,zoom,bearing,pitch. An explicitly empty `layers=` means
// "no layers" and overrides defaults; an absent key falls through.
//
// Writers merge partial updates here instead of going through React state:
// AppContext publishes { layers, base } and MapView publishes { camera } on
// every moveend, and keeping the high-churn camera out of context avoids
// re-rendering the UI on each pan frame.

const STORE_KEY = 'liveearth:view';
const WRITE_DEBOUNCE_MS = 400;

function parseCamera(s) {
  const [lng, lat, zoom, bearing, pitch] = (s || '').split(',').map(Number);
  if (![lng, lat, zoom].every(Number.isFinite)) return null;
  return {
    lng,
    lat,
    zoom,
    bearing: Number.isFinite(bearing) ? bearing : 0,
    pitch: Number.isFinite(pitch) ? pitch : 0,
  };
}

function formatCamera(c) {
  return [
    c.lng.toFixed(4),
    c.lat.toFixed(4),
    c.zoom.toFixed(2),
    c.bearing.toFixed(1),
    c.pitch.toFixed(1),
  ].join(',');
}

// Shared empty shape: null = "not specified, fall through to the next source".
const EMPTY = { layers: null, base: null, camera: null };

function readHash() {
  try {
    const h = window.location.hash.replace(/^#/, '');
    if (!h) return EMPTY;
    const params = new URLSearchParams(h);
    return {
      layers: params.has('layers')
        ? params.get('layers').split(',').filter(Boolean)
        : null,
      base: params.get('base') || null,
      camera: parseCamera(params.get('cam')),
    };
  } catch {
    return EMPTY; // malformed hash
  }
}

function readStored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    return {
      layers: Array.isArray(v?.layers) ? v.layers.map(String) : null,
      base: typeof v?.base === 'string' ? v.base : null,
      camera: v?.camera && Number.isFinite(v.camera.lng) ? v.camera : null,
    };
  } catch {
    return EMPTY; // absent, malformed, or storage unavailable
  }
}

function readInitialView() {
  const hash = readHash();
  const stored = readStored();
  return {
    layers: hash.layers ?? stored.layers,
    base: hash.base ?? stored.base,
    camera: hash.camera ?? stored.camera,
  };
}

// Snapshot taken once at module load — before any publish can overwrite the
// hash — and read by both AppContext (layers/base) and MapView (camera).
export const INITIAL_VIEW = readInitialView();

// Mutable current view, seeded from the snapshot so a partial publish (e.g.
// layers only, before the map's first moveend) doesn't drop the other fields
// from the hash.
let view = { ...INITIAL_VIEW };
let timer = null;

function write() {
  // Built by hand instead of URLSearchParams.toString() so the layer-list
  // commas stay readable in the address bar (values are ids and numbers —
  // nothing needs percent-encoding).
  const parts = [];
  if (view.layers) parts.push(`layers=${view.layers.join(',')}`);
  if (view.base) parts.push(`base=${view.base}`);
  if (view.camera) parts.push(`cam=${formatCamera(view.camera)}`);
  try {
    // replaceState (not location.hash) avoids spamming the back button with
    // one history entry per pan.
    window.history.replaceState(null, '', `#${parts.join('&')}`);
  } catch {
    /* sandboxed / unsupported — localStorage below still persists */
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(view));
  } catch {
    /* quota exceeded / private mode */
  }
}

/**
 * Merge a partial view update ({ layers?, base?, camera? }) and write it to
 * the URL hash + localStorage after a short debounce.
 */
export function publishViewState(partial) {
  view = { ...view, ...partial };
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    write();
  }, WRITE_DEBOUNCE_MS);
}

// Flush any pending debounced write when the tab is hidden or closed, so a
// zoom/pan made just before leaving is never lost to the debounce window.
function flushViewState() {
  if (timer == null) return;
  clearTimeout(timer);
  timer = null;
  write();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushViewState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushViewState();
  });
}
