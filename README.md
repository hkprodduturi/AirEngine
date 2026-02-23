# AirEngine

**One `.air` file, full-stack apps.** AirEngine is a transpiler that converts a compact AI-native language into production-ready React + Express + Prisma applications.

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

**11 lines of AIR &rarr; a working React app** with dark theme, Tailwind CSS, state management, filtered lists, and localStorage persistence.

---

## Quick Start

```bash
npm install -g airengine
```

Save the example above as `todo.air`, then transpile and run:

```bash
air transpile todo.air -o ./my-app
cd my-app && npm install && npm run dev
```

For full-stack apps (with `@db` or `@api` blocks), AirEngine generates a `client/` + `server/` structure:

```bash
air transpile app.air -o ./my-fullstack-app

# Client
cd my-fullstack-app/client && npm install && npm run dev

# Server
cd my-fullstack-app/server && npm install && npx prisma generate && npx prisma db push && npx tsx server.ts
```

Bundled examples are included in the npm package. To use them, clone the repo or find them at `$(npm root -g)/airengine/examples/`.

## What It Generates

| Input | Output |
|-------|--------|
| `todo.air` (11 lines) | 7 files, 138 lines — Vite + React + Tailwind |
| `fullstack-todo.air` (18 lines) | 14 files, 310 lines — React client + Express/Prisma server |
| `projectflow.air` (298 lines) | 21 files, 868 lines — 5 DB models, 18 API routes, 5 pages |

Every generated app builds and runs. Frontend apps use Vite + React + Tailwind. Full-stack apps add Express + Prisma with SQLite.

## Supported Blocks

| Block | Purpose |
|-------|---------|
| `@app:name` | Declare application |
| `@state{...}` | Reactive client state |
| `@style(...)` | Design tokens (theme, accent, radius, font) |
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

## Examples

Seven example apps ship with the package in `examples/`:

- **todo.air** — Classic todo with filters and persistence
- **expense-tracker.air** — Category tracking with budget stats
- **auth.air** — Login/register flow with protected routes
- **dashboard.air** — Admin dashboard with stats and data tables
- **landing.air** — Marketing landing page with multi-section layout
- **fullstack-todo.air** — Todo app with Express API and Prisma/SQLite
- **projectflow.air** — Full SaaS project management (5 models, 18 routes, 5 pages)

## MCP Integration

AirEngine includes an MCP server for use with Claude and other AI assistants. See [docs/MCP_SETUP.md](docs/MCP_SETUP.md) for setup instructions.

The MCP server exposes four tools: `air_validate`, `air_transpile`, `air_explain`, and `air_generate`.

## Language Reference

See [docs/SPEC.md](docs/SPEC.md) for the full AIR language specification.

## Development

```bash
git clone https://github.com/hkprodduturi/AirEngine.git
cd AirEngine
npm install
npm run build
npm test          # 272 tests
```

## License

MIT
