/**
 * Node test for the tile-probe heuristics (lib/tileProbe.js).
 *
 * The probe exists because a provider can return HTTP 200 with an
 * "API KEY REQUIRED" watermark image instead of real tiles (keyless CARTO
 * since Aug 2026). These tests feed synthetic RGBA tiles through the same
 * pure functions the browser probe uses and assert the verdicts:
 *
 *   run:  npm run test:probe   (or: node scripts/test-tile-probe.mjs)
 */
import { readFileSync } from 'node:fs';

// lib/tileProbe.js is ESM, but the app package has no "type": "module"
// (Next.js compiles it directly). Load the exact source as an ESM data-URL
// module so this test exercises the shipped code without touching package.json.
const probeSource = readFileSync(new URL('../lib/tileProbe.js', import.meta.url), 'utf8');
const { classifyProbeResult, computeTileStats, tilesIdentical } = await import(
  `data:text/javascript;base64,${Buffer.from(probeSource).toString('base64')}`
);

const SIZE = 64; // 64x64 keeps tests fast; heuristics are size-independent.

function makeTile(paint) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b] = paint(x, y);
      const o = (y * SIZE + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return data;
}

// Deterministic PRNG so "geography" differs per tile but is reproducible.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Dark basemap with varied "geography": landmass, roads, sparse labels. */
function makeRealisticDarkTile(seed) {
  const rand = prng(seed);
  const blobs = Array.from({ length: 24 }, () => ({
    x: Math.floor(rand() * SIZE),
    y: Math.floor(rand() * SIZE),
    r: 3 + rand() * 10,
    // Channels stay below the bright-luma cutoff (160) so a realistic dark
    // basemap never trips the watermark-overlay check.
    c: [40 + rand() * 100, 50 + rand() * 90, 60 + rand() * 80],
  }));
  return makeTile((x, y) => {
    let [r, g, b] = [24, 27, 31]; // dark background
    for (const blob of blobs) {
      const dx = x - blob.x;
      const dy = y - blob.y;
      if (dx * dx + dy * dy < blob.r * blob.r) [r, g, b] = blob.c;
    }
    if ((x + 2 * y) % 37 === 0) [r, g, b] = [120, 110, 90]; // thin "roads"
    if (x % 23 === 0 && y % 19 === 0) [r, g, b] = [225, 225, 225]; // sparse labels
    return [r, g, b];
  });
}

/** Light basemap (OSM-like): mostly bright — must NOT trip the dark check. */
function makeBrightTile(seed) {
  const rand = prng(seed);
  return makeTile((x, y) => {
    const n = rand() * 25;
    return [235 - n, 232 - n, 222 - n];
  });
}

/** Generic placeholder: identical image regardless of x/y (flat + "text"). */
function makePlaceholderTile() {
  return makeTile((x, y) => {
    const onText = (x + y) % 16 < 3 && y > 10 && y < 54; // diagonal "API KEY REQUIRED"
    return onText ? [240, 240, 240] : [18, 18, 20];
  });
}

/** Real geography darkened + big white watermark text over BOTH tiles. */
function makeWatermarkedTile(seed) {
  const base = makeRealisticDarkTile(seed);
  return makeTile((x, y) => {
    const onWatermark = ((x + y) % 12 < 4) || ((x - y + SIZE) % 17 < 3); // ~45% coverage
    if (onWatermark) return [245, 245, 245];
    const o = (y * SIZE + x) * 4;
    return [base[o] * 0.6, base[o + 1] * 0.6, base[o + 2] * 0.6];
  });
}

/**
 * THIN diagonal watermark (~3% coverage, 64px period) over real geography —
 * below any sane brightness limit, but perfectly periodic along the diagonal.
 * This mimics a subtle "API KEY REQUIRED" stamp on an invalid/missing key.
 */
function makeThinWatermarkedTile(seed) {
  const base = makeRealisticDarkTile(seed);
  return makeTile((x, y) => {
    if ((x + y) % 64 < 2) return [250, 250, 250];
    const o = (y * SIZE + x) * 4;
    return [base[o] * 0.55, base[o + 1] * 0.55, base[o + 2] * 0.55];
  });
}

