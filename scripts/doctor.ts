/**
 * AirEngine Doctor — Environment Readiness Check (A7)
 *
 * Verifies the development environment is ready for offline demo,
 * live demo, and online eval workflows.
 *
 * Usage:
 *   npx tsx scripts/doctor.ts
 *   npx tsx scripts/doctor.ts --verbose
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { join } from 'path';

// ---- Types ----

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface DoctorCheck {
  name: string;
  category: 'runtime' | 'repo' | 'env' | 'writable';
  status: CheckStatus;
  message: string;
}

export interface ReadinessSummary {
  ready_offline_demo: boolean;
  ready_live_demo: boolean;
  ready_online_eval: boolean;
}

export interface DoctorReport {
  schema_version: '1.0';
  timestamp: string;
  run_metadata: {
    airengine_version: string;
    node_version: string;
    platform: string;
  };
  checks: DoctorCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warned: number;
  };
  readiness: ReadinessSummary;
  verdict: 'pass' | 'fail';
}

// ---- Required Files ----

const REQUIRED_FILES = [
  'package.json',
  'tsconfig.json',
  'benchmarks/online-eval-corpus.json',
  'benchmarks/canonical-demo-prompt.json',
  'docs/loop-result.schema.json',
  'docs/online-eval-result.schema.json',
  'docs/quality-gate-result.schema.json',
  'docs/canonical-live-demo-result.schema.json',
  'scripts/eval-local.ts',
  'scripts/foundation-check.ts',
  'scripts/quality-gate.ts',
  'scripts/eval-online.ts',
  'scripts/demo-live-canonical.ts',
];

// ---- Exported Functions ----

/**
 * Run all doctor checks and return results.
 */
export async function runDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // --- Runtime ---

  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    name: 'Node.js',
    category: 'runtime',
    status: major >= 18 ? 'pass' : 'fail',
    message: major >= 18
      ? `${nodeVersion} (>= 18 required)`
      : `${nodeVersion} — upgrade to Node.js 18+`,
  });

  // npm
  try {
    const npmVersion = execSync('npm --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    checks.push({ name: 'npm', category: 'runtime', status: 'pass', message: `v${npmVersion}` });
  } catch {
    checks.push({ name: 'npm', category: 'runtime', status: 'fail', message: 'npm not found in PATH' });
  }

  // tsx — test via the actual supported runtime path (node --import tsx)
  try {
    execSync('node --import tsx -e "process.exit(0)"', { encoding: 'utf-8', stdio: 'pipe', timeout: 10000 });
    checks.push({ name: 'tsx', category: 'runtime', status: 'pass', message: 'available via node --import tsx' });
  } catch {
    // Distinguish installed-but-blocked from not-installed
    let installed = false;
    try {
      require.resolve('tsx');
      installed = true;
    } catch { /* not resolvable */ }

    if (installed) {
      checks.push({ name: 'tsx', category: 'runtime', status: 'warn', message: 'tsx installed but node --import tsx failed (IPC/pipe restriction in this environment)' });
    } else {
      checks.push({ name: 'tsx', category: 'runtime', status: 'fail', message: 'tsx not found — run npm install' });
    }
  }

  // --- Repo files ---

  for (const file of REQUIRED_FILES) {
    const exists = existsSync(file);
    checks.push({
      name: `file:${file}`,
      category: 'repo',
      status: exists ? 'pass' : 'fail',
      message: exists ? 'present' : 'missing',
    });
  }

  // --- Env vars ---

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  checks.push({
    name: 'ANTHROPIC_API_KEY',
    category: 'env',
    status: hasApiKey ? 'pass' : 'warn',
    message: hasApiKey
      ? 'set (live demo and online eval ready)'
      : 'not set (offline demo available; set for live demo/online eval)',
  });

  // --- Writable directories ---

  // artifacts dir
  try {
    mkdirSync('artifacts/doctor', { recursive: true });
    checks.push({ name: 'artifacts/ writable', category: 'writable', status: 'pass', message: 'writable' });
  } catch {
    checks.push({ name: 'artifacts/ writable', category: 'writable', status: 'fail', message: 'not writable' });
  }

  // temp dir
  try {
    const testPath = join(tmpdir(), `airengine-doctor-test-${Date.now()}`);
    mkdirSync(testPath, { recursive: true });
    const { rmSync } = require('fs');
    rmSync(testPath, { recursive: true, force: true });
    checks.push({ name: 'temp dir writable', category: 'writable', status: 'pass', message: `${tmpdir()} writable` });
  } catch {
    checks.push({ name: 'temp dir writable', category: 'writable', status: 'fail', message: `${tmpdir()} not writable` });
  }

  return checks;
}

