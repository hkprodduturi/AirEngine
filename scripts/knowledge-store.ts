#!/usr/bin/env npx tsx
/**
 * Self-Heal Knowledge Store (SH5)
 *
 * Append-only JSONL storage for resolved incidents.
 * Supports retrieval by classification + subsystem for patch bot context.
 *
 * Usage:
 *   Add:   node --import tsx scripts/knowledge-store.ts add <incident-path>
 *   Query: node --import tsx scripts/knowledge-store.ts query --classification <class> [--subsystem <sub>]
 *   List:  node --import tsx scripts/knowledge-store.ts list [--limit N]
 *
 * Storage: data/self-heal-knowledge.jsonl
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { validateJsonSchema } from '../tests/schema-validator.js';

// ---- Types ----

export interface KnowledgeEntry {
  schema_version: '1.0';
  knowledge_id: string;
  incident_id: string;
  timestamp: string;
  classification: string;
  subsystem: string;
  root_cause: string;
  fix_summary: string;
  patch_id: string | null;
  files_changed: string[];
  tests_added: string[];
  invariants_added: string[];
  recurrence_tags: string[];
  retrieval_keywords: string[];
  occurrence_count: number;
  related_incidents: string[];
  verified: boolean;
  promoted_to_regression: boolean;
}

// ---- Constants ----

const KNOWLEDGE_DIR = join('data');
const KNOWLEDGE_FILE = join(KNOWLEDGE_DIR, 'self-heal-knowledge.jsonl');

// ---- Helpers ----

function generateKnowledgeId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `SK-${date}-${time}-${rand}`;
}

function ensureStore(): void {
  mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  if (!existsSync(KNOWLEDGE_FILE)) {
    writeFileSync(KNOWLEDGE_FILE, '');
  }
}

// ---- Core Functions ----

export function loadKnowledge(): KnowledgeEntry[] {
  ensureStore();
  const content = readFileSync(KNOWLEDGE_FILE, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export function appendKnowledge(entry: KnowledgeEntry): void {
  ensureStore();
  appendFileSync(KNOWLEDGE_FILE, JSON.stringify(entry) + '\n');
}

export function queryKnowledge(
  classification: string,
  subsystem: string = '',
): KnowledgeEntry[] {
  const entries = loadKnowledge();
  return entries.filter(e => {
    if (e.classification === classification) return true;
    if (subsystem && e.subsystem === subsystem) return true;
    if (e.recurrence_tags.includes(classification)) return true;
    return false;
  }).sort((a, b) => b.occurrence_count - a.occurrence_count);
}

export function buildKnowledgeEntry(
  incident: Record<string, unknown>,
  overrides: Partial<KnowledgeEntry> = {},
): KnowledgeEntry {
  const triage = incident.triage as Record<string, unknown> | null;

  return {
    schema_version: '1.0',
    knowledge_id: generateKnowledgeId(),
    incident_id: String(incident.incident_id || ''),
    timestamp: new Date().toISOString(),
    classification: String(incident.classification || 'unknown'),
    subsystem: String(incident.suspected_subsystem || 'unknown'),
    root_cause: '',
    fix_summary: '',
    patch_id: null,
    files_changed: [],
    tests_added: [],
    invariants_added: [],
    recurrence_tags: [String(incident.classification || '')],
    retrieval_keywords: (incident.tags as string[] || []),
    occurrence_count: 1,
    related_incidents: [],
    verified: false,
    promoted_to_regression: false,
    ...overrides,
  };
}

export function incrementOccurrence(classification: string): boolean {
  const entries = loadKnowledge();
  let updated = false;
  const newLines: string[] = [];
  for (const entry of entries) {
    if (entry.classification === classification) {
      entry.occurrence_count += 1;
      updated = true;
    }
    newLines.push(JSON.stringify(entry));
  }
  if (updated) {
    ensureStore();
    writeFileSync(KNOWLEDGE_FILE, newLines.join('\n') + '\n');
  }
  return updated;
}

export function validateKnowledgeEntry(entry: KnowledgeEntry): string[] {
  const schemaPath = join(__dirname, '..', 'docs', 'self-heal-knowledge.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  return validateJsonSchema(entry, schema, schema);
}

// ---- CLI Main ----

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error('Usage: knowledge-store.ts <add|query|list> [options]');
    process.exit(1);
  }

  switch (command) {
    case 'add': {
      const incidentPath = args[1];
      if (!incidentPath) {
        console.error('Usage: knowledge-store.ts add <incident-json-path>');
        process.exit(1);
      }
      const incident = JSON.parse(readFileSync(incidentPath, 'utf-8'));
      const entry = buildKnowledgeEntry(incident);

      const errors = validateKnowledgeEntry(entry);
      if (errors.length > 0) {
        console.error('Knowledge entry validation failed:', errors);
        process.exit(1);
      }

      // Check if this classification already exists → increment
      const wasIncremented = incrementOccurrence(String(incident.classification));
      if (!wasIncremented) {
        appendKnowledge(entry);
      }

      console.log('\n  Knowledge Store Updated\n');
      console.log(`  ID:             ${entry.knowledge_id}`);
      console.log(`  Classification: ${entry.classification}`);
      console.log(`  Subsystem:      ${entry.subsystem}`);
      console.log(`  Action:         ${wasIncremented ? 'Incremented occurrence' : 'New entry added'}\n`);
      break;
    }

    case 'query': {
      const classIdx = args.indexOf('--classification');
      const subIdx = args.indexOf('--subsystem');
      const classification = classIdx >= 0 ? args[classIdx + 1] : '';
      const subsystem = subIdx >= 0 ? args[subIdx + 1] : '';

      if (!classification) {
        console.error('Usage: knowledge-store.ts query --classification <class> [--subsystem <sub>]');
        process.exit(1);
      }

      const results = queryKnowledge(classification, subsystem);
      console.log(`\n  Knowledge Store Query: ${classification}\n`);
      if (results.length === 0) {
        console.log('  No matching entries found.\n');
      } else {
        for (const r of results) {
          console.log(`  [${r.knowledge_id}] ${r.classification} (${r.subsystem}) — ${r.occurrence_count} occurrences`);
          if (r.fix_summary) console.log(`    Fix: ${r.fix_summary}`);
        }
        console.log('');
      }
      break;
    }

    case 'list': {
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 20;
      const entries = loadKnowledge().slice(-limit);
      console.log(`\n  Knowledge Store (${entries.length} entries)\n`);
      for (const e of entries) {
        console.log(`  [${e.knowledge_id}] ${e.classification} → ${e.subsystem} (${e.occurrence_count}x)`);
      }
      console.log('');
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

if (process.argv[1]?.includes('knowledge-store')) {
  main();
}
