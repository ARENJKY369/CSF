import { classifyProbeResult, computeTileStats, tilesIdentical } from './tileProbe';

/**
 * Browser-side probe that loads two tiles for widely separated land locations
 * from the ACTIVE provider's first layer and inspects their pixels (see
 * lib/tileProbe.js for the detection heuristics).
 *
 * Design rules:
 *  - The probe is best-effort: any failure (offline, CORS-blocked canvas,
 *    decode error) resolves to { status: 'inconclusive' } and the provider is
 *    KEPT — tile-error monitoring covers hard failures. It never throws and
 *    never triggers retries by itself.
 *  - Runs at most once per provider activation (enforced by the caller).
 */

/**
 * Probe tiles at z6 over land with visible detail in any real basemap:
 *   A: Central Europe (~10°E, ~50°N)   B: Honshu, Japan (~138°E, ~37°N)
 * Deliberately far apart so identical placeholder images are trivially caught.
 */
export const PROBE_TILES = [
  { z: 6, x: 33, y: 21 },
  { z: 6, x: 56, y: 24 },
];

const PROBE_TIMEOUT_MS = 12000;

/** Expand a Leaflet-style URL template for a concrete tile. */
export function buildProbeUrl(layer, tile) {
  const subdomains =
    typeof layer.subdomains === 'string'
      ? layer.subdomains.split('')
      : Array.isArray(layer.subdomains)
        ? layer.subdomains
        : ['a'];
  return layer.url
    .replace('{s}', subdomains[0] ?? 'a')
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
    .replace('{r}', '');
}

function loadTileImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // CORS mode lets us read pixels back from the canvas. If the provider
    // sends no CORS headers the load fails here and the probe reports
    // 'inconclusive' — the visible map layer is unaffected (it uses plain
    // <img> tags without crossOrigin, exactly like before).
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer-when-downgrade';
    const timer = setTimeout(() => {
      img.src = '';
      reject(new Error('probe-timeout'));
    }, PROBE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('probe-load-failed'));
    };
    img.src = url;
  });
}

function readPixels(img) {
  const width = img.naturalWidth || 256;
  const height = img.naturalHeight || 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas-unavailable');
  context.drawImage(img, 0, 0);
  // Throws SecurityError when the canvas is CORS-tainted.
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

/**
 * @param {object} provider  A provider from lib/tileProviders.js
 * @returns {Promise<{status: 'ok'|'fail'|'inconclusive'|'skipped', reason?: string, detail?: string, stats?: object}>}
 */
export async function probeTileProvider(provider) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { status: 'skipped', reason: 'no-dom' };
  }
  const layer = provider?.layers?.[0];
  if (!layer?.url) {
    return { status: 'skipped', reason: 'no-layer' };
  }

  let images;
  try {
    images = await Promise.all(
      PROBE_TILES.map((tile) => loadTileImage(buildProbeUrl(layer, tile))),
    );
  } catch (error) {
    return {
      status: 'inconclusive',
      reason: 'probe-unreachable',
      detail: `Could not load probe tiles (${error?.message ?? error}); keeping provider and relying on tile-error monitoring.`,
    };
  }

  let pixelA;
  let pixelB;
  try {
    pixelA = readPixels(images[0]);
    pixelB = readPixels(images[1]);
  } catch (error) {
    return {
      status: 'inconclusive',
      reason: 'canvas-blocked',
      detail: `Tile pixels could not be inspected (${error?.message ?? error}); keeping provider and relying on tile-error monitoring.`,
    };
  }

  const identical =
    pixelA.width === pixelB.width &&
    pixelA.height === pixelB.height &&
    tilesIdentical(pixelA.data, pixelB.data);
  const statsA = computeTileStats(pixelA.data, pixelA.width, pixelA.height);
  const statsB = computeTileStats(pixelB.data, pixelB.width, pixelB.height);
  const result = classifyProbeResult({
    identical,
    statsA,
    statsB,
    dark: provider.dark !== false,
  });

  return {
    status: result.verdict === 'fail' ? 'fail' : 'ok',
    reason: result.reason,
    detail: result.detail,
    stats: { identical, statsA, statsB },
  };
}
