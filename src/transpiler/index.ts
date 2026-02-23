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
import { createHash } from 'crypto';
import { extractContext } from './context.js';
import { analyzeUI } from './normalize-ui.js';
import { generateApp, generateLayout, generatePageComponents } from './react.js';
import { generateScaffold } from './scaffold.js';
import { generateServer, generateReadme } from './express.js';
import { generateApiClient } from './api-client-gen.js';
import { generateClientTypesFile } from './types-gen.js';
import { generateResourceHooks } from './resource-hook-gen.js';
import { generateDockerCompose } from './deploy-gen.js';
import { generateReusableComponents, detectPatterns } from './component-gen.js';

export interface TranspileOptions {
  framework?: 'react';
  outDir?: string;
  includeStyles?: boolean;
  prettyPrint?: boolean;
  sourceLines?: number;
  target?: 'all' | 'client' | 'server' | 'docs';
}

export interface TranspileResult {
  files: OutputFile[];
  stats: {
    inputLines: number;
    outputLines: number;
    compressionRatio: number;
    components: number;
    modules: number;
    pages: number;
    hooks: number;
    deadLines: number;
    timing: {
      extractMs: number;
      analyzeMs: number;
      clientGenMs: number;
      serverGenMs: number;
      totalMs: number;
    };
  };
}

export interface OutputFile {
  path: string;
  content: string;
}

/**
 * Count lines in generated source files that aren't imported by any other generated file.
 * Entry points (App.jsx, main.jsx, server.ts, seed.ts) are exempt — they're consumed by
 * runtime, not by imports. Config files (json, css, html, prisma) are also exempt.
 */
function computeDeadLines(files: OutputFile[]): number {
  // Collect all import targets from generated files
  const importedPaths = new Set<string>();
  for (const f of files) {
    // Match: import ... from './path' or from '../path'
    const fromMatches = f.content.matchAll(/from\s+['"]([^'"]+)['"]/g);
    for (const m of fromMatches) {
      const raw = m[1];
      const dir = f.path.replace(/\/[^/]+$/, '');
      const resolved = resolveImportPath(dir, raw);
      importedPaths.add(resolved);
    }
    // Match: dynamic imports — import('./path') (used by React.lazy)
    const dynamicMatches = f.content.matchAll(/import\(['"]([^'"]+)['"]\)/g);
    for (const m of dynamicMatches) {
      const raw = m[1];
      const dir = f.path.replace(/\/[^/]+$/, '');
      const resolved = resolveImportPath(dir, raw);
      importedPaths.add(resolved);
    }
  }

  // Entry points, configs, and runtime-consumed files — always useful, not dead
  const entryPatterns = [
    /App\.jsx$/, /main\.jsx$/, /server\.ts$/, /seed\.ts$/,
    /api\.ts$/, /prisma\.ts$/, /middleware\.ts$/, /validation\.ts$/,
    /\.json$/, /\.css$/, /\.html$/, /\.prisma$/, /\.cjs$/, /\.md$/,
    /Layout\.jsx$/, /api\.js$/, /types\.ts$/, /index\.css$/,
    /vite\.config/, /tailwind\.config/, /postcss\.config/,
    // Server block stubs — standalone config files consumed by runtime
    /env\.ts$/, /cron\.ts$/, /queue\.ts$/, /templates\.ts$/, /auth\.ts$/,
  ];

  let dead = 0;
  for (const f of files) {
    // Skip non-source files
    if (!f.path.match(/\.(jsx|js|ts)$/)) continue;
    // Skip entry points
    if (entryPatterns.some(p => p.test(f.path))) continue;
    // Check if any other file imports this one
    const basePath = f.path.replace(/\.(jsx|js|ts)$/, '');
    const isImported = importedPaths.has(basePath) ||
      importedPaths.has(basePath + '.js') ||
      importedPaths.has(basePath + '.jsx') ||
      importedPaths.has(basePath + '.ts') ||
      importedPaths.has(f.path);
    if (!isImported) {
      dead += f.content.split('\n').length;
    }
  }
  return dead;
}

