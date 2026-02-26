#!/usr/bin/env npx tsx
/**
 * Self-Heal Regression Promotion (SH6)
 *
 * Ensures every fixed bug is promoted to prevent recurrence.
 * Checks for: regression test, invariant, golden check, or sweep coverage.
 * Updates knowledge store with promotion status.
 *
 * Usage:  node --import tsx scripts/promote-fix.ts <incident-path> [--check-only]
 * Output: Updated incident + knowledge entry
 * Exit:   0 = promoted, 1 = missing promotions
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { loadKnowledge, type KnowledgeEntry } from './knowledge-store.js';

// ---- Types ----

export interface PromotionCheck {
  name: string;
  passed: boolean;
  details: string;
}

export interface PromotionReport {
  incident_id: string;
  classification: string;
  checks: PromotionCheck[];
  promoted: boolean;
  missing: string[];
}

// ---- Promotion Checks ----

export function checkRegressionTest(incident: Record<string, unknown>): PromotionCheck {
  const classification = String(incident.classification || '');
  // Check if there's a test that mentions this classification or related pattern
  try {
    const output = execSync(`grep -rl "${classification}" tests/ 2>/dev/null || true`, { encoding: 'utf-8' });
    const files = output.trim().split('\n').filter(Boolean);
    return {
      name: 'Regression test',
      passed: files.length > 0,
      details: files.length > 0
        ? `Found in: ${files.join(', ')}`
        : 'No regression test found for this classification.',
    };
  } catch {
    return { name: 'Regression test', passed: false, details: 'Check failed.' };
  }
}

export function checkInvariant(incident: Record<string, unknown>): PromotionCheck {
  const triage = incident.triage as Record<string, unknown> | null;
  const suggestedInvariant = triage ? String(triage.suggested_invariant || '') : '';

  if (!suggestedInvariant) {
    return { name: 'Invariant', passed: true, details: 'No invariant suggested by triage — skipped.' };
  }

  try {
    const invariants = readFileSync(join('src', 'self-heal', 'invariants.ts'), 'utf-8');
    const found = invariants.toLowerCase().includes(suggestedInvariant.toLowerCase());
    return {
      name: 'Invariant',
      passed: found,
      details: found
        ? `Invariant "${suggestedInvariant}" found in invariants.ts.`
        : `Suggested invariant "${suggestedInvariant}" not yet added to invariants.ts.`,
    };
  } catch {
    return { name: 'Invariant', passed: false, details: 'invariants.ts not found.' };
  }
}

export function checkGoldenCoverage(incident: Record<string, unknown>): PromotionCheck {
  const subsystem = String(incident.suspected_subsystem || '');
  // Check if golden run scripts cover the affected subsystem
  try {
    const files = ['scripts/helpdesk-golden-run.ts', 'scripts/photography-premium-golden-run.ts'];
    let covered = false;
    for (const f of files) {
      if (existsSync(f)) {
        const content = readFileSync(f, 'utf-8');
        if (content.includes(subsystem) || content.toLowerCase().includes(String(incident.classification || ''))) {
          covered = true;
          break;
        }
      }
    }
    return {
      name: 'Golden coverage',
      passed: covered,
      details: covered
        ? 'Golden run scripts cover this subsystem.'
        : 'No golden run coverage for this subsystem/classification.',
    };
  } catch {
    return { name: 'Golden coverage', passed: false, details: 'Check failed.' };
  }
}

export function checkKnowledgeEntry(incident: Record<string, unknown>): PromotionCheck {
  const classification = String(incident.classification || '');
  const entries = loadKnowledge();
  const found = entries.some(e => e.classification === classification);
  return {
    name: 'Knowledge store entry',
    passed: found,
    details: found
      ? 'Classification recorded in knowledge store.'
      : 'No knowledge store entry for this classification.',
  };
}

// ---- Promotion Runner ----

export function runPromotionChecks(incident: Record<string, unknown>): PromotionReport {
  const checks = [
    checkRegressionTest(incident),
    checkInvariant(incident),
    checkGoldenCoverage(incident),
    checkKnowledgeEntry(incident),
  ];

  // At least one promotion must be present (excluding skipped invariant)
  const activeChecks = checks.filter(c => !c.details.includes('skipped'));
  const anyPassed = activeChecks.some(c => c.passed);
  const missing = activeChecks.filter(c => !c.passed).map(c => c.name);

  return {
    incident_id: String(incident.incident_id || ''),
    classification: String(incident.classification || ''),
    checks,
    promoted: anyPassed,
    missing,
  };
}

// ---- CLI Main ----

function main(): void {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check-only');
  const incidentPath = args.find(a => !a.startsWith('--'));

  if (!incidentPath) {
    console.error('Usage: promote-fix.ts <incident-json-path> [--check-only]');
    process.exit(1);
  }

  try {
    const incident = JSON.parse(readFileSync(incidentPath, 'utf-8'));

    if (incident.status !== 'resolved' && incident.status !== 'triaged') {
      console.error(`Incident status is "${incident.status}" — must be "resolved" or "triaged" for promotion.`);
      process.exit(1);
    }

    const report = runPromotionChecks(incident);

    console.log('\n  Self-Heal Promotion Check\n');
    console.log(`  Incident:       ${report.incident_id}`);
    console.log(`  Classification: ${report.classification}\n`);

    for (const check of report.checks) {
      const icon = check.passed ? 'PASS' : check.details.includes('skipped') ? 'SKIP' : 'MISS';
      console.log(`    ${icon}  ${check.name}`);
      console.log(`         ${check.details}`);
    }

    console.log(`\n  Promoted: ${report.promoted ? 'YES' : 'NO'}`);
    if (report.missing.length > 0) {
      console.log(`  Missing:  ${report.missing.join(', ')}`);
    }
    console.log('');

    if (!checkOnly && !report.promoted) {
      console.log('  Action required: Add at least one of the missing promotions.\n');
    }

    process.exit(report.promoted ? 0 : 1);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1]?.includes('promote-fix')) {
  main();
}
