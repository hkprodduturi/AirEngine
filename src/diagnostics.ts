/**
 * Structured Diagnostics — machine-readable diagnostic types and utilities
 * for AI agent self-repair.
 *
 * Schema version: 1.0
 */

import { createHash } from 'crypto';
import { AirParseError, AirLexError } from './parser/errors.js';

// ---- Types ----

export interface DiagnosticLocation {
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
  sourceLine?: string;
}

export interface DiagnosticFix {
  description: string;
  suggestion?: string;
  pattern?: string;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticCategory = 'syntax' | 'structural' | 'semantic' | 'style' | 'performance';

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  location?: DiagnosticLocation;
  block?: string;
  path?: string;
  fix?: DiagnosticFix;
  category: DiagnosticCategory;
}

export interface DiagnosticResult {
  valid: boolean;
  diagnostics: Diagnostic[];
  summary: { errors: number; warnings: number; info: number };
  source_hash: string;
  airengine_version: string;
  schema_version: string;
}

// ---- Constants ----

export const SCHEMA_VERSION = '1.0';

// ---- Factory ----

export function createDiagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  category: DiagnosticCategory,
  opts?: {
    location?: DiagnosticLocation;
    block?: string;
    path?: string;
    fix?: DiagnosticFix;
  },
): Diagnostic {
  const d: Diagnostic = { code, severity, message, category };
  if (opts?.location) d.location = opts.location;
  if (opts?.block) d.block = opts.block;
  if (opts?.path) d.path = opts.path;
  if (opts?.fix) d.fix = opts.fix;
  return d;
}

// ---- Parse Error Wrapping ----

export function wrapParseError(err: AirParseError | AirLexError): Diagnostic {
  if (err instanceof AirParseError) {
    // Extract the core message (strip the "[AIR Parse Error] Line X:Y: " prefix)
    const coreMsg = err.message.replace(/^\[AIR Parse Error\] Line \d+:\d+: /, '');

    // Determine specific parse error code
    let code = 'AIR-P001';
    const fix: DiagnosticFix = { description: 'Fix the syntax error at this location' };

    if (coreMsg.includes('Expected')) {
      code = 'AIR-P003';
      fix.description = `Fix the syntax: ${coreMsg}`;
      // Extract expected/actual for suggestion
      const expectedMatch = coreMsg.match(/Expected (\S+)/);
      if (expectedMatch) {
        fix.suggestion = `Replace with ${expectedMatch[1]}`;
      }
    } else if (coreMsg.includes('Unknown block type')) {
      code = 'AIR-P004';
      fix.description = 'Use a valid block type: @state, @ui, @api, @db, @auth, @nav, @persist, @hook, @style, @cron, @webhook, @queue, @email, @env, @deploy';
    } else if (coreMsg.includes('Invalid type')) {
      code = 'AIR-P005';
      fix.description = 'Use a valid type: str, int, float, bool, date, datetime, enum, [type], {fields}, map, any, or prefix with ? for optional';
    }

    return createDiagnostic(code, 'error', coreMsg, 'syntax', {
      location: {
        line: err.line,
        col: err.col,
        sourceLine: err.sourceLine,
      },
      fix,
    });
  }

  // AirLexError
  const coreMsg = err.message.replace(/^\[AIR Lex Error\] Line \d+:\d+: /, '');
  let code = 'AIR-P001';
  const fix: DiagnosticFix = { description: 'Fix the lexer error at this location' };

  if (coreMsg.includes('Unterminated')) {
    code = 'AIR-P002';
    fix.description = 'Close the string literal with a matching quote character';
  }

  return createDiagnostic(code, 'error', coreMsg, 'syntax', {
    location: { line: err.line, col: err.col },
    fix,
  });
}

// ---- Sorting ----

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    // 1. By severity (error first)
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    // 2. By line number (ascending, diagnostics without line last)
    const aLine = a.location?.line ?? Infinity;
    const bLine = b.location?.line ?? Infinity;
    if (aLine !== bLine) return aLine - bLine;
    // 3. By code (alphabetical)
    return a.code.localeCompare(b.code);
  });
}

// ---- Result Builder ----

export function buildResult(diagnostics: Diagnostic[], sourceHash: string): DiagnosticResult {
  const sorted = sortDiagnostics(diagnostics);
  const errors = sorted.filter(d => d.severity === 'error').length;
  const warnings = sorted.filter(d => d.severity === 'warning').length;
  const info = sorted.filter(d => d.severity === 'info').length;

  return {
    valid: errors === 0,
    diagnostics: sorted,
    summary: { errors, warnings, info },
    source_hash: sourceHash,
    airengine_version: getVersion(),
    schema_version: SCHEMA_VERSION,
  };
}

export function hashSource(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

// ---- Legacy Format Adapter ----

export interface LegacyValidationResult {
  valid: boolean;
  errors: { code: string; message: string; block?: string; path?: string }[];
  warnings: { code: string; message: string; suggestion?: string }[];
}

export function toLegacyFormat(result: DiagnosticResult): LegacyValidationResult {
  const errors = result.diagnostics
    .filter(d => d.severity === 'error')
    .map(d => ({
      code: d.code.replace('AIR-', ''),
      message: d.message,
      ...(d.block && { block: d.block }),
      ...(d.path && { path: d.path }),
    }));
  const warnings = result.diagnostics
    .filter(d => d.severity === 'warning' || d.severity === 'info')
    .map(d => ({
      code: d.code.replace('AIR-', ''),
      message: d.message,
      ...(d.fix?.description && { suggestion: d.fix.description }),
    }));

  return { valid: result.valid, errors, warnings };
}

// ---- CLI Formatter ----

export function formatDiagnosticCLI(d: Diagnostic): string {
  const lines: string[] = [];
  lines.push(`${d.severity}[${d.code}]: ${d.message}`);

  if (d.location) {
    const loc = d.location.endLine
      ? `${d.location.line}:${d.location.col}-${d.location.endLine}:${d.location.endCol}`
      : d.location.col ? `${d.location.line}:${d.location.col}` : `${d.location.line}`;
    lines.push(`  --> line ${loc}`);

    if (d.location.sourceLine) {
      lines.push(`  |`);
      lines.push(`${String(d.location.line).padStart(3)} | ${d.location.sourceLine}`);
      lines.push(`  | ${' '.repeat(d.location.col - 1)}^`);
    }
  } else if (d.block || d.path) {
    const ref = d.path ? `${d.block || ''}.${d.path}` : d.block;
    lines.push(`  --> ${ref}`);
  }

  if (d.fix) {
    lines.push(`  = fix: ${d.fix.description}`);
  }

  return lines.join('\n');
}

// ---- Version Helper ----

let cachedVersion: string | null = null;

function getVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    // Read version from package.json at build time via bundler, or fallback
    cachedVersion = '0.2.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}
