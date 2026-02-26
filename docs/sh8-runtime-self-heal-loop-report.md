# SH8 — Autonomous Runtime QA + Self-Heal Loop v1

> Completed 2026-02-26

## Summary

SH8 automates dead CTA detection by launching a browser, executing flow steps against a running app, and feeding failures into the existing SH0-SH7 self-healing pipeline. The Photography HomePage's 3 dead CTA buttons (View Portfolio, Book a Session, Get in Touch) are now detectable without manual inspection.

## File Inventory

| File | Action | Lines |
|------|--------|-------|
| `package.json` | Modified | +5 (playwright devDep, 3 scripts) |
| `docs/runtime-qa-result.schema.json` | Created | 132 |
| `docs/self-heal-loop-result.schema.json` | Created | 135 |
| `qa-flows/photography-public.json` | Created | 98 |
| `docs/self-heal-incident.schema.json` | Modified | +1 (runtime-qa source) |
| `scripts/runtime-qa-run.ts` | Created | 695 |
| `scripts/runtime-qa-bridge.ts` | Created | 248 |
| `scripts/classify-incident.ts` | Modified | +39 (3 patterns) |
| `scripts/self-heal-loop.ts` | Created | 463 |
| `tests/runtime-qa.test.ts` | Created | 871 |
| `docs/self-heal-architecture.md` | Modified | +30 |
| `docs/sh8-runtime-self-heal-loop-report.md` | Created | 100 |

**Total: 8 new files (~2742 lines), 4 modified files (~75 lines)**

## Guardrails Implemented

| # | Guardrail | Implementation |
|---|-----------|---------------|
| 1 | Step-aware dead CTA | `detectDeadCTA()` reads `step.expected` signals, checks only those |
| 2 | Preflight health check | `runPreflight()` with 3 retries, 1s backoff, clear error |
| 3 | Worktree isolation | `createWorktree()` / `removeWorktree()` in self-heal-loop.ts |
| 4 | Propose without LLM | `proposePatch()` uses SH3 `buildPatchPrompt()`, `--model-assisted` opt-in |
| 5 | Rich evidence | `captureEvidence()` populates all fields, `buildRichEvidence()` for bridge |
| 6 | Flow preconditions | `loadFlowSpec()` validates base_url, preflight_health_path, setup hooks |
| 7 | Explicit tags | `stepToIncidentArgs()` always sets `['runtime-qa', flow_id, label, ...]` |
| 8 | CI-safe Playwright | Mock Page objects default, `RUNTIME_QA_LIVE=1` gates real browser |

## Test Results

```
Test Suites: 25 passed, 25 total
Tests:       1131 passed, 6 skipped, 0 failed
             (+54 new tests from SH8)

SH8 breakdown:
  Flow spec parsing ........... 5 pass
  Schema conformance .......... 5 pass
  Preflight checks ............ 3 pass
  Dead CTA detection .......... 6 pass
  Rich evidence capture ....... 3 pass
  Incident bridge + tags ...... 6 pass
  Classifier coverage ......... 3 pass
  Self-heal loop modes ........ 5 pass
  Propose without LLM ......... 2 pass
  Safety bounds ............... 3 pass
  Photography flow content .... 3 pass
  Step execution .............. 3 pass
  Schema validation ........... 2 pass
  Live integration ............ 2 skipped (RUNTIME_QA_LIVE=1)
```

Type check: `npx tsc --noEmit` — clean, 0 errors

## Classifier Patterns Added

1. **`runtime-dead-cta-detected`** (high) — source=runtime-qa + dead cta/no effect + button/click/cta
2. **`runtime-console-error`** (medium) — source=runtime-qa + console-error tag
3. **`runtime-navigation-failure`** (medium) — source=runtime-qa + navigation/route + fail/stuck/did not

## Modes

| Mode | Preflight | QA Flow | Bridge | Patch | Verify | Promote | Knowledge |
|------|-----------|---------|--------|-------|--------|---------|-----------|
| shadow | YES | YES | YES | — | — | — | — |
| propose | YES | YES | YES | YES (deterministic) | — | — | — |
| patch-verify | YES | YES | YES | YES | YES (worktree) | YES | YES |

## Usage

```bash
# Dry run — validate flow spec, no browser
npm run runtime-qa -- --flow qa-flows/photography-public.json --dry-run

# Shadow mode — observe and report
npm run self-heal-loop -- --flow qa-flows/photography-public.json --mode shadow

# Propose mode — deterministic patch proposals (no API key)
npm run self-heal-loop -- --flow qa-flows/photography-public.json --mode propose

# Propose with LLM enrichment (requires ANTHROPIC_API_KEY)
npm run self-heal-loop -- --flow qa-flows/photography-public.json --mode propose --model-assisted

# Live (requires app + playwright installed)
npm run playwright-install
npm run runtime-qa -- --flow qa-flows/photography-public.json
```
