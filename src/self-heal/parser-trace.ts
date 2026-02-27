/**
 * Parser Trace — Root Cause Mapping for Parser Bugs (H11 Gap Closure)
 *
 * Maps runtime incident classifications to parser source locations.
 * Parallel to codegen-trace.ts but targets src/parser/ instead of src/transpiler/.
 *
 * Each trace entry identifies the parser file/function responsible
 * for a detected issue and provides a deterministic fix strategy.
 *
 * Pure functions — no file I/O, no side effects.
 */

import type { CodegenTraceEntry, CodegenTraceResult, CodegenFix } from './codegen-trace.js';

// ---- Types ----

export interface ParserTraceEntry {
  id: string;
  name: string;
  classification_ids: string[];
  parser_file: string;
  parser_function: string;
  detect: (airSource: string, ast: any) => ParserTraceResult;
  fix: ParserFix;
}

export interface ParserTraceResult {
  detected: boolean;
  severity: 'p0' | 'p1' | 'p2' | 'p3';
  details: string;
  affected_lines: Array<{ line: number; snippet: string }>;
}

export interface ParserFix {
  strategy: string;
  target_file: string;
  target_function: string;
  description: string;
  apply: (currentSource: string, context?: ParserTraceResult) => string;
}

// ---- Helpers ----

function findSourceLines(source: string, pattern: RegExp): Array<{ line: number; snippet: string }> {
  const lines = source.split('\n');
  const results: Array<{ line: number; snippet: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      results.push({ line: i + 1, snippet: lines[i].trim() });
    }
  }
  return results;
}

// ---- Trace Rules ----

/**
 * PSH-001: Relation onDelete Dropped
 *
 * Detects when the .air source has :cascade or :set-null on a @relation
 * but the AST relation node has onDelete: undefined.
 *
 * This can happen if the parser's @relation handler fails to consume the
 * colon + referential action token after the <> relation syntax.
 *
 * Fix: patches parseDbBlock in parsers.ts to ensure the colon+identifier
 * for referential actions is consumed after the relation pair.
 */
const relationOnDeleteDropped: ParserTraceEntry = {
  id: 'PSH-001',
  name: 'Relation onDelete dropped by parser',
  classification_ids: ['db-relation-action-lost', 'cascade-missing', 'referential-action-dropped'],
  parser_file: 'src/parser/parsers.ts',
  parser_function: 'parseDbBlock',
  detect: (airSource: string, ast: any) => {
    // Check if source has :cascade or :set-null in @relation context
    const relationPattern = /@relation\s*\([^)]*:(cascade|set-null|restrict)/g;
    const sourceMatches = [...airSource.matchAll(relationPattern)];
    if (sourceMatches.length === 0) {
      return {
        detected: false,
        severity: 'p1',
        details: 'No explicit referential actions in source',
        affected_lines: [],
      };
    }

    // Check AST for corresponding onDelete fields
    const dbBlock = ast?.blocks?.find((b: any) => b.kind === 'db');
    if (!dbBlock || !dbBlock.relations) {
      return {
        detected: false,
        severity: 'p1',
        details: 'No @db block or relations in AST',
        affected_lines: [],
      };
    }

    const droppedActions: Array<{ line: number; snippet: string }> = [];
    for (const match of sourceMatches) {
      const action = match[1]; // 'cascade', 'set-null', or 'restrict'
      const lineIdx = airSource.substring(0, match.index!).split('\n').length;
      // Check if any AST relation has the corresponding onDelete
      const expectedOnDelete = action === 'set-null' ? 'setNull' : action;
      const hasInAst = dbBlock.relations.some((r: any) => r.onDelete === expectedOnDelete);
      if (!hasInAst) {
        droppedActions.push({
          line: lineIdx,
          snippet: airSource.split('\n')[lineIdx - 1]?.trim() || '',
        });
      }
    }

    return {
      detected: droppedActions.length > 0,
      severity: 'p1',
      details: droppedActions.length > 0
        ? `${droppedActions.length} referential action(s) in source but missing from AST`
        : 'All referential actions preserved in AST',
      affected_lines: droppedActions,
    };
  },
  fix: {
    strategy: 'ensure-colon-consume',
    target_file: 'src/parser/parsers.ts',
    target_function: 'parseDbBlock',
    description: 'When a colon follows a relation pair but the next identifier is unrecognized, consume it instead of restoring. Prevents the stray token from breaking subsequent relation/model parsing.',
    apply: (source: string, _context?: ParserTraceResult): string => {
      // Behavioral fix: When the colon is present after a relation pair (A.f<>B.f:)
      // but the following identifier is not cascade/set-null/restrict, the current
      // code silently restores the stream position. This leaves the colon+identifier
      // un-consumed, which can confuse subsequent parsing.
      //
      // The fix: consume the unknown identifier after the colon (advance past it)
      // instead of restoring. This is safe because the colon unambiguously signals
      // a referential action attempt — restoring creates a stale token position.

      const oldBlock = `} else {
            s.restore(save);
          }
        }
        const rel: AirDbRelation = { from, to };`;

      const newBlock = `} else if (s.is('identifier')) {
            // PSH-001: consume unknown referential action identifier
            // instead of restoring — prevents stray token from breaking
            // subsequent relation/model parsing
            s.advance();
          } else {
            s.restore(save);
          }
        }
        const rel: AirDbRelation = { from, to };`;

      if (!source.includes(oldBlock)) return source;

      return source.replace(oldBlock, newBlock);
    },
  },
};

/**
 * PSH-002: UI Scope Name Lost
 *
 * Detects when @page:Name or @section:Name exists in source but the AST
 * scoped node has a wrong or missing name.
 *
 * This is scaffolding — no known real bug exists yet.
 * Identity fix: returns source unchanged.
 */
