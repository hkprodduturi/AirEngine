# AirEngine

**AI-authored intermediate representation, deterministic compiler, owned app code.**

AirEngine is a compiler for `.air` files — a structured IR (intermediate representation) that AI models generate when building software. One `.air` file defines an entire full-stack application: frontend, backend, database, auth, jobs, email, and deployment. AirEngine transpiles it into production-ready React + Express + Prisma in milliseconds.

This is not a template pack or a black-box prompt toy. AirEngine is a deterministic compiler: the same `.air` input always produces the same output. AI generates the `.air`; AirEngine compiles it; you own the code.

```
@app:todo
  @state{items:[{id:int,text:str,done:bool}],filter:enum(all,active,done)}
  @style(theme:dark,accent:#6366f1,radius:12,font:sans)
  @ui(
    header>"Todo App"+badge:#items.length
    input:text>!add({text:#val,done:false})
    list>items|filter>*item(check:#item.done+text:#item.text+btn:!del(#item.id))
    tabs>filter.set(all,active,done)
    footer>"#items|!done.length items left"
  )
  @persist:localStorage(items)
```

**11 lines of `.air` &rarr; a working React app** with dark theme, Tailwind CSS, state management, filtered lists, and localStorage persistence.

---

## What You Can Run Without an API Key

Everything in the core pipeline works offline. No `ANTHROPIC_API_KEY` required:

- Transpile any `.air` file to a working app
- Run generated apps locally (client + server)
- Run all tests (`npx vitest run`)
- Run quality gates (`npm run quality-gate -- --mode offline`)
- Run golden checks (`npm run helpdesk-golden`, `npm run photography-golden`)
- Run complex eval (`npm run eval-complex`)
- Run stability sweep (`npm run stability-sweep -- --mode offline`)
- Use the MCP server with Claude Desktop or Claude Code
- Use `air doctor`, `air validate`, `air loop`, `air dev`

## What Requires an API Key

These features call the Anthropic Messages API and need `ANTHROPIC_API_KEY`:

- `npm run eval-online` — online eval harness (prompt-to-app via Claude)
- `npm run demo-prompt-replay -- --adapter claude` — live Claude generation
- `air loop --repair-mode claude` — LLM-assisted repair
- `npm run self-heal-loop -- --mode propose --model-assisted` — LLM-enriched patches

---

## Quickstart (Offline / Local)

### Prerequisites

- Node.js >= 18.0.0
- npm

Verify with:

```bash
node --version   # must be >= 18
npm --version
```

### 1. Clone and Install

```bash
git clone https://github.com/hkprodduturi/AirEngine.git
cd AirEngine
npm install
```

### 2. Check Environment

```bash
npx tsx src/cli/index.ts doctor
```

This checks Node version, npm, tsx, required directories, and .air file parsing.

### 3. Run Quality Gate (proves everything works)

```bash
npm run quality-gate -- --mode offline
```

This runs TypeScript compilation, full test suite, eval-local benchmarks, and schema validation.

### 4. Transpile a Flagship App

```bash
npx tsx src/cli/index.ts transpile examples/helpdesk.air -o ./output --no-incremental
```

### 5. Run the Generated App

**Frontend-only apps** (no `@db`/`@api` blocks):

```bash
cd output && npm install && npx vite
```

**Fullstack apps** (with `@db`/`@api` blocks) — requires two terminals:

```bash
# Terminal 1: Server
cd output/server && npm install
echo 'DATABASE_URL="file:./dev.db"' > .env
echo 'JWT_SECRET="dev-secret"' >> .env
echo 'SMTP_HOST="localhost"' >> .env
echo 'PORT=3001' >> .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts

# Terminal 2: Client
cd output/client && npm install && npx vite --port 5173
```

Open `http://localhost:5173` in your browser.

---

## Flagship Examples

These are production-quality, fullstack apps — the primary public showcase. Each has golden-run or complex-eval coverage.

