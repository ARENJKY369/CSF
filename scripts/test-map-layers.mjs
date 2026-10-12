/**
 * Node tests for the map-layer registry and the live-cloud resolver:
 *   - lib/tileProviders.js  (map types + keyless fallback chains)
 *   - lib/cloudOverlay.js   (NASA GIBS geostationary IR sector selection)
 *
 * These guard the two promises the floating layer switcher makes: every map
 * type and overlay is keyless/watermark-free by construction, and no map type
 * can dead-end into a blank map while a working provider remains in its chain.
 *
 *   run:  npm run test:layers   (or: node scripts/test-map-layers.mjs)
 */
import { readFileSync } from 'node:fs';

// Both modules are ESM, but the app package has no "type": "module" (Next.js
// compiles them directly). Load the exact source as an ESM data-URL module so
// this test exercises the shipped code without touching package.json — same
// trick as scripts/test-tile-probe.mjs.
async function loadEsm(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  ESRI_DARK_GRAY,
  GOOGLE_SATELLITE,
  OPENTOPO_TERRAIN,
  OSM_STANDARD,
  buildBasemapChain,
  buildProviderChain,
  getBasemap,
  resolveDefaultBasemapId,
} = await loadEsm('../lib/tileProviders.js');

const {
  CLOUD_REFRESH_MS,
  CLOUD_SATELLITES,
  GEOSTATIONARY_LIMB_DEG,
  GIBS_TILE_MATRIX_SET,
  angularDistanceDeg,
  buildCloudOverlay,
  buildCloudTileUrl,
  classifyCloudCoverage,
  pickCloudSatellite,
} = await loadEsm('../lib/cloudOverlay.js');