const uiScopeNameLost: ParserTraceEntry = {
  id: 'PSH-002',
  name: 'UI scope name lost in parser',
  classification_ids: ['page-name-mismatch', 'section-name-lost'],
  parser_file: 'src/parser/parsers.ts',
  parser_function: 'parseUIBlock',
  detect: (airSource: string, ast: any) => {
    // Check for @page:Name or @section:Name in source
    const scopePattern = /@(page|section):(\w+)/g;
    const sourceScopes = [...airSource.matchAll(scopePattern)];
    if (sourceScopes.length === 0) {
      return {
        detected: false,
        severity: 'p2',
        details: 'No @page/@section with names in source',
        affected_lines: [],
      };
    }

    // Check AST UI block for scoped nodes
    const uiBlock = ast?.blocks?.find((b: any) => b.kind === 'ui');
    if (!uiBlock || !uiBlock.nodes) {
      return {
        detected: false,
        severity: 'p2',
        details: 'No @ui block in AST',
        affected_lines: [],
      };
    }

    const missingNames: Array<{ line: number; snippet: string }> = [];
    for (const match of sourceScopes) {
      const name = match[2];
      const lineIdx = airSource.substring(0, match.index!).split('\n').length;

      // Walk AST UI nodes to find a scoped node with this name
      const found = findScopedNodeByName(uiBlock.nodes, name);
      if (!found) {
        missingNames.push({
          line: lineIdx,
          snippet: airSource.split('\n')[lineIdx - 1]?.trim() || '',
        });
      }
    }

    return {
      detected: missingNames.length > 0,
      severity: 'p2',
      details: missingNames.length > 0
        ? `${missingNames.length} scope name(s) in source but missing from AST`
        : 'All scope names preserved in AST',
      affected_lines: missingNames,
    };
  },
  fix: {
    strategy: 'identity',
    target_file: 'src/parser/parsers.ts',
    target_function: 'parseUIBlock',
    description: 'Scaffolding — no known parser bug. Identity fix (no-op).',
    apply: (source: string): string => source,
  },
};

function findScopedNodeByName(nodes: any[], name: string): boolean {
  for (const node of nodes) {
    if (node.kind === 'scoped' && node.name === name) return true;
    if (node.children && Array.isArray(node.children)) {
      if (findScopedNodeByName(node.children, name)) return true;
    }
  }
  return false;
}

// ---- Registry ----

export const PARSER_TRACE_REGISTRY: ParserTraceEntry[] = [
  relationOnDeleteDropped,
  uiScopeNameLost,
];

// ---- Lookup Functions ----

export function getParserTraceById(id: string): ParserTraceEntry | undefined {
  return PARSER_TRACE_REGISTRY.find(t => t.id === id);
}

/**
 * Run a parser trace for a given classification ID.
 * Returns the matching trace entry and detection result, or null.
 */
export function traceToParser(
  classificationId: string,
  airSource: string,
  ast: any,
): { trace: ParserTraceEntry; result: ParserTraceResult } | null {
  for (const entry of PARSER_TRACE_REGISTRY) {
    if (entry.classification_ids.includes(classificationId)) {
      const result = entry.detect(airSource, ast);
      if (result.detected) {
        return { trace: entry, result };
      }
    }
  }
  return null;
}

/**
 * Run all parser trace rules against source + AST.
 */
export function runAllParserTraces(
  airSource: string,
  ast: any,
): Array<{ trace: ParserTraceEntry; result: ParserTraceResult }> {
  const results: Array<{ trace: ParserTraceEntry; result: ParserTraceResult }> = [];
  for (const entry of PARSER_TRACE_REGISTRY) {
    const result = entry.detect(airSource, ast);
    if (result.detected) {
      results.push({ trace: entry, result });
    }
  }
  return results;
}

/**
 * Adapter: convert a ParserTraceEntry + ParserTraceResult into
 * CodegenTraceEntry-compatible shape for reuse of proposeTranspilerPatch/verifyTranspilerPatch.
 */
export function parserTraceAsCodegenTrace(
  parserTrace: ParserTraceEntry,
  parserResult: ParserTraceResult,
): { trace: CodegenTraceEntry; result: CodegenTraceResult } {
  const codegenTrace: CodegenTraceEntry = {
    id: parserTrace.id,
    name: parserTrace.name,
    classification_ids: parserTrace.classification_ids,
    output_file_patterns: [], // parser traces don't match output files
    transpiler_file: parserTrace.parser_file,
    transpiler_function: parserTrace.parser_function,
    detect: () => ({
      detected: parserResult.detected,
      severity: parserResult.severity,
      details: parserResult.details,
      affected_files: [parserTrace.parser_file],
      affected_lines: parserResult.affected_lines.map(l => ({
        file: parserTrace.parser_file,
        line: l.line,
        snippet: l.snippet,
      })),
    }),
    fix: {
      strategy: parserTrace.fix.strategy as CodegenFix['strategy'],
      target_file: parserTrace.fix.target_file,
      target_function: parserTrace.fix.target_function,
      description: parserTrace.fix.description,
      apply: parserTrace.fix.apply,
    },
  };

  const codegenResult: CodegenTraceResult = {
    detected: parserResult.detected,
    severity: parserResult.severity,
    details: parserResult.details,
    affected_files: [parserTrace.parser_file],
    affected_lines: parserResult.affected_lines.map(l => ({
      file: parserTrace.parser_file,
      line: l.line,
      snippet: l.snippet,
    })),
  };

  return { trace: codegenTrace, result: codegenResult };
}
