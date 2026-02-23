/**
 * AIR Transpiler — Orchestrator
 *
 * Converts a validated AirAST into a working React application.
 * Output is a complete Vite + React + Tailwind project.
 *
 * Pure function — no file I/O.
 */

import type { AirAST } from '../parser/types.js';
import { extractContext } from './context.js';
import { analyzeUI } from './normalize-ui.js';
import { generateApp } from './react.js';
import { generateScaffold } from './scaffold.js';

export interface TranspileOptions {
  framework?: 'react';
  outDir?: string;
  includeStyles?: boolean;
  prettyPrint?: boolean;
}

export interface TranspileResult {
  files: OutputFile[];
  stats: {
    inputLines: number;
    outputLines: number;
    compressionRatio: number;
    components: number;
  };
}

export interface OutputFile {
  path: string;
  content: string;
}

export function transpile(
  ast: AirAST,
  options: TranspileOptions = {},
): TranspileResult {
  // 1. Extract context from AST
  const ctx = extractContext(ast);

  // 2. Analyze UI tree
  const analysis = analyzeUI(ctx.uiNodes);

  // 3. Generate App.jsx
  const appCode = generateApp(ctx, analysis);

  // 4. Generate scaffold files
  const scaffoldFiles = generateScaffold(ctx);

  // 5. Assemble output
  const files: OutputFile[] = [
    ...scaffoldFiles,
    { path: 'src/App.jsx', content: appCode },
  ];

  const outputLines = files.reduce((sum, f) => sum + f.content.split('\n').length, 0);

  return {
    files,
    stats: {
      inputLines: 0,
      outputLines,
      compressionRatio: 0,
      components: analysis.hasPages ? analysis.pages.length : 1,
    },
  };
}
