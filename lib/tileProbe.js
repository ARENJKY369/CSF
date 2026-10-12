/**
 * Pure pixel-analysis helpers used to verify that a tile provider is serving
 * REAL basemap imagery.
 *
 * A provider can return HTTP 200 with a "valid" image that is actually an
 * "API KEY REQUIRED" watermark or a generic placeholder (this is exactly what
 * keyless basemaps.cartocdn.com has done since late August 2026). Status codes
 * alone cannot detect that, so we inspect rendered pixels instead:
 *
 *   1. Placeholder detection — two tiles for widely separated locations
 *      (Central Europe and Japan at z6) are compared byte-for-byte. Real
 *      geography is never pixel-identical across distant regions; a repeated
 *      watermark/placeholder tile is.
 *   2. Blank detection — an essentially flat image at both probe locations
 *      means the provider is serving empty tiles.
 *   3. Watermark-overlay detection — for DARK basemaps only, using two
 *      signals: (a) an unusually large fraction of bright pixels (>5% at both
 *      probe locations), and (b) diagonal periodicity of the bright-pixel
 *      mask, which catches THIN repeated watermark text ("API KEY REQUIRED —
 *      carto.com/basemaps/apikey" tiles diagonally at a fixed period) even
 *      when its coverage is small. Both are skipped for light basemaps such
 *      as the OSM fallback, where the whole tile is legitimately bright.
 *
 * These functions never throw on odd input and are DOM-free so they can be
 * unit-tested in Node (see scripts/test-tile-probe.mjs).
 */

/** Quantize each channel to 5 bits so anti-aliasing doesn't inflate counts. */
const QUANTIZE_SHIFT = 3;

/** Luma at/above which a pixel counts as "bright" (watermark text is white). */
const BRIGHT_LUMA = 160;

/**
 * Bright-pixel fraction above which a DARK tile looks watermark-stamped.
 * Real dark basemaps at the probe locations measure well under 3%; stamped
 * "API KEY REQUIRED" tiles are far brighter. Thin watermarks below this limit
 * are still caught by the diagonal-periodicity check below.
 */
const DARK_BRIGHT_FRACTION_LIMIT = 0.05;

/** Minimum bright coverage before periodicity is meaningful at all. */
const REPEAT_MIN_BRIGHT_FRACTION = 0.02;

/**
 * Watermark text repeats diagonally at a fixed pixel period, so shifting the
 * bright-pixel mask along a diagonal maps the text onto itself. Real geography
 * (scattered labels, borders) does not. Score = fraction of bright pixels that
 * stay bright after the shift; the max over candidate shifts/directions wins.
 */
const DIAGONAL_SHIFTS = [24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 112];
const DIAGONAL_REPEAT_FAIL_SCORE = 0.45;
const REPEAT_MIN_SAMPLE = 16;

/** A tile with at most this many quantized colors and tiny luma spread is flat. */
const FLAT_MAX_UNIQUE_COLORS = 8;
const FLAT_MAX_LUMA_STD_DEV = 6;

/**
 * Compute summary statistics for one RGBA tile.
 * @param {ArrayLike<number>} rgba  RGBA pixel data (length = w*h*4)
 * @param {number} width
 * @param {number} height
 */
export function computeTileStats(rgba, width, height) {
  const colors = new Set();
  const brightMask = new Uint8Array(width * height);
  let bright = 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    colors.add(((r >> QUANTIZE_SHIFT) << 10) | ((g >> QUANTIZE_SHIFT) << 5) | (b >> QUANTIZE_SHIFT));
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma >= BRIGHT_LUMA) {
      bright += 1;
      brightMask[i] = 1;
    }
    sum += luma;
    sumSq += luma * luma;
    n += 1;
  }
  if (n === 0) {
    return {
      uniqueColors: 0,
      brightFraction: 0,
      meanLuma: 0,
      lumaStdDev: 0,
      diagonalRepeatScore: 0,
    };
  }
  const meanLuma = sum / n;
  const variance = Math.max(0, sumSq / n - meanLuma * meanLuma);
  const brightFraction = bright / n;
  return {
    uniqueColors: colors.size,
    brightFraction,
    meanLuma,
    lumaStdDev: Math.sqrt(variance),
    diagonalRepeatScore:
      brightFraction > REPEAT_MIN_BRIGHT_FRACTION
        ? maxDiagonalRepeat(brightMask, width, height)
        : 0,
  };
}