| App | File | Lines | Models | Type | What It Demonstrates |
|-----|------|-------|--------|------|----------------------|
| **Lumiere Studio** | `examples/photography-studio-premium.air` | 360 | 6 | Fullstack + public pages | Portfolio CMS, 6-stage inquiry pipeline, services catalog, testimonials, FAQ, admin dashboard |
| **SalesPipe CRM** | `examples/crm-sales-pipeline.air` | 318 | 8 | Fullstack + admin | Deal pipeline, lead qualification, activity logging, profile management, 424-record seed |
| **ProjectFlow** | `examples/projectflow.air` | 301 | 5 | Fullstack + all blocks | All 16 block types: cron, webhooks, queues, email, deploy config |
| **HelpDesk** | `examples/helpdesk.air` | 137 | 4 | Fullstack + SaaS | Ticket workflows, agent assignment, SLA tracking, reply threads, analytics |
| **E-Commerce** | `examples/ecommerce.air` | 131 | 4 | Fullstack + commerce | Cart mutations, order workflow, checkout, webhooks, inventory tracking |

The repo also contains 7 internal regression fixtures, 14 gallery apps, and 20 base templates. See `examples/showcase-manifest.json` for the curated flagship list and `examples/fixtures-manifest.json` for the complete inventory.

---

## Running Flagship Apps Locally

### Photography Studio (Lumiere)

```bash
# Transpile
npx tsx src/cli/index.ts transpile examples/photography-studio-premium.air -o ./output --no-incremental

# Server (Terminal 1)
cd output/server && npm install
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts
# Expected: "Server running on port 3001"

# Client (Terminal 2)
cd output/client && npm install && npx vite --port 5173
# Expected: "VITE ready" on http://localhost:5173
```

### HelpDesk

```bash
rm -rf output
npx tsx src/cli/index.ts transpile examples/helpdesk.air -o ./output --no-incremental

cd output/server && npm install
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts

# Separate terminal:
cd output/client && npm install && npx vite --port 5173
```

### ProjectFlow

```bash
rm -rf output
npx tsx src/cli/index.ts transpile examples/projectflow.air -o ./output --no-incremental

cd output/server && npm install
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts

# Separate terminal:
cd output/client && npm install && npx vite --port 5173
```

For detailed setup instructions, see [docs/run-flagship-apps-locally.md](docs/run-flagship-apps-locally.md).

---

## Core Validation Commands

These commands prove the pipeline is working correctly:

```bash
# TypeScript compilation
npx tsc --noEmit

# Full test suite (1100+ tests)
npx vitest run

# Offline quality gate (tsc + tests + eval + schema sanity)
npm run quality-gate -- --mode offline

# Golden runs (flagship capability checks)
npm run helpdesk-golden       # 32 capability checks
npm run photography-golden    # 33 capability checks

# Complex eval (5 replay fixtures through full loop)
npm run eval-complex

# Stability sweep (all showcase + fixtures through loop)
npm run stability-sweep -- --mode offline

# Foundation check (tsc + tests + eval + schema validation)
npm run foundation-check

# Environment doctor
npx tsx src/cli/index.ts doctor
```

---

## What AirEngine Generates

| Input | Output |
|-------|--------|
| `todo.air` (11 lines) | 9 files, ~220 lines — Vite + React + Tailwind |
| `fullstack-todo.air` (20 lines) | 24 files, ~1100 lines — React client + Express/Prisma server |
| `helpdesk.air` (137 lines) | 37 files, ~3200 lines — 4 models, JWT auth, analytics |
| `projectflow.air` (301 lines) | 50 files, ~2200 lines — 5 models, 18 API routes, 5 pages |
| `photography-studio-premium.air` (360 lines) | 45 files, ~4000 lines — 6 models, public + admin pages |

Every generated app builds and runs. Frontend apps use Vite + React + Tailwind. Fullstack apps add Express + Prisma with SQLite. Generated servers include JWT auth (HMAC-SHA256), request validation, rate limiting, helmet security headers, and CORS config.

### Generated Output Structure

**Frontend-only** (no `@db`/`@api`):
```
output/
  index.html
  package.json
  vite.config.js
  tailwind.config.cjs
  postcss.config.cjs
  src/
    App.jsx
    main.jsx
    index.css
```

