#!/usr/bin/env bun
/**
 * Kairos — the signature artwork.
 *
 *   bun run apps/web/scripts/build-mosaic.ts
 *
 * Renders `public/fold-mosaic.png`: a dawn horizon composed entirely of
 * tesserae, where the nearest tiles carry hex pairs.
 *
 * WHY THIS IMAGE AND NOT ANOTHER. A mosaic is many small units that only
 * resolve into meaning at a distance — up close, no single tile tells you
 * anything. That is exactly what the vault does with money: an individual
 * settlement is unreadable, the epoch aggregate is the only number anyone can
 * decrypt. The medium is the argument, so the foreground tiles are literally
 * ciphertext and the whole is literally a legible scene.
 *
 * The tile grid coarsens toward the bottom of the frame. That does two jobs at
 * once: it reads as depth (near things are bigger), and it means the hex only
 * becomes legible in the band closest to the viewer — you have to come close to
 * find out the picture is made of ciphertext.
 *
 * Everything here is deterministic from SEED, and the output is committed, so
 * the page ships a static asset. Nothing about the fold depends on this script
 * running, on JavaScript, or on a canvas API at view time.
 *
 * No image libraries: the scene is a colour field sampled per tile, the glyphs
 * are a hand-built 3x5 bitmap font, and the PNG is encoded here from scratch.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public");

// Authored at the aspect the plate actually shows. The fold is a wide, short
// band, so a 4:3-ish source would be cropped hard enough to lose both the dark
// sky that anchors the top edge and the hex band along the bottom.
const W = 2560;
const H = 880;
const SEED = 0x4b41_1205; // "KA" + 1205. Change this and the mosaic re-cuts.

// --- deterministic noise ---------------------------------------------------

/** mulberry32 — small, fast, and identical on every machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(SEED);

// --- colour ----------------------------------------------------------------

type RGB = [number, number, number];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/** Sample a multi-stop ramp at t in 0..1. */
function ramp(stops: [number, RGB][], t: number): RGB {
  if (t <= stops[0]![0]) return stops[0]![1];
  const last = stops[stops.length - 1]!;
  if (t >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [p0, c0] = stops[i]!;
    const [p1, c1] = stops[i + 1]!;
    if (t >= p0 && t <= p1) return mix(c0, c1, (t - p0) / (p1 - p0));
  }
  return last[1];
}

// The palette. Amber against deep teal, resolved through a warm neutral rather
// than straight through grey — the transition band is what stops two saturated
// hues from colliding.
// The cool-to-warm crossing is the hard part of a dawn sky. Routed through a
// warm mauve rather than a neutral: passing teal straight into amber via grey
// produces a dead grey-green haze across the whole upper third.
const SKY: [number, RGB][] = [
  [0.0, [19, 45, 58]],
  [0.30, [40, 82, 94]],
  [0.50, [104, 88, 96]],
  [0.66, [158, 100, 76]],
  [0.80, [198, 134, 72]],
  [0.91, [226, 174, 104]],
  [1.0, [245, 219, 173]],
];

const SEA: [number, RGB][] = [
  [0.0, [26, 96, 104]],
  [0.35, [15, 74, 82]],
  [0.72, [11, 52, 60]],
  [1.0, [8, 36, 43]],
];

const SUN_CORE: RGB = [255, 243, 219];
const GLITTER: RGB = [236, 184, 104];
const GLITTER_HOT: RGB = [252, 230, 188];

const HORIZON = 0.56;
const SUN_X = 0.36;
const SUN_Y = 0.487;
const SUN_R = 0.052;

/** Cheap banded value noise — enough for cloud drift and wave chop. */
function band(x: number, y: number, fx: number, fy: number, warp: number): number {
  return Math.sin(y * fy + Math.sin(x * fx) * warp);
}

/**
 * The scene, as a continuous colour field. Sampled once per tile, never per
 * pixel, so the tessellation is what the eye actually receives.
 */
