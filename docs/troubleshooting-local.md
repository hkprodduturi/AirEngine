# AirEngine Local Troubleshooting

Quick fixes for common issues when running AirEngine locally.

## Diagnostic Commands

### Environment Doctor

```bash
npx tsx src/cli/index.ts doctor
```

Checks: Node.js version, npm, tsx, required files, writable directories. Report written to `artifacts/doctor/doctor-report.json`.

### Full Quality Gate

```bash
npm run quality-gate -- --mode offline
```

Runs: TypeScript compilation, full test suite, eval-local benchmarks, schema validation.

### Foundation Check

```bash
npm run foundation-check -- --verbose --fail-fast
```

Runs: tsc, vitest, eval-local, schema sanity. `--fail-fast` stops at first failure.

---

## Common Issues

### Port Already in Use

**Symptom:** `Error: listen EADDRINUSE: address already in use :::3001`

**Fix:**

```bash
# Find and kill the process on port 3001
lsof -i :3001 -t | xargs kill

# Same for port 5173 (client)
lsof -i :5173 -t | xargs kill
```

Then restart the server/client.

### Prisma: DATABASE_URL Not Set

**Symptom:** `Missing required env var: DATABASE_URL`

**Fix:** Create `.env` in the `output/server/` directory:

```bash
cd output/server
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
```

### Prisma: Database Not Synced

**Symptom:** `The table does not exist in the current database` or model errors

**Fix:** Push the schema and regenerate:

```bash
cd output/server
npx prisma db push
npx prisma generate
```

### Prisma: Client Not Generated

**Symptom:** `@prisma/client did not initialize yet`

**Fix:**

```bash
cd output/server
npx prisma generate
```

### tsx Not Found

**Symptom:** `tsx: command not found` or `Cannot find module tsx`

**Fix:** Make sure project dependencies are installed:

```bash
cd /path/to/AirEngine
npm install
```

Or use the `node --import tsx` form directly:

```bash
node --import tsx src/cli/index.ts doctor
```

### Stale Output Directory

**Symptom:** Old app code appears after transpiling a different `.air` file

**Fix:** Clean the output before transpiling a different app:

```bash
rm -rf output
npx tsx src/cli/index.ts transpile examples/helpdesk.air -o ./output --no-incremental
```

The `--no-incremental` flag forces a full rebuild, ignoring the hash cache.

### Transpile Parse Errors

**Symptom:** Parse errors when transpiling a `.air` file

**Fix:** Validate first to see diagnostics:

```bash
npx tsx src/cli/index.ts validate myapp.air
```

Or use the loop command for auto-repair:

```bash
npx tsx src/cli/index.ts loop myapp.air
```

The loop attempts deterministic repair for common issues (missing `@app`, missing `@ui`).

### Client Build Errors

**Symptom:** Vite or npm errors in the `output/client/` directory

**Fix:**

```bash
cd output/client
rm -rf node_modules
npm install
npx vite --port 5173
```

### Server TypeScript Errors

**Symptom:** TypeScript errors when running `npx tsx server.ts`

**Fix:** This usually means dependencies are missing:

```bash
cd output/server
npm install
```

### ANTHROPIC_API_KEY Not Set

**Symptom:** Error about missing API key

**What needs a key:** `eval-online`, `--adapter claude`, `--repair-mode claude`, `--model-assisted`

**What does NOT need a key:** Everything else (transpile, tests, quality-gate offline, golden runs, stability-sweep offline)

**Fix:** Set the key or use offline mode:

```bash
# Set key (for features that need it)
export ANTHROPIC_API_KEY=sk-ant-...

# Or use offline alternatives
npm run quality-gate -- --mode offline
npm run stability-sweep -- --mode offline
```

### Tests Failing

**Symptom:** `npx vitest run` reports failures

**Fix:**

1. Check Node version: `node --version` (must be >= 18)
2. Check dependencies: `npm install`
3. Run a single test file to isolate:

```bash
npx vitest run tests/parser.test.ts
```

4. Check TypeScript:

```bash
npx tsc --noEmit
```

### MCP Server Not Connecting

1. Verify it starts: `npm run mcp`
2. Check the path in your MCP config is absolute
3. Restart Claude Desktop completely (quit + reopen)
4. Check Claude Desktop logs for error details

See [mcp-quickstart.md](mcp-quickstart.md) for setup.

### Vite Port Conflict

**Symptom:** Vite says "Port 5173 is in use, trying another one..." and picks 5174

**Fix:** Kill the old Vite process first:

```bash
lsof -i :5173 -t | xargs kill
```

Or use the new port — the app works on any port, just update your browser URL.

---

## Verification Checklist

If something seems wrong, run these in order:

```bash
# 1. TypeScript compiles
npx tsc --noEmit

# 2. All tests pass
npx vitest run

# 3. Quality gate (comprehensive)
npm run quality-gate -- --mode offline

# 4. Doctor (environment health)
npx tsx src/cli/index.ts doctor

# 5. Golden runs (flagship capability)
npm run helpdesk-golden
npm run photography-golden
```

If all of these pass, the pipeline is healthy.

---

## Getting Help

- File issues: https://github.com/hkprodduturi/AirEngine/issues
- Run `npm run doctor` and attach `artifacts/doctor/doctor-report.json` to your issue