/** Broken provider serving flat gray at every coordinate. */
function makeBlankTile() {
  return makeTile(() => [40, 40, 40]);
}

let failures = 0;
function check(name, condition, extra = '') {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

console.log('tileProbe: stats sanity');
const tileA = makeRealisticDarkTile(1);
const tileB = makeRealisticDarkTile(2);
const statsA = computeTileStats(tileA, SIZE, SIZE);
const statsB = computeTileStats(tileB, SIZE, SIZE);
check('distinct colors detected', statsA.uniqueColors >= 15, JSON.stringify(statsA));
check('dark tile has low bright fraction', statsA.brightFraction < 0.05, JSON.stringify(statsA));
check('identical() true for same bytes', tilesIdentical(tileA, tileA));
check('identical() false for different geography', !tilesIdentical(tileA, tileB));

console.log('tileProbe: verdicts');
const pass = classifyProbeResult({ identical: false, statsA, statsB, dark: true });
check('realistic dark tiles PASS', pass.verdict === 'pass', pass.reason);

const placeholder = makePlaceholderTile();
const pStats = computeTileStats(placeholder, SIZE, SIZE);
const identicalResult = classifyProbeResult({
  identical: true,
  statsA: pStats,
  statsB: pStats,
  dark: true,
});
check(
  'pixel-identical distant tiles FAIL as placeholder',
  identicalResult.verdict === 'fail' && identicalResult.reason === 'placeholder-tiles',
  identicalResult.reason,
);

const wmA = makeWatermarkedTile(11);
const wmB = makeWatermarkedTile(12);
const wmResult = classifyProbeResult({
  identical: false,
  statsA: computeTileStats(wmA, SIZE, SIZE),
  statsB: computeTileStats(wmB, SIZE, SIZE),
  dark: true,
});
check(
  'watermark stamped over dark tiles FAILS',
  wmResult.verdict === 'fail' && wmResult.reason === 'watermark-overlay',
  wmResult.reason,
);

check(
  'realistic dark tile has low diagonal periodicity',
  statsA.diagonalRepeatScore < 0.3,
  `score=${statsA.diagonalRepeatScore}`,
);

const thinA = makeThinWatermarkedTile(31);
const thinB = makeThinWatermarkedTile(32);
const thinStatsA = computeTileStats(thinA, SIZE, SIZE);
const thinStatsB = computeTileStats(thinB, SIZE, SIZE);
check(
  'thin watermark: low bright coverage but strong diagonal repeat',
  thinStatsA.brightFraction < 0.05 && thinStatsA.diagonalRepeatScore >= 0.45,
  JSON.stringify({ bright: thinStatsA.brightFraction, repeat: thinStatsA.diagonalRepeatScore }),
);
const thinResult = classifyProbeResult({
  identical: false,
  statsA: thinStatsA,
  statsB: thinStatsB,
  dark: true,
});
check(
  'THIN diagonal watermark FAILS via periodicity',
  thinResult.verdict === 'fail' && thinResult.reason === 'watermark-overlay',
  thinResult.reason,
);

const lightResult = classifyProbeResult({
  identical: false,
  statsA: computeTileStats(makeBrightTile(21), SIZE, SIZE),
  statsB: computeTileStats(makeBrightTile(22), SIZE, SIZE),
  dark: false,
});
check('bright (light-theme) provider PASSES despite high brightness', lightResult.verdict === 'pass', lightResult.reason);

const blank = makeBlankTile();
const blankStats = computeTileStats(blank, SIZE, SIZE);
const blankB = computeTileStats(makeTile(() => [41, 41, 41]), SIZE, SIZE);
const blankResult = classifyProbeResult({ identical: false, statsA: blankStats, statsB: blankB, dark: true });
check('flat blank tiles FAIL as blank', blankResult.verdict === 'fail' && blankResult.reason === 'blank-tiles', blankResult.reason);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll tile-probe tests passed.');
