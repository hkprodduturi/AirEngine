#!/usr/bin/env node

/**
 * AirEngine MCP Server
 *
 * Exposes AIR language tools to Claude Desktop / Claude Code via MCP.
 * This lets Claude natively generate, validate, and transpile AIR files.
 *
 * Tools:
 *   - air_generate:   Generate .air from natural language description
 *   - air_validate:   Validate AIR source code
 *   - air_transpile:  Transpile AIR to React app code
 *   - air_explain:    Explain what an AIR file does in plain English
 *
 * Resources:
 *   - air://spec       AIR language specification
 *   - air://examples   Example .air files
 *
 * Usage with Claude Desktop:
 *   Add to claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "airengine": {
 *         "command": "npx",
 *         "args": ["tsx", "/path/to/airengine/src/mcp/server.ts"]
 *       }
 *     }
 *   }
 *
 * Usage with Claude Code (.mcp.json in project root):
 *   {
 *     "mcpServers": {
 *       "airengine": {
 *         "command": "npx",
 *         "args": ["tsx", "src/mcp/server.ts"]
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { parse } from '../parser/index.js';
import { validate } from '../validator/index.js';
import { transpile } from '../transpiler/index.js';
import { extractContext } from '../transpiler/context.js';
import { analyzeUI } from '../transpiler/normalize-ui.js';
import { AirParseError, AirLexError } from '../parser/errors.js';
import type { AirAST } from '../parser/types.js';
import type { TranspileContext } from '../transpiler/context.js';
import type { TranspileResult } from '../transpiler/index.js';

const ROOT = join(__dirname, '..', '..');

// ---- Session-Level AST Cache (5A) ----

interface CacheEntry {
  ast: AirAST;
  ctx: TranspileContext;
  result: TranspileResult;
  timestamp: number;
}

const astCache = new Map<string, CacheEntry>();
const transpileReturned = new Set<string>(); // tracks source hashes whose full transpile has been sent
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function hashSource(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

function evictStale(): void {
  const now = Date.now();
  for (const [key, entry] of astCache) {
    if (now - entry.timestamp > CACHE_TTL) {
      astCache.delete(key);
      transpileReturned.delete(key);
    }
  }
}

function getCachedOrParse(source: string): { ast: AirAST; ctx: TranspileContext; result: TranspileResult; cached: boolean } {
  evictStale();
  const hash = hashSource(source);
  const existing = astCache.get(hash);
  if (existing) {
    existing.timestamp = Date.now(); // refresh TTL
    return { ast: existing.ast, ctx: existing.ctx, result: existing.result, cached: true };
  }
  const ast = parse(source);
  const ctx = extractContext(ast);
  const result = transpile(ast);
  astCache.set(hash, { ast, ctx, result, timestamp: Date.now() });
  return { ast, ctx, result, cached: false };
}

// ---- AIR Language Spec (embedded for the LLM context) ----

const AIR_SPEC = `
AIR (AI-native Intermediate Representation) Language Reference v0.1

TYPES: str, int, float, bool, date, datetime, enum(v1,v2), [type], {key:type}, ?type, #ref

OPERATORS:
  >  flow (input>items.push = on input, push to items)
  |  pipe (items|filter = pipe through filter)
  +  compose (text+btn = text AND button)
  :  bind (theme:dark)
  ?  conditional (?auth>dash:login)
  *  iterate (*item(card) = for each item)
  !  mutate (!delete(id))
  #  reference (#user.name)
  ~  async (~api.get(/users))
  ^  emit (^notify("saved"))

BLOCKS:
  @app:name           — declare app
  @state{...}         — reactive state
  @style(...)         — theme/design tokens
  @ui(...)            — component tree + behavior
  @api(...)           — backend routes (GET, POST, PUT, DELETE, CRUD)
  @auth(...)          — authentication
  @nav(...)           — routing
  @persist:method     — data persistence
  @hook(...)          — lifecycle/side effects
  @db{...}            — database models with field modifiers (:primary, :required, :auto, :default(val))
  @cron(...)          — scheduled jobs
  @webhook(...)       — incoming webhook endpoints
  @queue(...)         — background job queues
  @email(...)         — email templates
  @env(...)           — environment variables
  @deploy(...)        — deployment config

DB FIELD MODIFIERS:
  :primary   — primary key
  :required  — non-nullable
  :auto      — auto-increment (int) or auto-timestamp (datetime)
  :default(v) — default value

UI ELEMENTS:
  header, footer, main, sidebar, row, grid, grid:N, grid:responsive
  input:text, input:number, input:email, select, tabs, toggle
  btn, btn:primary, btn:ghost, btn:icon
  text, h1, h2, p, list, table, card, badge, alert
  chart:line, chart:bar, stat, progress:bar, spinner, img, icon
  search:input, pagination, daterange, form
  @section:name(...), @page:name(...)

EXAMPLE — Todo App:
  @app:todo
    @state{items:[{id:int,text:str,done:bool}],filter:enum(all,active,done)}
    @style(theme:dark,accent:#6366f1,radius:12,font:sans)
    @ui(
      header>"Todo App"+badge:#items.length
      input:text>!add({text:#val,done:false})
      list>items|filter>*item(check:#item.done+text:#item.text+btn:!del(#item.id))
      tabs>filter.set(all,active,done)
      footer>"#items|!done.length items left"
    )
    @persist:localStorage(items)

EXAMPLE — Fullstack Todo (with DB + API):
  @app:fullstack-todo
    @state{items:[{id:int,text:str,done:bool}],filter:enum(all,active,done)}
    @style(theme:dark,accent:#6366f1,radius:12,font:sans)
    @db{
      Todo{id:int:primary:auto,text:str:required,done:bool:default(false),created_at:datetime:auto}
    }
    @api(
      GET:/todos>~db.Todo.findMany
      POST:/todos(text:str)>~db.Todo.create
      PUT:/todos/:id(done:bool)>~db.Todo.update
      DELETE:/todos/:id>~db.Todo.delete
    )
    @ui(
      header>"Todo App"+badge:#items.length
      input:text>!add({text:#val,done:false})
      list>items|filter>*item(check:#item.done+text:#item.text+btn:icon:!del(#item.id))
      tabs>filter.set(all,active,done)
      footer>"#items|!done.length items left"
    )
    @persist:localStorage(items)
`;

// ---- Load example files ----

function loadExamples(): Record<string, string> {
  const examplesDir = join(ROOT, 'examples');
  const examples: Record<string, string> = {};
  try {
    const files = ['todo.air', 'expense-tracker.air', 'auth.air', 'dashboard.air', 'landing.air', 'fullstack-todo.air'];
    for (const file of files) {
      try {
        examples[file] = readFileSync(join(examplesDir, file), 'utf-8');
      } catch {
        // skip if file doesn't exist
      }
    }
  } catch {
    // examples dir doesn't exist
  }
  return examples;
}

// ---- Helpers ----

/** Safely parse AIR source, returning AST or structured error */
function safeParse(source: string): { ast: AirAST } | { error: string; line?: number; col?: number } {
  try {
    return { ast: parse(source) };
  } catch (err) {
    if (err instanceof AirParseError) {
      return { error: err.message, line: err.line, col: err.col };
    }
    if (err instanceof AirLexError) {
      return { error: err.message, line: err.line, col: err.col };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Count fields across all state blocks */
function countStateFields(ast: AirAST): number {
  return ast.app.blocks
    .filter(b => b.kind === 'state')
    .reduce((sum, b) => sum + (b.kind === 'state' ? b.fields.length : 0), 0);
}

/** Count API routes */
function countRoutes(ast: AirAST): number {
  return ast.app.blocks
    .filter(b => b.kind === 'api')
    .reduce((sum, b) => sum + (b.kind === 'api' ? b.routes.length : 0), 0);
}

/** Count DB models */
function countDbModels(ast: AirAST): number {
  return ast.app.blocks
    .filter(b => b.kind === 'db')
    .reduce((sum, b) => sum + (b.kind === 'db' ? b.models.length : 0), 0);
}

// ---- Create MCP Server ----

async function main() {
  const server = new McpServer({
    name: 'AirEngine',
    version: '0.1.7',
  });

  const examples = loadExamples();

  // ============================================
  // RESOURCES
  // ============================================

  // AIR Language Spec
  server.resource(
    'air-spec',
    'air://spec',
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: AIR_SPEC,
      }],
    })
  );

  // Example AIR files
  server.resource(
    'air-examples',
    'air://examples',
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: Object.entries(examples)
          .map(([name, content]) => `=== ${name} ===\n${content}`)
          .join('\n\n'),
      }],
    })
  );

  // ============================================
  // TOOLS
  // ============================================

  // Tool: Generate AIR from natural language
  server.tool(
    'air_generate',
    'Generate AIR (.air) code from a natural language app description. Returns compact AIR source that can be transpiled to a working React app. Use this instead of generating React/HTML directly — AIR is 9x more compact.',
    {
      description: z.string().describe('Natural language description of the app to build'),
      complexity: z.enum(['simple', 'medium', 'complex']).optional().describe('Expected complexity level'),
    },
    async ({ description, complexity }) => {
      const prompt = `You are an AIR language code generator. Using the AIR language specification below, generate a complete .air file for the following app:

APP DESCRIPTION: ${description}
COMPLEXITY: ${complexity || 'medium'}

${AIR_SPEC}

RULES:
1. Output ONLY valid AIR code — no markdown, no explanation, no backticks
2. Always start with @app:name
3. Always include @state, @style, and @ui blocks
4. Use appropriate operators (>, |, +, *, !, #, ~)
5. Keep it as compact as possible — this is AI-native code
6. Add @persist if the app needs data persistence
7. Add @api if the app needs backend routes
8. Add @auth if the app needs authentication
9. Add @nav if the app has multiple pages
10. Add @db with field modifiers (:primary, :required, :auto, :default) for database models
11. Add @cron for scheduled jobs, @webhook for incoming webhooks
12. Add @env for environment variables, @deploy for deployment config

Generate the AIR code now:`;

      return {
        content: [{
          type: 'text' as const,
          text: prompt,
        }],
      };
    }
  );

  // Tool: Validate AIR source
  server.tool(
    'air_validate',
    'Validate AIR source code for correctness. Checks syntax, block structure, state references, and operator usage.',
    {
      source: z.string().describe('AIR source code to validate'),
    },
    async ({ source }) => {
      // Use cache for parse + context
      const parseResult = safeParse(source);

      if ('error' in parseResult) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              valid: false,
              error: parseResult.error,
              location: parseResult.line ? { line: parseResult.line, col: parseResult.col } : null,
            }, null, 2),
          }],
        };
      }

      const { ast, cached } = (() => {
        try {
          const c = getCachedOrParse(source);
          return { ast: c.ast, cached: c.cached };
        } catch {
          return { ast: parseResult.ast, cached: false };
        }
      })();

      const validation = validate(ast);

      const blockCount = ast.app.blocks.length;
      const blockTypes = ast.app.blocks.map(b => b.kind);
      const fieldCount = countStateFields(ast);
      const routeCount = countRoutes(ast);
      const modelCount = countDbModels(ast);

      const result = {
        valid: validation.valid,
        appName: ast.app.name,
        blocks: blockCount,
        blockTypes,
        stateFields: fieldCount,
        apiRoutes: routeCount,
        dbModels: modelCount,
        errors: validation.errors,
        warnings: validation.warnings,
        cached,
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  // Tool: Transpile AIR to React (5B: diff-first responses)
  server.tool(
    'air_transpile',
    'Transpile AIR source code into a working React application. Returns changed files on repeated calls for the same source.',
    {
      source: z.string().describe('AIR source code to transpile'),
      framework: z.enum(['react']).optional().describe('Target framework (default: react)'),
    },
    async ({ source, framework }) => {
      if (framework && framework !== 'react') {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `Unsupported framework '${framework}'. Only 'react' is currently supported.`,
            }, null, 2),
          }],
        };
      }

      const parseResult = safeParse(source);

      if ('error' in parseResult) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: parseResult.error,
              location: parseResult.line ? { line: parseResult.line, col: parseResult.col } : null,
            }, null, 2),
          }],
        };
      }

      try {
        const { ast, ctx, result } = getCachedOrParse(source);
        const sourceHash = hashSource(source);

        const totalLines = result.stats.outputLines;
        const processedBlocks = ast.app.blocks.map(b => b.kind);

        // Only return incremental (empty diff) if we've already sent full files for this source
        if (transpileReturned.has(sourceHash)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                incremental: true,
                changedFiles: [],
                removedFiles: [],
                unchangedCount: result.files.length,
                stats: {
                  fileCount: result.files.length,
                  totalLines,
                  hasBackend: ctx.hasBackend,
                  processedBlocks,
                  components: result.stats.components,
                  timing: result.stats.timing,
                },
              }, null, 2),
            }],
          };
        }

        // First transpile call for this source — return all files
        transpileReturned.add(sourceHash);
        let files: Array<{ path: string; lines: number; content?: string; preview?: string }>;
        if (totalLines <= 5000) {
          files = result.files.map(f => ({
            path: f.path,
            lines: f.content.split('\n').length,
            content: f.content,
          }));
        } else {
          files = result.files.map(f => {
            const contentLines = f.content.split('\n');
            return {
              path: f.path,
              lines: contentLines.length,
              preview: contentLines.slice(0, 20).join('\n') + '\n// ... truncated',
            };
          });
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              incremental: false,
              stats: {
                fileCount: result.files.length,
                totalLines,
                hasBackend: ctx.hasBackend,
                processedBlocks,
                components: result.stats.components,
                timing: result.stats.timing,
              },
              files,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }, null, 2),
          }],
        };
      }
    }
  );

  // Tool: Explain AIR code
  server.tool(
    'air_explain',
    'Explain what an AIR file does in plain English. Useful for understanding existing .air files.',
    {
      source: z.string().describe('AIR source code to explain'),
    },
    async ({ source }) => {
      const parseResult = safeParse(source);

      if ('error' in parseResult) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: parseResult.error,
              location: parseResult.line ? { line: parseResult.line, col: parseResult.col } : null,
            }, null, 2),
          }],
        };
      }

      try {
        const { ast, ctx, cached } = getCachedOrParse(source);

        const blockTypes = ast.app.blocks.map(b => b.kind);
        const stateFields = ast.app.blocks
          .filter(b => b.kind === 'state')
          .flatMap(b => b.kind === 'state' ? b.fields.map(f => f.name) : []);

        const dbModels = ast.app.blocks
          .filter(b => b.kind === 'db')
          .flatMap(b => b.kind === 'db' ? b.models.map(m => m.name) : []);

        const hooks = ast.app.blocks
          .filter(b => b.kind === 'hook')
          .flatMap(b => b.kind === 'hook' ? b.hooks.map(h => h.trigger) : []);

        const analysis = {
          appName: ast.app.name,
          blockTypes,
          stateFields,
          apiRoutes: countRoutes(ast),
          dbModels,
          hooks,
          hasBackend: ctx.hasBackend,
          persistMethod: ctx.persistKeys.length > 0 ? ctx.persistMethod : null,
          persistKeys: ctx.persistKeys,
          cached,
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(analysis, null, 2),
          }],
        };
      } catch {
        // Fall back to non-cached path
        const ast = parseResult.ast;
        const ctx = extractContext(ast);
        const blockTypes = ast.app.blocks.map(b => b.kind);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ appName: ast.app.name, blockTypes, hasBackend: ctx.hasBackend }, null, 2),
          }],
        };
      }
    }
  );

  // Tool: Lint AIR source (5C)
  server.tool(
    'air_lint',
    'Detect common issues in AIR source before transpiling. Checks for unused state, missing API routes, ambiguous relations, and other patterns.',
    {
      source: z.string().describe('AIR source code to lint'),
    },
    async ({ source }) => {
      const parseResult = safeParse(source);

      if ('error' in parseResult) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              hints: [{ level: 'error', message: parseResult.error }],
            }, null, 2),
          }],
        };
      }

      try {
        const { ast, ctx } = getCachedOrParse(source);
        const hints: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];

        // Check: unused state fields (state fields not referenced in @ui)
        const uiSource = JSON.stringify(ast.app.blocks.filter(b => b.kind === 'ui'));
        for (const block of ast.app.blocks) {
          if (block.kind === 'state') {
            for (const field of block.fields) {
              if (!uiSource.includes(field.name) && !uiSource.includes(`#${field.name}`)) {
                hints.push({ level: 'warn', message: `State field '${field.name}' may be unused in @ui` });
              }
            }
          }
        }

        // Check: @api routes without matching @db models
        if (ctx.apiRoutes.length > 0 && ctx.db) {
          const modelNames = new Set(ctx.db.models.map(m => m.name));
          for (const route of ctx.expandedRoutes) {
            const match = route.handler.match(/~db\.(\w+)\./);
            if (match && !modelNames.has(match[1])) {
              hints.push({ level: 'error', message: `API route ${route.method} ${route.path} references unknown model '${match[1]}'` });
            }
          }
        }

        // Check: @db models without @api routes
        if (ctx.db && ctx.apiRoutes.length === 0) {
          hints.push({ level: 'warn', message: '@db models defined but no @api routes — models won\'t be accessible' });
        }

        // Check: missing @persist on stateful apps
        const hasState = ast.app.blocks.some(b => b.kind === 'state');
        const hasPersist = ast.app.blocks.some(b => b.kind === 'persist');
        if (hasState && !hasPersist && !ctx.hasBackend) {
          hints.push({ level: 'info', message: 'Frontend-only app with @state but no @persist — data won\'t survive page refresh' });
        }

        // Check: ambiguous relations
        if (ctx.db) {
          const { resolveRelations } = await import('../transpiler/prisma.js');
          const { ambiguous } = resolveRelations(ctx.db);
          for (const a of ambiguous) {
            hints.push({ level: 'warn', message: `Ambiguous relation ${a.from}<>${a.to}: ${a.reason}` });
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ hints }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              hints: [{ level: 'error', message: err instanceof Error ? err.message : String(err) }],
            }, null, 2),
          }],
        };
      }
    }
  );

  // Tool: Capabilities introspection (5D)
  server.tool(
    'air_capabilities',
    'Returns supported AIR blocks, targets, options, and version. Use this to check what features are available before generating AIR code.',
    {},
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            version: '0.1.7',
            blocks: [
              'app', 'state', 'style', 'ui', 'api', 'auth', 'nav', 'persist', 'hook',
              'db', 'cron', 'webhook', 'queue', 'email', 'env', 'deploy',
            ],
            targets: ['all', 'client', 'server', 'docs'],
            frameworks: ['react'],
            dbFieldModifiers: ['primary', 'required', 'auto', 'default'],
            referentialActions: ['cascade', 'set-null', 'restrict'],
            uiElements: [
              'header', 'footer', 'main', 'sidebar', 'row', 'grid',
              'input', 'select', 'tabs', 'toggle', 'btn', 'text', 'h1', 'h2', 'p',
              'list', 'table', 'card', 'badge', 'alert', 'chart', 'stat',
              'progress', 'spinner', 'img', 'icon', 'search', 'pagination',
              'daterange', 'form', 'check', 'logo', 'nav', 'slot',
            ],
            operators: {
              '>': 'flow',
              '|': 'pipe',
              '+': 'compose',
              ':': 'bind',
              '?': 'conditional',
              '*': 'iterate',
              '!': 'mutate',
              '#': 'reference',
              '~': 'async',
              '^': 'emit',
            },
            persistMethods: ['localStorage', 'cookie'],
          }, null, 2),
        }],
      };
    }
  );

  // ============================================
  // PROMPTS
  // ============================================

  server.prompt(
    'air-new-app',
    'Generate a new app using AIR language',
    {
      description: z.string().describe('What kind of app do you want to build?'),
    },
    async ({ description }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Generate a new AIR app for: ${description}

Use the AIR language specification to create a complete .air file. AIR is a compact, AI-native language where:
- @app:name declares the app
- @state{...} defines reactive state
- @style(...) sets the theme
- @ui(...) defines the component tree
- Operators: > (flow), | (pipe), + (compose), * (iterate), ! (mutate), # (ref)
- @db{...} defines database models with :primary, :required, :auto, :default modifiers
- @api(...) defines backend routes mapped to db operations
- @cron, @webhook, @queue, @email, @env, @deploy for full-stack features

First generate the .air file, then use the air_transpile tool to create the working app.`,
        },
      }],
    })
  );

  // ============================================
  // START SERVER
  // ============================================

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error('AirEngine MCP Server running');
  console.error('   Tools: air_generate, air_validate, air_transpile, air_explain, air_lint, air_capabilities');
  console.error('   Resources: air://spec, air://examples');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
