# AirEngine Self-Healing System — Architecture

> Version 1.0 — A9 Foundation Phase

## Overview

The self-healing system transforms AirEngine from a deterministic compiler into an operationally intelligent system that can detect, classify, localize, patch, verify, learn from, and prevent recurrence of failures across the full transpiler pipeline.

```
┌────────────────────────────────────────────────────────────────────┐
│                        Data Flow                                    │
│                                                                     │
│  Failure Sources              Capture          Classify              │
│  ┌──────────────┐        ┌──────────┐     ┌──────────────┐         │
│  │ stability-   │───────▶│ capture- │────▶│ classify-    │         │
│  │ sweep        │        │ incident │     │ incident     │         │
│  │ goldens      │        │          │     │              │         │
│  │ eval-complex │        │ CLI/API  │     │ Pattern      │         │
│  │ runtime QA   │        │          │     │ Registry     │         │
│  │ manual       │        └──────────┘     └──────┬───────┘         │
│  └──────────────┘             │                  │                  │
│                               ▼                  ▼                  │
│                     ┌──────────────────────────────┐               │
│                     │  artifacts/self-heal/         │               │
│                     │  incidents/<ts>-<slug>/       │               │
│                     │    incident.json              │               │
│                     └──────────┬───────────────────┘               │
│                                │                                    │
│              ┌─────────────────┼──────────────────┐                │
│              ▼                 ▼                   ▼                │
│     ┌────────────┐    ┌──────────────┐    ┌──────────────┐        │
│     │ Invariants │    │ Patch Bot    │    │ Knowledge    │        │
│     │ (SH2)      │    │ (SH3)       │    │ Store (SH5)  │        │
│     │            │    │             │    │              │        │
│     │ Pre-runtime│    │ Propose     │    │ Retrieve     │        │
│     │ checks     │    │ bounded     │    │ past fixes   │        │
│     └────────────┘    │ diffs       │    │ for similar  │        │
│                       └──────┬──────┘    │ incidents    │        │
│                              │           └──────────────┘        │
│                              ▼                                    │
│                     ┌──────────────┐                              │
│                     │ Verifier     │                              │
│                     │ (SH4)       │                              │
│                     │             │                              │
│                     │ tsc + vitest │                              │
│                     │ + gates +   │                              │
│                     │ goldens     │                              │
│                     └──────┬──────┘                              │
│                            │                                      │
│                            ▼                                      │
│                     ┌──────────────┐                              │
│                     │ Human Review │                              │
│                     │ + Approve    │                              │
│                     └──────┬──────┘                              │
│                            │                                      │
│                            ▼                                      │
│                     ┌──────────────┐                              │
│                     │ Promote      │                              │
│                     │ (SH6)       │                              │
│                     │             │                              │
│                     │ → test      │                              │
│                     │ → invariant │                              │
│                     │ → golden    │                              │
│                     │ → knowledge │                              │
│                     └─────────────┘                              │
└────────────────────────────────────────────────────────────────────┘
```

## Phase Details

### SH0 — Contracts + Policy (Implemented)

**Purpose**: Define the structural contracts and governance rules.

**Artifacts**:
- `docs/self-heal-incident.schema.json` — Incident capture format
- `docs/self-heal-patch-result.schema.json` — Patch proposal format
- `docs/self-heal-verify.schema.json` — Verification report format
- `docs/self-heal-knowledge.schema.json` — Knowledge store entry format
- `docs/self-heal-policy.md` — Governance rules, severity, ownership
- `docs/self-heal-architecture.md` — This document

**Key decisions**:
- All artifacts are JSON with strict schemas
- `additionalProperties: false` for forward compatibility via schema versioning
- Incident IDs: `SH-YYYYMMDD-HHmmss-<random6>`
- Severity: P0–P3 with clear assignment rules

### SH1 — Incident Capture + Deterministic Triage (Implemented)

**Purpose**: Capture failures as structured incidents and classify them deterministically.

**Components**:
- `scripts/capture-incident.ts` — CLI tool for creating incident artifacts
- `scripts/classify-incident.ts` — Deterministic pattern-matching classifier
- Pattern registry — Centralized classification rules (no scattered conditionals)

**Artifact path**: `artifacts/self-heal/incidents/<timestamp>-<slug>/incident.json`

**Classifier design**:
- Centralized `PATTERN_REGISTRY` array — each pattern has:
  - `id`: Classification string
  - `subsystem`: Suspected transpiler module
  - `confidence`: high/medium/low
  - `match(incident)`: Predicate function
  - `notes`: Triage explanation
  - `next_step`: Recommended action
  - `suggested_tests`: Test ideas
  - `suggested_invariant`: Optional invariant idea
- Patterns evaluated in priority order; first match wins
- Unknown fallback with low confidence

**Integration points**:
- Stability sweep → can pipe failures to capture-incident
- Golden runs → failed checks can be captured as incidents
- Runtime QA → manual capture with evidence attachments

### SH2 — Starter Invariants (Implemented)

**Purpose**: Catch known bad patterns in generated output before browser/runtime QA.

**Components**:
- `src/self-heal/invariants.ts` — Invariant definitions + runner
- `tests/invariants.test.ts` — Positive/negative test cases

