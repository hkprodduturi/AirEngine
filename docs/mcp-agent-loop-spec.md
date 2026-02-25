# MCP Agent Loop Specification

## Overview

This document defines the end-to-end autonomous loop for AI-agent-driven app generation via AirEngine's MCP server. The loop is designed for zero human intervention from prompt to running app.

## Loop Phases

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: GENERATE                                          │
│  Agent reads air://spec + air://examples                    │
│  Agent writes .air from natural language prompt              │
├─────────────────────────────────────────────────────────────┤
│  Phase 2: VALIDATE                                          │
│  air_validate(source) → errors[] + warnings[]               │
│  air_lint(source) → hints[]                                 │
├─────────────────────────────────────────────────────────────┤
│  Phase 3: REPAIR (iterative, max N attempts)                │
│  If errors: agent patches .air using diagnostic feedback     │
│  Loop back to Phase 2                                       │
├─────────────────────────────────────────────────────────────┤
│  Phase 4: TRANSPILE                                         │
│  air_transpile(source) → files[] + stats                    │
├─────────────────────────────────────────────────────────────┤
│  Phase 5: SMOKE TEST                                        │
│  npm install + build check + optional dev server start       │
├─────────────────────────────────────────────────────────────┤
│  Phase 6: DELIVER                                           │
│  Return file listing, run instructions, success metrics      │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: Generate

### Input
- Natural language prompt from human
- `air://spec` resource (full language specification)
- `air://examples` resource (reference `.air` files)

### Agent Behavior
1. Read `air://spec` to understand syntax, blocks, types, operators
2. Read `air://examples` for structural patterns (frontend-only vs fullstack)
3. Map human intent to `.air` blocks:
   - UI description → `@ui`, `@page`, `@section`
   - Data model → `@db`
   - API needs → `@api` (CRUD shorthand or explicit routes)
   - Auth requirements → `@auth`, `@nav`
   - Persistence → `@persist`
   - Styling → `@style`
4. Write compact `.air` source

### Output
- `.air` source string (typically 20-80 lines)

### Quality Heuristics
- Prefer CRUD shorthand (`CRUD:/tasks>~db.Task`) over verbose routes
- Include `@style` for production appearance
- Include `@auth(required)` + login/register routes for any multi-user app
- Include `@nav` for page routing
- Name models with PascalCase, pages with camelCase

## Phase 2: Validate

### Tool Calls (sequential)

```
1. air_validate(source)
   → { valid: boolean, errors: ValidationError[], warnings: ValidationWarning[] }

2. air_lint(source)
   → { hints: LintHint[] }
```

### Decision Logic

```
if (validate.errors.length > 0) → Phase 3 (REPAIR)
if (lint.hints.filter(h => h.level === 'error').length > 0) → Phase 3 (REPAIR)
if (validate.warnings.length > 0 || lint.hints.length > 0) → log warnings, proceed to Phase 4
if (all clean) → Phase 4 (TRANSPILE)
```

### Current Validation Coverage (v0.1.7)

| Check | Source | Level |
|-------|--------|-------|
| Missing @app:name | validator | error (E001) |
| Missing @ui block | validator | error (E002) |
| Missing @state block | validator | warn (W001) |
| Parse errors (syntax) | parser | error (thrown) |
| Unused state fields | lint | warn |
| Unknown @db model refs in @api | lint | error |
| @db without @api routes | lint | warn |
| Missing @persist on frontend-only | lint | info |
| Ambiguous relations | lint | warn |

### Gap: Validation Rules Needed for AI Loop

