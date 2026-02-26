#!/usr/bin/env npx tsx
/**
 * Self-Heal Incident Capture (SH1)
 *
 * Captures a failure as a structured incident artifact with evidence.
 * Validates output against self-heal-incident.schema.json.
 *
 * Usage:  node --import tsx scripts/capture-incident.ts --source manual --summary "..." --message "..." --stage runtime-ui
 * Output: artifacts/self-heal/incidents/<timestamp>-<slug>/incident.json
 * Exit:   0 = success, 1 = failure
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { validateJsonSchema } from '../tests/schema-validator.js';

// ---- Types ----

export interface IncidentError {
  message: string;
  stack: string | null;
  raw_output: string | null;
  error_code: string | null;
  http_status: number | null;
}

export interface FileRef {
  path: string;
  hash: string | null;
}

export interface IncidentInputs {
  air_file: FileRef | null;
  generated_file: FileRef | null;
  output_dir: string | null;
  page_name: string | null;
  route_path: string | null;
  seed_file: string | null;
  example_id: string | null;
}

export interface EvidenceItem {
  kind: string;
  content: string;
  file_path: string | null;
  line_number: number | null;
  label: string | null;
}

export interface Incident {
  schema_version: '1.0';
  incident_id: string;
  timestamp: string;
  source: string;
  command: string | null;
  stage: string;
  severity: string;
  classification: string | null;
  suspected_subsystem: string | null;
  summary: string;
  error: IncidentError;
  inputs: IncidentInputs;
  evidence: EvidenceItem[];
  status: string;
  tags: string[];
  triage: null;
}

// ---- Helpers ----

function generateIncidentId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `SH-${date}-${time}-${rand}`;
}

export function computeFileHash(filePath: string): string | null {
  try {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function makeFileRef(filePath: string | undefined): FileRef | null {
  if (!filePath) return null;
  return { path: filePath, hash: computeFileHash(filePath) };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function readFileOrNull(path: string | undefined): string | null {
  if (!path) return null;
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

// ---- CLI Arg Parsing ----

export interface CaptureArgs {
  source: string;
  summary: string;
  message: string;
  stage: string;
  severity?: string;
  command?: string;
  airFile?: string;
  generatedFile?: string;
  outputDir?: string;
  pageName?: string;
  routePath?: string;
  seedFile?: string;
  exampleId?: string;
  stackFile?: string;
  rawOutputFile?: string;
  screenshots: string[];
  tags: string[];
  errorCode?: string;
  httpStatus?: number;
}

export function parseArgs(argv: string[]): CaptureArgs {
  const args: CaptureArgs = { source: '', summary: '', message: '', stage: '', screenshots: [], tags: [] };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--source': args.source = next || ''; i += 2; break;
      case '--summary': args.summary = next || ''; i += 2; break;
      case '--message': args.message = next || ''; i += 2; break;
      case '--stage': args.stage = next || ''; i += 2; break;
      case '--severity': args.severity = next; i += 2; break;
      case '--command': args.command = next; i += 2; break;
      case '--air-file': args.airFile = next; i += 2; break;
      case '--generated-file': args.generatedFile = next; i += 2; break;
      case '--output-dir': args.outputDir = next; i += 2; break;
      case '--page-name': args.pageName = next; i += 2; break;
      case '--route-path': args.routePath = next; i += 2; break;
      case '--seed-file': args.seedFile = next; i += 2; break;
      case '--example-id': args.exampleId = next; i += 2; break;
      case '--stack-file': args.stackFile = next; i += 2; break;
      case '--raw-output-file': args.rawOutputFile = next; i += 2; break;
      case '--screenshot': args.screenshots.push(next || ''); i += 2; break;
      case '--tag': args.tags.push(next || ''); i += 2; break;
      case '--error-code': args.errorCode = next; i += 2; break;
      case '--http-status': args.httpStatus = parseInt(next || '0', 10); i += 2; break;
      default: i += 1; break;
    }
  }
  return args;
}

// ---- Severity Inference ----

export function inferSeverity(stage: string, message: string): string {
  const msg = message.toLowerCase();
  // P0: crashes, build failures, security
  if (stage === 'build' || stage === 'seed') return 'p0';
  if (msg.includes('eaddrinuse') || msg.includes('cannot start')) return 'p0';
  if (msg.includes('auth bypass') || msg.includes('security')) return 'p0';
  // P1: runtime errors, feature broken
  if (msg.includes('is not a function') || msg.includes('is not defined')) return 'p1';
  if (msg.includes('dead button') || msg.includes('unwired') || msg.includes('crash')) return 'p1';
  if (stage === 'runtime-ui' || stage === 'runtime-server') return 'p1';
  // P2: visual, seed quality
  if (stage === 'qa-visual') return 'p2';
  if (msg.includes('spacing') || msg.includes('alignment') || msg.includes('contrast')) return 'p2';
  // P3: docs, config
  if (msg.includes('docs') || msg.includes('stale') || msg.includes('config')) return 'p3';
  return 'p2'; // default to medium
}

// ---- Core Capture ----

export function buildIncident(args: CaptureArgs): Incident {
  const severity = args.severity || inferSeverity(args.stage, args.message);
  const evidence: EvidenceItem[] = [];

  // Stack trace evidence
  const stackContent = readFileOrNull(args.stackFile);
  if (stackContent) {
    evidence.push({ kind: 'stack_frame', content: stackContent, file_path: args.stackFile || null, line_number: null, label: 'Stack trace' });
  }

  // Raw output evidence
  const rawContent = readFileOrNull(args.rawOutputFile);
  if (rawContent) {
    evidence.push({ kind: 'raw_output', content: rawContent, file_path: args.rawOutputFile || null, line_number: null, label: 'Raw output' });
  }

  // Screenshot evidence
  for (const ss of args.screenshots) {
    evidence.push({ kind: 'screenshot_path', content: ss, file_path: ss, line_number: null, label: 'Screenshot' });
  }

  return {
    schema_version: '1.0',
    incident_id: generateIncidentId(),
    timestamp: new Date().toISOString(),
    source: args.source as Incident['source'],
    command: args.command || null,
    stage: args.stage as Incident['stage'],
    severity: severity as Incident['severity'],
    classification: null,
    suspected_subsystem: null,
    summary: args.summary,
    error: {
      message: args.message,
      stack: stackContent,
      raw_output: rawContent,
      error_code: args.errorCode || null,
      http_status: args.httpStatus || null,
    },
    inputs: {
      air_file: makeFileRef(args.airFile),
      generated_file: makeFileRef(args.generatedFile),
      output_dir: args.outputDir || null,
      page_name: args.pageName || null,
      route_path: args.routePath || null,
      seed_file: args.seedFile || null,
      example_id: args.exampleId || null,
    },
    evidence,
    status: 'open',
    tags: args.tags,
    triage: null,
  };
}

export function writeIncidentArtifact(incident: Incident): string {
  const ts = incident.timestamp.replace(/[-:T]/g, '').slice(0, 15);
  const slug = slugify(incident.summary);
  const dirName = `${ts}-${slug}`;
  const dir = join('artifacts', 'self-heal', 'incidents', dirName);
  mkdirSync(dir, { recursive: true });

  const outPath = join(dir, 'incident.json');
  writeFileSync(outPath, JSON.stringify(incident, null, 2));
  return outPath;
}

export function validateIncident(incident: Incident): string[] {
  const schemaPath = join(__dirname, '..', 'docs', 'self-heal-incident.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  return validateJsonSchema(incident, schema, schema);
}

// ---- CLI Main ----

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.source || !args.summary || !args.message || !args.stage) {
    console.error('Required: --source, --summary, --message, --stage');
    process.exit(1);
  }

  const incident = buildIncident(args);

  // Validate
  const errors = validateIncident(incident);
  if (errors.length > 0) {
    console.error('Incident validation failed:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  // Write artifact
  const outPath = writeIncidentArtifact(incident);

  console.log(`\n  Self-Heal Incident Captured\n`);
  console.log(`  ID:       ${incident.incident_id}`);
  console.log(`  Severity: ${incident.severity.toUpperCase()}`);
  console.log(`  Stage:    ${incident.stage}`);
  console.log(`  Source:   ${incident.source}`);
  console.log(`  Summary:  ${incident.summary}`);
  console.log(`  Artifact: ${outPath}\n`);
}

if (process.argv[1]?.includes('capture-incident')) {
  main();
}