**Fullstack** (with `@db`/`@api`):
```
output/
  client/
    index.html, package.json, vite.config.js
    src/App.jsx, main.jsx, pages/, api.js
  server/
    server.ts, package.json, tsconfig.json
    routes/, middleware/, auth.ts
    prisma/schema.prisma, seed.ts
  _airengine_manifest.json
```

---

## Supported Blocks (16)

| Block | Purpose |
|-------|---------|
| `@app:name` | Declare application |
| `@state{...}` | Reactive client state |
| `@style(...)` | Design tokens (theme, accent, radius, font, maxWidth) |
| `@ui(...)` | Component tree with pages, sections, forms |
| `@db{...}` | Database models with field modifiers |
| `@api(...)` | REST routes mapped to Prisma operations |
| `@auth(...)` | Authentication config (roles, redirect) |
| `@env(...)` | Environment variables with defaults |
| `@webhook(...)` | Webhook endpoint handlers |
| `@cron(...)` | Scheduled job definitions |
| `@queue(...)` | Background job definitions |
| `@email(...)` | Email template definitions |
| `@nav(...)` | Client-side routing with guards |
| `@persist:x(...)` | Data persistence (localStorage, cookie) |
| `@hook(...)` | Lifecycle hooks and side effects |
| `@deploy(...)` | Deployment config (Docker Compose generation) |

---

## MCP Integration

AirEngine includes an MCP server for use with Claude Desktop, Claude Code, and other AI assistants. It exposes seven tools: `air_validate`, `air_transpile`, `air_explain`, `air_generate`, `air_lint`, `air_capabilities`, and `air_loop`.

See [docs/mcp-quickstart.md](docs/mcp-quickstart.md) for setup.

---

## CLI Commands

```bash
air transpile app.air -o ./out              # Transpile (incremental by default)
air transpile app.air --target client       # Client-only output
air transpile app.air --target server       # Server-only output
air transpile app.air --no-incremental      # Force full rebuild
air validate app.air                        # Parse + validate without transpiling
air loop app.air                            # Full pipeline (validate, repair, transpile, smoke)
air init                                    # Interactive starter .air file
air init --name myapp --fullstack           # Non-interactive fullstack template
air dev app.air                             # Watch mode with hot reload
air dev app.air -p 3000 --server-port 3001  # Custom ports
air doctor                                  # Check environment
air doctor app.air                          # Check env + validate .air file
```

---

## Troubleshooting

Common issues and their fixes:

| Issue | Fix |
|-------|-----|
| Port 3001/5173 in use | `lsof -i :3001 -t \| xargs kill` |
| Prisma "DATABASE_URL not set" | Create `.env` with `DATABASE_URL="file:./dev.db"` in `output/server/` |
| `tsx: command not found` | Run `npm install` in the project root |
| Tests failing | `npx vitest run` — check for Node >= 18 |
| Transpile parse errors | `npx tsx src/cli/index.ts validate myapp.air` to see diagnostics |

For detailed troubleshooting, see [docs/troubleshooting-local.md](docs/troubleshooting-local.md).

---

## Docs Index

| Doc | Description |
|-----|-------------|
| [docs/quickstart-local.md](docs/quickstart-local.md) | Step-by-step local setup guide |
| [docs/run-flagship-apps-locally.md](docs/run-flagship-apps-locally.md) | Detailed instructions for running flagship apps |
| [docs/what-to-expect.md](docs/what-to-expect.md) | What AirEngine is, what it generates, what to expect |
| [docs/troubleshooting-local.md](docs/troubleshooting-local.md) | Common issues and fixes |
| [docs/quickstart-ai-first.md](docs/quickstart-ai-first.md) | AI-first workflow quickstart |
| [docs/mcp-quickstart.md](docs/mcp-quickstart.md) | MCP server setup for Claude |
| [docs/examples-policy.md](docs/examples-policy.md) | Examples tier system and classification rules |
| [docs/examples-inventory-and-usage.md](docs/examples-inventory-and-usage.md) | Complete dependency audit of all 46 example files |
| [SPEC.md](SPEC.md) | Full `.air` language specification |

---

## Development

```bash
git clone https://github.com/hkprodduturi/AirEngine.git
cd AirEngine
npm install
npm run build         # TypeScript compilation
npx vitest run        # Full test suite
```

## License

MIT