let failures = 0;
function check(name, condition, extra = '') {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

/** Any credential-shaped query parameter would mean a watermark-prone source. */
const KEYED_PATTERN = /[?&](key|appid|api_?key|token|ak)=/i;

console.log('tileProviders: map type registry');
check('three map types are registered', BASEMAPS.length === 3, `got ${BASEMAPS.length}`);
check(
  'ids are satellite / dark / terrain in menu order',
  BASEMAPS.map((basemap) => basemap.id).join(',') === 'satellite,dark,terrain',
  BASEMAPS.map((basemap) => basemap.id).join(','),
);
check('default map type is satellite', DEFAULT_BASEMAP_ID === 'satellite', DEFAULT_BASEMAP_ID);

for (const basemap of BASEMAPS) {
  check(
    `"${basemap.id}" has a label and hint for the popover`,
    Boolean(basemap.label) && Boolean(basemap.hint),
  );
  check(
    `"${basemap.id}" head provider has at least one layer`,
    Array.isArray(basemap.provider?.layers) && basemap.provider.layers.length > 0,
  );
  check(
    `"${basemap.id}" carries a keyless fallback chain`,
    Array.isArray(basemap.fallback) && basemap.fallback.length > 0,
  );
  const chainIds = [basemap.provider, ...basemap.fallback].map((provider) => provider.id);
  check(
    `"${basemap.id}" chain has no duplicate providers`,
    new Set(chainIds).size === chainIds.length,
    chainIds.join(','),
  );
  for (const provider of [basemap.provider, ...basemap.fallback]) {
    check(
      `"${provider.id}" has a short name for the popover footer`,
      typeof provider.shortName === 'string' && provider.shortName.length > 0,
    );
  }
}

console.log('tileProviders: every tile source is https, keyless and attributed');
const allProviders = [GOOGLE_SATELLITE, ESRI_DARK_GRAY, OPENTOPO_TERRAIN, OSM_STANDARD];
for (const provider of allProviders) {
  for (const layer of provider.layers) {
    check(
      `${provider.id} uses https`,
      layer.url.startsWith('https://'),
      layer.url,
    );
    check(
      `${provider.id} has no key/appid/token parameter`,
      !KEYED_PATTERN.test(layer.url),
      layer.url,
    );
    check(
      `${provider.id} ships attribution text`,
      typeof layer.attribution === 'string' && layer.attribution.length > 0,
    );
    check(
      `${provider.id} declares maxNativeZoom so Leaflet upscales instead of 404ing`,
      Number.isFinite(layer.maxNativeZoom) && Number.isFinite(layer.maxZoom),
    );
    if (layer.url.includes('{s}')) {
      check(
        `${provider.id} defines subdomains for its {s} placeholder`,
        Boolean(layer.subdomains),
        layer.url,
      );
    }
  }
  check(`${provider.id} is not marked as requiring a key`, provider.requiresKey === false);
}

check(
  'satellite map type is the specified Google hybrid URL',
  GOOGLE_SATELLITE.layers[0].url === 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  GOOGLE_SATELLITE.layers[0].url,
);
check(
  'dark map type is the Esri World Dark Gray base layer ({z}/{y}/{x} REST order)',
  ESRI_DARK_GRAY.layers[0].url ===
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  ESRI_DARK_GRAY.layers[0].url,
);
check(
  'terrain map type is the OpenTopoMap XYZ URL',
  OPENTOPO_TERRAIN.layers[0].url === 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  OPENTOPO_TERRAIN.layers[0].url,
);

console.log('tileProviders: chains');
const satelliteChain = buildBasemapChain('satellite');
check(
  'satellite chain: google → esri → osm',
  satelliteChain.map((provider) => provider.id).join(',') ===
    'google-satellite,esri-dark-gray,osm-standard',
  satelliteChain.map((provider) => provider.id).join(','),
);
const terrainChain = buildBasemapChain('terrain');
check(
  'terrain chain starts at OpenTopoMap and keeps keyless fallbacks',
  terrainChain[0].id === 'opentopo-terrain' && terrainChain.length === 3,
  terrainChain.map((provider) => provider.id).join(','),
);
check(
  'dark chain defers to the env-built chain',
  buildBasemapChain('dark', [OSM_STANDARD, ESRI_DARK_GRAY]).map((p) => p.id).join(',') ===
    'osm-standard,esri-dark-gray',
);
check('unknown map type falls back to the default', getBasemap('nope').id === DEFAULT_BASEMAP_ID);
check('buildBasemapChain never returns an empty chain', buildBasemapChain('nope').length > 0);

console.log('tileProviders: NEXT_PUBLIC_TILE_PROVIDER');
check('unset provider env → satellite default', resolveDefaultBasemapId({}) === 'satellite');
check('terrain env → terrain', resolveDefaultBasemapId({ NEXT_PUBLIC_TILE_PROVIDER: 'terrain' }) === 'terrain');
check('dark env → dark', resolveDefaultBasemapId({ NEXT_PUBLIC_TILE_PROVIDER: 'DARK' }) === 'dark');
check(
  'legacy esri env still resolves (to the dark map type)',
  resolveDefaultBasemapId({ NEXT_PUBLIC_TILE_PROVIDER: 'esri' }) === 'dark',
);
check(
  'unknown env value falls back to satellite',
  resolveDefaultBasemapId({ NEXT_PUBLIC_TILE_PROVIDER: 'bing' }) === 'satellite',
);
check(
  'unknown env value is reported as a warning, valid values are not',
  buildProviderChain({ NEXT_PUBLIC_TILE_PROVIDER: 'bing' }).warnings.length === 1 &&
    buildProviderChain({ NEXT_PUBLIC_TILE_PROVIDER: 'satellite' }).warnings.length === 0 &&
    buildProviderChain({}).warnings.length === 0,
);
check(
  'carto without a key warns and stays on the keyless chain',
  buildProviderChain({ NEXT_PUBLIC_TILE_PROVIDER: 'carto' }).warnings.length === 1 &&
    buildProviderChain({ NEXT_PUBLIC_TILE_PROVIDER: 'carto' }).chain[0].id === 'esri-dark-gray',
);
check(
  'carto with a key leads the dark chain and keeps keyless fallbacks',
  buildProviderChain({ NEXT_PUBLIC_CARTO_API_KEY: 'demo' }).chain
    .map((provider) => provider.id)
    .join(',') === 'carto-dark-matter,esri-dark-gray,osm-standard',
);
check(
  'osm env keeps OSM at the head of the dark chain',
  buildProviderChain({ NEXT_PUBLIC_TILE_PROVIDER: 'osm' }).chain[0].id === 'osm-standard',
);

console.log('cloudOverlay: geometry');
check('same longitude → 0°', angularDistanceDeg(-75.2, -75.2) === 0);
check('plain difference', Math.abs(angularDistanceDeg(10, -75.2) - 85.2) < 1e-9);
check('wraps across the antimeridian', Math.abs(angularDistanceDeg(170, -137.2) - 52.8) < 1e-9);
check('non-finite input → Infinity', angularDistanceDeg(NaN, 0) === Infinity);
check('core / limb / none thresholds', classifyCloudCoverage(10) === 'live'
  && classifyCloudCoverage(75) === 'edge'
  && classifyCloudCoverage(GEOSTATIONARY_LIMB_DEG + 1) === 'none'
  && classifyCloudCoverage(Infinity) === 'none');
check('three geostationary disks are configured', CLOUD_SATELLITES.length === 3);
check('Cherry Springs (PA) → GOES-East', pickCloudSatellite(-77.8228).id === 'goes-east');
check('Tokyo → Himawari', pickCloudSatellite(139.6503).id === 'himawari');
check('mid-Pacific → GOES-West', pickCloudSatellite(-165).id === 'goes-west');
check('non-finite longitude still returns a satellite', Boolean(pickCloudSatellite(undefined)));

console.log('cloudOverlay: GIBS request shape');
const goesEast = buildCloudOverlay(-77.8228);
check(
  'URL is the keyless GIBS WMTS REST template with the default (newest) time',
  goesEast.url ===
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared' +
    `/default/default/${GIBS_TILE_MATRIX_SET}/{z}/{y}/{x}.png`,
  goesEast.url,
);
check('no key/appid/token in the cloud URL', !KEYED_PATTERN.test(goesEast.url), goesEast.url);
check('matrix set is the 2 km Band 13 pyramid', GIBS_TILE_MATRIX_SET === 'GoogleMapsCompatible_Level6');
check('tile order is {z}/{y}/{x} (row before column)', /\/\{z\}\/\{y\}\/\{x\}\.png$/.test(goesEast.url));
check('cloud feed refreshes every 10 minutes', CLOUD_REFRESH_MS === 600000);
check('attribution names NASA GIBS and the satellite operator', /NASA EOSDIS GIBS/.test(goesEast.attribution)
  && /NOAA/.test(goesEast.attribution), goesEast.attribution);
check('covered site reports live coverage and no warning note', goesEast.coverage === 'live' && goesEast.note === '');
check('caption names the active satellite', /GOES-EAST/.test(goesEast.caption), goesEast.caption);
check('buildCloudTileUrl is stable for a satellite', buildCloudTileUrl(CLOUD_SATELLITES[2]) === buildCloudOverlay(139.7).url);

const europe = buildCloudOverlay(10);
check('Europe is outside every GIBS disk → coverage none', europe.coverage === 'none', `${europe.coverage}/${europe.distanceDeg}`);
check('uncovered site explains itself instead of drawing nothing silently', europe.note.length > 20);
const limb = buildCloudOverlay(0);
check('Greenwich sits on the GOES-East limb', limb.coverage === 'edge' && limb.satellite.id === 'goes-east', limb.coverage);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll map-layer tests passed.');
