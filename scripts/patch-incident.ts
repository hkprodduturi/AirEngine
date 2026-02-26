#!/usr/bin/env npx tsx
/**
 * Self-Heal Patch Bot Orchestrator (SH3)
 *
 * Generates bounded patch proposals from classified incidents.
 * Uses knowledge store for retrieval-first context when available.
 * No auto-apply — outputs patch artifact for human review.
 *
 * Usage:  node --import tsx scripts/patch-incident.ts <incident-path> [--dry-run]
 * Output: artifacts/self-heal/patches/SP-<timestamp>-<rand>.json
 * Exit:   0 = proposal generated, 1 = error
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { validateJsonSchema } from '../tests/schema-validator.js';
import { queryKnowledge, type KnowledgeEntry } from './knowledge-store.js';

// ---- Types ----

export interface PatchScope {
  subsystems: string[];
  files: string[];
  max_lines_changed: number;
}

export interface DiffEntry {
  file_path: string;
  diff_type: 'modify' | 'create' | 'delete';
  content: string;
  lines_added: number;
  lines_removed: number;
}

export interface PatchResult {
  schema_version: '1.0';
  patch_id: string;
  incident_id: string;
  timestamp: string;
  status: 'proposed' | 'approved' | 'applied' | 'rejected' | 'failed_verification';
  patch_scope: PatchScope;
  diffs: DiffEntry[];
  tests_added: string[];
  invariants_added: string[];
  verification_status: { verify_id: string; verdict: string } | null;
  approver: string | null;
  notes: string | null;
}

// ---- Policy Constants ----

export const MAX_FILES = 10;
export const MAX_LINES_CHANGED = 200;

// Subsystem → likely files mapping
export const SUBSYSTEM_FILES: Record<string, string[]> = {
  'page-gen': ['src/transpiler/react/page-gen.ts'],
  'jsx-gen': ['src/transpiler/react/jsx-gen.ts'],
  'layout-gen': ['src/transpiler/react/layout-gen.ts'],
  'scaffold': ['src/transpiler/scaffold.ts'],
  'mutation-gen': ['src/transpiler/react/mutation-gen.ts'],
  'api-client-gen': ['src/transpiler/api-client-gen.ts'],
  'api-router-gen': ['src/transpiler/express/api-router-gen.ts'],
  'server-entry-gen': ['src/transpiler/express/server-entry-gen.ts'],
  'prisma-gen': ['src/transpiler/prisma.ts'],
  'seed-gen': ['src/transpiler/seed-gen.ts'],
  'parser': ['src/parser/index.ts', 'src/parser/parsers.ts'],
  'validator': ['src/validator/index.ts'],
  'operator-config': ['src/transpiler/scaffold.ts'],
  'docs': [],
  'transpiler': ['src/transpiler/index.ts'],
  'unknown': [],
};

// ---- Helpers ----

function generatePatchId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `SP-${date}-${time}-${rand}`;
}

function loadIncident(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ---- Patch Scope Builder ----

export function buildPatchScope(incident: Record<string, unknown>): PatchScope {
  const subsystem = String(incident.suspected_subsystem || 'unknown');
  const subsystems = [subsystem];
  const files = SUBSYSTEM_FILES[subsystem] || [];

  return {
    subsystems,
    files: files.slice(0, MAX_FILES),
    max_lines_changed: MAX_LINES_CHANGED,
  };
}

// ---- Patch Prompt Builder ----

export function buildPatchPrompt(
  incident: Record<string, unknown>,
  scope: PatchScope,
  relatedKnowledge: KnowledgeEntry[],
): string {
  const classification = String(incident.classification || 'unknown');
  const subsystem = String(incident.suspected_subsystem || 'unknown');
  const summary = String(incident.summary || '');
  const triage = incident.triage as Record<string, unknown> | null;
  const notes = triage ? String(triage.triage_notes || '') : '';
  const nextStep = triage ? String(triage.recommended_next_step || '') : '';

  const lines: string[] = [];
  lines.push('# Patch Request');
  lines.push('');
  lines.push(`## Incident: ${classification}`);
  lines.push(`- Summary: ${summary}`);
  lines.push(`- Subsystem: ${subsystem}`);
  lines.push(`- Triage notes: ${notes}`);
  lines.push(`- Recommended next step: ${nextStep}`);
  lines.push('');
  lines.push('## Scope Constraints');
  lines.push(`- Files: ${scope.files.join(', ') || 'TBD'}`);
  lines.push(`- Max lines changed: ${scope.max_lines_changed}`);
  lines.push(`- Subsystems: ${scope.subsystems.join(', ')}`);
  lines.push('');

  if (relatedKnowledge.length > 0) {
    lines.push('## Related Past Fixes');
    for (const k of relatedKnowledge.slice(0, 3)) {
      lines.push(`- [${k.classification}] ${k.fix_summary}`);
      lines.push(`  Files: ${k.files_changed.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Requirements');
  lines.push('1. Fix the root cause in transpiler code (not in generated output)');
  lines.push('2. Add a regression test');
  lines.push('3. Do not break existing tests');
  lines.push('4. Stay within scope constraints');

  return lines.join('\n');
}

// ---- Patch Artifact Builder ----

export function buildPatchArtifact(
  incident: Record<string, unknown>,
  scope: PatchScope,
  prompt: string,
): PatchResult {
  return {
    schema_version: '1.0',
    patch_id: generatePatchId(),
    incident_id: String(incident.incident_id || ''),
    timestamp: new Date().toISOString(),
    status: 'proposed',
    patch_scope: scope,
    diffs: [], // Empty — patch bot generates diffs in future phase
    tests_added: [],
    invariants_added: [],
    verification_status: null,
    approver: null,
    notes: `Patch prompt generated. ${prompt.split('\n').length} lines of context. Awaiting implementation.`,
  };
}

export function writePatchArtifact(patch: PatchResult, prompt: string): string {
  const dir = join('artifacts', 'self-heal', 'patches');
  mkdirSync(dir, { recursive: true });

  const patchPath = join(dir, `${patch.patch_id}.json`);
  writeFileSync(patchPath, JSON.stringify(patch, null, 2));

  // Also write the prompt for reference
  const promptPath = join(dir, `${patch.patch_id}-prompt.md`);
  writeFileSync(promptPath, prompt);

  return patchPath;
}

export function validatePatchResult(patch: PatchResult): string[] {
  const schemaPath = join(__dirname, '..', 'docs', 'self-heal-patch-result.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  return validateJsonSchema(patch, schema, schema);
}

// ---- CLI Main ----

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const incidentPath = args.find(a => !a.startsWith('--'));

  if (!incidentPath) {
    console.error('Usage: patch-incident.ts <incident-json-path> [--dry-run]');
    process.exit(1);
  }

  try {
    const incident = loadIncident(incidentPath);

    if (!incident.classification || incident.classification === 'unknown') {
      console.error('Incident not yet classified. Run classify-incident.ts first.');
      process.exit(1);
    }

    // Build scope
    const scope = buildPatchScope(incident);

    // Query knowledge store for similar past fixes
    const related = queryKnowledge(
      String(incident.classification),
      String(incident.suspected_subsystem || ''),
    );

    // Build prompt
    const prompt = buildPatchPrompt(incident, scope, related);

    if (dryRun) {
      console.log('\n  Patch Prompt (dry run):\n');
      console.log(prompt);
      return;
    }

    // Build and write patch artifact
    const patch = buildPatchArtifact(incident, scope, prompt);
    const errors = validatePatchResult(patch);
    if (errors.length > 0) {
      console.error('Patch validation failed:', errors);
      process.exit(1);
    }

    const outPath = writePatchArtifact(patch, prompt);

    console.log('\n  Self-Heal Patch Proposal Generated\n');
    console.log(`  Patch ID:       ${patch.patch_id}`);
    console.log(`  Incident:       ${patch.incident_id}`);
    console.log(`  Subsystems:     ${scope.subsystems.join(', ')}`);
    console.log(`  Target files:   ${scope.files.join(', ') || 'TBD'}`);
    console.log(`  Related fixes:  ${related.length}`);
    console.log(`  Status:         ${patch.status}`);
    console.log(`  Artifact:       ${outPath}\n`);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1]?.includes('patch-incident')) {
  main();
}