| Rule | Priority | Phase |
|------|----------|-------|
| State ref validation (#refs exist in @state) | P0 | Loop v1 |
| Type checking (@state types match @db types) | P1 | Loop v2 |
| Route-handler validation (handlers reference valid models) | P0 | Loop v1 |
| Circular reference detection | P2 | Loop v3 |
| Page-route consistency (@nav pages exist in @ui) | P0 | Loop v1 |
| Auth route completeness (login without register) | P1 | Loop v2 |
| Duplicate page/section names | P0 | Loop v1 |

## Phase 3: Repair (Iterative Self-Correction)

### Retry Policy

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Max attempts | 3 | Most syntax errors fixable in 1-2 passes |
| Backoff | None | Deterministic errors, no rate limiting needed |
| Escalation | After 3 failures, return error to human | Prevents infinite loops |

### Agent Repair Strategy

For each error/hint from Phase 2:

1. **Parse errors**: Read error message, line/col, token. Fix syntax at indicated location.
2. **Validation errors**: Read error code + message. Apply the documented fix.
3. **Lint errors**: Read hint message. Modify the relevant block.
4. **Warnings**: Log but do not necessarily fix (may be intentional).

### Repair Loop

```
attempt = 0
while attempt < MAX_ATTEMPTS:
    result = air_validate(source)
    hints = air_lint(source)

    errors = result.errors + hints.filter(level='error')
    if errors.length == 0:
        break  # → Phase 4

    for error in errors:
        source = agent.patch(source, error)  # AI applies fix

    attempt += 1

if attempt == MAX_ATTEMPTS:
    return FAILURE(errors, source, attempt)
```

### Repair Artifacts (logged per attempt)

```json
{
  "attempt": 1,
  "source_before": "...",
  "source_after": "...",
  "errors_in": [{"code": "E001", "message": "..."}],
  "errors_out": [],
  "diff": "unified diff string",
  "tokens_used": 450
}
```

## Phase 4: Transpile

### Tool Call

```
air_transpile(source, { target: "all" })
→ {
    files: [{ path, content }],
    stats: {
      fileCount, outputLines, compressionRatio,
      timing: { extractMs, analyzeMs, clientGenMs, serverGenMs, totalMs },
      inputLines
    }
  }
```

### Post-Transpile Validation

The agent should verify:
1. `files.length > 0` (transpile produced output)
2. `stats.fileCount` is reasonable (> 5 for fullstack apps)
3. Key files exist: `package.json`, `src/App.jsx`, `vite.config.js`
4. If fullstack: `server/index.js`, `prisma/schema.prisma` exist
5. `stats.timing.totalMs < 500` (performance budget)

### Failure Handling

If transpile fails (throws error):
- Log the error
- If error is a parse error: return to Phase 3 (should not happen if Phase 2 passed)
- If error is internal: return FAILURE to human with error details

## Phase 5: Smoke Test

### Test Sequence

```
1. Write files to output directory
2. cd output && npm install
3. npx tsc --noEmit (if TypeScript files present)
4. npm run build (Vite build for client)
5. (Optional) Start dev server, check HTTP 200 on /
```

### Smoke Test Levels

| Level | Checks | Time | When to Use |
|-------|--------|------|------------|
| **L0: Syntax** | npm install succeeds | ~10s | Always |
| **L1: Build** | Vite build succeeds (no import errors, no JSX errors) | ~15s | Always |
| **L2: Server** | Express server starts without crash | ~5s | Fullstack apps |
| **L3: Render** | HTTP 200 on localhost:3000 | ~5s | Optional |

### Pass/Fail Criteria

```
L0 fail → FAILURE (dependency issue — likely transpiler bug)
L1 fail → FAILURE (code generation error — log for debugging)
L2 fail → FAILURE (server generation error)
L3 fail → WARNING (may be runtime data issue, not blocking)
```

### Smoke Test Failure Recovery

If L0 or L1 fails:
- Log build error output
- If error is in generated code: this is a transpiler bug, not repairable by agent
- Return FAILURE with build log to human
- Do NOT retry (deterministic compiler means same input → same failure)

## Phase 6: Deliver

### Success Output

```json
{
  "status": "success",
  "air_source": "...(final .air)...",
  "air_lines": 42,
  "output_files": 47,
  "output_lines": 1850,
  "compression_ratio": "44:1",
  "repair_attempts": 1,
  "total_time_ms": 8500,
  "transpile_time_ms": 120,
  "smoke_test": "L1_PASS",
  "run_instructions": "cd output && npm run dev",
  "files_summary": [
    { "path": "package.json", "lines": 25 },
    { "path": "src/App.jsx", "lines": 85 },
    "..."
  ]
}
```

### Failure Output

```json
{
  "status": "failure",
  "phase": "validate",
  "air_source": "...(last .air version)...",
  "repair_attempts": 3,
  "remaining_errors": [
    { "code": "E001", "message": "..." }
  ],
  "total_tokens_used": 2400,
  "recommendation": "Manual review needed for: ..."
}
```

## Determinism and Reproducibility

### Guarantees

| Property | Guarantee |
|----------|-----------|
| Same `.air` → same transpile output | **Yes** (pure function, no randomness) |
| Same `.air` → same validation result | **Yes** |
| Same `.air` → same lint result | **Yes** |
| Same prompt → same `.air` | **No** (LLM is non-deterministic) |
| Same `.air` + same npm versions → same build | **Yes** (pinned deps in generated package.json) |

### Reproducibility Artifacts

Each run should log:
- AirEngine version (`0.1.7`)
- Final `.air` source (SHA-256 hash + full text)
- TranspileResult stats
- Smoke test results
- Repair history (if any)
- Agent model + version (for `.air` generation reproducibility context)

## Concurrency and Session Management

### MCP Session Cache
- AST + TranspileContext + TranspileResult cached per source hash
- 5-minute TTL, auto-evicted on access
- Diff-first response: second `air_transpile` call returns only stats (no file content)

### Concurrent Requests
- Each tool call is synchronous within the MCP session
- No concurrent modification of cached state
- Multiple sessions are independent (no shared state)

## Error Budget

### Target Metrics (per run)

| Metric | Target | Acceptable |
|--------|--------|-----------|
| Total agent tokens | < 5,000 | < 10,000 |
| Repair iterations | 0-1 | <= 3 |
| Transpile time | < 200ms | < 500ms |
| Smoke test (L1) time | < 30s | < 60s |
| Total wall-clock time | < 45s | < 120s |

### Success Rate Targets

| App Complexity | Target Success Rate |
|----------------|-------------------|
| Simple (todo, notes, tracker) | > 95% |
| Medium (CRUD admin, auth + 3 models) | > 85% |
| Complex (5+ models, relations, dashboard) | > 70% |
