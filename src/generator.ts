/**
 * AirEngine Generator Adapter — Pluggable prompt-to-.air generation (A5b + A5c)
 *
 * Defines the adapter interface for converting a natural-language prompt
 * into AIR source code. Implementations:
 *   - ReplayAdapter: deterministic fixture-backed (offline, no LLM)
 *   - NoopAdapter: always returns error (for testing)
 *   - ClaudeAdapter: LLM-backed generation via Anthropic Messages API (A5c)
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { parse } from './parser/index.js';

// ---- Types ----

export interface GeneratorContext {
  /** Optional adapter-specific hint (e.g. fixture ID for replay) */
  fixtureId?: string;
  /** Max generation time in ms (for future async adapters) */
  timeoutMs?: number;
}

export interface GeneratorResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Generated AIR source (empty string on failure) */
  source: string;
  /** Adapter metadata */
  metadata: {
    adapter: string;
    fixtureId?: string;
    promptHash: string;
    durationMs: number;
    model?: string;
    attempts?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  /** Structured error on failure */
  error?: string;
}

export interface GeneratorAdapter {
  readonly name: string;
  generate(prompt: string, context?: GeneratorContext): GeneratorResult | Promise<GeneratorResult>;
}

// ---- Claude Adapter Types ----

export interface ClaudeAdapterOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

// ---- AIR Language Spec (shared by MCP server + Claude adapter) ----

