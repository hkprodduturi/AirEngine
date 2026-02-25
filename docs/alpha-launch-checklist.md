# Alpha Launch Checklist

Pre-release verification for AirEngine v0.2.0-alpha.

## Foundation Gates

- [ ] `npx tsc --noEmit` — exit 0
- [ ] `npx vitest run` — all tests pass (869+)
- [ ] `npm run eval-local` — 6/6 benchmarks pass
- [ ] `npm run foundation-check` — 4/4 stages pass
- [ ] `npm run doctor` — verdict PASS

## Offline Demo

- [ ] `npm run demo-canonical` — fullstack-todo loop succeeds
- [ ] `npm run demo-prompt-replay -- --fixture-id todo` — prompt-to-app succeeds
- [ ] `npm run demo-prompt-replay -- --list-fixtures` — lists 5 fixtures
- [ ] `npx tsx src/cli/index.js transpile examples/todo.air -o /tmp/test-todo` — generates files

## Quality Gate (Offline)

- [ ] `npm run quality-gate -- --mode offline` — all offline steps pass

## Live Demo (requires ANTHROPIC_API_KEY)

- [ ] `npm run demo-live-canonical` — Claude generation + loop succeeds
- [ ] `npm run eval-online -- --dry-run` — corpus validates, exit 0
- [ ] `npm run eval-online -- --limit 1` — 1 prompt runs through pipeline
- [ ] `npm run quality-gate -- --mode online` — online steps pass

## Docs and Artifacts

- [ ] `docs/quickstart-ai-first.md` exists
- [ ] `docs/mcp-quickstart.md` exists
- [ ] `docs/troubleshooting-ai-first.md` exists
- [ ] `examples/showcase-manifest.json` exists and lists 7 examples
- [ ] Schema files present: loop-result, online-eval-result, quality-gate-result, canonical-live-demo-result, prompt-replay-result, diagnostics

## Error Messages

- [ ] All CLI errors use text labels (no emoji)
- [ ] Missing API key errors include fallback hints
- [ ] Script entrypoints have `.catch()` handlers

## Sign-Off

| Gate | Status | Date |
|------|--------|------|
| Foundation | | |
| Offline demo | | |
| Live demo | | |
| Docs review | | |
