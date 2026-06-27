// Minimal hash router for the single non-globe route, Ground View.
//
// The app has no router dependency, and the globe already owns the URL hash for
// its shareable view state (#layers=...&base=...&cam=...). Ground View is a
// separate route gated on a `ground` hash: `#ground?lat=..&lng=..`. When that
// route is active, App renders <GroundView/> INSTEAD of the globe so MapLibre
// fully unmounts (we never run two WebGL contexts at once).
//
// Why a tiny pub/sub instead of leaning only on 'hashchange': urlState writes
// the globe hash with history.replaceState, which does NOT fire 'hashchange'.
// So we keep our own subscriber set and notify it explicitly on navigation,
// while also listening to 'hashchange' for back/forward and deep links.

import { useEffect, useState } from 'react';

function parse(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (!h.startsWith('ground')) return { name: 'globe' };
  const q = h.includes('?') ? h.slice(h.indexOf('?') + 1) : '';
  const params = new URLSearchParams(q);
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  return {
    name: 'ground',
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

let current = typeof window !== 'undefined' ? parse(window.location.hash) : { name: 'globe' };
const listeners = new Set();

// The globe hash captured when we entered Ground View, restored verbatim on
// "Back to globe" so the prior layers/base/camera survive the round trip.
let priorGlobeHash = '';

function emit() {
  current = parse(window.location.hash);
  listeners.forEach((fn) => fn(current));
}

if (typeof window !== 'undefined') {
  // Covers browser back/forward and direct #ground deep links.
  window.addEventListener('hashchange', emit);
}

/** Enter Ground View for a point. Globe hash is stashed for the return trip. */
export function navigateToGround(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  priorGlobeHash = window.location.hash; // the globe's current shareable hash
  // Assigning location.hash (not replaceState) fires 'hashchange' -> emit().
  window.location.hash = `ground?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`;
}

/** Return to the globe, restoring its prior hash (layers/base/camera intact). */
export function navigateToGlobe() {
  // Empty restores defaults (e.g. when Ground View was opened via a deep link
  // with no globe hash to come back to); localStorage still rehydrates state.
  window.location.hash = priorGlobeHash || '';
  emit(); // in case the assignment didn't change the string (no 'hashchange')
}

/** React binding: re-renders App whenever the route changes. */
export function useRoute() {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    listeners.add(setRoute);
    setRoute(current); // resync in case the hash changed before subscribing
    return () => listeners.delete(setRoute);
  }, []);
  return route;
}
