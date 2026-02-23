/**
 * AIR Transpiler — Orchestrator
 *
 * Converts a validated AirAST into a working application.
 *
 * Frontend-only .air files → flat Vite + React + Tailwind project.
 * Fullstack .air files (with @db, @api, etc.) → client/ + server/ structure.
 *
 * Pure function — no file I/O.
 */

import type { AirAST } from '../parser/types.js';
import { extractContext } from './context.js';
import { analyzeUI } from './normalize-ui.js';
import { generateApp } from './react.js';
import { generateScaffold } from './scaffold.js';
import { generateServer } from './express.js';
import { generateApiClient } from './api-client-gen.js';

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
  const files: OutputFile[] = [];

  if (ctx.hasBackend) {
    // Fullstack: client/ + server/
    files.push(...scaffoldFiles.map(f => ({ ...f, path: `client/${f.path}` })));
    files.push({ path: 'client/src/App.jsx', content: appCode });
    if (ctx.apiRoutes.length > 0) {
      files.push({ path: 'client/src/api.js', content: generateApiClient(ctx) });
    }
    files.push(...generateServer(ctx));
  } else {
    // Frontend-only: flat (backward compatible)
    files.push(...scaffoldFiles);
    files.push({ path: 'src/App.jsx', content: appCode });
  }

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
