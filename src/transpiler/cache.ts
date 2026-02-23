/**
 * Incremental Transpilation Cache
 *
 * Computes file-level diffs between transpile runs to skip unchanged files.
 * Uses SHA-256 (Node built-in crypto) for content hashing.
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import type { OutputFile } from './index.js';

// ---- Hashing ----

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ---- Manifest ----

export interface CacheManifest {
  version: 1;
  sourceHash: string;
  files: Record<string, string>; // path → content hash
  timestamp: number;
}

const MANIFEST_DIR = '.air-cache';
const MANIFEST_FILE = 'manifest.json';

export function loadManifest(outDir: string): CacheManifest | null {
  const manifestPath = join(outDir, MANIFEST_DIR, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(raw);
    if (data.version !== 1) return null;
    return data as CacheManifest;
  } catch {
    return null;
  }
}

export function saveManifest(outDir: string, manifest: CacheManifest): void {
  const dir = join(outDir, MANIFEST_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
}

// ---- Incremental Diff ----

export interface IncrementalResult {
  changedFiles: OutputFile[];
  removedPaths: string[];
  skipped: number;
}

export function computeIncremental(
  source: string,
  files: OutputFile[],
  outDir: string,
): IncrementalResult {
  const sourceHash = hashContent(source);
  const prev = loadManifest(outDir);

  // Build new manifest (exclude _airengine_manifest.json — its timestamp changes every run)
  const newFileHashes: Record<string, string> = {};
  for (const f of files) {
    if (f.path === '_airengine_manifest.json') continue;
    newFileHashes[f.path] = hashContent(f.content);
  }

  // No previous manifest → everything is new, save baseline for next run
  if (!prev) {
    saveManifest(outDir, { version: 1, sourceHash, files: newFileHashes, timestamp: Date.now() });
    return {
      changedFiles: files,
      removedPaths: [],
      skipped: 0,
    };
  }

  // Compare individual files against previous hashes
  const changedFiles: OutputFile[] = [];
  let skipped = 0;

  for (const f of files) {
    // Manifest always gets rewritten (timestamp changes every run)
    if (f.path === '_airengine_manifest.json') {
      changedFiles.push(f);
      continue;
    }
    const prevHash = prev.files[f.path];
    const newHash = newFileHashes[f.path];
    if (prevHash === newHash) {
      skipped++;
    } else {
      changedFiles.push(f);
    }
  }

  // Files that were in the previous build but not in the new one
  const newPaths = new Set(files.map(f => f.path));
  const removedPaths = Object.keys(prev.files).filter(p => !newPaths.has(p));

  // Save updated manifest
  const manifest: CacheManifest = {
    version: 1,
    sourceHash,
    files: newFileHashes,
    timestamp: Date.now(),
  };
  saveManifest(outDir, manifest);

  return { changedFiles, removedPaths, skipped };
}
