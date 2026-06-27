import { useEffect, useRef, useState } from 'react';
import { mapillaryEngine as engine } from './engines/mapillary';
import { EngineUnavailable } from './engines/types';

// Ground View — the street-level route. Rendered INSTEAD of the globe (see
// App.jsx), so the MapLibre canvas is unmounted while this is open. Self-
// contained: it doesn't read the globe's AppContext, only the {lat,lng} props
// handed off from the globe seam.
//
// Flow: findNearest(lat,lng) -> mount the engine's viewer if there's coverage
// and the engine can embed; otherwise show the keyless Google Street View
// link-out. The engine is torn down on unmount (critical — a leaked WebGL
// viewer leaks GPU memory across navigations).

// Keyless Maps URL scheme — opens the nearest Street View pano in a new tab with
// no API key and no billing (the deliberate lightweight fallback to embedding).
function googleStreetViewUrl(lat, lng) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

function formatCaptured(ms) {
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
    });
  } catch {
    return null;
  }
}

export default function GroundView({ lat, lng, onBack }) {
  const panoRef = useRef(null);
  // 'loading' | 'pano' | 'fallback'
  const [status, setStatus] = useState('loading');
  const [image, setImage] = useState(null); // resolved GroundImage (for attribution)
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);

  useEffect(() => {
    if (!hasPoint) {
      setStatus('fallback');
      return;
    }
    let cancelled = false;
    setStatus('loading');

    (async () => {
      const found = await engine.findNearest(lat, lng);
      if (cancelled) return;
      if (!found) {
        setStatus('fallback'); // no coverage near the point
        return;
      }
      setImage(found);
      try {
        await engine.mount(panoRef.current, found.imageId);
        if (cancelled) {
          engine.unmount(); // resolved after teardown (StrictMode/fast nav)
          return;
        }
        setStatus('pano');
        // Optional URL sync: as the user walks the panorama, mirror the current
        // image's coordinates into the hash so the view stays shareable. Uses
        // replaceState (no history spam, no route re-render).
        engine.on('nodechanged', ({ lat: nlat, lng: nlng }) => {
          try {
            window.history.replaceState(
              null,
              '',
              `#ground?lat=${nlat.toFixed(5)}&lng=${nlng.toFixed(5)}`
            );
          } catch {
            /* sandboxed — ignore */
          }
        });
      } catch (err) {
        if (cancelled) return;
        // EngineUnavailable (no browser token) or any mount failure -> fall back
        // to the keyless link-out instead of a blank/broken viewer.
        if (!(err instanceof EngineUnavailable)) {
          console.warn('[GroundView] engine mount failed:', err?.message || err);
        }
        setStatus('fallback');
      }
    })();

    return () => {
      cancelled = true;
      engine.unmount();
    };
  }, [lat, lng, hasPoint]);

  const captured = image ? formatCaptured(image.capturedAt) : null;

  return (
    <div className="relative h-full w-full bg-black">
      {/* Viewer host — always in the DOM so the engine has a stable container to
          mount into. Hidden until the pano is ready to avoid a flash of the
          engine's empty canvas behind the fallback/loading UI. */}
      <div
        ref={panoRef}
        className="absolute inset-0"
        style={{ visibility: status === 'pano' ? 'visible' : 'hidden' }}
      />

      {/* Top bar: Back to globe + attribution (attribution is required when a
          pano is shown). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
        <button
          type="button"
          onClick={onBack}
          className="glass pointer-events-auto rounded-xl px-3 py-2 text-sm font-medium text-slate-100 hover:bg-white/10"
        >
          ← Back to globe
        </button>
        {status === 'pano' && image && (
          <div className="glass pointer-events-auto rounded-xl px-3 py-2 text-right text-[11px] text-slate-300">
            <div>{image.attribution}</div>
            {captured && <div className="text-slate-500">Captured {captured}</div>}
          </div>
        )}
      </div>

      {status === 'loading' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-slate-400">
          Finding nearby street-level imagery…
        </div>
      )}

      {status === 'fallback' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="glass max-w-sm rounded-2xl p-6 text-center">
            <h2 className="text-lg font-semibold text-white">No street-level imagery here</h2>
            <p className="mt-2 text-sm text-slate-400">
              {hasPoint
                ? 'No embedded panorama is available near this point. Try Google Street View, which may have coverage.'
                : 'No location was provided for Ground View.'}
            </p>
            {hasPoint && (
              <a
                href={googleStreetViewUrl(lat, lng)}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 transition-colors hover:bg-white/10"
              >
                Open Google Street View ↗
              </a>
            )}
            <div>
              <button
                type="button"
                onClick={onBack}
                className="mt-3 text-xs text-slate-500 hover:text-slate-300"
              >
                ← Back to globe
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
