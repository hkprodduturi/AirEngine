# AI Benchmark Plan

## Purpose

Prove AirEngine's differentiation as an AI-native IR and compiler through quantitative benchmarks. Measure the full prompt-to-running-app pipeline against the alternative (AI generating raw React/Express/Prisma directly).

## Benchmark Dimensions

### 1. Token Cost: `.air` vs Raw Code Generation

**Hypothesis**: Generating `.air` (20-80 lines) costs 5-20x fewer output tokens than generating equivalent React + Express + Prisma code (500-2000+ lines).

**Methodology**:
1. Define 10 app prompts of increasing complexity (see Eval Corpus below)
2. For each prompt, measure:
   - **AirEngine path**: tokens to generate `.air` + tokens for repair iterations
   - **Raw path**: tokens to generate equivalent React + Express + Prisma files
3. Compare total output tokens

**Metrics**:
| Metric | Definition |
|--------|-----------|
| `air_output_tokens` | Tokens in generated `.air` source |
| `air_repair_tokens` | Total tokens across repair iterations |
| `air_total_tokens` | `air_output_tokens + air_repair_tokens` |
| `raw_output_tokens` | Tokens to generate equivalent app code directly |
| `token_ratio` | `raw_output_tokens / air_total_tokens` |

**Target (hypothesis — to be measured in A4)**: `token_ratio > 10x` for medium complexity apps.

### 2. Time-to-First-Runnable-App

**Hypothesis**: AirEngine path (generate .air + validate + repair + transpile + install) is faster than raw generation path (generate all files + install) because less LLM output = faster generation.

**Methodology**:
1. Same 10 prompts
2. Measure wall-clock time from prompt submission to `npm run dev` succeeding
3. Breakdown:
   - **AirEngine path**: LLM generation time + validate time + repair time + transpile time + npm install time
   - **Raw path**: LLM generation time + file write time + npm install time

**Metrics**:
| Metric | Definition |
|--------|-----------|
| `air_gen_ms` | Time for AI to generate `.air` |
| `air_validate_ms` | Time for validate + lint |
| `air_repair_ms` | Time for AI repair iterations |
| `air_transpile_ms` | AirEngine transpile time |
| `air_install_ms` | npm install time |
| `air_total_ms` | Sum of all above |
| `raw_gen_ms` | Time for AI to generate all files |
| `raw_install_ms` | npm install time |
| `raw_total_ms` | Sum of all above |
| `speedup` | `raw_total_ms / air_total_ms` |

**Target (hypothesis — to be measured in A4)**: `speedup > 2x` for medium complexity apps.

### 3. Success Rate Without Human Code Edits

**Hypothesis**: AirEngine path has higher success rate because the deterministic compiler eliminates common AI code generation errors (import typos, missing dependencies, inconsistent naming, broken JSX).

**Methodology**:
1. Same 10 prompts, run each N times (N=10 for statistical significance)
2. Define "success" as: app builds (`npm run build` exits 0) AND serves HTTP 200
3. For AirEngine path: success = valid `.air` + transpile + build + serve
4. For raw path: success = all generated files + build + serve

**Metrics**:
| Metric | Definition |
|--------|-----------|
| `air_success_rate` | % of runs where AirEngine path produces runnable app |
| `raw_success_rate` | % of runs where raw generation produces runnable app |
| `success_lift` | `air_success_rate - raw_success_rate` |

**Target (hypothesis — to be measured in A4)**: `air_success_rate > 85%`, `success_lift > 20 percentage points`.

### 4. Retries to Valid `.air`

**Hypothesis**: Most `.air` files validate on first attempt or within 1-2 repair iterations.

**Methodology**:
1. Same 10 prompts, N=10 runs each
2. Count validation/lint errors per attempt
3. Count total repair iterations before success (or failure at max=3)

**Metrics**:
| Metric | Definition |
|--------|-----------|
| `first_pass_rate` | % of runs where `.air` validates without repair |
| `avg_repairs` | Average repair iterations (including 0) |
| `max_repairs` | Maximum repairs observed |
| `repair_failure_rate` | % of runs that exhaust max attempts |

**Distribution target (hypothesis — to be measured in A4)**:
- First-pass valid: > 60%
- 1 repair: > 25%
- 2 repairs: > 10%
- 3 repairs (failure): < 5%

### 5. Transpile Time

**Hypothesis**: AirEngine transpiles `.air` to full app in < 200ms consistently.

**Methodology**:
1. Transpile all eval corpus inputs 100 times each
2. Measure `stats.timing.totalMs` from TranspileResult
3. Track P50, P95, P99 latencies

**Metrics**:
| Metric | Definition |
|--------|-----------|
| `transpile_p50` | Median transpile time |
| `transpile_p95` | 95th percentile transpile time |
| `transpile_p99` | 99th percentile transpile time |
| `transpile_max` | Maximum observed transpile time |

**Targets (hypothesis — to be measured in A4)**: P50 < 100ms, P95 < 200ms, P99 < 500ms.

**Note**: This is already partially covered by `tests/bench.test.ts` (200ms ceiling per example, 500ms cumulative).

### 6. Smoke-Test Pass Rate

**Hypothesis**: AirEngine-transpiled code passes build smoke tests at a very high rate because the compiler output is deterministic and tested.

