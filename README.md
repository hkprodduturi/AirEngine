# AirEngine

**The language AI thinks in when it builds software.** One `.air` file defines your entire full-stack app — frontend, backend, database, auth, and more. AirEngine transpiles it into production-ready React + Express + Prisma in milliseconds.

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

---

## What It Generates

| Input | Output |
|-------|--------|
| `todo.air` (12 lines) | 9 files, ~270 lines — Vite + React + Tailwind |
| `fullstack-todo.air` (18 lines) | ~20 files, ~600 lines — React client + Express/Prisma server |
| `projectflow.air` (302 lines) | 50 files, ~2500 lines — 5 DB models, 18 API routes, 5 pages |

Every generated app builds and runs. Frontend apps use Vite + React + Tailwind. Full-stack apps add Express + Prisma with SQLite. Generated servers include JWT auth, request validation, rate limiting, and helmet security headers.

---

## Why AirEngine?

- **10x Faster** — AI generates 300 lines of AIR in 3 seconds. Transpiler outputs 5,000+ lines in 50ms. Total: under 4 seconds from prompt to running app.
- **Zero Errors** — Schema-guaranteed output. No syntax errors, no hallucinated imports, no broken builds. Every time.
- **AI Native** — MCP server lets Claude generate, validate, and transpile AIR natively. No manual coding required.
- **Full-Stack** — One file covers UI, state, API routes, database models, auth, cron jobs, webhooks, email, and deployment.

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

## UI Elements & Modifiers

AirEngine ships with 30+ built-in UI elements that map to semantic HTML + Tailwind:

| Element | Modifiers | Output |
|---------|-----------|--------|
| `h1` | `hero`, `display` | Headings with size variants |
| `p` | `lead`, `muted`, `small`, `center` | Text with visual hierarchy |
| `btn` | `primary`, `secondary`, `ghost`, `icon`, `submit` | Styled buttons |
| `input` | `text`, `email`, `password`, `number`, `search` | Form inputs |
| `card` | — | Bordered surface container |
| `grid` | `2`, `3`, `4`, `responsive` | CSS grid layouts |
| `row` | `center` | Flex row with alignment |
| `code` | `block` | Inline code / multi-line code blocks |
| `section` | — | Auto-styled by name (`hero`, `footer`, `cta`) |
| `divider` | — | Horizontal rule |

Plus: `header`, `footer`, `main`, `sidebar`, `list`, `table`, `tabs`, `badge`, `stat`, `form`, `link`, `img`, `icon`, `nav`, `toggle`, `check`, `alert`, `spinner`, `progress`, `chart`, `search`, `pagination`, `plan`, `slot`, `logo`, `select`, `pre`.

---

## Examples

Eight example apps ship with the package in `examples/`:

- **todo.air** — Classic todo with filters and persistence
- **expense-tracker.air** — Category tracking with budget stats
- **auth.air** — Login/register flow with protected routes
- **dashboard.air** — Admin dashboard with stats and data tables
- **landing.air** — Marketing landing page with multi-section layout
- **fullstack-todo.air** — Todo app with Express API and Prisma/SQLite
- **projectflow.air** — Full SaaS project management (5 models, 18 routes, 5 pages)
- **airengine-site.air** — AirEngine marketing site with code blocks and hero layout

---

## MCP Integration

AirEngine includes an MCP server for use with Claude and other AI assistants. See [docs/MCP_SETUP.md](docs/MCP_SETUP.md) for setup instructions.

The MCP server exposes six tools: `air_validate`, `air_transpile`, `air_explain`, `air_generate`, `air_lint`, and `air_capabilities`.

---

## CLI Commands

```bash
air transpile app.air -o ./out              # Transpile (incremental by default)
air transpile app.air --target client       # Client-only output
air transpile app.air --target server       # Server-only output
air transpile app.air --target docs         # README + types only
air transpile app.air --no-incremental      # Force full rebuild
air init                                    # Interactive starter .air file
air init --name myapp --fullstack           # Non-interactive fullstack template
air dev app.air                             # Watch mode with hot reload
air dev app.air -p 3000 --server-port 3001  # Custom ports
air doctor                                  # Check environment
air doctor app.air                          # Check env + validate .air file
air validate app.air                        # Parse + validate without transpiling
```

---

## Development

```bash
git clone https://github.com/hkprodduturi/AirEngine.git
cd AirEngine
npm install
npm run build
npm test          # all tests
```

## License

MIT
