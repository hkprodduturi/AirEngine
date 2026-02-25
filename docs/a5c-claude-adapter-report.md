# A5c — Claude Provider Adapter Report

## Summary

Implements the first real LLM-backed generator adapter for AirEngine using the Anthropic Messages API. The Claude adapter slots into the existing `GeneratorAdapter` interface (A5b) with zero new dependencies — uses native `fetch()`.

## Changes

### `src/generator.ts`
- **Widened `generate()` return type** to `GeneratorResult | Promise<GeneratorResult>` — non-breaking for sync adapters (replay, noop)
- **Added optional metadata fields**: `model`, `attempts`, `inputTokens`, `outputTokens`
- **Moved `AIR_SPEC`** from `src/mcp/server.ts` into a shared export
- **Added `ClaudeAdapterOptions`** interface: `apiKey`, `model`, `maxTokens`, `temperature`, `maxRetries`, `timeoutMs`
- **Added `createClaudeAdapter()`**: LLM-backed generation with retry logic and quality gate
- **Added `extractAirSource()`**: extracts `.air` source from fenced code blocks or raw text
- **Added `tryParseAir()`**: post-generation quality gate using the real parser

### `src/mcp/server.ts`
- Replaced inline `AIR_SPEC` constant (~85 lines) with `import { AIR_SPEC } from '../generator.js'`

### `scripts/demo-prompt-replay.ts`
- Added `--adapter claude`, `--model`, `--timeout-ms`, `--max-retries` CLI flags
- Changed `adapter.generate()` to `await adapter.generate()` for async support
- Enhanced logging: model, attempt count, token usage when present

### `tests/generator.test.ts`
- Added `extractAirSource` tests (3)
- Added `tryParseAir` tests (2)
- Added `ClaudeAdapter` unit tests with mocked fetch (14)
- Added env-gated live integration test (1)
- Total new tests: 20

## Architecture

```
                     GeneratorAdapter
                     ├── ReplayAdapter   (sync, fixture-backed)
                     ├── NoopAdapter     (sync, always fails)
                     └── ClaudeAdapter   (async, LLM-backed)  ← NEW
                           │
                           ├── fetch() → Anthropic Messages API
                           ├── extractAirSource() → strip code fences
                           ├── tryParseAir() → quality gate
                           └── retry loop (parse errors, 429, 5xx, timeout)
```

## Retry Logic

| Condition | Action |
|-----------|--------|
| Parse failure | Retry with error feedback appended to prompt |
| HTTP 429 / 5xx | Retry (transient) |
| Timeout | Retry |
| HTTP 401 / 403 | Fail immediately (auth error) |
| Empty response | Retry |
| All retries exhausted | Return structured failure with last error |

Default: `maxRetries=2` → up to 3 total attempts.

## CLI Usage

```bash
# Default replay adapter (unchanged)
node --import tsx scripts/demo-prompt-replay.ts --prompt "build a todo app"

# Claude adapter
ANTHROPIC_API_KEY=sk-... node --import tsx scripts/demo-prompt-replay.ts \
  --adapter claude \
  --prompt "build a simple counter app" \
  --model claude-sonnet-4-20250514 \
  --max-retries 2 \
  --timeout-ms 30000
```

## Risk Mitigation

- **Replay path untouched**: default adapter stays `replay`, all existing tests pass without API key
- **No new dependencies**: native `fetch()` avoids SDK version lock-in
- **Interface change is non-breaking**: union return type — sync adapters unchanged
- **Quality gate prevents garbage**: generated `.air` parsed before returning success
- **Retry bounded**: max 3 API calls (default), auth errors fail immediately
