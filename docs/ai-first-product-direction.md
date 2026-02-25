# AirEngine: AI-First Product Direction

## Product Definition

**AirEngine is an AI-native application intermediate representation (IR) and deterministic compiler.**

It is NOT a prompt-to-code generator, a template library, or a human-first DSL product.

The `.air` format is a compact, structured IR that AI agents author and AirEngine deterministically compiles into owned, production-quality full-stack application code (React + Tailwind + Express + Prisma).

## Core Workflow

```
Human intent (natural language)
  → AI agent writes .air
    → AirEngine validates/lints .air
      → AI agent repairs .air using structured feedback
        → AirEngine transpiles .air to full-stack app code
          → Human receives running code they own
```

The default author of `.air` is the AI agent, not the human.

## Target Users

### Primary: AI Agents (Claude, GPT, etc.)
- Consume `air://spec` resource for syntax knowledge
- Call `air_validate` / `air_lint` for structured feedback
- Self-correct `.air` using machine-readable diagnostics
- Call `air_transpile` to produce deployable code
- Operate via MCP protocol

### Secondary: Developers Receiving Generated Code
- Inspect `.air` for trust, debugging, auditability
- Run CLI commands (`air transpile`, `air dev`, `air doctor`)
- Own and modify the generated React/Express/Prisma output
- Never required to hand-write `.air` (but can if they choose)

## Primary UX: MCP-First

The canonical interface is the MCP server (`src/mcp/server.ts`):

| Tool | Purpose |
|------|---------|
| `air_validate` | Syntax + structural validation with error codes |
| `air_lint` | Semantic issue detection (unused state, missing routes, ambiguous relations) |
| `air_transpile` | Deterministic compilation to React + Express + Prisma |
| `air_explain` | Structural summary for agent introspection |
| `air_generate` | Scaffolding prompt (delegates to calling LLM) |
| `air_capabilities` | Static introspection of supported blocks/elements/operators |

| Resource | Purpose |
|----------|---------|
| `air://spec` | Full language specification for agent consumption |
| `air://examples` | Reference `.air` files for pattern learning |

## Secondary UX: CLI

The CLI (`air transpile`, `air validate`, `air dev`, `air doctor`, `air init`) serves developers who want to:
- Run AirEngine locally outside an AI agent context
- Debug transpilation issues
- Iterate on `.air` files manually (secondary use case)
- Integrate into CI/CD pipelines

## Scope

### In Scope (Active Development)
- MCP server reliability and tool completeness
- Structured validation diagnostics optimized for AI self-repair
- Transpiler quality improvements (forms, validation, auth, errors)
- Benchmark harness proving AI-first differentiation
- Canonical demo showing prompt-to-running-app
- Regression/eval suite using existing template corpus
- `.air` language evolution for expressiveness and AI-friendliness

### Out of Scope (Deprioritized)
- Style variants for templates
- Template gallery UI/polish
- Human-facing starter/template marketing workflows
- Human CLI onboarding as primary UX
- Human-first DSL ergonomics (syntax sugar for humans)
- Visual `.air` editor or GUI builder

### Preserved but Reclassified
Existing Phase 1-4 template work and starter plans are valuable but reclassified as **internal assets**:

| Asset | Original Purpose | New Classification |
|-------|-----------------|-------------------|
| Phase 1 base-template-specs.json | Template library planning | **Eval corpus** for AI benchmark |
| Phase 4 example .air files | Demo gallery content | **Compiler test fixtures** |
| Starter acceptance criteria | Template quality gates | **Transpiler regression criteria** |
| Capability matrix | Template feature tracking | **Compiler coverage map** |
| Transpiler readiness audit | Starter readiness | **AI-generated app quality baseline** |
| T1-T4 roadmap items | Starter-ready transpiler | **AI-generated app quality improvements** |
| Duplication report | Template uniqueness | **Structural diversity verification** |

## Design Principles

### 1. AI-First, Not Human-Hostile
`.air` should be optimized for AI authorship: compact tokens, unambiguous syntax, predictable structure. It should also be human-inspectable for trust, but human writeability is secondary.

### 2. Deterministic Compilation
Same `.air` input always produces identical output. No LLM in the compilation path. The compiler is a pure function.

### 3. Structured Feedback for Self-Correction
Every validation error, lint warning, and parse failure must be machine-readable with stable error codes, precise locations, and actionable fix hints. The AI agent should be able to self-correct without human intervention.

### 4. Owned Output
The generated code belongs to the developer. No runtime dependencies on AirEngine. No phone-home. Standard React + Express + Prisma that works independently.

### 5. Token Efficiency
A `.air` file should be 10-50x smaller than the equivalent hand-written React + Express + Prisma code. This is the core economic argument: cheaper, faster, more reliable than raw code generation.

## North Star Metric

**Prompt-to-running-app success rate with zero human code edits.**

This measures the entire loop:
1. Human describes intent
2. AI writes `.air`
3. AirEngine validates/repairs/transpiles
4. App runs successfully
5. No manual code fixes needed

Target: >80% success rate for apps within the language's capability envelope.

## AI-First Language Design Principles

### Compactness
Minimize tokens, maximize information density. Every `.air` construct encodes significant semantic intent relative to its token cost.

### No Ambiguous Sugar
Every construct has exactly one parse. There are no semantically equivalent alternative syntaxes — agents never need to choose between equivalent representations.

### Canonical Normalization
No semantically equivalent alternatives. If two `.air` fragments produce the same AST, they must be textually identical (after whitespace normalization).

### Grammar Versioning
The `.air` format supports future versioning via `@air:v1` header. Current version is implicit v1 (no header required). Breaking syntax changes require a version bump.

### Syntax Evolution Gate
Syntax changes must be justified by measured agent success rate metrics. No syntax is added "for humans" at the expense of AI authorship clarity.

## Determinism Scope

### Guaranteed
- Same `.air` input + same AirEngine version = identical output files, identical content hashes, identical diagnostics
- Diagnostics ordering is deterministic: sorted by severity (error > warning > info), then by line number (ascending), then by code (alphabetical)
- Transpile output file ordering is deterministic (alphabetical by path)
- Codegen manifest hashes are stable across runs

### NOT Guaranteed
- Same natural language prompt → same `.air` output (LLM non-determinism is inherent)
- Cross-version output stability: generated code may change between AirEngine versions (new features, bug fixes, improved templates)
- Cross-platform byte-identical output (line endings may vary)

## What Success Looks Like

A developer using Claude with AirEngine MCP:
1. Says: "Build me a task management app with teams, assignments, and a kanban board"
2. Claude writes ~40 lines of `.air`
3. AirEngine validates (passes or AI self-corrects in 1-2 iterations)
4. AirEngine transpiles to ~50 files, ~2000 lines of React + Express + Prisma
5. Developer runs `npm install && npm run dev`
6. Working app with auth, database, API, and styled UI — in under 60 seconds total
