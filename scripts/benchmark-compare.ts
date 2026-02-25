#!/usr/bin/env npx tsx
/**
 * A4b Benchmark Regression Comparator
 *
 * Compares two benchmark JSON files (from eval-local.ts) and detects regressions.
 *
 * Usage:  node --import tsx scripts/benchmark-compare.ts <previous.json> <current.json> [--threshold 1.5] [--min-abs 5]
 * Output: artifacts/benchmarks/benchmark-compare.json
 * Exit:   0 = no regressions, 1 = regressions detected
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { basename } from 'path';

// ---- Types ----

interface BenchmarkEntry {
  file: string;
  totalMs: number;
  hashStable: boolean;
}

interface BenchmarkFile {
  timestamp: string;
  airengineVersion?: string;
  nodeVersion?: string;
  platform?: string;
  benchmarks: BenchmarkEntry[];
  aggregate: {
    totalMs: number;
    maxMs: number;
    allUnder200ms: boolean;
    cumulativeUnder500ms: boolean;
    allHashStable: boolean;
  };
}

interface FileComparison {
  file: string;
  previous: { totalMs: number; hashStable: boolean };
  current: { totalMs: number; hashStable: boolean };
  deltaMs: number;
  ratio: number;
  isRegression: boolean;
  hashRegression: boolean;
  reason?: string;
}

interface CompareResult {
  timestamp: string;
  previous: { file: string; timestamp: string; version?: string };
  current: { file: string; timestamp: string; version?: string };
  policy: { threshold: number; minAbsMs: number };
  comparisons: FileComparison[];
  newEntries: string[];
  removedEntries: string[];
  aggregateDelta: { previousMs: number; currentMs: number; deltaMs: number; ratio: number };
  budgetFlags: {
    allUnder200ms: { previous: boolean; current: boolean; regression: boolean };
    cumulativeUnder500ms: { previous: boolean; current: boolean; regression: boolean };
    allHashStable: { previous: boolean; current: boolean; regression: boolean };
  };
  verdict: 'pass' | 'fail';
  regressions: string[];
  humanSummary: string;
}

// ---- CLI args ----

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const flagArgs = args.filter(a => a.startsWith('--'));

if (positional.length < 2) {
  console.error('\n  Usage: node --import tsx scripts/benchmark-compare.ts <previous.json> <current.json> [--threshold 1.5] [--min-abs 5]\n');
  process.exit(2);
}

const previousFile = positional[0];
const currentFile = positional[1];

function getFlagValue(name: string, defaultVal: number): number {
  const idx = flagArgs.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) {
    const val = parseFloat(args[args.indexOf(name) + 1]);
    return isNaN(val) ? defaultVal : val;
  }
  return defaultVal;
}

const threshold = getFlagValue('--threshold', 1.5);
const minAbsMs = getFlagValue('--min-abs', 5);

// ---- Helpers ----

function loadBenchmarkFile(path: string): BenchmarkFile {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  // Normalize: handle both direct array and object-with-benchmarks formats
  if (Array.isArray(raw.benchmarks)) {
    return raw as BenchmarkFile;
  }
  throw new Error(`Invalid benchmark file format: ${path} — expected "benchmarks" array`);
}

function isRegression(prev: number, curr: number, thresh: number, minAbs: number): boolean {
  const delta = curr - prev;
  if (delta <= 0) return false;
  if (delta < minAbs) return false;
  const ratio = prev > 0 ? curr / prev : Infinity;
  return ratio >= thresh;
}

// ---- Main ----

function main() {
  console.log('\n  AirEngine Benchmark Comparator (A4b)\n');

  const prev = loadBenchmarkFile(previousFile);
  const curr = loadBenchmarkFile(currentFile);

  const prevMap = new Map(prev.benchmarks.map(b => [b.file, b]));
  const currMap = new Map(curr.benchmarks.map(b => [b.file, b]));

  const allFiles = new Set([...prevMap.keys(), ...currMap.keys()]);
  const comparisons: FileComparison[] = [];
  const regressions: string[] = [];
  const newEntries: string[] = [];
  const removedEntries: string[] = [];

  for (const file of allFiles) {
    const p = prevMap.get(file);
    const c = currMap.get(file);

    if (!p) {
      newEntries.push(file);
      continue;
    }
    if (!c) {
      removedEntries.push(file);
      continue;
    }

    const deltaMs = Math.round((c.totalMs - p.totalMs) * 100) / 100;
    const ratio = p.totalMs > 0 ? Math.round((c.totalMs / p.totalMs) * 100) / 100 : (c.totalMs > 0 ? Infinity : 1);
    const timeRegression = isRegression(p.totalMs, c.totalMs, threshold, minAbsMs);
    const hashRegression = p.hashStable && !c.hashStable;

    const reasons: string[] = [];
    if (timeRegression) reasons.push(`${deltaMs.toFixed(1)}ms slower (${ratio}x)`);
    if (hashRegression) reasons.push('hash became unstable');

    const comp: FileComparison = {
      file,
      previous: { totalMs: p.totalMs, hashStable: p.hashStable },
      current: { totalMs: c.totalMs, hashStable: c.hashStable },
      deltaMs,
      ratio,
      isRegression: timeRegression,
      hashRegression,
      ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    };
    comparisons.push(comp);

    if (timeRegression || hashRegression) {
      regressions.push(`${file}: ${reasons.join('; ')}`);
    }
  }

  // Budget flags
  const budgetFlags = {
    allUnder200ms: {
      previous: prev.aggregate.allUnder200ms,
      current: curr.aggregate.allUnder200ms,
      regression: prev.aggregate.allUnder200ms && !curr.aggregate.allUnder200ms,
    },
    cumulativeUnder500ms: {
      previous: prev.aggregate.cumulativeUnder500ms,
      current: curr.aggregate.cumulativeUnder500ms,
      regression: prev.aggregate.cumulativeUnder500ms && !curr.aggregate.cumulativeUnder500ms,
    },
    allHashStable: {
      previous: prev.aggregate.allHashStable,
      current: curr.aggregate.allHashStable,
      regression: prev.aggregate.allHashStable && !curr.aggregate.allHashStable,
    },
  };

  // Budget flag regressions are gate-blocking
  if (budgetFlags.allUnder200ms.regression) regressions.push('Budget: allUnder200ms went true→false');
  if (budgetFlags.cumulativeUnder500ms.regression) regressions.push('Budget: cumulativeUnder500ms went true→false');
  if (budgetFlags.allHashStable.regression) regressions.push('Budget: allHashStable went true→false');

  const aggregateDelta = {
    previousMs: prev.aggregate.totalMs,
    currentMs: curr.aggregate.totalMs,
    deltaMs: Math.round((curr.aggregate.totalMs - prev.aggregate.totalMs) * 100) / 100,
    ratio: prev.aggregate.totalMs > 0
      ? Math.round((curr.aggregate.totalMs / prev.aggregate.totalMs) * 100) / 100
      : 1,
  };

  const verdict = regressions.length === 0 ? 'pass' : 'fail';

  // Human summary
  const summaryParts: string[] = [];
  summaryParts.push(`Compared ${comparisons.length} files`);
  if (newEntries.length > 0) summaryParts.push(`${newEntries.length} new`);
  if (removedEntries.length > 0) summaryParts.push(`${removedEntries.length} removed`);
  summaryParts.push(`aggregate delta: ${aggregateDelta.deltaMs >= 0 ? '+' : ''}${aggregateDelta.deltaMs}ms (${aggregateDelta.ratio}x)`);
  if (regressions.length > 0) {
    summaryParts.push(`${regressions.length} regression(s) detected`);
  } else {
    summaryParts.push('no regressions');
  }
  const humanSummary = summaryParts.join(', ');

  const result: CompareResult = {
    timestamp: new Date().toISOString(),
    previous: { file: basename(previousFile), timestamp: prev.timestamp, version: prev.airengineVersion },
    current: { file: basename(currentFile), timestamp: curr.timestamp, version: curr.airengineVersion },
    policy: { threshold, minAbsMs },
    comparisons,
    newEntries,
    removedEntries,
    aggregateDelta,
    budgetFlags,
    verdict,
    regressions,
    humanSummary,
  };

  mkdirSync('artifacts/benchmarks', { recursive: true });
  writeFileSync('artifacts/benchmarks/benchmark-compare.json', JSON.stringify(result, null, 2));

  // Print summary
  console.log(`  Policy:      threshold=${threshold}x, min-abs=${minAbsMs}ms`);
  console.log(`  Previous:    ${basename(previousFile)} (${prev.timestamp})`);
  console.log(`  Current:     ${basename(currentFile)} (${curr.timestamp})`);
  console.log(`  Files:       ${comparisons.length} compared, ${newEntries.length} new, ${removedEntries.length} removed`);
  console.log(`  Aggregate:   ${aggregateDelta.previousMs}ms → ${aggregateDelta.currentMs}ms (${aggregateDelta.deltaMs >= 0 ? '+' : ''}${aggregateDelta.deltaMs}ms, ${aggregateDelta.ratio}x)`);
  console.log('');

  if (regressions.length > 0) {
    console.log('  Regressions:');
    for (const r of regressions) {
      console.log(`    FAIL  ${r}`);
    }
  } else {
    console.log('  No regressions detected.');
  }

  console.log('');
  console.log(`  Verdict: ${verdict.toUpperCase()}`);
  console.log(`  Report:  artifacts/benchmarks/benchmark-compare.json\n`);

  process.exit(regressions.length > 0 ? 1 : 0);
}

main();
