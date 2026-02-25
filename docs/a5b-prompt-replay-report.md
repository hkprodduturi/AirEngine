# A5b — Prompt-to-App Replay Orchestrator

## Summary

Implements a deterministic prompt-to-app pipeline: accepts a natural-language prompt, generates `.air` source via a pluggable adapter (replay/noop), then runs the full loop pipeline (validate → repair → transpile → smoke → determinism). No LLM or API calls — all generation is fixture-backed.

## Architecture

```
prompt → GeneratorAdapter.generate() → .air source → runLoopFromSource() → output files + report
```

### Generator Adapter Interface (`src/generator.ts`)

```typescript
interface GeneratorAdapter {
  readonly name: string;
  generate(prompt: string, context?: GeneratorContext): GeneratorResult;
}
```

Two implementations:
- **ReplayAdapter**: Maps known prompts to existing `.air` example files (deterministic, offline)
- **NoopAdapter**: Always returns failure (for testing adapter error paths)

### Replay Fixtures

| Fixture ID | Prompt | File |
|------------|--------|------|
| `todo` | "build a todo app" | `examples/todo.air` |
| `fullstack-todo` | "build a fullstack todo app with database" | `examples/fullstack-todo.air` |
| `landing` | "build a landing page" | `examples/landing.air` |
| `dashboard` | "build a dashboard with auth" | `examples/dashboard.air` |
| `expense-tracker` | "build an expense tracker" | `examples/expense-tracker.air` |

### Orchestrator Script (`scripts/demo-prompt-replay.ts`)

CLI usage:
```bash
# By prompt text
node --import tsx scripts/demo-prompt-replay.ts --prompt "build a todo app"

# By fixture ID
node --import tsx scripts/demo-prompt-replay.ts --fixture-id fullstack-todo

# List available fixtures
node --import tsx scripts/demo-prompt-replay.ts --list-fixtures

# npm script
npm run demo-prompt-replay -- --prompt "build a todo app"
```

Exit codes: 0 = success, 1 = failure

Output: `artifacts/prompt-replay/prompt-replay-result.json`

### Result Schema (`docs/prompt-replay-result.schema.json`)

Schema version 1.0. Required fields: `schema_version`, `success`, `prompt`, `generator`, `timestamp`.

Optional fields: `generated_air`, `loop_result`, `timing`, `artifacts`, `error`.

## Files

| File | Action | Description |
|------|--------|-------------|
| `src/generator.ts` | Created | GeneratorAdapter interface, ReplayAdapter, NoopAdapter, listReplayFixtures |
| `scripts/demo-prompt-replay.ts` | Created | Prompt-to-app orchestrator CLI |
| `docs/prompt-replay-result.schema.json` | Created | Result schema v1.0 |
| `tests/generator.test.ts` | Created | 27 tests: adapter interface, fixture coverage, loop integration, schema conformance |
| `docs/a5b-prompt-replay-report.md` | Created | This report |
| `package.json` | Modified | Added `demo-prompt-replay` script |

## Tests (27 new)

| Describe Block | Count | Coverage |
|----------------|-------|----------|
| ReplayAdapter | 9 | Name, success, case-insensitivity, determinism, promptHash, fixture-id context, unknown prompt/fixture, source matches file, hash stability |
| ReplayAdapter fixture coverage | 7 | All 5 fixtures generate, listReplayFixtures count/fields |
| NoopGeneratorAdapter | 3 | Name, always fails, promptHash |
| Generator → Loop integration | 3 | todo passes loop, fullstack-todo passes loop, all 5 fixtures run without throwing |
| prompt-replay-result schema conformance | 5 | Success result, noop failure, unknown prompt, all fixture variants |

## Verification

See final verification section for exact test counts and exit codes.