/** Max fraction of bright pixels that stay bright under a diagonal shift. */
function maxDiagonalRepeat(brightMask, width, height) {
  let best = 0;
  for (const d of DIAGONAL_SHIFTS) {
    for (const sy of [1, -1]) {
      let matches = 0;
      let sampled = 0;
      const yStart = sy === 1 ? 0 : d;
      const yEnd = sy === 1 ? height - d : height;
      for (let y = yStart; y < yEnd; y += 1) {
        const rowBase = y * width;
        const shiftedRowBase = (y + sy * d) * width;
        for (let x = 0; x < width - d; x += 1) {
          if (!brightMask[rowBase + x]) continue;
          sampled += 1;
          if (brightMask[shiftedRowBase + x + d]) matches += 1;
        }
      }
      if (sampled >= REPEAT_MIN_SAMPLE) {
        best = Math.max(best, matches / sampled);
      }
    }
  }
  return best;
}

/** Exact byte-for-byte comparison of two RGBA tiles. */
export function tilesIdentical(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isFlat(stats) {
  return (
    stats.uniqueColors <= FLAT_MAX_UNIQUE_COLORS &&
    stats.lumaStdDev <= FLAT_MAX_LUMA_STD_DEV
  );
}

/**
 * Classify a two-tile probe result.
 * @param {{identical: boolean, statsA: object, statsB: object, dark?: boolean}} input
 * @returns {{verdict: 'pass'|'fail', reason: string, detail: string}}
 */
export function classifyProbeResult({ identical, statsA, statsB, dark = true }) {
  if (identical) {
    return {
      verdict: 'fail',
      reason: 'placeholder-tiles',
      detail:
        'Two geographically distant tiles returned pixel-identical images — the provider is serving a placeholder/watermark image instead of real basemap tiles.',
    };
  }
  if (isFlat(statsA) && isFlat(statsB)) {
    return {
      verdict: 'fail',
      reason: 'blank-tiles',
      detail: 'Probe tiles are essentially blank (no geographic detail).',
    };
  }
  if (dark) {
    const bothVeryBright =
      statsA.brightFraction > DARK_BRIGHT_FRACTION_LIMIT &&
      statsB.brightFraction > DARK_BRIGHT_FRACTION_LIMIT;
    const bothPeriodic =
      statsA.diagonalRepeatScore >= DIAGONAL_REPEAT_FAIL_SCORE &&
      statsB.diagonalRepeatScore >= DIAGONAL_REPEAT_FAIL_SCORE &&
      statsA.brightFraction > REPEAT_MIN_BRIGHT_FRACTION &&
      statsB.brightFraction > REPEAT_MIN_BRIGHT_FRACTION;
    if (bothVeryBright || bothPeriodic) {
      return {
        verdict: 'fail',
        reason: 'watermark-overlay',
        detail:
          `Probe tiles contain ${Math.round(statsA.brightFraction * 100)}% / ` +
          `${Math.round(statsB.brightFraction * 100)}% bright pixels ` +
          `(diagonal repeat ${statsA.diagonalRepeatScore.toFixed(2)} / ` +
          `${statsB.diagonalRepeatScore.toFixed(2)}) — consistent with an ` +
          '"API KEY REQUIRED"-style watermark stamped over an otherwise dark basemap.',
      };
    }
  }
  return {
    verdict: 'pass',
    reason: 'ok',
    detail: 'Probe tiles show distinct, detailed geographic content.',
  };
}
