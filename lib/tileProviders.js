/**
 * Basemap tile-provider registry for the dark-sky map.
 *
 * Why this exists
 * ---------------
 * Since late August 2026 CARTO stamps EVERY keyless request to
 * basemaps.cartocdn.com with an "API KEY REQUIRED — carto.com/basemaps/apikey"
 * watermark. The response is still HTTP 200 and a valid PNG, so the old
 * `dark_all` URL "loads" but renders watermarked — a content problem, not a
 * connectivity problem. Keyless CARTO therefore can no longer be the default.
 *
 * Default chain (works with zero configuration, no credentials):
 *   1. Esri World Dark Gray (base + reference labels) — dark, neutral,
 *      anonymous raster tiles verified against the public ArcGIS REST service
 *      metadata; attribution required and included below.
 *   2. OpenStreetMap standard tiles — keyless last-resort fallback so the map
 *      always has a chance to draw real geography (low-volume, non-commercial
 *      use per the OSM tile usage policy).
 *
 * Optional keyed provider:
 *   Set NEXT_PUBLIC_CARTO_API_KEY (free key, 5M tiles/month, from
 *   https://carto.com/basemaps/apikey) to restore the original CARTO Dark
 *   Matter look. Keys are NEVER hard-coded or committed; put yours in
 *   .env.local. Without a key the app silently uses the keyless chain above.
 *
 * NEXT_PUBLIC_TILE_PROVIDER can force the head of the chain:
 *   "esri" (default) | "carto" (requires the key) | "osm".
 */

const ESRI_ATTRIBUTION =
  'Basemap by Esri — Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community';

const ESRI_CANVAS_BASE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';

/**
 * ArcGIS REST cached tile services address tiles as /tile/{level}/{row}/{col},
 * i.e. {z}/{y}/{x} — note the reversed order compared to XYZ providers.
 * The World Dark Gray cache is fully populated through level 16; Leaflet
 * upscales beyond that via maxNativeZoom instead of requesting missing tiles.
 */
function esriLayer(service) {
  return {
    url: `${ESRI_CANVAS_BASE}/${service}/MapServer/tile/{z}/{y}/{x}`,
    // Base and reference share the same copyright text; Leaflet's attribution
    // control de-duplicates identical strings automatically.
    attribution: ESRI_ATTRIBUTION,
    tileSize: 256,
    maxNativeZoom: 16,
    maxZoom: 18,
  };
}

export const ESRI_DARK_GRAY = {
  id: 'esri-dark-gray',
  name: 'Esri World Dark Gray',
  dark: true,
  requiresKey: false,
  layers: [
    esriLayer('World_Dark_Gray_Base'),
    esriLayer('World_Dark_Gray_Reference'),
  ],
};

export const OSM_STANDARD = {
  id: 'osm-standard',
  name: 'OpenStreetMap',
  dark: false,
  requiresKey: false,
  layers: [
    {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      tileSize: 256,
      maxNativeZoom: 19,
      maxZoom: 19,
    },
  ],
};

/** CARTO Dark Matter with a user-supplied key (see module header). */
export function cartoDarkMatter(apiKey) {
  return {
    id: 'carto-dark-matter',
    name: 'CARTO Dark Matter',
    dark: true,
    requiresKey: true,
    keyEnvVar: 'NEXT_PUBLIC_CARTO_API_KEY',
    layers: [
      {
        url:
          'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png' +
          `?key=${encodeURIComponent(apiKey)}`,
        subdomains: 'abcd',
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions/">CARTO</a>',
        tileSize: 256,
        maxNativeZoom: 19,
        maxZoom: 20,
      },
    ],
  };
}

const KNOWN_PROVIDERS = ['esri', 'carto', 'osm'];

/**
 * Build the ordered provider chain from NEXT_PUBLIC_* environment variables.
 * Deterministic and side-effect free apart from the returned warning strings;
 * safe to call during render on the client (MapComponent is ssr:false).
 *
 * @returns {{ chain: object[], warnings: string[] }}
 */
export function buildProviderChain(env = process.env) {
  const warnings = [];
  const requested = String(env?.NEXT_PUBLIC_TILE_PROVIDER ?? '')
    .trim()
    .toLowerCase();
  const cartoKey = String(env?.NEXT_PUBLIC_CARTO_API_KEY ?? '').trim();

  if (requested && !KNOWN_PROVIDERS.includes(requested)) {
    warnings.push(
      `Unknown NEXT_PUBLIC_TILE_PROVIDER "${requested}"; using the default keyless chain. Valid values: ${KNOWN_PROVIDERS.join(', ')}.`,
    );
  }
  if (requested === 'carto' && !cartoKey) {
    warnings.push(
      'NEXT_PUBLIC_TILE_PROVIDER=carto but NEXT_PUBLIC_CARTO_API_KEY is not set. Keyless CARTO tiles are watermarked ("API KEY REQUIRED"), so falling back to the keyless chain. Get a free key at https://carto.com/basemaps/apikey and put it in .env.local — never commit it.',
    );
  }

  const carto = cartoKey ? cartoDarkMatter(cartoKey) : null;
  let chain;
  if (requested === 'carto') {
    chain = carto ? [carto, ESRI_DARK_GRAY, OSM_STANDARD] : [ESRI_DARK_GRAY, OSM_STANDARD];
  } else if (requested === 'esri') {
    chain = [ESRI_DARK_GRAY, OSM_STANDARD];
  } else if (requested === 'osm') {
    chain = [OSM_STANDARD, ESRI_DARK_GRAY];
  } else {
    // Default: honour a configured CARTO key if present, else Esri first.
    chain = carto ? [carto, ESRI_DARK_GRAY, OSM_STANDARD] : [ESRI_DARK_GRAY, OSM_STANDARD];
  }

  return { chain, warnings };
}
