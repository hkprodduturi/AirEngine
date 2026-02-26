# AirEngine Local Quickstart

Step-by-step guide to set up and run AirEngine locally. No API keys required.

## Prerequisites

| Requirement | Minimum | Check |
|-------------|---------|-------|
| Node.js | >= 18.0.0 | `node --version` |
| npm | >= 8 | `npm --version` |

## 1. Clone and Install

```bash
git clone https://github.com/hkprodduturi/AirEngine.git
cd AirEngine
npm install
```

## 2. Verify Environment

```bash
npx tsx src/cli/index.ts doctor
```

Expected output:
```
AirEngine Doctor
  Node.js:    PASS (v20.x.x)
  npm:        PASS
  tsx:        PASS
  ...
```

## 3. Run the Offline Quality Gate

This single command proves the entire pipeline works:

```bash
npm run quality-gate -- --mode offline
```

It runs TypeScript compilation, the full test suite (1100+ tests), eval-local benchmarks, and schema validation. Takes about 30-60 seconds.

## 4. Transpile Your First App

**Frontend-only example** (simplest):

```bash
npx tsx src/cli/index.ts transpile examples/todo.air -o ./output
cd output && npm install && npx vite
```

Open `http://localhost:5173`. You should see a todo app with dark theme.

**Fullstack example** (with database):

```bash
rm -rf output
npx tsx src/cli/index.ts transpile examples/helpdesk.air -o ./output --no-incremental
```

Then follow the fullstack setup in Section 5.

## 5. Run a Fullstack App

Fullstack apps (those with `@db` or `@api` blocks) generate both `client/` and `server/` directories. They need two terminal sessions.

### Terminal 1: Server

```bash
cd output/server
npm install

# Create environment file
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env

# Set up database
npx prisma db push        # Create SQLite database from schema
npx prisma generate       # Generate Prisma client
npx tsx seed.ts           # Seed with sample data

# Start server
npx tsx server.ts
```

Expected output: `Server running on port 3001`

Verify: `curl http://localhost:3001/api/health` should return `{"status":"ok","db":"connected"}`

### Terminal 2: Client

```bash
cd output/client
npm install
npx vite --port 5173
```

Expected output: `VITE ready` with local URL `http://localhost:5173`

Open the URL in your browser.

## 6. Try a Flagship App

See [run-flagship-apps-locally.md](run-flagship-apps-locally.md) for detailed instructions on Photography Studio, HelpDesk, and ProjectFlow.

## 7. Write Your Own .air File

```bash
# Generate a starter template
npx tsx src/cli/index.ts init --name myapp --fullstack

# Edit myapp.air to your liking, then transpile
npx tsx src/cli/index.ts transpile myapp.air -o ./my-output --no-incremental
```

## 8. Watch Mode (Live Reload)

```bash
npx tsx src/cli/index.ts dev myapp.air -o ./my-output
```

Edit `myapp.air` and the app rebuilds automatically. Vite HMR reloads the browser.

## What Works Without an API Key

| Feature | Works Offline |
|---------|--------------|
| Transpile `.air` files | Yes |
| Run generated apps | Yes |
| All tests (`npx vitest run`) | Yes |
| Quality gates (offline mode) | Yes |
| Golden runs | Yes |
| Complex eval | Yes |
| Stability sweep (offline) | Yes |
| MCP server | Yes |
| `air doctor`, `air validate`, `air loop` | Yes |

## What Requires `ANTHROPIC_API_KEY`

| Feature | Needs Key |
|---------|-----------|
| `npm run eval-online` | Yes |
| `--adapter claude` in prompt replay | Yes |
| `--repair-mode claude` in loop | Yes |
| `--model-assisted` in self-heal | Yes |

## Next Steps

- [run-flagship-apps-locally.md](run-flagship-apps-locally.md) — Run flagship apps step by step
- [what-to-expect.md](what-to-expect.md) — Understand what AirEngine generates
- [troubleshooting-local.md](troubleshooting-local.md) — Fix common issues
- [quickstart-ai-first.md](quickstart-ai-first.md) — AI-first workflow with MCP
