# AirEngine Troubleshooting

## Diagnostic Commands

Run the doctor to check your environment:

```bash
npm run doctor
```

This verifies Node.js version, npm, tsx, required files, API key, and writable directories.

For verbose output:

```bash
npm run doctor -- --verbose
```

Report is written to `artifacts/doctor/doctor-report.json`.

## Common Issues

### "ANTHROPIC_API_KEY not set"

**Affects**: `air loop --repair-mode claude`, `npm run demo-live-canonical`, `npm run eval-online`

**Fix**: Set the environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Workaround**: Use offline mode. All offline commands work without an API key:

```bash
# Use deterministic repair instead of Claude repair
npx tsx src/cli/index.js loop examples/todo.air --repair-mode deterministic

# Use replay adapter instead of Claude adapter
npm run demo-prompt-replay -- --fixture-id todo

# Validate corpus without API calls
npm run eval-online -- --dry-run
```

### "tsx not found"

**Fix**: Install dependencies:

```bash
npm install
```

Or install tsx globally:

```bash
npm install -g tsx
```

### TypeScript compilation errors

**Check**: Run the compiler:

```bash
npx tsc --noEmit
```

If errors appear, ensure you're on the correct branch and dependencies are installed.

### Tests failing

**Check**: Run the full suite:

```bash
npx vitest run
```

For a single file:

```bash
npx vitest run tests/parser.test.ts
```

### Foundation check failing

```bash
npm run foundation-check -- --verbose --fail-fast
```

This runs tsc, vitest, eval-local, and schema sanity in sequence. `--fail-fast` stops at the first failure.

### Transpile errors

**"Unsupported framework"**: Only `react` is supported. Omit `--framework` or use `--framework react`.

**Parse errors**: Validate the .air file first:

```bash
npx tsx src/cli/index.js validate myapp.air
```

**Repair**: Use the loop command to auto-repair common issues:

```bash
npx tsx src/cli/index.js loop myapp.air
```

### MCP server not connecting

1. Verify the server starts:

```bash
npm run mcp
```

2. Check the path in your MCP config is absolute
3. Restart Claude Desktop completely (quit + reopen)
4. Check Claude Desktop logs for error details

### Benchmark regressions

Compare two benchmark runs:

```bash
npm run benchmark-compare -- --baseline artifacts/benchmarks/old.json --current artifacts/benchmarks/new.json
```

Default thresholds: 1.5x timing regression, 10pp rate drop.

## Getting Help

- File issues: https://github.com/hkprodduturi/AirEngine/issues
- Run `npm run doctor` and attach the report to your issue
