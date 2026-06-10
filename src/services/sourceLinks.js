// Per-entity "drill-down" deep links. Given a selected entity (the object the
// TelemetrySidebar renders), resolve the authoritative source page for THAT
// specific item — the satellite's live track, the earthquake's event page, etc.
//
// Every URL is derived from fields already present on the entity (id / meta), so
// this stays a pure function with no network access and the data fetchers in
// globalStreams.js need no extra fields. Returns { url, label } or null when the
// layer has no per-entity page (or the needed id is missing).

export function sourceLinkForEntity(entity) {
  if (!entity) return null;
  const meta = entity.meta ?? {};

  switch (entity.layer) {
    case 'flights':
      // entity.id is the ICAO 24-bit hex; airplanes.live globe deep-links on it.
      return entity.id
        ? { url: `https://globe.airplanes.live/?icao=${encodeURIComponent(entity.id)}`, label: 'airplanes.live' }
        : null;

    case 'earthquakes':
      // USGS event pages follow /eventpage/{feature id} (e.g. us7000abcd).
      return entity.id
        ? { url: `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(entity.id)}`, label: 'USGS event' }
        : null;

    case 'satellites':
      return meta.norad_id
        ? { url: `https://www.n2yo.com/satellite/?s=${encodeURIComponent(meta.norad_id)}`, label: 'N2YO live track' }
        : null;

    case 'buoys':
      return meta.station
        ? { url: `https://www.ndbc.noaa.gov/station_page.php?station=${encodeURIComponent(meta.station)}`, label: 'NDBC station' }
        : null;

    case 'airquality':
      return meta.location_id && meta.location_id !== '—'
        ? { url: `https://explore.openaq.org/locations/${encodeURIComponent(meta.location_id)}`, label: 'OpenAQ location' }
        : null;

    case 'eonet':
      // EONET has no stable per-event permalink in the entity, so link the feed.
      return { url: 'https://eonet.gsfc.nasa.gov/', label: 'NASA EONET' };

    default:
      return null;
  }
}
