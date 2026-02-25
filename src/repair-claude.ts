/**
 * AirEngine Claude Repair Adapter (A3e)
 *
 * LLM-backed repair via Anthropic Messages API.
 * Reuses extractAirSource() and tryParseAir() from generator.ts (A5c).
 *
 * Two-layer retry architecture:
 *   Provider layer (this file): retries on 429/5xx/timeout
 *   Loop layer (loop.ts):       retries on partial/failed via maxRepairAttempts
 */

import type { Diagnostic } from './diagnostics.js';
import type { RepairAdapter, RepairResult, RepairContext, RepairAction } from './repair.js';
import { extractAirSource, tryParseAir, AIR_SPEC } from './generator.js';

// ---- Types ----

export interface ClaudeRepairAdapterOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Provider-level retries (for transient HTTP errors). NOT for parse failures. */
  maxRetries?: number;
  timeoutMs?: number;
}

// ---- Constants ----

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30000;

const REPAIR_SYSTEM_PROMPT = `You are an AIR language repair tool. Your job is to fix errors in AIR source code.

${AIR_SPEC}

RULES:
1. Fix ONLY the reported errors — do not add features, blocks, or restructure
2. Preserve the original intent and structure as much as possible
3. Output ONLY the corrected .air source — no markdown, no explanation, no backticks
4. If you cannot fix an error, leave that part unchanged
5. Always ensure the output starts with @app:name
6. Always ensure the output has at least a @ui block`;

// ---- Adapter Factory ----

export function createClaudeRepairAdapter(options: ClaudeRepairAdapterOptions): RepairAdapter {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    maxRetries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const totalProviderAttempts = maxRetries + 1;

  return {
    name: 'claude',

    async repair(
      source: string,
      diagnostics: Diagnostic[],
      context?: RepairContext,
    ): Promise<RepairResult> {
      const errorDiags = diagnostics.filter(d => d.severity === 'error');

      // No errors → noop
      if (errorDiags.length === 0) {
        return {
          status: 'noop',
          originalSource: source,
          repairedSource: source,
          sourceChanged: false,
          actions: [],
          appliedCount: 0,
          skippedCount: 0,
        };
      }

      // Build user message
      const diagJson = JSON.stringify(
        errorDiags.map(d => ({ code: d.code, message: d.message, severity: d.severity })),
        null,
        2,
      );

      let userMessage = `Here is the AIR source code with errors:\n\n${source}\n\nErrors to fix:\n${diagJson}`;
      if (context && context.maxAttempts > 1) {
        userMessage += `\n\nThis is repair attempt ${context.attemptNumber} of ${context.maxAttempts}.`;
      }
      userMessage += '\n\nOutput ONLY the corrected AIR source code.';

      // Provider retry loop (transient errors only)
      for (let attempt = 1; attempt <= totalProviderAttempts; attempt++) {
        let responseText: string;

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
              system: REPAIR_SYSTEM_PROMPT,
              messages: [{ role: 'user', content: userMessage }],
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });

          // Auth errors — fail immediately
          if (res.status === 401 || res.status === 403) {
            return makeFailedResult(source, `Authentication error (HTTP ${res.status}): check ANTHROPIC_API_KEY`);
          }

          // Transient errors — retry
          if (res.status === 429 || res.status >= 500) {
            if (attempt < totalProviderAttempts) continue;
            return makeFailedResult(source, `HTTP ${res.status} after ${attempt} provider attempt(s)`);
          }

          if (!res.ok) {
            return makeFailedResult(source, `HTTP ${res.status}`);
          }

          const body = await res.json() as {
            content?: Array<{ type: string; text?: string }>;
          };

          const textBlock = body.content?.find(c => c.type === 'text');
          responseText = textBlock?.text ?? '';

          if (!responseText) {
            if (attempt < totalProviderAttempts) continue;
            return makeFailedResult(source, 'Empty response from API');
          }
        } catch (err: any) {
          // Timeout or network error — retry
          const reason = err.name === 'TimeoutError'
            ? `Request timed out after ${timeoutMs}ms`
            : err.message || String(err);
          if (attempt < totalProviderAttempts) continue;
          return makeFailedResult(source, reason);
        }

        // Extract .air source from response
        const repairedSource = extractAirSource(responseText);

        // Same source → noop
        if (repairedSource === source) {
          return {
            status: 'noop',
            originalSource: source,
            repairedSource: source,
            sourceChanged: false,
            actions: [makeSyntheticAction(repairedSource, false, 'Source unchanged by Claude')],
            appliedCount: 0,
            skippedCount: 1,
          };
        }

        // Quality gate: parse check
        const parseCheck = tryParseAir(repairedSource);
        if (parseCheck.valid) {
          return {
            status: 'repaired',
            originalSource: source,
            repairedSource,
            sourceChanged: true,
            actions: [makeSyntheticAction(repairedSource, true, 'Claude whole-source repair')],
            appliedCount: 1,
            skippedCount: 0,
          };
        }

        // Changed but parse-invalid → partial (loop layer will re-diagnose)
        return {
          status: 'partial',
          originalSource: source,
          repairedSource,
          sourceChanged: true,
          actions: [makeSyntheticAction(repairedSource, true, `Claude repair (parse invalid: ${parseCheck.error})`)],
          appliedCount: 1,
          skippedCount: 0,
        };
      }

      // Should not reach here, but safety net
      return makeFailedResult(source, 'Provider retry loop exhausted');
    },
  };
}

// ---- Helpers ----

function makeSyntheticAction(text: string, applied: boolean, description: string): RepairAction {
  return {
    rule: 'claude-repair',
    kind: 'replace',
    text,
    description,
    applied,
  };
}

function makeFailedResult(source: string, reason: string): RepairResult {
  return {
    status: 'failed',
    originalSource: source,
    repairedSource: source,
    sourceChanged: false,
    actions: [{
      rule: 'claude-repair',
      kind: 'replace',
      text: '',
      description: `Failed: ${reason}`,
      applied: false,
      reason,
    }],
    appliedCount: 0,
    skippedCount: 1,
  };
}
