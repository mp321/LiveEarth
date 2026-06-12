// Curated mountain config for the Snow & Mountains layer. Static seed data —
// per-peak snow telemetry (forecast, outlook, alerts, snowpack) is resolved at
// runtime by src/services/snowData.js.
//
// Schema per entry:
//   id        stable slug (entity id on the globe)
//   name      display name
//   state     US state code
//   range     mountain range (display only)
//   lat/lng   forecast point (resort summit area)
//   elev_m    elevation handed to the Open-Meteo model for snowfall downscaling
//   snotel    nearest representative SNOTEL station triplet (id:STATE:SNTL),
//             or null when none sits close enough (~25 km) to be meaningful
//   cams      curated webcam PAGE links (links only, never embeds — respect
//             resort TOS); empty when no stable cam URL could be verified
//   links     curated forecast links (NWS point forecast, OpenSnow, ...)
//   excludeFromAlerts  true mutes ALL alerting for the peak — no NWS alert
//             fetch, no storm-signal flag, the marker never escalates. Set on
//             northeast US mountains, which are out of alerting scope.
//
// TODO: expand list / load from JSON / user-added mountains

export const MOUNTAINS = [
  // --- Sierra Nevada ---------------------------------------------------------
  {
    id: 'mammoth',
    name: 'Mammoth Mountain',
    state: 'CA',
    range: 'Sierra Nevada',
    lat: 37.6308,
    lng: -119.0326,
    elev_m: 3369,
    // Mammoth Pass is a CDEC station, not SNOTEL; nearest SNOTEL is ~52 km out.
    snotel: null,
    cams: [],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=37.63&lon=-119.03' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/mammothmountain' },
    ],
  },
  {
    id: 'palisades',
    name: 'Palisades Tahoe',
    state: 'CA',
    range: 'Sierra Nevada',
    lat: 39.1969,
    lng: -120.2358,
    elev_m: 2758,
    snotel: '784:CA:SNTL', // Palisades Tahoe, 2.7 km
    cams: [
      { label: 'Palisades Tahoe webcams', url: 'https://www.palisadestahoe.com/mountain-information/webcams' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=39.20&lon=-120.24' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/palisadestahoe' },
    ],
  },
  {
    id: 'heavenly',
    name: 'Heavenly',
    state: 'CA',
    range: 'Sierra Nevada',
    lat: 38.9353,
    lng: -119.94,
    elev_m: 3068,
    snotel: '518:CA:SNTL', // Heavenly Valley, 2.4 km
    cams: [
      { label: 'Heavenly mountain cams', url: 'https://www.skiheavenly.com/the-mountain/mountain-conditions/mountain-cams.aspx' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=38.94&lon=-119.94' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/heavenly' },
    ],
  },
  {
    id: 'kirkwood',
    name: 'Kirkwood Mountain',
    state: 'CA',
    range: 'Sierra Nevada',
    lat: 38.685,
    lng: -120.0654,
    elev_m: 2987,
    snotel: '1067:CA:SNTL', // Carson Pass, 5.6 km
    cams: [
      { label: 'Kirkwood mountain cams', url: 'https://www.kirkwood.com/the-mountain/mountain-conditions/mountain-cams.aspx' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=38.69&lon=-120.07' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/kirkwood' },
    ],
  },
  {
    id: 'shasta',
    name: 'Mt Shasta',
    state: 'CA',
    range: 'Cascade Range',
    lat: 41.4092,
    lng: -122.1949,
    elev_m: 4322,
    snotel: null, // nearest SNOTEL is ~90 km out
    cams: [], // no stable cam URL verified
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=41.41&lon=-122.19' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/mtshastaskipark' },
      { label: 'Mt Shasta Avalanche Center', url: 'https://www.shastaavalanche.org/' },
    ],
  },

  // --- Pacific Northwest -----------------------------------------------------
  {
    id: 'baker',
    name: 'Mt Baker',
    state: 'WA',
    range: 'North Cascades',
    lat: 48.8573,
    lng: -121.6776,
    elev_m: 1554, // ski-area top, not the 3,286 m volcano summit
    snotel: '909:WA:SNTL', // Wells Creek, 8.3 km
    cams: [
      { label: 'Mt Baker snow report & cams', url: 'https://www.mtbaker.us/snow-report/' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=48.86&lon=-121.68' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/mtbaker' },
    ],
  },
  {
    id: 'crystal',
    name: 'Crystal Mountain',
    state: 'WA',
    range: 'Cascade Range',
    lat: 46.9282,
    lng: -121.5045,
    elev_m: 2134,
    snotel: '642:WA:SNTL', // Morse Lake, 3.0 km
    cams: [
      { label: 'Crystal Mountain webcams', url: 'https://www.crystalmountainresort.com/explore-the-mountain/webcams' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=46.93&lon=-121.50' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/crystalmountain' },
    ],
  },
  {
    id: 'hood-meadows',
    name: 'Mt Hood Meadows',
    state: 'OR',
    range: 'Cascade Range',
    lat: 45.3318,
    lng: -121.6645,
    elev_m: 2225,
    snotel: '651:OR:SNTL', // Mt Hood Test Site, 4.2 km
    cams: [], // no stable cam URL verified
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=45.33&lon=-121.66' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/mthoodmeadows' },
    ],
  },
  {
    id: 'bachelor',
    name: 'Mt Bachelor',
    state: 'OR',
    range: 'Cascade Range',
    lat: 43.9793,
    lng: -121.6886,
    elev_m: 2764,
    snotel: '815:OR:SNTL', // Three Creeks Meadow, ~19 km — nearest available
    cams: [], // no stable cam URL verified
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=43.98&lon=-121.69' },
    ],
  },

  // --- Wasatch ----------------------------------------------------------------
  {
    id: 'alta',
    name: 'Alta',
    state: 'UT',
    range: 'Wasatch Range',
    lat: 40.5884,
    lng: -111.6386,
    elev_m: 3216,
    snotel: '1308:UT:SNTL', // Atwater, 0.3 km
    cams: [], // no stable cam URL verified
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=40.59&lon=-111.64' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/alta' },
      { label: 'Alta weather & conditions', url: 'https://www.alta.com/weather' },
    ],
  },
  {
    id: 'snowbird',
    name: 'Snowbird',
    state: 'UT',
    range: 'Wasatch Range',
    lat: 40.581,
    lng: -111.6558,
    elev_m: 3353,
    snotel: '766:UT:SNTL', // Snowbird, 1.3 km
    cams: [
      { label: 'Snowbird webcams', url: 'https://www.snowbird.com/webcams/' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=40.58&lon=-111.66' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/snowbird' },
    ],
  },
  {
    id: 'park-city',
    name: 'Park City',
    state: 'UT',
    range: 'Wasatch Range',
    lat: 40.6514,
    lng: -111.508,
    elev_m: 3049,
    snotel: '814:UT:SNTL', // Thaynes Canyon, 3.8 km
    cams: [
      { label: 'Park City mountain cams', url: 'https://www.parkcitymountain.com/the-mountain/mountain-conditions/mountain-cams.aspx' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=40.65&lon=-111.51' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/parkcity' },
    ],
  },

  // --- Rockies ----------------------------------------------------------------
  {
    id: 'vail',
    name: 'Vail',
    state: 'CO',
    range: 'Gore Range',
    lat: 39.6061,
    lng: -106.355,
    elev_m: 3527,
    snotel: '842:CO:SNTL', // Vail Mountain, 2.5 km
    cams: [
      { label: 'Vail mountain cams', url: 'https://www.vail.com/the-mountain/mountain-conditions/mountain-cams.aspx' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=39.61&lon=-106.36' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/vail' },
    ],
  },
  {
    id: 'breckenridge',
    name: 'Breckenridge',
    state: 'CO',
    range: 'Tenmile Range',
    lat: 39.4817,
    lng: -106.0384,
    elev_m: 3914,
    snotel: '415:CO:SNTL', // Copper Mountain, 11.5 km — nearest available
    cams: [
      { label: 'Breckenridge mountain cams', url: 'https://www.breckenridge.com/the-mountain/mountain-conditions/mountain-cams.aspx' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=39.48&lon=-106.04' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/breckenridge' },
    ],
  },
  {
    id: 'copper',
    name: 'Copper Mountain',
    state: 'CO',
    range: 'Tenmile Range',
    lat: 39.5022,
    lng: -106.1497,
    elev_m: 3753,
    snotel: '415:CO:SNTL', // Copper Mountain, 2.4 km
    cams: [], // no stable cam URL verified
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=39.50&lon=-106.15' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/copper' },
    ],
  },

  // --- Tetons -----------------------------------------------------------------
  {
    id: 'jackson',
    name: 'Jackson Hole',
    state: 'WY',
    range: 'Teton Range',
    lat: 43.5875,
    lng: -110.8279,
    elev_m: 3185,
    snotel: '689:WY:SNTL', // Phillips Bench, 10.4 km
    cams: [], // no stable cam URL verified
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=43.59&lon=-110.83' },
      { label: 'OpenSnow', url: 'https://opensnow.com/location/jacksonhole' },
    ],
  },

  // --- East (alerts muted — northeast US peaks are out of alerting scope) -----
  {
    id: 'mt-washington',
    name: 'Mt Washington',
    state: 'NH',
    range: 'Presidential Range',
    lat: 44.2705,
    lng: -71.3033,
    elev_m: 1916,
    snotel: null, // SNOTEL network is western US only
    excludeFromAlerts: true,
    cams: [
      { label: 'Mt Washington Observatory cams', url: 'https://mountwashington.org/webcams/' },
    ],
    links: [
      { label: 'NWS point forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=44.27&lon=-71.30' },
      { label: 'Mount Washington Observatory', url: 'https://www.mountwashington.org/' },
    ],
  },
];
