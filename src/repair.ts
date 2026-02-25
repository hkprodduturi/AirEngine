/**
 * AirEngine Repair Engine — Deterministic Rule-Based MVP (A3b)
 *
 * Single-pass, deterministic repair for two blocking diagnostic codes:
 *   AIR-E001 — Missing @app:name declaration → prepend @app:myapp
 *   AIR-E002 — No @ui block found           → append @ui(h1>"Hello World")
 *
 * All other codes are explicitly skipped with a logged reason.
 */

import type { Diagnostic } from './diagnostics.js';

// ---- Types ----

export interface RepairAction {
  rule: string;              // diagnostic code, e.g. "AIR-E001"
  kind: 'prepend' | 'append'; // explicit patch type
  text: string;              // exact patch text to insert
  description: string;       // human-readable
  applied: boolean;          // true = will be applied
  reason?: string;           // why skipped (when applied=false)
}

export type RepairStatus = 'noop' | 'repaired' | 'partial' | 'failed';

export interface RepairResult {
  status: RepairStatus;
  originalSource: string;
  repairedSource: string;
  sourceChanged: boolean;
  actions: RepairAction[];
  appliedCount: number;
  skippedCount: number;
}

// ---- Skip Reasons ----

const SKIP_REASONS: Record<string, string> = {
  'AIR-E003': 'Model reference is ambiguous — requires user intent',
  'AIR-E004': 'Duplicate page — choosing a new name is ambiguous',
  'AIR-E005': 'Nav ref — could add page or fix nav (ambiguous)',
  'AIR-E007': 'Model reference is ambiguous — requires user intent',
  'AIR-E008': 'Auth design is complex — requires user intent',
};

function getSkipReason(code: string): string {
  if (SKIP_REASONS[code]) return SKIP_REASONS[code];
  if (code.startsWith('AIR-P')) return 'Parse errors — source is malformed, text patching is fragile';
  if (code.startsWith('AIR-W')) return 'Warnings are non-blocking — no repair needed';
  if (code.startsWith('AIR-L')) return 'Info-level — changes app behavior, non-blocking';
  return `Unsupported diagnostic code: ${code}`;
}

// ---- Source Heuristics ----

/** Check if source has an @app declaration (heuristic) */
function sourceHasApp(source: string): boolean {
  return /^@app:\w/m.test(source);
}

/** Check if source has an @ui block (heuristic) */
function sourceHasUI(source: string): boolean {
  return /@ui[\s({]/.test(source);
}

/** Check if a diagnostic is a "Missing @app" parse error (AIR-P*) */
function isMissingAppParseError(diag: Diagnostic): boolean {
  return diag.code.startsWith('AIR-P') && diag.message.includes('Missing @app');
}

// ---- Core Functions ----

/**
 * Plan repairs for the given diagnostics. Returns an ordered action list:
 * prepend actions first, append actions second.
 *
 * Handles two cases:
 * 1. Validator-reported E001/E002 (when parser succeeds)
 * 2. Parse-error equivalents: "Missing @app" parse error maps to E001,
 *    and when a parse error prevents the validator from detecting E002,
 *    source-level heuristics fill in speculatively.
 */
export function planRepairs(source: string, diagnostics: Diagnostic[]): RepairAction[] {
  const prepends: RepairAction[] = [];
  const appends: RepairAction[] = [];
  const skipped: RepairAction[] = [];

  // Track which rules we've already planned to avoid duplicates
  const planned = new Set<string>();
  let repairedMissingApp = false;

  for (const diag of diagnostics) {
    if (planned.has(diag.code)) continue;

    // E001: from validator OR "Missing @app" parse error
    if (diag.code === 'AIR-E001' || isMissingAppParseError(diag)) {
      if (!planned.has('AIR-E001')) {
        planned.add('AIR-E001');
        planned.add(diag.code); // also mark original code
        prepends.push({
          rule: 'AIR-E001',
          kind: 'prepend',
          text: '@app:myapp\n',
          description: 'Prepend missing @app:name declaration',
          applied: true,
        });
        // Only set flag for parse-error path — when the validator reports E001,
        // it also runs E002 detection, so no speculation needed.
        if (isMissingAppParseError(diag)) repairedMissingApp = true;
      }
    } else if (diag.code === 'AIR-E002') {
      planned.add(diag.code);
      appends.push({
        rule: 'AIR-E002',
        kind: 'append',
        text: '\n@ui(h1>"Hello World")',
        description: 'Append missing @ui block',
        applied: true,
      });
    } else {
      planned.add(diag.code);
      skipped.push({
        rule: diag.code,
        kind: 'prepend', // placeholder — won't be applied
        text: '',
        description: `Skip: ${diag.message}`,
        applied: false,
        reason: getSkipReason(diag.code),
      });
    }
  }

  // Speculative E002: ONLY when the specific "Missing @app" parse error was
  // repaired (not on arbitrary parse errors). The missing @app error blocks
  // the parser before the validator can detect E002, so we check the source
  // directly — but only in this narrow, well-understood case.
  if (repairedMissingApp && !planned.has('AIR-E002') && !sourceHasUI(source)) {
    planned.add('AIR-E002');
    appends.push({
      rule: 'AIR-E002',
      kind: 'append',
      text: '\n@ui(h1>"Hello World")',
      description: 'Append missing @ui block (speculative — @app parse error blocked validator)',
      applied: true,
    });
  }

  // Ordered: prepends first, appends second, skipped last
  return [...prepends, ...appends, ...skipped];
}

/**
 * Apply planned repairs to source. Only processes actions where applied === true.
 * Uses ONLY the explicit text from actions — no hidden logic.
 */
export function applyRepairs(source: string, actions: RepairAction[]): string {
  let result = source;

  for (const action of actions) {
    if (!action.applied) continue;

    if (action.kind === 'prepend') {
      result = action.text + result;
    } else if (action.kind === 'append') {
      result = result + action.text;
    }
  }

  return result;
}

/**
 * Full repair pipeline: plan → apply → determine status.
 * Single-pass only — no iterative retries.
 */
export function repair(source: string, diagnostics: Diagnostic[]): RepairResult {
  const errorDiags = diagnostics.filter(d => d.severity === 'error');

  // No errors → noop
  if (errorDiags.length === 0) {
    return {
      status: 'noop',
      originalSource: source,
      repairedSource: source,
      sourceChanged: false,
      actions: [],
      appliedCount: 0,
      skippedCount: 0,
    };
  }

  const actions = planRepairs(source, diagnostics);
  const appliedCount = actions.filter(a => a.applied).length;
  // Count skipped actions that correspond to error-level diagnostics
  const errorCodes = new Set(errorDiags.map(d => d.code));
  const skippedErrors = actions.filter(a => !a.applied && errorCodes.has(a.rule)).length;

  const repairedSource = applyRepairs(source, actions);
  const sourceChanged = repairedSource !== source;

  // Determine status based on error-level diagnostics only
  let status: RepairStatus;
  if (appliedCount === 0) {
    status = 'failed';
  } else if (skippedErrors === 0) {
    status = 'repaired';
  } else {
    status = 'partial';
  }

  return {
    status,
    originalSource: source,
    repairedSource,
    sourceChanged,
    actions,
    appliedCount,
    skippedCount: actions.filter(a => !a.applied).length,
  };
}
