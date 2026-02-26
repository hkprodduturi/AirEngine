# A9 — Self-Healing System Complete Report (SH0–SH7)

## Summary

Implemented the complete AirEngine self-healing system across all 8 phases: contracts/policy (SH0), incident capture + deterministic classification (SH1), starter invariants (SH2), patch bot orchestrator (SH3), verification gate runner (SH4), knowledge store (SH5), regression promotion (SH6), and model-assisted improvements (SH7). The system provides a full incident lifecycle from capture through resolution with knowledge retention.

## Architecture Overview

```
Failure Source → SH1 Capture → SH1 Classify → SH3 Patch Proposal
                                                      ↓
                 SH6 Promote ← SH5 Knowledge ← SH4 Verify
                                                      ↓
                                             SH7 Model-Assisted
```

## Phase Inventory

### SH0 — Contracts & Policy
| File | Purpose | Lines |
|------|---------|-------|
| `docs/self-heal-incident.schema.json` | Incident capture schema v1.0 | 189 |
| `docs/self-heal-patch-result.schema.json` | Patch proposal schema v1.0 | 103 |
| `docs/self-heal-verify.schema.json` | Verification report schema v1.0 | 83 |
| `docs/self-heal-knowledge.schema.json` | Knowledge store entry schema v1.0 | 72 |
| `docs/self-heal-policy.md` | Governance rules, severity, ownership model | 186 |
| `docs/self-heal-architecture.md` | Data flow, phase details, integration matrix | 260 |

### SH1 — Incident Capture + Classification
| File | Purpose | Lines |
|------|---------|-------|
| `scripts/capture-incident.ts` | CLI tool with 20+ flags for incident capture | 292 |
| `scripts/classify-incident.ts` | 25-pattern deterministic classifier | 605 |

### SH2 — Starter Invariants
| File | Purpose | Lines |
|------|---------|-------|
| `src/self-heal/invariants.ts` | 6 invariant definitions + runner | 414 |

### SH3 — Patch Bot Orchestrator
| File | Purpose | Lines |
|------|---------|-------|
| `scripts/patch-incident.ts` | Scoped patch proposals from classified incidents | 257 |

**Features:**
- `buildPatchScope()` — maps subsystem to target files with MAX_FILES (10) and MAX_LINES_CHANGED (200) constraints
- `buildPatchPrompt()` — generates structured patch request with incident context, scope constraints, and related past fixes
- `buildPatchArtifact()` — creates patch proposal JSON with schema validation
- `SUBSYSTEM_FILES` — mapping of 13 subsystems to their transpiler source files
- Knowledge store integration — queries related past fixes for retrieval-augmented context
- Output: `artifacts/self-heal/patches/SP-<timestamp>.json` + companion prompt markdown

### SH4 — Verification Gate Runner
| File | Purpose | Lines |
|------|---------|-------|
| `scripts/verify-patch.ts` | Sequential gate suite execution for patches | 202 |

**Features:**
- 6 verification steps: tsc, vitest, quality-gate, helpdesk-golden, photography-golden, eval-complex
- `runStep()` — executes command with 5-minute timeout, captures output summary + exit code
- `buildVerifyResult()` — aggregates step results into pass/fail/partial verdict
- `--fail-fast` flag — stops at first failure
- Output: `artifacts/self-heal/verifications/SV-<timestamp>.json`
- Schema validation against `self-heal-verify.schema.json`

### SH5 — Knowledge Store
| File | Purpose | Lines |
|------|---------|-------|
| `scripts/knowledge-store.ts` | JSONL append-only storage for resolved incidents | 231 |

**Features:**
- `loadKnowledge()` — reads all entries from JSONL file
- `appendKnowledge()` — appends new entry to store
- `queryKnowledge(classification, subsystem)` — retrieval by classification, subsystem, or recurrence tags (sorted by occurrence count)
- `buildKnowledgeEntry()` — creates entry from incident with configurable overrides
- `incrementOccurrence()` — bumps count for existing classification
- `validateKnowledgeEntry()` — validates against JSON Schema
- CLI: `add <incident>`, `query --classification <class>`, `list [--limit N]`
- Storage: `data/self-heal-knowledge.jsonl`

