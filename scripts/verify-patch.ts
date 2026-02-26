#!/usr/bin/env npx tsx
/**
 * Self-Heal Verifier Orchestrator (SH4)
 *
 * Runs the full verification gate suite against a patch.
 * Reports structured results per step.
 *
 * Usage:  node --import tsx scripts/verify-patch.ts <patch-path> [--fail-fast]
 * Output: artifacts/self-heal/verifications/SV-<timestamp>-<rand>.json
 * Exit:   0 = pass, 1 = fail
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { validateJsonSchema } from '../tests/schema-validator.js';

// ---- Types ----

export interface VerifyStep {
  name: string;
  command: string;
  status: 'pass' | 'fail' | 'skip';
  duration_ms: number;
  output_summary: string | null;
  exit_code: number | null;
}

export interface PromotionRecord {
  regression_test_added: boolean;
  invariant_added: boolean;
  golden_coverage_added: boolean;
  sweep_coverage_added: boolean;
  details: string | null;
}

export interface VerifyResult {
  schema_version: '1.0';
  verify_id: string;
  patch_id: string;
  incident_id: string;
  timestamp: string;
  steps: VerifyStep[];
  verdict: 'pass' | 'fail' | 'partial';
  total_duration_ms: number;
  recurrence_tags: string[];
  promotion: PromotionRecord | null;
}

// ---- Constants ----

export const VERIFY_STEPS = [
  { name: 'Type check', command: 'npx tsc --noEmit' },
  { name: 'Test suite', command: 'npx vitest run' },
  { name: 'Quality gate', command: 'npm run quality-gate -- --mode offline' },
  { name: 'Helpdesk golden', command: 'npm run helpdesk-golden' },
  { name: 'Photography golden', command: 'npm run photography-golden' },
  { name: 'Complex eval', command: 'npm run eval-complex' },
];

// ---- Helpers ----

function generateVerifyId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `SV-${date}-${time}-${rand}`;
}

export function runStep(step: { name: string; command: string }): VerifyStep {
  const start = performance.now();
  try {
    const output = execSync(step.command, {
      encoding: 'utf-8',
      timeout: 300_000, // 5 min
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const duration = Math.round(performance.now() - start);
    const lines = output.trim().split('\n');
    const summary = lines.slice(-3).join('\n');
    return {
      name: step.name,
      command: step.command,
      status: 'pass',
      duration_ms: duration,
      output_summary: summary,
      exit_code: 0,
    };
  } catch (err: any) {
    const duration = Math.round(performance.now() - start);
    const output = String(err.stdout || err.stderr || err.message || '');
    const lines = output.trim().split('\n');
    const summary = lines.slice(-5).join('\n');
    return {
      name: step.name,
      command: step.command,
      status: 'fail',
      duration_ms: duration,
      output_summary: summary.slice(0, 500),
      exit_code: err.status ?? 1,
    };
  }
}

export function buildVerifyResult(
  patchId: string,
  incidentId: string,
  steps: VerifyStep[],
): VerifyResult {
  const allPassed = steps.every(s => s.status === 'pass');
  const anyPassed = steps.some(s => s.status === 'pass');
  const totalMs = steps.reduce((sum, s) => sum + s.duration_ms, 0);

  return {
    schema_version: '1.0',
    verify_id: generateVerifyId(),
    patch_id: patchId,
    incident_id: incidentId,
    timestamp: new Date().toISOString(),
    steps,
    verdict: allPassed ? 'pass' : anyPassed ? 'partial' : 'fail',
    total_duration_ms: totalMs,
    recurrence_tags: [],
    promotion: null,
  };
}

export function writeVerifyArtifact(result: VerifyResult): string {
  const dir = join('artifacts', 'self-heal', 'verifications');
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `${result.verify_id}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  return outPath;
}

export function validateVerifyResult(result: VerifyResult): string[] {
  const schemaPath = join(__dirname, '..', 'docs', 'self-heal-verify.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  return validateJsonSchema(result, schema, schema);
}

// ---- CLI Main ----

function main(): void {
  const args = process.argv.slice(2);
  const failFast = args.includes('--fail-fast');
  const patchPath = args.find(a => !a.startsWith('--'));

  if (!patchPath) {
    console.error('Usage: verify-patch.ts <patch-json-path> [--fail-fast]');
    process.exit(1);
  }

  try {
    const patch = JSON.parse(readFileSync(patchPath, 'utf-8'));
    const patchId = String(patch.patch_id || '');
    const incidentId = String(patch.incident_id || '');

    console.log('\n  Self-Heal Verification\n');
    console.log(`  Patch:    ${patchId}`);
    console.log(`  Incident: ${incidentId}\n`);

    const steps: VerifyStep[] = [];
    for (const stepDef of VERIFY_STEPS) {
      console.log(`  Running: ${stepDef.name}...`);
      const result = runStep(stepDef);
      steps.push(result);
      const icon = result.status === 'pass' ? 'PASS' : 'FAIL';
      console.log(`    ${icon} (${result.duration_ms}ms)`);

      if (result.status === 'fail' && failFast) {
        console.log('\n  Fail-fast: stopping at first failure.');
        break;
      }
    }

    const verifyResult = buildVerifyResult(patchId, incidentId, steps);

    // Validate
    const errors = validateVerifyResult(verifyResult);
    if (errors.length > 0) {
      console.error('Verify result validation failed:', errors);
    }

    const outPath = writeVerifyArtifact(verifyResult);

    console.log(`\n  Verdict: ${verifyResult.verdict.toUpperCase()}`);
    console.log(`  Steps:   ${steps.filter(s => s.status === 'pass').length}/${steps.length} passed`);
    console.log(`  Time:    ${verifyResult.total_duration_ms}ms`);
    console.log(`  Report:  ${outPath}\n`);

    process.exit(verifyResult.verdict === 'pass' ? 0 : 1);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1]?.includes('verify-patch')) {
  main();
}
