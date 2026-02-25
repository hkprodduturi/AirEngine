# A7 — Launch Hardening Report

## Summary

A7 hardens AirEngine for alpha launch readiness. Three focus areas: environment diagnostics, error message consistency, and launch documentation.

## Deliverables

### 1. Doctor Script (`scripts/doctor.ts`)

Environment readiness checker. Verifies:

- **Runtime**: Node.js >= 18, npm, tsx
- **Repo files**: 13 required files (configs, scripts, schemas, benchmarks)
- **Env vars**: ANTHROPIC_API_KEY (warn, not fail)
- **Writable dirs**: artifacts/, system temp directory

Exports: `runDoctorChecks()`, `computeReadiness()`, `buildDoctorReport()`

Three readiness tiers:
- **Offline demo**: runtime + repo + writable
- **Live demo**: offline + API key
- **Online eval**: offline + API key

Report: `artifacts/doctor/doctor-report.json`

CLI: `npm run doctor` / `npm run doctor -- --verbose`

### 2. Doctor Tests (`tests/doctor.test.ts`)

13 tests covering:
- `runDoctorChecks`: array shape, Node.js check, npm check, API key check, repo files, writable dirs
- `computeReadiness`: all pass, missing API key, runtime failure, repo file missing
- `buildDoctorReport`: complete report, verdict logic (fail on critical, pass on env-only warn)

### 3. Error Message Hardening

Files modified:
- `src/cli/index.ts`: All emoji replaced with text labels (ERROR, FAIL, PASS, WARN). Missing API key includes fallback hint.
- `scripts/demo-prompt-replay.ts`: Error prefix standardized, `.catch()` handler on main()
- `scripts/eval-online.ts`: Missing API key error includes hint and report path

Pattern established:
- `ERROR:` for runtime/configuration errors
- `FAIL:` for validation/pipeline failures
- `Hint:` for actionable fallback suggestions
- No emoji in CLI output

### 4. Launch Docs

| File | Description |
|------|-------------|
| `docs/quickstart-ai-first.md` | Getting started guide: install, offline demo, live demo, watch mode |
| `docs/mcp-quickstart.md` | MCP server setup for Claude Desktop and Claude Code |
| `docs/troubleshooting-ai-first.md` | Common issues and diagnostic commands |
| `docs/alpha-launch-checklist.md` | Pre-release verification checklist |
| `docs/release-alpha-v0.md` | v0.2.0-alpha release notes |

### 5. Showcase Manifest (`examples/showcase-manifest.json`)

7 curated examples with metadata:

| ID | Name | Complexity | Lines |
|----|------|-----------|-------|
| todo | Todo App | simple | 11 |
| expense-tracker | Expense Tracker | simple | 32 |
| landing | Landing Page | simple | 31 |
| auth | Auth App | medium | 24 |
| dashboard | Analytics Dashboard | medium | 37 |
| fullstack-todo | Fullstack Todo | medium | 20 |
| projectflow | ProjectFlow | complex | 301 |

### 6. npm Script

Added `"doctor": "node --import tsx scripts/doctor.ts"` to package.json.

## Files Created

| File | Lines |
|------|-------|
| `scripts/doctor.ts` | ~271 |
| `tests/doctor.test.ts` | ~171 |
| `docs/quickstart-ai-first.md` | ~100 |
| `docs/mcp-quickstart.md` | ~100 |
| `docs/troubleshooting-ai-first.md` | ~120 |
| `docs/alpha-launch-checklist.md` | ~75 |
| `docs/release-alpha-v0.md` | ~110 |
| `examples/showcase-manifest.json` | ~85 |
| `docs/a7-launch-hardening-report.md` | this file |

## Files Modified

| File | Change |
|------|--------|
| `src/cli/index.ts` | Emoji → text labels, fallback hints |
| `scripts/demo-prompt-replay.ts` | Error prefix, .catch() handler |
| `scripts/eval-online.ts` | Missing-key error hint + report path |
| `package.json` | Added `doctor` npm script |

## Verification

```
npx tsc --noEmit                           → exit 0
npx vitest run                             → 882+ tests pass (16 files)
npm run doctor                             → verdict PASS
npm run eval-local                         → 6/6 pass
npm run foundation-check                   → 4/4 pass
npm run demo-canonical                     → loop succeeds
npm run demo-prompt-replay -- --fixture-id todo  → prompt-to-app succeeds
```

## Test Count

| File | Tests |
|------|-------|
| tests/doctor.test.ts | 13 |
| **Total suite** | **882+** |
