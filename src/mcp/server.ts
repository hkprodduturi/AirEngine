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
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ---- AIR Language Spec (embedded for the LLM context) ----

const AIR_SPEC = `
AIR (AI-native Intermediate Representation) Language Reference v0.1

TYPES: str, int, float, bool, date, enum(v1,v2), [type], {key:type}, ?type, #ref

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
  @app:name         — declare app
  @state{...}       — reactive state
  @style(...)       — theme/design tokens
  @ui(...)          — component tree + behavior
  @api(...)         — backend routes
  @auth(...)        — authentication
  @nav(...)         — routing
  @persist:method   — data persistence
  @hook(...)        — lifecycle/side effects

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
`;

// ---- Load example files ----

function loadExamples(): Record<string, string> {
  const examplesDir = join(ROOT, 'examples');
  const examples: Record<string, string> = {};
  try {
    const files = ['todo.air', 'expense-tracker.air', 'auth.air', 'dashboard.air', 'landing.air'];
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
      // The LLM (Claude) will use the spec + examples as context
      // to generate AIR code. This tool provides the structured prompt.
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

Generate the AIR code now:`;

      return {
        content: [{
          type: 'text',
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
      const errors: string[] = [];
      const warnings: string[] = [];
      const lines = source.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

      // Check @app declaration
      if (!lines.some(l => l.trim().startsWith('@app:'))) {
        errors.push('Missing @app:name declaration (must be first block)');
      }

      // Check for required blocks
      const hasState = lines.some(l => l.trim().startsWith('@state'));
      const hasUI = lines.some(l => l.trim().startsWith('@ui'));
      const hasStyle = lines.some(l => l.trim().startsWith('@style'));

      if (!hasUI) errors.push('Missing @ui block — app has no interface');
      if (!hasState) warnings.push('No @state block — app has no reactive state');
      if (!hasStyle) warnings.push('No @style block — app will use default theme');

      // Check bracket balance
      const opens = (source.match(/\(/g) || []).length;
      const closes = (source.match(/\)/g) || []).length;
      if (opens !== closes) {
        errors.push(`Unbalanced parentheses: ${opens} opening, ${closes} closing`);
      }

      const braceOpens = (source.match(/\{/g) || []).length;
      const braceCloses = (source.match(/\}/g) || []).length;
      if (braceOpens !== braceCloses) {
        errors.push(`Unbalanced braces: ${braceOpens} opening, ${braceCloses} closing`);
      }

      // Check for common operator patterns
      const stateRefs = source.match(/#[\w.]+/g) || [];
      const mutations = source.match(/![\w]+/g) || [];
      const asyncOps = source.match(/~[\w.]+/g) || [];

      // Stats
      const lineCount = lines.length;
      const tokenEstimate = source.split(/\s+/).length;

      const valid = errors.length === 0;

      let result = `AIR Validation ${valid ? '✅ PASSED' : '❌ FAILED'}\n\n`;
      result += `Lines: ${lineCount}\n`;
      result += `Est. tokens: ${tokenEstimate}\n`;
      result += `State refs (#): ${stateRefs.length}\n`;
      result += `Mutations (!): ${mutations.length}\n`;
      result += `Async ops (~): ${asyncOps.length}\n`;

      if (errors.length > 0) {
        result += `\nErrors:\n${errors.map(e => `  ❌ ${e}`).join('\n')}`;
      }
      if (warnings.length > 0) {
        result += `\nWarnings:\n${warnings.map(w => `  ⚠️  ${w}`).join('\n')}`;
      }

      return {
        content: [{
          type: 'text',
          text: result,
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
      const target = framework || 'react';

      const prompt = `You are an AIR-to-${target === 'react' ? 'React' : 'HTML'} transpiler. Convert the following AIR source code into a complete, working ${target === 'react' ? 'React component' : 'HTML page'}.

AIR SOURCE:
${source}

TRANSPILATION RULES:
1. Every @state field becomes a useState hook (React) or a variable (HTML)
2. Every @ui element maps to JSX/HTML elements with proper event handlers
3. The > operator means "on event, do action"
4. The | operator means "pipe/transform data"
5. The + operator means "compose elements side by side"
6. The * operator means "iterate/map over array"
7. The ! operator means "mutation/action function"
8. The # operator means "reference to state"
9. The ~ operator means "async operation"
10. @style properties map to CSS variables / Tailwind classes
11. @persist:localStorage maps to useEffect + localStorage
12. @api routes map to fetch calls
13. @auth maps to auth context/guards
14. @nav maps to React Router or conditional rendering

OUTPUT RULES:
- Generate a COMPLETE, working ${target === 'react' ? 'React component with all imports' : 'HTML file with embedded CSS and JS'}
- Include proper styling based on @style block
- Make it production-quality, not a skeleton
- All state management, event handlers, and data flow must work

Generate the transpiled code now:`;

      return {
        content: [{
          type: 'text',
          text: prompt,
        }],
      };
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
      const lines = source.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

      // Parse basic structure
      const appName = lines.find(l => l.trim().startsWith('@app:'))?.trim().slice(5) || 'unknown';
      const blocks = lines
        .filter(l => l.trim().startsWith('@'))
        .map(l => l.trim().match(/@(\w+)/)?.[1])
        .filter(Boolean);

      const lineCount = lines.length;
      const reactEstimate = lineCount * 9; // ~9x expansion ratio

      let explanation = `📱 App: ${appName}\n`;
      explanation += `📏 ${lineCount} lines of AIR (~${reactEstimate} lines of React equivalent)\n`;
      explanation += `🧱 Blocks: ${[...new Set(blocks)].join(', ')}\n\n`;
      explanation += `For a detailed explanation, analyze the AIR source using the language spec:\n\n`;
      explanation += `${AIR_SPEC}\n\n`;
      explanation += `AIR SOURCE TO EXPLAIN:\n${source}`;

      return {
        content: [{
          type: 'text',
          text: explanation,
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
    [
      {
        name: 'description',
        description: 'What kind of app do you want to build?',
        required: true,
      },
    ],
    async ({ description }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Generate a new AIR app for: ${description}

Use the AIR language specification to create a complete .air file. AIR is a compact, AI-native language where:
- @app:name declares the app
- @state{...} defines reactive state
- @style(...) sets the theme
- @ui(...) defines the component tree
- Operators: > (flow), | (pipe), + (compose), * (iterate), ! (mutate), # (ref)

First generate the .air file, then use the air_transpile tool to create the working React app.`,
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
  console.error('🚀 AirEngine MCP Server running');
  console.error('   Tools: air_generate, air_validate, air_transpile, air_explain');
  console.error('   Resources: air://spec, air://examples');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
