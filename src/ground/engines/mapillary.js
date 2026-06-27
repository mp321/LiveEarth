// Mapillary engine — the default Ground View street-level viewer.
//
// MapillaryJS v4 (MIT, open-data ethos). Two distinct token roles, on purpose:
//   - findNearest() goes through our /api/ground proxy, which uses the
//     server-side MAPILLARY_TOKEN. The browser never sees that token and the
//     image-search calls stay out of dist/.
//   - The embedded Viewer must fetch tiles/metadata from the browser, which
//     needs a token in the client. Mapillary client tokens are designed to be
//     publishable, so this reads an OPTIONAL VITE_MAPILLARY_TOKEN. When it is
//     absent we throw EngineUnavailable and the route degrades to the keyless
//     Google Street View link-out rather than showing a blank viewer.
//
// The mapillary-js bundle (~MBs of WebGL) is dynamic-imported inside mount() so
// it is code-split out of the globe bundle and only ever downloaded when a user
// actually opens Ground View.

import { EngineUnavailable } from './types';
// Bundled locally (vite injects it once when this chunk loads) instead of the
// unpkg CDN URL — offline-safe and versioned with the installed package.
import 'mapillary-js/dist/mapillary.css';

// Publishable client token for the in-browser Viewer (MLY|...). Optional: without
// it the embedded pano can't load, so the route shows the Google fallback.
const BROWSER_TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN;

let viewer = null; // the live Viewer instance, or null when unmounted

export const mapillaryEngine = {
  id: 'mapillary',

  // Nearest image via the server proxy. Returns the GroundImage shape or null
  // (no coverage / any failure). Never throws — the route relies on that.
  async findNearest(lat, lng) {
    try {
      const res = await fetch(`/api/ground?lat=${lat}&lng=${lng}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.none || !data.imageId) return null;
      return {
        imageId: data.imageId,
        capturedAt: data.capturedAt ?? null,
        isPano: Boolean(data.isPano),
        attribution: data.attribution || '© Mapillary contributors',
      };
    } catch {
      return null; // degrade to the link-out fallback
    }
  },

  // Build the Viewer in the container. Throws EngineUnavailable when there is no
  // browser token, so the route can fall back without rendering a broken embed.
  async mount(containerEl, imageId) {
    if (!BROWSER_TOKEN) {
      throw new EngineUnavailable('VITE_MAPILLARY_TOKEN not set');
    }
    const { Viewer } = await import('mapillary-js');
    viewer = new Viewer({
      accessToken: BROWSER_TOKEN,
      container: containerEl,
      imageId,
    });
  },

  // Free the WebGL context. Idempotent — Ground View calls this on every
  // unmount, and leaking the Viewer would leak GPU memory across navigations.
  unmount() {
    if (viewer) {
      try {
        viewer.remove();
      } catch {
        /* already torn down */
      }
      viewer = null;
    }
  },

  // Only 'nodechanged' is meaningful to the route (optional URL sync). MapillaryJS
  // fires 'image' when the user navigates to a new pano; we forward its lng/lat.
  on(event, cb) {
    if (event !== 'nodechanged' || !viewer) return;
    viewer.on('image', (e) => {
      const ll = e?.image?.lngLat;
      if (ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lng)) {
        cb({ lat: ll.lat, lng: ll.lng });
      }
    });
  },
};

export default mapillaryEngine;