**Invariant types**:
1. **Paginated list unwrapping** — Detect `api.getX()` used without `.data ?? res` unwrapping
2. **Auth wrapper composition** — Detect nested auth wrappers that break login layout
3. **Global auth submit width** — Detect CSS rules that force all submits to full-width
4. **Public route auth exemption** — Ensure `/public/` paths are exempted from auth middleware
5. **Public API auth-header** — Ensure public API client functions don't send Authorization header
6. **Slug route support** — Ensure slug routes use `findFirst({ where: { slug } })`

**Design**:
- Each invariant is a pure function: `(files: Map<string, string>) => InvariantResult`
- Results: `{ id, name, passed, severity, details, file_path?, line_hint? }`
- Runner: `runInvariants(files)` returns all results + summary
- String-pattern based (no AST parsing) — simple and deterministic

### SH3 — Patch Bot Orchestrator (Future)

**Purpose**: Generate bounded patch proposals from incident data.

**Design**:
- Input: Incident artifact (with triage) + knowledge store matches
- Process:
  1. Retrieve similar past fixes from knowledge store
  2. Build bounded prompt with: incident context, file snippets, past fixes, scope constraints
  3. Call Claude API for patch proposal
  4. Parse response into structured diff
  5. Validate scope constraints (files, lines, subsystem)
- Output: Patch artifact (self-heal-patch-result.schema.json)

**Constraints**:
- No auto-apply to codebase — artifact only
- Max 10 files, 200 lines changed
- Must stay within suspected subsystem
- Claude call includes scope constraints in system prompt

**CLI**: `scripts/patch-incident.ts --incident <path> [--dry-run]`

### SH4 — Verifier Orchestrator (Future)

**Purpose**: Run the full verification suite against a proposed patch.

**Design**:
- Input: Patch artifact + incident artifact
- Steps (sequential):
  1. `npx tsc --noEmit` — Type safety
  2. `npx vitest run` — Full test suite
  3. `npm run quality-gate -- --mode offline` — Quality gates
  4. `npm run helpdesk-golden` — Helpdesk golden (32/32)
  5. `npm run photography-golden` — Photography golden (30/30)
  6. `npm run eval-complex` — Complex eval (6/6)
  7. Incident-specific checks (re-transpile, invariants, targeted tests)
- Output: Verification artifact (self-heal-verify.schema.json)

**Fail-fast**: Stop on first failure, report which step failed.

**CLI**: `scripts/verify-patch.ts --patch <path>`

### SH5 — Knowledge / "Self-Training" Memory (Future)

**Purpose**: Store resolved incidents for retrieval-first reuse.

**Design**:
- Storage: `data/self-heal-knowledge.jsonl` (append-only JSONL)
- Each entry: resolved incident + patch + tests + invariants + recurrence tags
- Retrieval: keyword matching on classification + subsystem + recurrence_tags
- Used by SH3 to find similar past fixes for prompt context

**Entry lifecycle**:
```
incident resolved → knowledge entry created → retrieval index updated
                 → occurrence_count incremented on similar incidents
```

**CLI**: `scripts/knowledge-query.ts --classification <class> [--subsystem <sub>]`

### SH6 — Regression Promotion Automation (Future)

**Purpose**: Ensure every fixed bug is promoted to prevent recurrence.

**Design**:
- Triggered after patch verification passes
- Checks:
  - Was a regression test added? (test file diff)
  - Was an invariant added? (invariants.ts diff)
  - Was golden coverage added? (golden run script diff)
  - Was sweep coverage added? (stability-sweep fixture)
- At least one promotion type required for closure
- Semi-automated: system proposes, human reviews

**Closure criteria**:
- Patch verified (SH4 pass)
- At least one promotion completed
- Knowledge entry created (SH5)
- Human approval

### SH7 — Model-Assisted Improvements (Future, Optional)

**Purpose**: Use LLM capabilities for better triage and patching.

**Scope** (only after sufficient incident corpus):
- Prompt tuning for patch generation
- Retrieval-augmented classification
- Confidence calibration from historical accuracy
- Fine-tuning (much later, requires 100+ resolved incidents)

**Still gated by**: Human approval + verifier + all existing policies.

## Integration Matrix

| System | Feeds Into | Feeds From |
|--------|-----------|------------|
| stability-sweep | SH1 (incidents) | SH2 (invariants as checks) |
| helpdesk-golden | SH1 (incidents) | SH6 (new golden checks) |
| photography-golden | SH1 (incidents) | SH6 (new golden checks) |
| eval-complex | SH1 (incidents) | — |
| quality-gate | SH1 (incidents) | SH4 (verify step) |
| foundation-check | SH1 (incidents) | — |
| invariants | SH1 (evidence) | SH6 (new invariants) |
| knowledge store | SH3 (context) | SH5 (entries from resolved) |

## Artifact Directory Structure

```
artifacts/self-heal/
├── incidents/
│   ├── 20260226-143022-abc123/
│   │   └── incident.json
│   └── 20260226-150511-def456/
│       └── incident.json
├── patches/           (SH3, future)
│   └── SP-20260226-160000-ghi789.json
├── verifications/     (SH4, future)
│   └── SV-20260226-161500-jkl012.json
└── knowledge/         (SH5, future)
    └── self-heal-knowledge.jsonl
```
