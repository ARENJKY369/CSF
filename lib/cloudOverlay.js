/**
 * "Live clouds" overlay for the dark-sky map.
 *
 * Source: NASA EOSDIS **GIBS** (Global Imagery Browse Services) geostationary
 * Band 13 "Clean Infrared" imagery — the standard cloud-top temperature view
 * used by operational weather services. It is:
 *
 *   - KEYLESS   — anonymous public WMTS tiles, no account, no `appid`/`key`
 *                 query parameter, therefore no "API KEY REQUIRED" watermark
 *                 (the failure mode that removed keyless CARTO from this app);
 *   - LIVE      — a new frame every ~10 minutes, and this module asks GIBS for
 *                 the `default` time keyword so the service itself resolves the
 *                 newest ingested frame (no client-side clock maths, no risk of
 *                 requesting a timestamp that has not been ingested yet → 404);
 *   - TRANSPARENT — PNG with alpha, so it reads as a semi-transparent cloud
 *                 veil over any basemap instead of hiding it.
 *
 * WMTS RESTful template (note the {z}/{y}/{x} = level/row/column order):
 *   https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/
 *     {LayerIdentifier}/default/{Time}/{TileMatrixSet}/{z}/{y}/{x}.png
 *
 * Coverage caveat (documented in the UI, not hidden): geostationary satellites
 * each see roughly a hemisphere, and GIBS currently serves the NOAA GOES-East /
 * GOES-West and JMA Himawari disks only — there is no Meteosat layer, so a site
 * over Europe/Africa can fall outside every disk. This module reports that
 * honestly (`coverage: 'none'`) instead of drawing an empty overlay silently.
 *
 * Everything here is pure and DOM-free so it can be unit-tested in Node
 * (see scripts/test-map-layers.mjs).
 */

/** Band 13 IR is served at 2 km → GIBS matrix set with zoom levels 0–6. */
export const GIBS_TILE_MATRIX_SET = 'GoogleMapsCompatible_Level6';

export const GIBS_WMTS_ROOT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/**
 * A geostationary satellite sees the Earth's limb at ~81.3° of arc from its
 * sub-satellite point; usable imagery degrades well before that, so the "core"
 * disk is treated as ±70° and 70–81.3° as a low-quality limb.
 */
export const GEOSTATIONARY_LIMB_DEG = 81.3;
export const GEOSTATIONARY_CORE_DEG = 70;

/** How often an enabled overlay asks Leaflet to re-request the newest frame. */
export const CLOUD_REFRESH_MS = 10 * 60 * 1000;

export const CLOUD_ATTRIBUTION =
  'Cloud IR &copy; <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/global-imagery-browse-services-gibs">NASA EOSDIS GIBS</a>';

export const CLOUD_SATELLITES = [
  {
    id: 'goes-east',
    name: 'GOES-East',
    shortName: 'GOES-EAST',
    layer: 'GOES-East_ABI_Band13_Clean_Infrared',
    subSatelliteLng: -75.2,
    source: 'NOAA GOES-R / ABI',
  },
  {
    id: 'goes-west',
    name: 'GOES-West',
    shortName: 'GOES-WEST',
    layer: 'GOES-West_ABI_Band13_Clean_Infrared',
    subSatelliteLng: -137.2,
    source: 'NOAA GOES-R / ABI',
  },
  {
    id: 'himawari',
    name: 'Himawari',
    shortName: 'HIMAWARI',
    layer: 'Himawari_AHI_Band13_Clean_Infrared',
    subSatelliteLng: 140.7,
    source: 'JMA Himawari / AHI',
  },
];

/** Shortest angular separation between two longitudes, wrapping at ±180°. */
export function angularDistanceDeg(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs((((a - b + 540) % 360) + 360) % 360 - 180);
}

/**
 * Pick the geostationary disk whose sub-satellite point is closest to `longitude`.
 * Always returns a satellite (the nearest one) — coverage quality is reported
 * separately by {@link classifyCloudCoverage}.
 */
export function pickCloudSatellite(longitude) {
  let best = CLOUD_SATELLITES[0];
  let bestDistance = Infinity;
  for (const satellite of CLOUD_SATELLITES) {
    const distance = angularDistanceDeg(longitude, satellite.subSatelliteLng);
    if (distance < bestDistance) {
      best = satellite;
      bestDistance = distance;
    }
  }
  return best;
}

/** 'live' (full-resolution disk) | 'edge' (limb) | 'none' (outside every disk). */
export function classifyCloudCoverage(distanceDeg) {
  if (!Number.isFinite(distanceDeg)) return 'none';
  if (distanceDeg <= GEOSTATIONARY_CORE_DEG) return 'live';
  if (distanceDeg <= GEOSTATIONARY_LIMB_DEG) return 'edge';
  return 'none';
}

/**
 * GIBS tile URL for one satellite, with only the Leaflet placeholders left.
 * `default/default` = the layer's default style at its default (newest) time.
 */
export function buildCloudTileUrl(satellite) {
  return (
    `${GIBS_WMTS_ROOT}/${satellite.layer}/default/default/` +
    `${GIBS_TILE_MATRIX_SET}/{z}/{y}/{x}.png`
  );
}

/**
 * Resolve everything the map needs to draw (or refuse to draw) the cloud veil
 * for a given longitude.
 *
 * @param {number} longitude
 * @returns {{satellite: object, url: string, coverage: 'live'|'edge'|'none',
 *            distanceDeg: number, caption: string, note: string, attribution: string}}
 */
export function buildCloudOverlay(longitude) {
  const satellite = pickCloudSatellite(longitude);
  const distanceDeg = angularDistanceDeg(longitude, satellite.subSatelliteLng);
  const coverage = classifyCloudCoverage(distanceDeg);
  const caption = `LIVE IR · ${satellite.shortName} · ~10 MIN`;
  let note = '';
  if (coverage === 'none') {
    note =
      `No geostationary IR disk covers ${Number.isFinite(longitude) ? `${longitude.toFixed(1)}°` : 'this'} ` +
      `longitude (GIBS serves GOES-East/West and Himawari only, no Meteosat) — the overlay stays empty here.`;
  } else if (coverage === 'edge') {
    note = `${satellite.name} limb view — this site sits near the edge of the satellite disk, so cloud detail is stretched.`;
  }
  return {
    satellite,
    url: buildCloudTileUrl(satellite),
    coverage,
    distanceDeg,
    caption,
    note,
    attribution: `${CLOUD_ATTRIBUTION} · ${satellite.source}`,
  };
}