**Methodology**:
1. Transpile all eval corpus inputs
2. For each output: `npm install && npm run build`
3. Track pass/fail with failure categorization

**Metrics**:
| Metric | Definition |
|--------|-----------|
| `build_pass_rate` | % of transpiled apps that build successfully |
| `install_pass_rate` | % where npm install succeeds |
| `server_start_rate` | % where Express server starts (fullstack only) |

**Targets (hypothesis — to be measured in A4)**: `build_pass_rate > 99%` (compiler bugs are the only failure mode).

## Eval Corpus

### Using Existing Template Corpus

The Phase 1-4 template work provides an ideal eval corpus. Each template represents a structurally distinct app type that tests different compiler capabilities.

### Complexity Tiers

| Tier | Complexity | Eval Inputs | Source |
|------|-----------|-------------|--------|
| **T1: Simple** | 1 model, no auth, 1-2 pages | todo, notes, expense-tracker | Existing examples |
| **T2: Medium** | 2-3 models, auth, 3-5 pages | crud-admin, feed, marketplace | Phase 1 base specs |
| **T3: Complex** | 4+ models, relations, dashboard, roles | command-center, inbox, scheduler | Phase 1 base specs |
| **T4: Stress** | 5+ models, m:n relations, 8+ pages | projectflow-scale | Synthetic |

### Canonical 10 Eval Prompts

| # | Prompt (natural language) | Expected Complexity | Phase 1 Base |
|---|--------------------------|-------------------|-------------|
| 1 | "Simple todo app with add/delete/filter" | T1 | — (existing) |
| 2 | "Expense tracker with categories and budget" | T1 | — (existing) |
| 3 | "Blog with posts, comments, and auth" | T2 | crud-admin |
| 4 | "Task management with teams and assignments" | T2 | kanban |
| 5 | "E-commerce store with products, cart, checkout" | T2 | storefront |
| 6 | "Help desk with tickets, priority, assignment, dashboard" | T3 | command-center |
| 7 | "Project management with tasks, milestones, team members" | T3 | gantt |
| 8 | "Learning platform with courses, lessons, quizzes, progress" | T3 | learning |
| 9 | "Patient record system with vitals, medications, notes, labs" | T3 | patient-chart |
| 10 | "Multi-model CRM with contacts, deals, activities, pipeline, reports" | T4 | — (synthetic) |

### Generating `.air` for Eval

For each prompt, the benchmark harness:
1. Provides prompt + `air://spec` + `air://examples` to the AI agent
2. Records the generated `.air`
3. Runs the validate → repair → transpile → smoke test loop
4. Records all metrics

For the "raw path" comparison:
1. Provides same prompt to the AI agent
2. Instructs: "Generate a complete React + Tailwind + Express + Prisma app"
3. Records all generated files
4. Runs npm install + build
5. Records all metrics

## Benchmark Harness Architecture

```
benchmark/
  harness.ts          # Main benchmark runner
  prompts/            # 10 eval prompts as text files
  baselines/          # Pre-generated .air files (for transpile-only benchmarks)
  results/            # JSON output per run
  report.ts           # Generate markdown summary from results
```

### Harness Flow

```typescript
for (const prompt of prompts) {
  for (let run = 0; run < N; run++) {
    // AirEngine path
    const airResult = await runAirEnginePath(prompt);

    // Raw path (optional — requires LLM API access)
    const rawResult = await runRawPath(prompt);

    results.push({ prompt, run, airResult, rawResult });
  }
}
generateReport(results);
```

### Offline Benchmarks (No LLM Required)

Some benchmarks can run without LLM access:
- **Transpile time**: Use pre-generated `.air` baselines
- **Smoke-test pass rate**: Use pre-generated `.air` baselines
- **Compression ratio**: Compare `.air` line count to output line count

### Online Benchmarks (Require LLM API)

These require an LLM (Claude API) to be meaningful:
- **Token cost comparison**
- **Time-to-first-runnable-app**
- **Success rate**
- **Retries to valid .air**

## Reporting

### Summary Table (per prompt)

```
| Prompt | .air Lines | Output Files | Output Lines | Ratio | Repairs | Build | Success |
|--------|-----------|-------------|-------------|-------|---------|-------|---------|
| Todo   | 22        | 9           | 220         | 10:1  | 0       | PASS  | YES     |
| Blog   | 45        | 35          | 1200        | 27:1  | 1       | PASS  | YES     |
| CRM    | 78        | 52          | 2400        | 31:1  | 2       | PASS  | YES     |
```

### Aggregate Metrics

```
Token efficiency:     12.5x average (vs raw generation)
Time to first app:    2.3x faster average
Success rate:         87% (AirEngine) vs 62% (raw)
First-pass valid:     68%
Avg repair attempts:  0.4
Build pass rate:      100% (when .air is valid)
Transpile P95:        145ms
```

## Implementation Timeline

| Phase | Work | Depends On |
|-------|------|-----------|
| B1 | Offline harness (transpile time + smoke test + compression ratio) | Existing codebase |
| B2 | 10 baseline `.air` files (hand-verified valid) | B1 |
| B3 | Online harness (Claude API integration for token/time/success comparison) | B2 + Claude API key |
| B4 | Full benchmark run + report generation | B3 |
| B5 | CI integration (run offline benchmarks on every PR) | B1 |
