/**
 * Golden Output Snapshots (6A)
 *
 * Transpiles each example and verifies the output file count and
 * manifest hash stability. Catches unintended output changes.
 *
 * Update golden values: SNAPSHOT_UPDATE=1 npx vitest run tests/snapshots.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';

const SNAPSHOT_DIR = 'tests/__snapshots__';
const SNAPSHOT_FILE = join(SNAPSHOT_DIR, 'golden.json');

function hashFiles(files: Array<{ path: string; content: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of files) {
    // Exclude timestamp-dependent files from hash
    if (f.path === '_airengine_manifest.json') continue;
    result[f.path] = createHash('sha256').update(f.content).digest('hex').slice(0, 16);
  }
  return result;
}

interface GoldenData {
  [example: string]: {
    fileCount: number;
    hashes: Record<string, string>;
  };
}

function loadGolden(): GoldenData | null {
  if (!existsSync(SNAPSHOT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveGolden(data: GoldenData): void {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(data, null, 2) + '\n');
}

const EXAMPLES = ['todo', 'expense-tracker', 'auth', 'dashboard', 'landing', 'fullstack-todo', 'projectflow', 'helpdesk'];

describe('Golden output snapshots', () => {
  const currentData: GoldenData = {};

  for (const name of EXAMPLES) {
    it(`${name}.air transpiles to stable output`, () => {
      const source = readFileSync(`examples/${name}.air`, 'utf-8');
      const ast = parse(source);
      const result = transpile(ast);
      const hashes = hashFiles(result.files);

      currentData[name] = { fileCount: result.files.length, hashes };

      if (process.env.SNAPSHOT_UPDATE) {
        // In update mode, just record the new values
        return;
      }

      const golden = loadGolden();
      if (!golden || !golden[name]) {
        // No golden data yet — save it
        saveGolden({ ...golden, ...currentData });
        return;
      }

      // Verify file count matches
      expect(result.files.length).toBe(golden[name].fileCount);

      // Verify file hashes match (catches content drift)
      for (const [path, hash] of Object.entries(golden[name].hashes)) {
        if (hashes[path] !== hash) {
          expect.fail(`${name}/${path}: hash changed from ${hash} to ${hashes[path]}`);
        }
      }
    });
  }

  // After all examples, save if in update mode
  if (process.env.SNAPSHOT_UPDATE) {
    it('saves updated golden data', () => {
      saveGolden(currentData);
    });
  }
});

describe('Codegen manifest (6B)', () => {
  it('every transpile output includes _airengine_manifest.json', () => {
    for (const name of EXAMPLES) {
      const source = readFileSync(`examples/${name}.air`, 'utf-8');
      const ast = parse(source);
      const result = transpile(ast);
      const manifest = result.files.find(f => f.path === '_airengine_manifest.json');
      expect(manifest, `${name} missing manifest`).toBeDefined();
    }
  });

  it('manifest has correct structure', () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const ast = parse(source);
    const result = transpile(ast);
    const manifest = JSON.parse(result.files.find(f => f.path === '_airengine_manifest.json')!.content);

    expect(manifest.generatedBy).toBe('AirEngine');
    expect(manifest.version).toBe('0.1.7');
    expect(manifest.sourceHash).toHaveLength(16);
    expect(manifest.files).toBeInstanceOf(Array);
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.timestamp).toBeTruthy();

    // Each file entry has path, hash, lines
    for (const f of manifest.files) {
      expect(f.path).toBeTruthy();
      expect(f.hash).toHaveLength(16);
      expect(f.lines).toBeGreaterThan(0);
    }
  });

  it('manifest file list matches actual output (minus manifest itself)', () => {
    const source = readFileSync('examples/fullstack-todo.air', 'utf-8');
    const ast = parse(source);
    const result = transpile(ast);
    const manifest = JSON.parse(result.files.find(f => f.path === '_airengine_manifest.json')!.content);

    const manifestPaths = new Set(manifest.files.map((f: any) => f.path));
    const actualPaths = new Set(result.files.map(f => f.path).filter(p => p !== '_airengine_manifest.json'));

    expect(manifestPaths).toEqual(actualPaths);
  });
});