export const AIR_SPEC = `
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

// ---- Prompt hash helper ----

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

// ---- Replay Fixtures ----

/**
 * Maps known prompt strings to example .air file paths.
 * Each entry is a deterministic fixture: same prompt always yields same source.
 */
const REPLAY_FIXTURES: Record<string, { fixtureId: string; file: string; description: string }> = {
  'build a todo app': {
    fixtureId: 'todo',
    file: 'examples/todo.air',
    description: 'Simple todo app with state and UI',
  },
  'build a fullstack todo app with database': {
    fixtureId: 'fullstack-todo',
    file: 'examples/fullstack-todo.air',
    description: 'Fullstack todo with Prisma, API, auth',
  },
  'build a landing page': {
    fixtureId: 'landing',
    file: 'examples/landing.air',
    description: 'Static landing page with sections',
  },
  'build a dashboard with auth': {
    fixtureId: 'dashboard',
    file: 'examples/dashboard.air',
    description: 'Dashboard with authentication and charts',
  },
  'build an expense tracker': {
    fixtureId: 'expense-tracker',
    file: 'examples/expense-tracker.air',
    description: 'Expense tracking app with categories',
  },
};

/**
 * Reverse lookup: fixture ID -> prompt + file.
 * Allows --fixture-id as an alternative to --prompt.
 */
const FIXTURE_BY_ID: Record<string, { prompt: string; file: string; description: string }> = {};
for (const [prompt, fixture] of Object.entries(REPLAY_FIXTURES)) {
  FIXTURE_BY_ID[fixture.fixtureId] = { prompt, file: fixture.file, description: fixture.description };
}

// ---- Replay Adapter ----

export function createReplayAdapter(): GeneratorAdapter {
  return {
    name: 'replay',

    generate(prompt: string, context?: GeneratorContext): GeneratorResult {
      const start = performance.now();
      const promptLower = prompt.toLowerCase().trim();
      const pHash = hashPrompt(prompt);

      // Look up by fixture ID first (if provided), then by prompt text
      let match: { fixtureId: string; file: string } | undefined;

      if (context?.fixtureId && FIXTURE_BY_ID[context.fixtureId]) {
        const entry = FIXTURE_BY_ID[context.fixtureId];
        match = { fixtureId: context.fixtureId, file: entry.file };
      } else if (REPLAY_FIXTURES[promptLower]) {
        match = {
          fixtureId: REPLAY_FIXTURES[promptLower].fixtureId,
          file: REPLAY_FIXTURES[promptLower].file,
        };
      }

      if (!match) {
        const durationMs = Math.round(performance.now() - start);
        return {
          success: false,
          source: '',
          metadata: { adapter: 'replay', promptHash: pHash, durationMs },
          error: `Unknown prompt: no replay fixture matches "${prompt}". Available fixture IDs: ${Object.keys(FIXTURE_BY_ID).join(', ')}`,
        };
      }

      try {
        const source = readFileSync(match.file, 'utf-8');
        const durationMs = Math.round(performance.now() - start);
        return {
          success: true,
          source,
          metadata: {
            adapter: 'replay',
            fixtureId: match.fixtureId,
            promptHash: pHash,
            durationMs,
          },
        };
      } catch (err: any) {
        const durationMs = Math.round(performance.now() - start);
        return {
          success: false,
          source: '',
          metadata: {
            adapter: 'replay',
            fixtureId: match.fixtureId,
            promptHash: pHash,
            durationMs,
          },
          error: `Failed to read fixture file "${match.file}": ${err.message}`,
        };
      }
    },
  };
}

// ---- Noop Adapter ----

export function createNoopGeneratorAdapter(): GeneratorAdapter {
  return {
    name: 'noop',

    generate(prompt: string): GeneratorResult {
      return {
        success: false,
        source: '',
        metadata: {
          adapter: 'noop',
          promptHash: hashPrompt(prompt),
          durationMs: 0,
        },
        error: 'Noop adapter: generation disabled',
      };
    },
  };
}

// ---- Claude Adapter Helpers ----

const CLAUDE_SYSTEM_PROMPT = `You are an AIR language code generator. Using the AIR language specification below, generate a complete .air file for the user's app description.

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
12. Add @env for environment variables, @deploy for deployment config`;

/** Extract .air source from LLM response text */
export function extractAirSource(rawText: string): string {
  // Try fenced code block first (```air ... ``` or ``` ... ```)
  const fenced = rawText.match(/```(?:air)?\s*\n([\s\S]*?)\n```/);
  if (fenced) return fenced[1].trim();
  // Fallback: raw text trimmed
  return rawText.trim();
}

/** Attempt to parse .air source, returning validity + error */
export function tryParseAir(source: string): { valid: true } | { valid: false; error: string } {
  try {
    parse(source);
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message || String(err) };
  }
}

// ---- Claude Adapter ----

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30000;

export function createClaudeAdapter(options: ClaudeAdapterOptions): GeneratorAdapter {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    maxRetries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const totalAttempts = maxRetries + 1;

  return {
    name: 'claude',

    async generate(prompt: string): Promise<GeneratorResult> {
      const pHash = hashPrompt(prompt);
      const totalStart = performance.now();
      let attempts = 0;
      let lastError = '';
      let lastSource = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      // Build user message; may be extended with parse errors on retries
      let userMessage = prompt;

      for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        attempts = attempt;

        let responseText: string;
        let inputTokens = 0;
        let outputTokens = 0;

        try {
          const res = await fetch(CLAUDE_API_URL, {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              temperature,
              system: CLAUDE_SYSTEM_PROMPT,
              messages: [{ role: 'user', content: userMessage }],
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });

          // Auth errors — fail immediately, don't waste retries
          if (res.status === 401 || res.status === 403) {
            const durationMs = Math.round(performance.now() - totalStart);
            return {
              success: false,
              source: '',
              metadata: { adapter: 'claude', promptHash: pHash, durationMs, model, attempts },
              error: `Authentication error (HTTP ${res.status}): check ANTHROPIC_API_KEY`,
            };
          }

          // Transient errors (429, 5xx) — retry
          if (res.status === 429 || res.status >= 500) {
            lastError = `HTTP ${res.status}`;
            if (attempt < totalAttempts) {
              userMessage = prompt; // reset for retry
              continue;
            }
            break;
          }

          if (!res.ok) {
            lastError = `HTTP ${res.status}`;
            break;
          }

          const body = await res.json() as {
            content?: Array<{ type: string; text?: string }>;
            usage?: { input_tokens?: number; output_tokens?: number };
          };

          inputTokens = body.usage?.input_tokens ?? 0;
          outputTokens = body.usage?.output_tokens ?? 0;
          totalInputTokens += inputTokens;
          totalOutputTokens += outputTokens;

          // Extract text from response
          const textBlock = body.content?.find(c => c.type === 'text');
          responseText = textBlock?.text ?? '';

          if (!responseText) {
            lastError = 'Empty response from API';
            if (attempt < totalAttempts) continue;
            break;
          }
        } catch (err: any) {
          // Timeout or network error — retry
          lastError = err.name === 'TimeoutError'
            ? `Request timed out after ${timeoutMs}ms`
            : err.message || String(err);
          if (attempt < totalAttempts) continue;
          break;
        }

        // Extract .air source
        const source = extractAirSource(responseText);
        lastSource = source;

        // Quality gate: parse check
        const parseCheck = tryParseAir(source);
        if (parseCheck.valid) {
          const durationMs = Math.round(performance.now() - totalStart);
          return {
            success: true,
            source,
            metadata: {
              adapter: 'claude',
              promptHash: pHash,
              durationMs,
              model,
              attempts,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            },
          };
        }

        // Parse failed — retry with error feedback
        lastError = parseCheck.error;
        if (attempt < totalAttempts) {
          userMessage = `${prompt}\n\nYour previous output had a parse error:\n${parseCheck.error}\n\nPlease fix the AIR code and output ONLY valid AIR code.`;
        }
      }

      // All attempts exhausted
      const durationMs = Math.round(performance.now() - totalStart);
      return {
        success: false,
        source: lastSource,
        metadata: {
          adapter: 'claude',
          promptHash: pHash,
          durationMs,
          model,
          attempts,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        },
        error: `Generation failed after ${attempts} attempt(s): ${lastError}`,
      };
    },
  };
}

// ---- Exports for introspection ----

/** List all available replay fixture IDs */
export function listReplayFixtures(): Array<{ fixtureId: string; prompt: string; file: string; description: string }> {
  return Object.entries(FIXTURE_BY_ID).map(([id, entry]) => ({
    fixtureId: id,
    prompt: entry.prompt,
    file: entry.file,
    description: entry.description,
  }));
}
