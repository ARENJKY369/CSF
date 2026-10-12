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
 * Every provider in this registry is anonymous and keyless (except the
 * opt-in CARTO one, which needs YOUR key in .env.local): no watermarks, no
 * `key=`/`appid=` query strings, no account. Each provider is additionally
 * verified at runtime by the pixel probe in lib/tileProbe.js, and every basemap
 * carries a finite fallback chain so a dead provider degrades gracefully.
 *
 * Map types (the floating layer switcher inside the map box)
 * ---------------------------------------------------------
 *   satellite — Google satellite/hybrid imagery (mt1.google.com, `lyrs=y`).
 *               The default map type; brightest and most realistic for
 *               scouting horizons and terrain around an observing site.
 *   dark      — Esri World Dark Gray (base + reference labels). Dark, neutral,
 *               ideal behind the simulated sky-glow overlay and for protecting
 *               night vision.
 *   terrain   — OpenTopoMap relief/contour shading for judging terrain and
 *               horizon obstruction.
 *
 * NEXT_PUBLIC_TILE_PROVIDER picks the INITIAL map type:
 *   "satellite" (default) | "dark" | "terrain"
 *   legacy values "esri"/"carto"/"osm" are still accepted and mean "dark"
 *   (they also control the head of the dark chain, see buildProviderChain).
 *
 * Optional keyed provider:
 *   Set NEXT_PUBLIC_CARTO_API_KEY (free key, 5M tiles/month, from
 *   https://carto.com/basemaps/apikey) to restore the original CARTO Dark
 *   Matter look at the head of the DARK chain. Keys are NEVER hard-coded or
 *   committed; put yours in .env.local.
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
  shortName: 'Esri Dark Gray',
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
  shortName: 'OSM',
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

/**
 * Google satellite/hybrid raster tiles. `lyrs=y` bakes the place-name and road
 * labels into the imagery, so no extra label layer is needed. Keyless and
 * watermark-free; mt0–mt3 are equivalent mirrors (mt1 is used here). This is a
 * light-use, interactive endpoint — never script or mirror it in bulk.
 */
export const GOOGLE_SATELLITE = {
  id: 'google-satellite',
  name: 'Google Satellite',
  shortName: 'Google Satellite',
  dark: false,
  requiresKey: false,
  layers: [
    {
      url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      attribution:
        'Satellite imagery &copy; <a href="https://www.google.com/permissions/geoguidelines/">Google</a>',
      tileSize: 256,
      maxNativeZoom: 19,
      maxZoom: 19,
    },
  ],
};

/**
 * OpenTopoMap: OpenStreetMap data + SRTM relief shading, CC-BY-SA. Keyless;
 * the project asks for attribution (included) and low-volume interactive use.
 * Native tiles stop at z17, so Leaflet upscales the last levels.
 */
export const OPENTOPO_TERRAIN = {
  id: 'opentopo-terrain',
  name: 'OpenTopoMap',
  shortName: 'OpenTopoMap',
  dark: false,
  requiresKey: false,
  layers: [
    {
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      subdomains: 'abc',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style &copy; <a href="https://opentopomap.org/">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      tileSize: 256,
      maxNativeZoom: 17,
      maxZoom: 18,
    },
  ],
};

/** CARTO Dark Matter with a user-supplied key (see module header). */
export function cartoDarkMatter(apiKey) {
  return {
    id: 'carto-dark-matter',
    name: 'CARTO Dark Matter',
    shortName: 'CARTO Dark Matter',
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

/**
 * The three map types offered by the floating layer switcher, in menu order.
 * `fallback` is the finite keyless chain used when the head provider fails the
 * runtime pixel probe or starts erroring — so no map type can ever dead-end
 * into a blank map while a working provider remains.
 */
export const BASEMAPS = [
  {
    id: 'satellite',
    label: 'Satellite View',
    hint: 'Google hybrid imagery',
    provider: GOOGLE_SATELLITE,
    fallback: [ESRI_DARK_GRAY, OSM_STANDARD],
  },
  {
    id: 'dark',
    label: 'Dark Mode',
    hint: 'Esri World Dark Gray',
    provider: ESRI_DARK_GRAY,
    fallback: [OSM_STANDARD],
  },
  {
    id: 'terrain',
    label: 'Terrain View',
    hint: 'OpenTopoMap relief',
    provider: OPENTOPO_TERRAIN,
    fallback: [OSM_STANDARD, ESRI_DARK_GRAY],
  },
];

/** Map type shown on first load (overridable via NEXT_PUBLIC_TILE_PROVIDER). */
export const DEFAULT_BASEMAP_ID = 'satellite';

/** NEXT_PUBLIC_TILE_PROVIDER value → initial map type. */
const BASEMAP_ALIASES = {
  satellite: 'satellite',
  dark: 'dark',
  terrain: 'terrain',
  // Legacy values selected a *provider*, not a map type; they all belonged to
  // the dark theme, so they keep working as "start on Dark Mode".
  esri: 'dark',
  carto: 'dark',
  osm: 'dark',
};

/** Every value NEXT_PUBLIC_TILE_PROVIDER accepts. */
export const KNOWN_PROVIDERS = Object.keys(BASEMAP_ALIASES);

export function getBasemap(basemapId) {
  return (
    BASEMAPS.find((basemap) => basemap.id === basemapId) ||
    BASEMAPS.find((basemap) => basemap.id === DEFAULT_BASEMAP_ID) ||
    BASEMAPS[0]
  );
}

/**
 * IMPORTANT: Next.js only inlines the EXACT `process.env.NEXT_PUBLIC_*`
 * member-expression pattern into the client bundle. A bare `process.env`
 * object passed around at runtime does NOT carry the values into the browser,
 * so the two variables must be read with direct member access here (they are
 * statically replaced at build/dev-compile time). Callers can still inject an
 * overrides object (used by tests).
 */
function readPublicEnv() {
  return {
    NEXT_PUBLIC_TILE_PROVIDER: process.env.NEXT_PUBLIC_TILE_PROVIDER,
    NEXT_PUBLIC_CARTO_API_KEY: process.env.NEXT_PUBLIC_CARTO_API_KEY,
  };
}

/** Initial map type for the layer switcher, from NEXT_PUBLIC_TILE_PROVIDER. */
export function resolveDefaultBasemapId(env = readPublicEnv()) {
  const requested = String(env?.NEXT_PUBLIC_TILE_PROVIDER ?? '')
    .trim()
    .toLowerCase();
  return BASEMAP_ALIASES[requested] || DEFAULT_BASEMAP_ID;
}

/**
 * Build the ordered provider chain for the DARK map type from NEXT_PUBLIC_*
 * environment variables (kept for the documented env behaviour and reused by
 * buildBasemapChain). Deterministic and side-effect free apart from the
 * returned warning strings; safe to call during render on the client
 * (MapComponent is ssr:false).
 *
 * @returns {{ chain: object[], warnings: string[] }}
 */
export function buildProviderChain(env = readPublicEnv()) {
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
  } else if (requested === 'osm') {
    chain = [OSM_STANDARD, ESRI_DARK_GRAY];
  } else {
    // "satellite" / "terrain" select a map type, not a dark-chain head, so
    // they (like "esri" and the unset default) keep the dark chain as-is:
    // honour a configured CARTO key if present, else Esri first.
    chain = carto ? [carto, ESRI_DARK_GRAY, OSM_STANDARD] : [ESRI_DARK_GRAY, OSM_STANDARD];
  }

  return { chain, warnings };
}

/**
 * Ordered provider chain for one map type: the chosen provider first, then its
 * keyless fallbacks (de-duplicated). The DARK map type defers to the
 * env-configurable chain so NEXT_PUBLIC_TILE_PROVIDER / NEXT_PUBLIC_CARTO_API_KEY
 * keep working exactly as documented.
 *
 * @param {string} basemapId  'satellite' | 'dark' | 'terrain'
 * @param {object[]} [darkChain]  pre-built chain from buildProviderChain()
 * @returns {object[]} providers, head first
 */
export function buildBasemapChain(basemapId, darkChain = null) {
  const basemap = getBasemap(basemapId);
  if (basemap.id === 'dark' && Array.isArray(darkChain) && darkChain.length > 0) {
    return darkChain;
  }
  const chain = [];
  const seen = new Set();
  for (const provider of [basemap.provider, ...basemap.fallback]) {
    if (!provider || seen.has(provider.id)) continue;
    seen.add(provider.id);
    chain.push(provider);
  }
  return chain;
}