### SH6 — Regression Promotion
| File | Purpose | Lines |
|------|---------|-------|
| `scripts/promote-fix.ts` | Ensures every fixed bug is promoted to prevent recurrence | 193 |

**Features:**
- 4 promotion checks:
  1. **Regression test** — grep for classification in tests/ directory
  2. **Invariant** — check suggested invariant exists in invariants.ts
  3. **Golden coverage** — verify golden run scripts cover affected subsystem
  4. **Knowledge store entry** — confirm classification recorded in knowledge store
- At least one promotion required for closure (excluding skipped checks)
- `runPromotionChecks()` — returns structured report with pass/fail per check
- Exit: 0 = promoted, 1 = missing promotions

### SH7 — Model-Assisted Improvements
| File | Purpose | Lines |
|------|---------|-------|
| `scripts/model-assisted.ts` | LLM-enhanced triage, patching, and calibration | 397 |

**Features:**
- `enhancedClassify()` — falls back to LLM when deterministic classifier returns 'unknown' (fast path: skips model call when deterministic succeeds)
- `enrichPatchContext()` — retrieval-augmented patch prompt with knowledge store context and similar patterns
- `generateFixSummary()` — LLM-generated fix summaries from patch diffs for knowledge entries
- `calibrate()` — confidence calibration comparing deterministic vs model classifications
- `callModel()` — generic Anthropic Messages API wrapper with error handling
- CLI: `classify`, `enrich-patch`, `summarize`, `calibrate [--limit N]`
- Gated by: `ANTHROPIC_API_KEY` environment variable
- All existing policies (human approval, verifier, bounded scope) still apply

## Test Coverage

### Test Files
| File | Tests | Phase |
|------|-------|-------|
| `tests/self-heal.test.ts` | 54 | SH0 + SH1 + SH2 |
| `tests/invariants.test.ts` | 16 | SH2 |
| `tests/self-heal-advanced.test.ts` | 51 | SH3 + SH4 + SH5 + SH6 + SH7 |
| **Total** | **121** | **SH0–SH7** |

### SH3 Tests (14)
- `buildPatchScope()` — known subsystem, unknown subsystem, MAX_FILES limit
- `buildPatchPrompt()` — incident details, related knowledge, scope constraints
- `buildPatchArtifact()` — valid artifact creation
- `SUBSYSTEM_FILES` — coverage of 12 key subsystems, file path types
- Schema conformance against `self-heal-patch-result.schema.json`

### SH4 Tests (10)
- `VERIFY_STEPS` — step count, name/command fields, tsc step, vitest step
- `runStep()` — successful command, failing command, output capture
- `buildVerifyResult()` — pass/fail/partial verdict logic
- Schema conformance against `self-heal-verify.schema.json`

### SH5 Tests (8)
- `buildKnowledgeEntry()` — defaults, overrides, tag extraction, recurrence tags
- `queryKnowledge()` — classification matching, recurrence tag matching
- Schema conformance against `self-heal-knowledge.schema.json` (default + overridden)

### SH6 Tests (9)
- `checkRegressionTest()` — finds tests by classification, valid structure
- `checkInvariant()` — skipped when no invariant suggested, finds invariant in invariants.ts
- `checkGoldenCoverage()` — checks golden run scripts
- `checkKnowledgeEntry()` — checks knowledge store
- `runPromotionChecks()` — structured report, promoted when any check passes, missing check validation

### SH7 Tests (7)
- `enhancedClassify()` — deterministic fast path (no API call), valid structure
- `enrichPatchContext()` — base prompt, similar patterns, knowledge context
- `calibrate()` — valid structure, agreement rate bounds, total consistency

### Cross-Phase Integration Tests (5)
- Incident → patch scope → prompt pipeline
- Verify result → verdict logic
- Knowledge entry → query roundtrip
- Promotion check structure completeness
- Enhanced classify → enrich pipeline