function scene(px: number, py: number): RGB {
  const x = px / W;
  const y = py / H;
  const hy = HORIZON;

  // Distance to the sun, corrected for aspect so the disc stays round.
  const aspect = W / H;
  const dx = (x - SUN_X) * aspect;
  const dy = y - SUN_Y;
  const d = Math.sqrt(dx * dx + dy * dy);

  let c: RGB;

  if (y < hy) {
    const t = y / hy;
    c = ramp(SKY, t);

    // Cloud banding: two octaves, strongest in the mid sky, gone by the horizon
    // so nothing competes with the light at the skyline.
    const cloud =
      band(px, py, 0.0031, 0.0119, 2.1) * 0.6 + band(px, py, 0.0072, 0.0263, 1.4) * 0.4;
    const cloudMask = Math.max(0, Math.sin(t * Math.PI) - 0.15) * (1 - t * 0.6);
    const lift = cloud * cloudMask * 13;
    c = [c[0] + lift, c[1] + lift * 0.92, c[2] + lift * 0.78];
  } else {
    const s = (y - hy) / (1 - hy);
    c = ramp(SEA, s);

    // The sun path: a column of broken light that widens as it nears the
    // viewer, chopped into wave rows so it reads as water and not a beam.
    const colWidth = SUN_R * 1.6 + s * 0.26;
    const across = Math.abs(x - SUN_X) / colWidth;
    const path = Math.max(0, 1 - Math.pow(across, 1.55));

    const chop = band(px, py, 0.021, 0.33 + s * 0.5, 1.7);
    const spark = Math.pow(Math.max(0, chop), 3);

    const g = path * (0.28 + 0.72 * spark) * (1 - s * 0.25);
    c = mix(c, GLITTER, Math.min(1, g * 1.15));
    c = mix(c, GLITTER_HOT, Math.min(1, Math.max(0, g - 0.62) * 1.5));

    // Faint swell across the whole sea, so water outside the path still moves.
    const swell = band(px, py, 0.009, 0.16 + s * 0.22, 1.1) * (5 - s * 2);
    c = [c[0] + swell, c[1] + swell, c[2] + swell * 0.9];
  }

  // Sun glow, applied over both sky and its own reflection near the horizon.
  const glow = Math.exp(-Math.pow(d / (SUN_R * 4.2), 2));
  c = mix(c, SUN_CORE, Math.min(0.92, glow * 0.86));
  if (d < SUN_R) {
    const core = 1 - Math.pow(d / SUN_R, 2.2);
    c = mix(c, SUN_CORE, core);
  }

  // Corner falloff. Directional — heavier at the top, because the light source
  // sits low. Not a symmetric vignette ring.
  const edge = Math.pow(Math.abs(x - 0.5) * 2, 2.4) * 0.09 + Math.pow(1 - y, 3) * 0.07;
  c = [c[0] * (1 - edge), c[1] * (1 - edge), c[2] * (1 - edge)];

  return c;
}

// --- the 3x5 glyph set -----------------------------------------------------
// Hand-built, because the tesserae ARE the pixels: a rasterised typeface at
// this size would fight the grid instead of sitting on it.

const GLYPHS: Record<string, number[]> = {
  "0": [0b111, 0b101, 0b101, 0b101, 0b111],
  "1": [0b010, 0b110, 0b010, 0b010, 0b111],
  "2": [0b111, 0b001, 0b111, 0b100, 0b111],
  "3": [0b111, 0b001, 0b111, 0b001, 0b111],
  "4": [0b101, 0b101, 0b111, 0b001, 0b001],
  "5": [0b111, 0b100, 0b111, 0b001, 0b111],
  "6": [0b111, 0b100, 0b111, 0b101, 0b111],
  "7": [0b111, 0b001, 0b001, 0b010, 0b010],
  "8": [0b111, 0b101, 0b111, 0b101, 0b111],
  "9": [0b111, 0b101, 0b111, 0b001, 0b111],
  a: [0b111, 0b101, 0b111, 0b101, 0b101],
  b: [0b110, 0b101, 0b110, 0b101, 0b110],
  c: [0b111, 0b100, 0b100, 0b100, 0b111],
  d: [0b110, 0b101, 0b101, 0b101, 0b110],
  e: [0b111, 0b100, 0b111, 0b100, 0b111],
  f: [0b111, 0b100, 0b111, 0b100, 0b100],
};

const HEX = "0123456789abcdef";

// --- raster ----------------------------------------------------------------

const buf = new Uint8Array(W * H * 3);

/** Grout: the surface the tiles are set into. Warm, dark, never black. */
const GROUT: RGB = [14, 26, 32];
for (let i = 0; i < W * H; i += 1) {
  buf[i * 3] = GROUT[0];
  buf[i * 3 + 1] = GROUT[1];
  buf[i * 3 + 2] = GROUT[2];
}

function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = clamp(c[0]);
  buf[i + 1] = clamp(c[1]);
  buf[i + 2] = clamp(c[2]);
}

function fill(x0: number, y0: number, w: number, h: number, c: RGB): void {
  const r = clamp(c[0]);
  const g = clamp(c[1]);
  const b = clamp(c[2]);
  for (let y = y0; y < y0 + h; y += 1) {
    if (y < 0 || y >= H) continue;
    let i = (y * W + Math.max(0, x0)) * 3;
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x += 1) {
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      i += 3;
    }
  }
}

/**
 * Tile height at a given depth. Fine at the skyline, coarse in the near water,
 * so the grid itself carries the perspective.
 */
function tileSizeAt(y: number): number {
  const t = y / H;
  return Math.round(5 + 19 * Math.pow(t, 2.6));
}

/** Tiles large enough to hold two legible glyphs earn a hex pair. */
const MIN_HEX_TILE = 15;

