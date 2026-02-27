/**
 * SH9 Visual Diff — Minimal pixel-comparison utility
 *
 * Compares two PNG screenshots by raw RGBA pixel comparison.
 * Pure Node.js — no external image library dependencies.
 *
 * Limitations:
 *   - Only works with same-dimension images
 *   - Simple pixel-level comparison (no perceptual hashing)
 *   - Sufficient for V1 regression detection
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { inflateSync } from 'zlib';

// ---- Types ----

export interface VisualDiffResult {
  match: boolean;
  diffScore: number;
  diffImagePath: string | null;
  baselineExists: boolean;
  dimensionMatch: boolean;
  details: string;
}

// ---- PNG Parsing (minimal, headeronly for dimensions) ----

interface PNGInfo {
  width: number;
  height: number;
  data: Buffer;
}

/**
 * Parse PNG and extract decoded RGBA pixel data.
 * Uses Node's built-in zlib to decompress IDAT chunks, then removes
 * PNG filter bytes to produce raw RGBA pixel buffer.
 */
function decodePNG(filePath: string): { width: number; height: number; pixels: Buffer } | null {
  if (!existsSync(filePath)) return null;

  const buffer = readFileSync(filePath);

  // PNG signature check
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(pngSignature)) {
    return null;
  }

  // IHDR chunk: width at offset 16, height at offset 20
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];

  // Only support 8-bit RGBA (colorType 6) and 8-bit RGB (colorType 2)
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    // Fallback: return null, caller will use raw buffer comparison
    return null;
  }

  const channels = colorType === 6 ? 4 : 3;

  // Collect all IDAT chunk data
  const idatChunks: Buffer[] = [];
  let offset = 8; // skip signature
  while (offset < buffer.length - 4) {
    const chunkLen = buffer.readUInt32BE(offset);
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (chunkType === 'IDAT') {
      idatChunks.push(buffer.subarray(offset + 8, offset + 8 + chunkLen));
    }
    offset += 12 + chunkLen; // length(4) + type(4) + data + crc(4)
  }

  if (idatChunks.length === 0) return null;

  // Decompress
  const compressed = Buffer.concat(idatChunks);
  let decompressed: Buffer;
  try {
    decompressed = inflateSync(compressed);
  } catch {
    return null;
  }

  // Remove PNG filter bytes (first byte of each scanline)
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4); // always output RGBA
  let srcOffset = 0;
  let prevRow = Buffer.alloc(stride); // reconstructed row from previous scanline

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[srcOffset++];
    const scanline = decompressed.subarray(srcOffset, srcOffset + stride);
    srcOffset += stride;

    // Apply filter reconstruction (None=0, Sub=1, Up=2, Average=3, Paeth=4)
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      let raw = scanline[x];
      if (filterType === 1) { // Sub
        raw = (raw + (x >= channels ? row[x - channels] : 0)) & 0xff;
      } else if (filterType === 2) { // Up
        raw = (raw + prevRow[x]) & 0xff;
      } else if (filterType === 3) { // Average
        const left = x >= channels ? row[x - channels] : 0;
        raw = (raw + Math.floor((left + prevRow[x]) / 2)) & 0xff;
      } else if (filterType === 4) { // Paeth
        const a = x >= channels ? row[x - channels] : 0;
        const b = prevRow[x];
        const c = x >= channels ? prevRow[x - channels] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        raw = (raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      // filterType 0 (None): raw stays as is
      row[x] = raw;
    }
    // Save reconstructed row for next scanline's Up/Average/Paeth
    row.copy(prevRow);

    // Copy to RGBA output
    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;
      pixels[dstIdx] = row[x * channels];
      pixels[dstIdx + 1] = row[x * channels + 1];
      pixels[dstIdx + 2] = row[x * channels + 2];
      pixels[dstIdx + 3] = channels === 4 ? row[x * channels + 3] : 255;
    }
  }

  return { width, height, pixels };
}

/**
 * Fallback: read raw PNG buffer for dimension check + byte comparison.
 */
function readPNGBuffer(filePath: string): { buffer: Buffer; width: number; height: number } | null {
  if (!existsSync(filePath)) return null;

  const buffer = readFileSync(filePath);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(pngSignature)) {
    return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { buffer, width, height };
}

// ---- Comparison ----

/**
 * Compare two screenshot files.
 *
 * @param baselinePath - Path to baseline PNG
 * @param actualPath - Path to actual PNG (just captured)
 * @param threshold - Max acceptable diff score (0.0 - 1.0, default 0.01 = 1%)
 * @param diffOutputDir - Directory for diff artifacts
 * @returns VisualDiffResult
 */
