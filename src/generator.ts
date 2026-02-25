/**
 * AirEngine Generator Adapter — Pluggable prompt-to-.air generation (A5b)
 *
 * Defines the adapter interface for converting a natural-language prompt
 * into AIR source code. Implementations:
 *   - ReplayAdapter: deterministic fixture-backed (offline, no LLM)
 *   - NoopAdapter: always returns error (for testing)
 *
 * Future adapters (not in this phase): ClaudeAdapter, OpenAIAdapter, etc.
 */

import { readFileSync } from 'fs';

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
  };
  /** Structured error on failure */
  error?: string;
}

export interface GeneratorAdapter {
  readonly name: string;
  generate(prompt: string, context?: GeneratorContext): GeneratorResult;
}

// ---- Prompt hash helper ----

import { createHash } from 'crypto';

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
