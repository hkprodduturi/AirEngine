#!/usr/bin/env npx tsx
/**
 * Offline Benchmark Baseline Generator
 *
 * Runs parse → validate → transpile over all 7 example .air files.
 * Produces per-file and aggregate metrics.
 *
 * Output: artifacts/benchmarks/offline-baseline.json
 *
 * Usage: npx tsx scripts/benchmark-baseline.ts
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { parse } from '../src/parser/index.js';
import { diagnose } from '../src/validator/index.js';
import { transpile } from '../src/transpiler/index.js';
import { buildResult, hashSource } from '../src/diagnostics.js';

interface FileBenchmark {
  file: string;
  sourceLines: number;
  sourceBytes: number;
  sourceHash: string;
  parseMs: number;
  validateMs: number;
  transpileMs: number;
  totalMs: number;
  outputFiles: number;
  outputLines: number;
  compressionRatio: number;
  diagnostics: { errors: number; warnings: number; info: number };
  hashStable: boolean;
}

interface BenchmarkBaseline {
  timestamp: string;
  airengineVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  examples: FileBenchmark[];
  aggregate: {
    totalExamples: number;
    totalSourceLines: number;
    totalOutputLines: number;
    avgCompressionRatio: number;
    totalParseMs: number;
    totalValidateMs: number;
    totalTranspileMs: number;
    totalMs: number;
    maxSingleFileMs: number;
    allHashStable: boolean;
    allUnder200ms: boolean;
    cumulativeUnder500ms: boolean;
  };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function benchmarkFile(filePath: string): FileBenchmark {
  const source = readFileSync(filePath, 'utf-8');
  const sourceLines = source.split('\n').length;
  const sourceBytes = Buffer.byteLength(source, 'utf-8');
  const srcHash = hashSource(source);

  // Parse
  const parseStart = performance.now();
  const ast = parse(source);
  const parseMs = performance.now() - parseStart;

  // Validate (diagnose)
  const validateStart = performance.now();
  const diags = diagnose(ast);
  const diagnosticResult = buildResult(diags, srcHash);
  const validateMs = performance.now() - validateStart;

  // Transpile
  const transpileStart = performance.now();
  const result = transpile(ast, { sourceLines });
  const transpileMs = performance.now() - transpileStart;

  const totalMs = parseMs + validateMs + transpileMs;

  // Hash stability: transpile twice, compare output hashes
  const hashes1 = new Map(result.files.map(f => [f.path, hashContent(f.content)]));
  const result2 = transpile(ast, { sourceLines });
  const hashes2 = new Map(result2.files.map(f => [f.path, hashContent(f.content)]));

  let hashStable = true;
  for (const [path, hash] of hashes1) {
    if (path === '_airengine_manifest.json') continue;
    if (hashes2.get(path) !== hash) {
      hashStable = false;
      break;
    }
  }

  return {
    file: filePath.replace(/^examples\//, ''),
    sourceLines,
    sourceBytes,
    sourceHash: srcHash,
    parseMs: Math.round(parseMs * 100) / 100,
    validateMs: Math.round(validateMs * 100) / 100,
    transpileMs: Math.round(transpileMs * 100) / 100,
    totalMs: Math.round(totalMs * 100) / 100,
    outputFiles: result.files.length,
    outputLines: result.stats.outputLines,
    compressionRatio: result.stats.compressionRatio,
    diagnostics: diagnosticResult.summary,
    hashStable,
  };
}

function main() {
  const examplesDir = 'examples';
  const coreExamples = [
    'todo.air', 'expense-tracker.air', 'auth.air', 'dashboard.air',
    'landing.air', 'fullstack-todo.air', 'projectflow.air',
  ];

  // Verify all exist
  for (const ex of coreExamples) {
    try {
      readFileSync(join(examplesDir, ex));
    } catch {
      console.error(`Missing example: ${ex}`);
      process.exit(1);
    }
  }

  console.log('Running benchmarks...\n');

  const examples: FileBenchmark[] = [];
  for (const ex of coreExamples) {
    const result = benchmarkFile(join(examplesDir, ex));
    examples.push(result);
    const status = result.totalMs < 200 ? 'PASS' : 'SLOW';
    console.log(`  ${status}  ${result.file.padEnd(25)} ${result.totalMs.toFixed(1)}ms  ${result.outputFiles} files  ${result.outputLines} lines  ${result.compressionRatio}x  hash:${result.hashStable ? 'stable' : 'UNSTABLE'}`);
  }

  const totalSourceLines = examples.reduce((s, e) => s + e.sourceLines, 0);
  const totalOutputLines = examples.reduce((s, e) => s + e.outputLines, 0);
  const totalParseMs = examples.reduce((s, e) => s + e.parseMs, 0);
  const totalValidateMs = examples.reduce((s, e) => s + e.validateMs, 0);
  const totalTranspileMs = examples.reduce((s, e) => s + e.transpileMs, 0);
  const totalMs = examples.reduce((s, e) => s + e.totalMs, 0);
  const maxSingleFileMs = Math.max(...examples.map(e => e.totalMs));
  const avgCompression = Math.round((examples.reduce((s, e) => s + e.compressionRatio, 0) / examples.length) * 10) / 10;
  const allHashStable = examples.every(e => e.hashStable);
  const allUnder200 = examples.every(e => e.totalMs < 200);
  const cumulativeUnder500 = totalMs < 500;

  const baseline: BenchmarkBaseline = {
    timestamp: new Date().toISOString(),
    airengineVersion: '0.2.0',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    examples,
    aggregate: {
      totalExamples: examples.length,
      totalSourceLines,
      totalOutputLines,
      avgCompressionRatio: avgCompression,
      totalParseMs: Math.round(totalParseMs * 100) / 100,
      totalValidateMs: Math.round(totalValidateMs * 100) / 100,
      totalTranspileMs: Math.round(totalTranspileMs * 100) / 100,
      totalMs: Math.round(totalMs * 100) / 100,
      maxSingleFileMs: Math.round(maxSingleFileMs * 100) / 100,
      allHashStable,
      allUnder200ms: allUnder200,
      cumulativeUnder500ms: cumulativeUnder500,
    },
  };

  mkdirSync('artifacts/benchmarks', { recursive: true });
  writeFileSync('artifacts/benchmarks/offline-baseline.json', JSON.stringify(baseline, null, 2));

  console.log('\n  Aggregate:');
  console.log(`    Total: ${totalMs.toFixed(1)}ms (parse: ${totalParseMs.toFixed(1)}ms, validate: ${totalValidateMs.toFixed(1)}ms, transpile: ${totalTranspileMs.toFixed(1)}ms)`);
  console.log(`    Max single file: ${maxSingleFileMs.toFixed(1)}ms`);
  console.log(`    ${totalSourceLines} source lines → ${totalOutputLines} output lines (avg ${avgCompression}x)`);
  console.log(`    Hash stability: ${allHashStable ? 'ALL STABLE' : 'UNSTABLE'}`);
  console.log(`    All under 200ms: ${allUnder200 ? 'YES' : 'NO'}`);
  console.log(`    Cumulative under 500ms: ${cumulativeUnder500 ? 'YES' : 'NO'}`);
  console.log(`\n  Written: artifacts/benchmarks/offline-baseline.json\n`);
}

main();