/**
 * Compute readiness summary from checks.
 */
export function computeReadiness(checks: DoctorCheck[]): ReadinessSummary {
  const hasFail = (cats: string[]) =>
    checks.some(c => cats.includes(c.category) && c.status === 'fail');

  const runtimeOk = !hasFail(['runtime']);
  const repoOk = !hasFail(['repo']);
  const writableOk = !hasFail(['writable']);
  const hasApiKey = checks.find(c => c.name === 'ANTHROPIC_API_KEY')?.status === 'pass';

  const offlineReady = runtimeOk && repoOk && writableOk;

  return {
    ready_offline_demo: offlineReady,
    ready_live_demo: offlineReady && hasApiKey,
    ready_online_eval: offlineReady && hasApiKey,
  };
}

/**
 * Build a complete doctor report.
 */
export function buildDoctorReport(checks: DoctorCheck[]): DoctorReport {
  const summary = {
    total: checks.length,
    passed: checks.filter(c => c.status === 'pass').length,
    failed: checks.filter(c => c.status === 'fail').length,
    warned: checks.filter(c => c.status === 'warn').length,
  };
  const readiness = computeReadiness(checks);
  const hasCriticalFail = checks.some(c => c.category !== 'env' && c.status === 'fail');

  return {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    run_metadata: {
      airengine_version: '0.2.0',
      node_version: process.version,
      platform: process.platform,
    },
    checks,
    summary,
    readiness,
    verdict: hasCriticalFail ? 'fail' : 'pass',
  };
}

// ---- CLI ----

interface CliArgs {
  verbose: boolean;
  output: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    verbose: false,
    output: 'artifacts/doctor/doctor-report.json',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verbose') result.verbose = true;
    else if (args[i] === '--output') result.output = args[++i];
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('AirEngine Doctor — Environment Readiness Check\n');

  const checks = await runDoctorChecks();
  const report = buildDoctorReport(checks);

  // Print checks
  for (const check of checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
    if (args.verbose || check.status !== 'pass') {
      console.log(`  ${icon.padEnd(4)} ${check.name}: ${check.message}`);
    } else {
      console.log(`  ${icon.padEnd(4)} ${check.name}`);
    }
  }

  // Write report
  const outputPath = resolve(args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Print summary
  const r = report.readiness;
  console.log();
  console.log('=== Readiness ===');
  console.log(`  Offline demo:  ${r.ready_offline_demo ? 'READY' : 'NOT READY'}`);
  console.log(`  Live demo:     ${r.ready_live_demo ? 'READY' : 'NOT READY (set ANTHROPIC_API_KEY)'}`);
  console.log(`  Online eval:   ${r.ready_online_eval ? 'READY' : 'NOT READY (set ANTHROPIC_API_KEY)'}`);
  console.log();
  console.log(`Verdict: ${report.verdict.toUpperCase()} (${report.summary.passed} pass, ${report.summary.failed} fail, ${report.summary.warned} warn)`);
  console.log(`Report: ${args.output}`);

  process.exit(report.verdict === 'pass' ? 0 : 1);
}

// Guard: only run when executed directly
const isDirectRun = process.argv[1]?.includes('doctor');
if (isDirectRun) {
  main().catch(err => {
    console.error('ERROR: Doctor check failed unexpectedly:', err.message);
    process.exit(1);
  });
}