function drawGlyphPair(
  x0: number,
  y0: number,
  tw: number,
  th: number,
  tile: RGB,
  r: () => number,
): void {
  const scale = Math.min(Math.floor((th - 4) / 5), Math.floor((tw - 5) / 7));
  if (scale < 1) return;

  const gw = 7 * scale;
  const gh = 5 * scale;
  const ox = x0 + Math.round((tw - gw) / 2);
  const oy = y0 + Math.round((th - gh) / 2);

  // Ink is the tile's own colour pushed away from itself, so the hex is
  // discoverable up close and invisible at reading distance. It never
  // introduces a new hue.
  const lum = (tile[0] * 299 + tile[1] * 587 + tile[2] * 114) / 1000;
  const dir = lum > 132 ? -1 : 1;
  const amt = 30 + r() * 16;
  const ink: RGB = [tile[0] + dir * amt, tile[1] + dir * amt * 0.94, tile[2] + dir * amt * 0.8];

  const chars = [HEX[Math.floor(r() * 16)]!, HEX[Math.floor(r() * 16)]!];
  for (let ci = 0; ci < 2; ci += 1) {
    const rows = GLYPHS[chars[ci]!]!;
    const cx = ox + ci * 4 * scale;
    for (let ry = 0; ry < 5; ry += 1) {
      const bits = rows[ry]!;
      for (let rx = 0; rx < 3; rx += 1) {
        if (!(bits & (1 << (2 - rx)))) continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            px(cx + rx * scale + sx, oy + ry * scale + sy, ink);
          }
        }
      }
    }
  }
}

let tiles = 0;
let hexTiles = 0;
let sumR = 0;
let sumG = 0;
let sumB = 0;

for (let y = 0; y < H; ) {
  const th = tileSizeAt(y);
  // Rows drift horizontally so the grid never reads as graph paper.
  const rowShift = Math.floor(rand() * th);

  for (let x = -rowShift; x < W; ) {
    // Tiles are near-square with a little variation in width, the way cut
    // tesserae actually are.
    const tw = Math.max(3, th + Math.round((rand() - 0.5) * th * 0.35));

    const c = scene(Math.min(W - 1, x + tw / 2), Math.min(H - 1, y + th / 2));

    // Per-tile variation. Value jitter carries most of it; a small warm/cool
    // push keeps the field from looking like flat posterisation.
    const v = (rand() - 0.5) * 17;
    const warm = (rand() - 0.5) * 7;
    const tile: RGB = [c[0] + v + warm, c[1] + v, c[2] + v - warm * 0.8];

    // 1px inset on the right and bottom leaves the grout showing.
    const iw = Math.max(1, tw - 1);
    const ih = Math.max(1, th - 1);
    fill(x, y, iw, ih, tile);

    if (th >= MIN_HEX_TILE && rand() < 0.82) {
      drawGlyphPair(x, y, iw, ih, tile, rand);
      hexTiles += 1;
    }

    sumR += tile[0];
    sumG += tile[1];
    sumB += tile[2];
    tiles += 1;
    x += tw;
  }
  y += th;
}

// --- PNG encoding ----------------------------------------------------------
// Written out here rather than pulled in: an 8-bit truecolour PNG is a header,
// one deflate stream of filtered scanlines, and a trailer.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const forCrc = out.subarray(4, 8 + data.length);
  dv.setUint32(8 + data.length, crc32(forCrc));
  return out;
}

// Filter byte 0 (None) per scanline. The image is flat-filled rectangles, which
// deflate handles well without per-row prediction.
const raw = new Uint8Array(H * (1 + W * 3));
for (let y = 0; y < H; y += 1) {
  const o = y * (1 + W * 3);
  raw[o] = 0;
  raw.set(buf.subarray(y * W * 3, (y + 1) * W * 3), o + 1);
}

const ihdr = new Uint8Array(13);
const iv = new DataView(ihdr.buffer);
iv.setUint32(0, W);
iv.setUint32(4, H);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(chunk("IHDR", ihdr)),
  Buffer.from(chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 })))),
  Buffer.from(chunk("IEND", new Uint8Array(0))),
]);

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, "fold-mosaic.png");
writeFileSync(outPath, png);

const avg: RGB = [sumR / tiles, sumG / tiles, sumB / tiles];
const hex = (n: number) => Math.round(clamp(n)).toString(16).padStart(2, "0");

console.log(`wrote ${outPath}`);
console.log(`  ${W}x${H} · ${(png.length / 1024).toFixed(0)} KB`);
console.log(`  ${tiles.toLocaleString()} tesserae · ${hexTiles.toLocaleString()} carry hex`);
console.log(`  mean tone #${hex(avg[0])}${hex(avg[1])}${hex(avg[2])}  <- fold fallback colour`);
