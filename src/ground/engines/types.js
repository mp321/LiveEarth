// Ground View engine adapter contract.
//
// Ground View is a SEPARATE engine on a SEPARATE route from the MapLibre globe.
// Everything behind this interface is swappable: today it's Mapillary, tomorrow
// it could be an embedded-Google engine, without the route (src/ground/route.js)
// or the globe seam knowing anything changed. Keeping the surface this small is
// the point — the route only ever calls findNearest/mount/unmount.
//
// This file is documentation-as-code: JS has no interfaces, so the shape lives
// here as a JSDoc typedef and the engines below are checked against it by eye.

/**
 * A nearby street-level image, as resolved by an engine (via its server proxy).
 * @typedef {Object} GroundImage
 * @property {string} imageId      Engine-specific id to mount in the viewer.
 * @property {number|null} capturedAt  Capture time (epoch ms) for attribution.
 * @property {boolean} isPano      True for a navigable 360°; false for flat.
 * @property {string} attribution  Required credit string to display.
 */

/**
 * An interchangeable street-level viewer engine.
 * @typedef {Object} GroundEngine
 * @property {string} id
 *   Stable engine id, e.g. 'mapillary'.
 * @property {(lat: number, lng: number) => Promise<GroundImage|null>} findNearest
 *   Nearest image to the point, or null when there's no coverage. Never throws —
 *   resolves null on any failure so the route can offer the link-out fallback.
 * @property {(containerEl: HTMLElement, imageId: string) => Promise<void>} mount
 *   Build the viewer in the container. May throw EngineUnavailable when the
 *   engine cannot embed (e.g. no browser token) — the route then falls back.
 * @property {() => void} unmount
 *   Tear the viewer down and free its WebGL context. Safe to call when unmounted.
 * @property {(event: string, cb: (payload: any) => void) => void} on
 *   Subscribe to engine events. The only one the route uses is 'nodechanged'
 *   -> { lat, lng } for optional URL sync. Unknown events are ignored.
 */

// Thrown by an engine's mount() when it cannot embed a viewer (e.g. the browser
// access token is absent). The route catches this specifically and degrades to
// the keyless link-out instead of showing a broken/blank viewer.
export class EngineUnavailable extends Error {
  constructor(message = 'Ground View engine cannot embed') {
    super(message);
    this.name = 'EngineUnavailable';
  }
}
