# Canonical Live Demo Runbook

Operator-ready guide for running the AirEngine canonical demo pipeline.

## Preflight Checklist

- [ ] Node.js >= 18 installed (`node --version`)
- [ ] Repo is clean and on the correct branch (`git status`)
- [ ] Dependencies installed (`npm install`)
- [ ] Offline gates passing (`npx tsx scripts/quality-gate.ts --mode offline`)
- [ ] For live demo: `ANTHROPIC_API_KEY` is set and valid
- [ ] For replay fallback: no key needed

## Quick Commands

### Replay Fallback (always works, no API key)

```bash
npx tsx scripts/demo-live-canonical.ts --adapter replay
```

Expected: SUCCESS in <1s, uses pre-built `fullstack-todo.air` fixture.

### Live Claude Demo

```bash
ANTHROPIC_API_KEY=sk-... npx tsx scripts/demo-live-canonical.ts --adapter claude
```

Expected: SUCCESS in 10-30s depending on provider latency.

### Live with Claude Repair

```bash
ANTHROPIC_API_KEY=sk-... npx tsx scripts/demo-live-canonical.ts \
  --adapter claude \
  --repair-mode claude \
  --max-repair-attempts 2 \
  --verbose
```

### Custom Prompt

```bash
npx tsx scripts/demo-live-canonical.ts \
  --adapter replay \
  --prompt "Build a simple todo app"
```

### Keep Output Files

```bash
npx tsx scripts/demo-live-canonical.ts --adapter replay --keep-output --output-dir ./demo-output
```

## Expected Success Output

```
Canonical Live Demo — AirEngine v0.2.0
Adapter: replay
Repair: deterministic, max attempts: 1
Prompt: "Build a fullstack todo app with a database for tasks. Each task has a title..."

Step 1: Generating .air source...
  Generated 24 lines (1ms)

Step 2: Running pipeline (validate -> repair -> transpile -> smoke -> determinism)...

=== Canonical Demo: SUCCESS ===
Adapter: replay
Prompt: "Build a fullstack todo app with a database for tasks. Each task has a title..."

Generation: 1ms
Pipeline:
  validate      PASS (5ms)
  repair        SKIP (0ms)
  transpile     PASS (20ms)
  smoke         PASS (10ms)
  determinism   PASS (15ms)

Output: 50 files, 2204 lines
Deterministic: yes

Total: 55ms
Report: artifacts/demo/canonical-live-demo-result.json
Generated .air: artifacts/demo/generated.air
```

## Failure Recovery Playbook

### Missing API Key

**Symptom**: `ERROR: ANTHROPIC_API_KEY not set.`

**Action**:
1. Set the key: `export ANTHROPIC_API_KEY=sk-...`
2. Or fall back to replay: `npx tsx scripts/demo-live-canonical.ts --adapter replay`

A structured failure report is still written to `artifacts/demo/canonical-live-demo-result.json`.

### Provider Timeout

**Symptom**: Generation takes >30s and fails.

**Action**:
1. Increase timeout: `--timeout-ms 60000`
2. Or fall back to replay adapter
3. Show the replay output as a demo of deterministic pipeline quality

### Provider Returns Invalid .air

**Symptom**: Generation succeeds but loop validation fails.

**Action**:
1. Enable repair: `--repair-mode deterministic` or `--repair-mode claude --max-repair-attempts 2`
2. Show the repair cycle as a demo feature ("self-healing pipeline")
3. If repair fails, fall back to replay adapter

### Loop Validation/Repair Failure

**Symptom**: Pipeline fails at validate or transpile stage.

**Action**:
1. Check `artifacts/demo/generated.air` for the generated source
2. Run replay fallback for the live demo
3. Use the generated .air artifact to demonstrate what the model produced
4. Show the structured failure report as evidence of quality instrumentation

## What to Show If Live Run Fails

Even if the Claude live path fails, you can demonstrate:

1. **Replay path always works**: `--adapter replay` shows the deterministic pipeline
2. **Structured artifacts**: The failure report itself shows quality instrumentation
3. **Generated .air source**: Show what the model produced (if generation succeeded)
4. **Pipeline stages**: Point to individual stage results as evidence of thorough checks
5. **Quality gates**: `npx tsx scripts/quality-gate.ts --mode offline` shows the full gate system

## Artifacts

| Artifact | Path |
|----------|------|
| Demo result (JSON) | `artifacts/demo/canonical-live-demo-result.json` |
| Generated .air | `artifacts/demo/generated.air` |
| Output files | temp dir (auto-cleaned unless `--keep-output`) |

## Timing Expectations

| Adapter | Generation | Loop | Total |
|---------|-----------|------|-------|
| Replay | <5ms | 20-50ms | <100ms |
| Claude | 5-25s | 20-50ms | 5-25s |
| Claude + Claude repair | 5-25s + 5-25s/attempt | 20-50ms | 10-50s |