function resolveImportPath(dir: string, importPath: string): string {
  if (!importPath.startsWith('.')) return importPath;
  const parts = dir.split('/');
  for (const segment of importPath.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

export function transpile(
  ast: AirAST,
  options: TranspileOptions = {},
): TranspileResult {
  const totalStart = performance.now();
  const target = options.target ?? 'all';

  // 1. Extract context from AST
  const extractStart = performance.now();
  const ctx = extractContext(ast);
  const extractMs = performance.now() - extractStart;

  // 2. Analyze UI tree
  const analyzeStart = performance.now();
  const analysis = analyzeUI(ctx.uiNodes);
  const analyzeMs = performance.now() - analyzeStart;

  // 3. Generate client files
  const clientStart = performance.now();
  const files: OutputFile[] = [];

  if (target !== 'server' && target !== 'docs') {
    const appCode = generateApp(ctx, analysis);
    const scaffoldFiles = generateScaffold(ctx);

    if (ctx.hasBackend) {
      files.push(...scaffoldFiles.map(f => ({ ...f, path: `client/${f.path}` })));
      files.push({ path: 'client/src/App.jsx', content: appCode });
      const layoutCode = generateLayout(ctx, analysis);
      if (layoutCode) {
        files.push({ path: 'client/src/Layout.jsx', content: layoutCode });
      }
      if (ctx.apiRoutes.length > 0) {
        files.push({ path: 'client/src/api.js', content: generateApiClient(ctx) });
      }
      if (ctx.db) {
        files.push({ path: 'client/src/types.ts', content: generateClientTypesFile(ctx) });
      }

      // Page components (extracted from @page scopes)
      const pageFiles = generatePageComponents(ctx, analysis);
      files.push(...pageFiles.map(f => ({ ...f, path: `client/${f.path}` })));

      // Resource hooks — only for models with matching array state vars
      const hookFiles = generateResourceHooks(ctx);
      files.push(...hookFiles.map(f => ({ ...f, path: `client/${f.path}` })));

      // Reusable components (DataTable, EmptyState, StatCard) when patterns detected
      const componentFiles = generateReusableComponents(ctx, analysis);
      files.push(...componentFiles.map(f => ({ ...f, path: `client/${f.path}` })));
    } else {
      // Frontend-only: flat (backward compatible)
      files.push(...scaffoldFiles);
      files.push({ path: 'src/App.jsx', content: appCode });
    }
  }
  const clientGenMs = performance.now() - clientStart;

  // 4. Generate server files
  const serverStart = performance.now();
  if (ctx.hasBackend && target !== 'client') {
    if (target === 'docs') {
      files.push({ path: 'README.md', content: generateReadme(ctx) });
      if (ctx.db) {
        files.push({ path: 'client/src/types.ts', content: generateClientTypesFile(ctx) });
      }
    } else {
      files.push(...generateServer(ctx));
      files.push({ path: 'README.md', content: generateReadme(ctx) });

      if (ctx.deploy) {
        const compose = generateDockerCompose(ctx);
        if (compose) files.push({ path: 'docker-compose.yml', content: compose });
      }
    }
  }
  const serverGenMs = performance.now() - serverStart;

  // Count page components and hooks
  const pageCount = files.filter(f => f.path.includes('/pages/') && f.path.endsWith('Page.jsx')).length;
  const hookCount = files.filter(f => f.path.includes('/hooks/') && f.path.startsWith('client/')).length;

  // Dead lines: lines in .jsx/.js/.ts files not imported by any other generated file
  // (computed before provenance headers since those don't affect import analysis)
  const deadLines = computeDeadLines(files);

  // Prepend provenance header to generated source files
  const provenance = `// Generated by AirEngine v0.1.7 from ${ctx.appName}.air`;
  for (const f of files) {
    if (/\.(jsx|tsx|ts|js)$/.test(f.path)) {
      f.content = provenance + '\n' + f.content;
    }
  }

  // Codegen manifest (6B) — add _airengine_manifest.json
  const sourceHash = createHash('sha256')
    .update(JSON.stringify(ast))
    .digest('hex')
    .slice(0, 16);
  const manifest = {
    generatedBy: 'AirEngine',
    version: '0.1.7',
    sourceHash,
    files: files.map(f => ({
      path: f.path,
      hash: createHash('sha256').update(f.content).digest('hex').slice(0, 16),
      lines: f.content.split('\n').length,
    })),
    timestamp: new Date().toISOString(),
  };
  files.push({ path: '_airengine_manifest.json', content: JSON.stringify(manifest, null, 2) + '\n' });

  // Compute outputLines AFTER provenance headers and manifest are added
  const outputLines = files.reduce((sum, f) => sum + f.content.split('\n').length, 0);

  const inputLines = options.sourceLines ?? 0;
  const totalMs = performance.now() - totalStart;

  return {
    files,
    stats: {
      inputLines,
      outputLines,
      compressionRatio: inputLines > 0 ? Math.round(outputLines / inputLines * 10) / 10 : 0,
      components: analysis.hasPages ? analysis.pages.length : 1,
      modules: files.length,
      pages: pageCount,
      hooks: hookCount,
      deadLines,
      timing: {
        extractMs: Math.round(extractMs * 100) / 100,
        analyzeMs: Math.round(analyzeMs * 100) / 100,
        clientGenMs: Math.round(clientGenMs * 100) / 100,
        serverGenMs: Math.round(serverGenMs * 100) / 100,
        totalMs: Math.round(totalMs * 100) / 100,
      },
    },
  };
}
