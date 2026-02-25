/**
 * A7 Doctor Tests
 *
 * Tests for scripts/doctor.ts — environment readiness checks,
 * readiness computation, and report building.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  runDoctorChecks,
  computeReadiness,
  buildDoctorReport,
} from '../scripts/doctor.js';
import type { DoctorCheck, DoctorReport, ReadinessSummary } from '../scripts/doctor.js';

// ---- Helpers ----

function makeCheck(overrides: Partial<DoctorCheck> = {}): DoctorCheck {
  return {
    name: 'test-check',
    category: 'runtime',
    status: 'pass',
    message: 'ok',
    ...overrides,
  };
}

// ---- runDoctorChecks ----

describe('runDoctorChecks', () => {
  it('returns an array of checks', async () => {
    const checks = await runDoctorChecks();
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThan(5);
  });

  it('includes Node.js check', async () => {
    const checks = await runDoctorChecks();
    const node = checks.find(c => c.name === 'Node.js');
    expect(node).toBeDefined();
    expect(node!.status).toBe('pass');
    expect(node!.category).toBe('runtime');
  });

  it('includes npm check', async () => {
    const checks = await runDoctorChecks();
    const npm = checks.find(c => c.name === 'npm');
    expect(npm).toBeDefined();
    expect(npm!.status).toBe('pass');
  });

  it('includes ANTHROPIC_API_KEY check', async () => {
    const checks = await runDoctorChecks();
    const apiKey = checks.find(c => c.name === 'ANTHROPIC_API_KEY');
    expect(apiKey).toBeDefined();
    expect(['pass', 'warn']).toContain(apiKey!.status);
    expect(apiKey!.category).toBe('env');
  });

  it('checks required repo files', async () => {
    const checks = await runDoctorChecks();
    const repoChecks = checks.filter(c => c.category === 'repo');
    expect(repoChecks.length).toBeGreaterThan(5);
    // All required files should exist in this repo
    for (const c of repoChecks) {
      expect(c.status).toBe('pass');
    }
  });

  it('checks writable directories', async () => {
    const checks = await runDoctorChecks();
    const writable = checks.filter(c => c.category === 'writable');
    expect(writable.length).toBe(2);
    for (const c of writable) {
      expect(c.status).toBe('pass');
    }
  });
});

// ---- computeReadiness ----

describe('computeReadiness', () => {
  it('all pass + API key = all ready', () => {
    const checks: DoctorCheck[] = [
      makeCheck({ name: 'Node.js', category: 'runtime' }),
      makeCheck({ name: 'npm', category: 'runtime' }),
      makeCheck({ name: 'file:package.json', category: 'repo' }),
      makeCheck({ name: 'ANTHROPIC_API_KEY', category: 'env' }),
      makeCheck({ name: 'artifacts/ writable', category: 'writable' }),
    ];
    const r = computeReadiness(checks);
    expect(r.ready_offline_demo).toBe(true);
    expect(r.ready_live_demo).toBe(true);
    expect(r.ready_online_eval).toBe(true);
  });

  it('missing API key = offline ready only', () => {
    const checks: DoctorCheck[] = [
      makeCheck({ name: 'Node.js', category: 'runtime' }),
      makeCheck({ name: 'npm', category: 'runtime' }),
      makeCheck({ name: 'file:package.json', category: 'repo' }),
      makeCheck({ name: 'ANTHROPIC_API_KEY', category: 'env', status: 'warn' }),
      makeCheck({ name: 'artifacts/ writable', category: 'writable' }),
    ];
    const r = computeReadiness(checks);
    expect(r.ready_offline_demo).toBe(true);
    expect(r.ready_live_demo).toBe(false);
    expect(r.ready_online_eval).toBe(false);
  });

  it('runtime failure = nothing ready', () => {
    const checks: DoctorCheck[] = [
      makeCheck({ name: 'Node.js', category: 'runtime', status: 'fail' }),
      makeCheck({ name: 'ANTHROPIC_API_KEY', category: 'env' }),
    ];
    const r = computeReadiness(checks);
    expect(r.ready_offline_demo).toBe(false);
    expect(r.ready_live_demo).toBe(false);
    expect(r.ready_online_eval).toBe(false);
  });

  it('repo file missing = nothing ready', () => {
    const checks: DoctorCheck[] = [
      makeCheck({ name: 'Node.js', category: 'runtime' }),
      makeCheck({ name: 'file:missing.ts', category: 'repo', status: 'fail' }),
      makeCheck({ name: 'ANTHROPIC_API_KEY', category: 'env' }),
      makeCheck({ name: 'artifacts/ writable', category: 'writable' }),
    ];
    const r = computeReadiness(checks);
    expect(r.ready_offline_demo).toBe(false);
  });
});

// ---- buildDoctorReport ----

describe('buildDoctorReport', () => {
  it('produces a complete report', () => {
    const checks: DoctorCheck[] = [
      makeCheck({ name: 'Node.js', category: 'runtime' }),
      makeCheck({ name: 'ANTHROPIC_API_KEY', category: 'env', status: 'warn' }),
    ];
    const report = buildDoctorReport(checks);
    expect(report.schema_version).toBe('1.0');
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.warned).toBe(1);
    expect(report.summary.failed).toBe(0);
    expect(report.verdict).toBe('pass');
  });

  it('verdict is fail when non-env check fails', () => {
    const checks: DoctorCheck[] = [
      makeCheck({ name: 'Node.js', category: 'runtime', status: 'fail' }),
    ];
    const report = buildDoctorReport(checks);
    expect(report.verdict).toBe('fail');
  });

  it('verdict is pass when only env check warns', () => {
    const checks: DoctorCheck[] = [
      makeCheck({ name: 'Node.js', category: 'runtime' }),
      makeCheck({ name: 'ANTHROPIC_API_KEY', category: 'env', status: 'warn' }),
    ];
    const report = buildDoctorReport(checks);
    expect(report.verdict).toBe('pass');
  });
});
