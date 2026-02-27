/**
 * SH9 Visual Diff Tests
 *
 * Tests for PNG comparison utility used by visual_snapshot steps.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { compareScreenshots, hasBaseline, getBaselinePath } from '../scripts/visual-diff.js';

const TEST_DIR = join('artifacts', 'test-visual-diff');

function ensureDir() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

/**
 * Create a minimal valid PNG file (1x1 pixel, RGBA).
 * PNG format: signature + IHDR + IDAT + IEND.
 */
function createMinimalPNG(r: number, g: number, b: number, a: number = 255): Buffer {
  const { deflateSync } = require('zlib');

  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: 1x1, 8-bit RGBA
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);  // width
  ihdrData.writeUInt32BE(1, 4);  // height
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT: filter byte (0=None) + RGBA pixel
  const rawScanline = Buffer.from([0, r, g, b, a]);
  const compressed = deflateSync(rawScanline);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const { createHash } = require('crypto');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeBuffer, data]);
  // CRC32 — use a simple implementation
  const crc = crc32(combined);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// Simple CRC32
function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return crc ^ 0xFFFFFFFF;
}

describe('compareScreenshots', () => {
  it('returns match for identical PNGs', () => {
    ensureDir();
    const png = createMinimalPNG(255, 0, 0);
    const baselinePath = join(TEST_DIR, 'baseline-same.png');
    const actualPath = join(TEST_DIR, 'actual-same.png');
    writeFileSync(baselinePath, png);
    writeFileSync(actualPath, png);

    const result = compareScreenshots(baselinePath, actualPath, 0.01, TEST_DIR);
    expect(result.match).toBe(true);
    expect(result.diffScore).toBe(0);
    expect(result.baselineExists).toBe(true);
    expect(result.dimensionMatch).toBe(true);
    cleanDir();
  });

  it('returns mismatch for different PNGs', () => {
    ensureDir();
    const baseline = createMinimalPNG(255, 0, 0);
    const actual = createMinimalPNG(0, 255, 0);
    const baselinePath = join(TEST_DIR, 'baseline-diff.png');
    const actualPath = join(TEST_DIR, 'actual-diff.png');
    writeFileSync(baselinePath, baseline);
    writeFileSync(actualPath, actual);

    const result = compareScreenshots(baselinePath, actualPath, 0.01, TEST_DIR);
    expect(result.match).toBe(false);
    expect(result.diffScore).toBeGreaterThan(0);
    expect(result.baselineExists).toBe(true);
    expect(result.dimensionMatch).toBe(true);
    cleanDir();
  });

  it('returns baselineExists=false when no baseline', () => {
    ensureDir();
    const actualPath = join(TEST_DIR, 'actual-no-base.png');
    writeFileSync(actualPath, createMinimalPNG(255, 0, 0));

    const result = compareScreenshots(join(TEST_DIR, 'nonexistent.png'), actualPath);
    expect(result.match).toBe(false);
    expect(result.baselineExists).toBe(false);
    expect(result.diffScore).toBe(1.0);
    cleanDir();
  });

  it('handles non-PNG files gracefully', () => {
    ensureDir();
    const fakePath = join(TEST_DIR, 'fake.png');
    writeFileSync(fakePath, 'not a PNG');
    const actual = join(TEST_DIR, 'actual-fake.png');
    writeFileSync(actual, createMinimalPNG(255, 0, 0));

    const result = compareScreenshots(fakePath, actual);
    expect(result.match).toBe(false);
    expect(result.details).toContain('Failed to read');
    cleanDir();
  });
});

describe('hasBaseline', () => {
  it('returns false when baseline does not exist', () => {
    expect(hasBaseline('nonexistent-snapshot', TEST_DIR)).toBe(false);
  });

  it('returns true when baseline exists', () => {
    ensureDir();
    writeFileSync(join(TEST_DIR, 'existing.png'), createMinimalPNG(0, 0, 0));
    expect(hasBaseline('existing', TEST_DIR)).toBe(true);
    cleanDir();
  });
});

describe('getBaselinePath', () => {
  it('returns correct path', () => {
    const path = getBaselinePath('my-snapshot', 'baselines');
    expect(path).toBe(join('baselines', 'my-snapshot.png'));
  });
});
