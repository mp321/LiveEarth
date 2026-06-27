// Vercel serverless function: nearest street-level image for a {lat,lng}.
//
// This powers Ground View's engine.findNearest(). It is deliberately NOT a map
// layer (see src/ground/) — it answers a single point query rather than a
// viewport of entities, so it lives outside globalStreams/layerRegistry.
//
// The browser must NOT call graph.mapillary.com directly with the server token,
// so this proxy holds MAPILLARY_TOKEN server-side (Vercel project env var —
// NEVER VITE_-prefixed) and returns only the nearest image's id + metadata.
//
// CONTRACT: this never fails the caller. Any miss (no coverage, missing token,
// upstream error) resolves to the "none" shape `{ none: true }`, which the
// client maps to null and then offers the keyless Google Street View link-out.
// That mirrors the project-wide "degrade to empty, never throw" rule.

// Mapillary's Graph API image search. We query a small bounding box around the
// point and pick the nearest result client-side here.
//
// NOTE: Mapillary later added a dedicated radius search (closeto/radius params).
// We use the long-stable `bbox` query instead because its parameters are known
// and unambiguous; a ~50 m box is the radius equivalent. The fields we request
// are the minimum Ground View needs: the id to mount, plus capture date / pano
// flag / geometry for attribution and nearest-pick.
// TODO: if the radius search is preferred, swap the bbox below for
//       `&closeto={lng},{lat}&radius=50` once its param names are reconfirmed
//       against current docs — the rest of this handler is unaffected.
const IMAGES_URL = 'https://graph.mapillary.com/images';
const SEARCH_RADIUS_M = 50; // coverage this far from the point counts as "here"
const SEARCH_LIMIT = 10; // a handful of candidates is plenty to pick the nearest

// Short module-scope cache keyed by the point rounded to ~11 m, so repeated
// opens of the same location (and a warm lambda) share one upstream call.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // key -> { result, fetchedAt }

const M_PER_DEG_LAT = 111_320; // ~constant; lon scales by cos(lat)

// Great-circle distance in metres (small distances, so a planar approx on the
// local degree scale is more than accurate enough to rank candidates).
function metresBetween(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * M_PER_DEG_LAT;
  const dLng = (bLng - aLng) * M_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

const NONE = { none: true };

export default async function handler(req, res) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'lat and lng query params are required' });
    return;
  }

  const token = process.env.MAPILLARY_TOKEN;
  if (!token) {
    // No token configured: degrade to the Google fallback rather than erroring.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ...NONE, reason: 'MAPILLARY_TOKEN not configured' });
    return;
  }

  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    res.status(200).json(hit.result);
    return;
  }

  try {
    const dLat = SEARCH_RADIUS_M / M_PER_DEG_LAT;
    const dLng =
      SEARCH_RADIUS_M / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',');
    const url =
      `${IMAGES_URL}?fields=id,captured_at,is_pano,computed_geometry` +
      `&bbox=${bbox}&limit=${SEARCH_LIMIT}`;

    const upstream = await fetch(url, {
      headers: { Authorization: `OAuth ${token}` },
    });
    if (!upstream.ok) throw new Error(`Mapillary responded ${upstream.status}`);
    const data = await upstream.json();
    const images = Array.isArray(data?.data) ? data.data : [];

    // Pick the nearest image to the requested point, preferring full panoramas
    // (they give the navigable 360° experience; flat images still mount fine).
    let best = null;
    for (const img of images) {
      const coords = img?.computed_geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const [imgLng, imgLat] = coords;
      const dist = metresBetween(lat, lng, imgLat, imgLng);
      // Rank: panoramas win outright; within the same pano-ness, nearest wins.
      const better =
        !best ||
        (img.is_pano && !best.isPano) ||
        (Boolean(img.is_pano) === best.isPano && dist < best.dist);
      if (better) {
        best = { id: img.id, capturedAt: img.captured_at, isPano: Boolean(img.is_pano), dist };
      }
    }

    const result = best
      ? {
          imageId: best.id,
          capturedAt: best.capturedAt ?? null,
          isPano: best.isPano,
          // Mapillary's terms require attribution; per-creator credit needs an
          // extra authenticated field, so we surface the platform credit here.
          attribution: '© Mapillary contributors',
        }
      : NONE;

    cache.set(key, { result, fetchedAt: Date.now() });
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    res.status(200).json(result);
  } catch (err) {
    // Never surface an error to Ground View — it would only ever show the
    // Google fallback anyway, so return the none shape and log server-side.
    console.warn('[api/ground] lookup failed:', err.message || err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(NONE);
  }
}