## npm Scripts Added

```json
"capture-incident": "node --import tsx scripts/capture-incident.ts",
"classify-incident": "node --import tsx scripts/classify-incident.ts",
"patch-incident": "node --import tsx scripts/patch-incident.ts",
"verify-patch": "node --import tsx scripts/verify-patch.ts",
"knowledge-store": "node --import tsx scripts/knowledge-store.ts",
"promote-fix": "node --import tsx scripts/promote-fix.ts",
"model-assisted": "node --import tsx scripts/model-assisted.ts"
```

## Verification Results

### Core Safety
```
1) npx tsc --noEmit                          → clean (exit 0)
2) npx vitest run                            → 1073 passed, 4 skipped (1077 total)
```

### Self-Heal Test Breakdown
```
3) SH0–SH2 tests (self-heal.test.ts)        → 54 passed
4) SH2 invariant tests (invariants.test.ts)  → 16 passed
5) SH3–SH7 tests (self-heal-advanced.test.ts)→ 51 passed
   Total self-heal tests:                      121 passed
```

## Incident Lifecycle

```
1. Capture   (SH1)  npm run capture-incident -- --source manual --summary "..."
2. Classify  (SH1)  npm run classify-incident -- <incident.json>
3. Patch     (SH3)  npm run patch-incident -- <incident.json> [--dry-run]
4. Verify    (SH4)  npm run verify-patch -- <patch.json> [--fail-fast]
5. Knowledge (SH5)  npm run knowledge-store -- add <incident.json>
6. Promote   (SH6)  npm run promote-fix -- <incident.json> [--check-only]
7. Enhance   (SH7)  npm run model-assisted -- classify <incident.json>
```

## Complete File Inventory

### New Files Created (18 files, 5,058 lines)

| File | Phase | Lines |
|------|-------|-------|
| `docs/self-heal-incident.schema.json` | SH0 | 189 |
| `docs/self-heal-patch-result.schema.json` | SH0 | 103 |
| `docs/self-heal-verify.schema.json` | SH0 | 83 |
| `docs/self-heal-knowledge.schema.json` | SH0 | 72 |
| `docs/self-heal-policy.md` | SH0 | 186 |
| `docs/self-heal-architecture.md` | SH0 | 260 |
| `docs/a9-sh0-sh2-self-heal-foundation-report.md` | SH0 | 189 |
| `docs/a9-self-heal-complete-report.md` | SH0–SH7 | 204 |
| `scripts/capture-incident.ts` | SH1 | 292 |
| `scripts/classify-incident.ts` | SH1 | 605 |
| `src/self-heal/invariants.ts` | SH2 | 414 |
| `scripts/patch-incident.ts` | SH3 | 257 |
| `scripts/verify-patch.ts` | SH4 | 202 |
| `scripts/knowledge-store.ts` | SH5 | 231 |
| `scripts/promote-fix.ts` | SH6 | 193 |
| `scripts/model-assisted.ts` | SH7 | 397 |
| `tests/self-heal.test.ts` | SH0–SH2 | 681 |
| `tests/invariants.test.ts` | SH2 | 157 |
| `tests/self-heal-advanced.test.ts` | SH3–SH7 | 740 |

### Files Modified (1 file)

| File | Change |
|------|--------|
| `package.json` | Added 7 npm scripts (capture-incident, classify-incident, patch-incident, verify-patch, knowledge-store, promote-fix, model-assisted) |

## Remaining Limitations

- **No auto-apply**: Patches require manual application and human approval (by design)
- **Pattern-based primary**: Classifier uses string matching; LLM fallback (SH7) only for 'unknown' results
- **No runtime integration**: Gate scripts don't auto-pipe failures to capture-incident yet
- **SH7 requires API key**: Model-assisted features need ANTHROPIC_API_KEY
- **Knowledge corpus**: Calibration meaningful only after 50+ resolved incidents