export function compareScreenshots(
  baselinePath: string,
  actualPath: string,
  threshold: number = 0.01,
  diffOutputDir: string = 'qa-artifacts',
): VisualDiffResult {
  // Check baseline exists
  if (!existsSync(baselinePath)) {
    return {
      match: false,
      diffScore: 1.0,
      diffImagePath: null,
      baselineExists: false,
      dimensionMatch: false,
      details: `Baseline not found: ${baselinePath}`,
    };
  }

  // Check actual exists
  if (!existsSync(actualPath)) {
    return {
      match: false,
      diffScore: 1.0,
      diffImagePath: null,
      baselineExists: true,
      dimensionMatch: false,
      details: `Actual screenshot not found: ${actualPath}`,
    };
  }

  // Try decoded pixel comparison first, fall back to raw bytes
  const baselineDecoded = decodePNG(baselinePath);
  const actualDecoded = decodePNG(actualPath);

  // Fallback to raw buffer for dimension check if decoding failed
  const baselineRaw = readPNGBuffer(baselinePath);
  const actualRaw = readPNGBuffer(actualPath);

  if (!baselineRaw || !actualRaw) {
    return {
      match: false,
      diffScore: 1.0,
      diffImagePath: null,
      baselineExists: !!baselineRaw,
      dimensionMatch: false,
      details: 'Failed to read one or both PNG files',
    };
  }

  // Dimension check
  if (baselineRaw.width !== actualRaw.width || baselineRaw.height !== actualRaw.height) {
    return {
      match: false,
      diffScore: 1.0,
      diffImagePath: null,
      baselineExists: true,
      dimensionMatch: false,
      details: `Dimension mismatch: baseline ${baselineRaw.width}x${baselineRaw.height} vs actual ${actualRaw.width}x${actualRaw.height}`,
    };
  }

  let diffScore: number;

  if (baselineDecoded && actualDecoded) {
    // Pixel-level comparison: compare RGBA values per pixel
    const totalPixels = baselineDecoded.width * baselineDecoded.height;
    let differentPixels = 0;

    for (let i = 0; i < totalPixels; i++) {
      const offset = i * 4;
      const rDiff = Math.abs(baselineDecoded.pixels[offset] - actualDecoded.pixels[offset]);
      const gDiff = Math.abs(baselineDecoded.pixels[offset + 1] - actualDecoded.pixels[offset + 1]);
      const bDiff = Math.abs(baselineDecoded.pixels[offset + 2] - actualDecoded.pixels[offset + 2]);
      const aDiff = Math.abs(baselineDecoded.pixels[offset + 3] - actualDecoded.pixels[offset + 3]);

      // A pixel is "different" if any channel differs by more than 2 (anti-aliasing tolerance)
      if (rDiff > 2 || gDiff > 2 || bDiff > 2 || aDiff > 2) {
        differentPixels++;
      }
    }

    diffScore = totalPixels > 0 ? differentPixels / totalPixels : 0;
  } else {
    // Fallback: raw byte comparison (compressed data — less accurate)
    const baselineBytes = baselineRaw.buffer;
    const actualBytes = actualRaw.buffer;
    const minLen = Math.min(baselineBytes.length, actualBytes.length);
    const maxLen = Math.max(baselineBytes.length, actualBytes.length);

    let differentBytes = 0;
    for (let i = 0; i < minLen; i++) {
      if (baselineBytes[i] !== actualBytes[i]) {
        differentBytes++;
      }
    }
    differentBytes += maxLen - minLen;
    diffScore = maxLen > 0 ? differentBytes / maxLen : 0;
  }

  const match = diffScore <= threshold;

  // Save diff info
  let diffImagePath: string | null = null;
  if (!match) {
    mkdirSync(diffOutputDir, { recursive: true });
    const diffInfoPath = join(diffOutputDir, `diff-${Date.now()}.json`);
    writeFileSync(diffInfoPath, JSON.stringify({
      baseline: baselinePath,
      actual: actualPath,
      diffScore,
      threshold,
      match,
      baselineDimensions: { width: baselineRaw.width, height: baselineRaw.height },
      actualDimensions: { width: actualRaw.width, height: actualRaw.height },
      pixelComparison: !!baselineDecoded && !!actualDecoded,
    }, null, 2));
    diffImagePath = diffInfoPath;
  }

  return {
    match,
    diffScore: Math.round(diffScore * 10000) / 10000,
    diffImagePath,
    baselineExists: true,
    dimensionMatch: true,
    details: match
      ? `Visual match (diff: ${(diffScore * 100).toFixed(2)}%, threshold: ${(threshold * 100).toFixed(2)}%)`
      : `Visual diff exceeds threshold: ${(diffScore * 100).toFixed(2)}% > ${(threshold * 100).toFixed(2)}%`,
  };
}

/**
 * Check if a baseline exists for a given name.
 */
export function hasBaseline(baselineName: string, baselineDir: string = 'qa-baselines'): boolean {
  return existsSync(join(baselineDir, `${baselineName}.png`));
}

/**
 * Get baseline path for a name.
 */
export function getBaselinePath(baselineName: string, baselineDir: string = 'qa-baselines'): string {
  return join(baselineDir, `${baselineName}.png`);
}
