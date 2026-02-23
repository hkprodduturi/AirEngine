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
import { join } from 'path';
import { parse } from '../parser/index.js';
import { validate } from '../validator/index.js';
import { transpile } from '../transpiler/index.js';
import { extractContext } from '../transpiler/context.js';
import { AirParseError, AirLexError } from '../parser/errors.js';
import type {
  AirAST, AirDbBlock, AirAPIBlock, AirAuthBlock,
  AirCronBlock, AirWebhookBlock, AirQueueBlock,
  AirEmailBlock, AirEnvBlock, AirDeployBlock,
} from '../parser/types.js';

const ROOT = join(__dirname, '..', '..');

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
    version: '0.1.0',
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
      // Step 1: Parse
      const parseResult = safeParse(source);

      if ('error' in parseResult) {
        const loc = parseResult.line ? ` (line ${parseResult.line}:${parseResult.col})` : '';
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

      const ast = parseResult.ast;

      // Step 2: Validate
      const validation = validate(ast);

      // Step 3: Collect stats
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
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  // Tool: Transpile AIR to React
  server.tool(
    'air_transpile',
    'Transpile AIR source code into a working React application. Returns the full React component code.',
    {
      source: z.string().describe('AIR source code to transpile'),
      framework: z.enum(['react', 'html']).optional().describe('Target framework (default: react)'),
    },
    async ({ source, framework }) => {
      // Step 1: Parse
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

      const ast = parseResult.ast;

      // Step 2: Transpile
      try {
        const result = transpile(ast);
        const ctx = extractContext(ast);

        // Build file metadata
        const fileMeta = result.files.map(f => ({
          path: f.path,
          lines: f.content.split('\n').length,
        }));

        const totalLines = result.stats.outputLines;

        // Determine which blocks were processed
        const processedBlocks = ast.app.blocks.map(b => b.kind);

        // Include full contents only if under 5000 lines
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

        const output = {
          success: true,
          stats: {
            fileCount: result.files.length,
            totalLines,
            hasBackend: ctx.hasBackend,
            processedBlocks,
            components: result.stats.components,
          },
          files,
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(output, null, 2),
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
      // Step 1: Parse
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

      const ast = parseResult.ast;

      // Step 2: Analyze
      const blockTypes = ast.app.blocks.map(b => b.kind);
      const stateFields = ast.app.blocks
        .filter(b => b.kind === 'state')
        .flatMap(b => b.kind === 'state' ? b.fields.map(f => f.name) : []);

      const routeCount = countRoutes(ast);
      const modelCount = countDbModels(ast);
      const dbModels = ast.app.blocks
        .filter(b => b.kind === 'db')
        .flatMap(b => b.kind === 'db' ? b.models.map(m => m.name) : []);

      const hooks = ast.app.blocks
        .filter(b => b.kind === 'hook')
        .flatMap(b => b.kind === 'hook' ? b.hooks.map(h => h.trigger) : []);

      const ctx = extractContext(ast);

      const analysis = {
        appName: ast.app.name,
        blockTypes,
        stateFields,
        apiRoutes: routeCount,
        dbModels,
        hooks,
        hasBackend: ctx.hasBackend,
        persistMethod: ctx.persistKeys.length > 0 ? ctx.persistMethod : null,
        persistKeys: ctx.persistKeys,
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(analysis, null, 2),
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
  console.error('   Tools: air_generate, air_validate, air_transpile, air_explain');
  console.error('   Resources: air://spec, air://examples');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
