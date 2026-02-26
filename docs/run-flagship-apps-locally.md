# Running Flagship Apps Locally

Detailed instructions for running each of the 5 flagship apps locally. All commands are copy-paste ready.

## Prerequisites

- Node.js >= 18, npm
- AirEngine repo cloned and `npm install` completed
- Two terminal sessions (one for server, one for client)

## General Pattern

All fullstack flagship apps follow the same pattern:

```bash
# 1. Transpile
npx tsx src/cli/index.ts transpile examples/<app>.air -o ./output --no-incremental

# 2. Server setup (Terminal 1)
cd output/server && npm install
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts

# 3. Client (Terminal 2)
cd output/client && npm install && npx vite --port 5173

# 4. Open http://localhost:5173
```

Between apps, clean the output directory: `rm -rf output`

---

## 1. Lumiere Photography Studio

**File:** `examples/photography-studio-premium.air` (360 lines, 6 models)
**What you see:** Public portfolio site with hero, gallery, services, testimonials, FAQ pages. Admin backoffice behind login.

```bash
rm -rf output
npx tsx src/cli/index.ts transpile examples/photography-studio-premium.air -o ./output --no-incremental
```

**Server (Terminal 1):**

```bash
cd output/server && npm install
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts
```

**Client (Terminal 2):**

```bash
cd output/client && npm install && npx vite --port 5173
```

**Expected:**
- Homepage at `http://localhost:5173` with "Lumiere" branding, dark theme, gold accent
- "View Portfolio" button navigates to gallery page
- "Book a Session" button navigates to booking page
- "Get in Touch" navigates to FAQ/contact
- Health check: `curl http://localhost:3001/api/health` returns `{"status":"ok","db":"connected"}`
- Public API: `curl http://localhost:3001/api/public/projects` returns seeded project data

**Golden validation:** `npm run photography-golden` (33 capability checks)

---

## 2. HelpDesk

**File:** `examples/helpdesk.air` (137 lines, 4 models)
**What you see:** Ticket management with status workflows, agent assignment, department filtering, analytics.

```bash
rm -rf output
npx tsx src/cli/index.ts transpile examples/helpdesk.air -o ./output --no-incremental
```

**Server (Terminal 1):**

```bash
cd output/server && npm install
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts
```

**Client (Terminal 2):**

```bash
cd output/client && npm install && npx vite --port 5173
```

**Expected:**
- Login page (auth-gated)
- Ticket list with priority badges, status workflow
- Department and agent views
- Analytics dashboard with stats
- Health check: `curl http://localhost:3001/api/health`

**Golden validation:** `npm run helpdesk-golden` (32 capability checks)

---

## 3. SalesPipe CRM

**File:** `examples/crm-sales-pipeline.air` (318 lines, 8 models)
**What you see:** Full CRM with contacts, accounts, leads, deals pipeline, tasks, activities, and dashboard analytics.

```bash
rm -rf output
npx tsx src/cli/index.ts transpile examples/crm-sales-pipeline.air -o ./output --no-incremental
```

**Server (Terminal 1):**

```bash
cd output/server && npm install
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts
```

**Client (Terminal 2):**

```bash
cd output/client && npm install && npx vite --port 5173
```

**Expected:**
- Login page (auth-gated)
- Dashboard with deal pipeline stats
- Contacts, accounts, leads, deals pages
- 424 seeded records across 8 models
- Profile management and password change

---

## 4. ProjectFlow

**File:** `examples/projectflow.air` (301 lines, 5 models)
**What you see:** Project management with all 16 block types — cron, webhooks, queues, email, deployment config.

```bash
rm -rf output
npx tsx src/cli/index.ts transpile examples/projectflow.air -o ./output --no-incremental
```

**Server (Terminal 1):**

```bash
cd output/server && npm install
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts
```

**Client (Terminal 2):**

```bash
cd output/client && npm install && npx vite --port 5173
```

**Expected:**
- Project list with status filtering
- Task management with assignments
- Team member views
- Generated `docker-compose.yml` in output root

---

## 5. E-Commerce

**File:** `examples/ecommerce.air` (131 lines, 4 models)
**What you see:** Online store with products, categories, cart, orders, checkout, and inventory tracking.

```bash
rm -rf output
npx tsx src/cli/index.ts transpile examples/ecommerce.air -o ./output --no-incremental
```

**Server (Terminal 1):**

```bash
cd output/server && npm install
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001\n' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts
```

**Client (Terminal 2):**

```bash
cd output/client && npm install && npx vite --port 5173
```

**Expected:**
- Product catalog with categories
- Cart management
- Order workflow and status tracking
- Health check: `curl http://localhost:3001/api/health`

---

## Troubleshooting

### Port already in use

```bash
# Kill process on port 3001
lsof -i :3001 -t | xargs kill

# Kill process on port 5173
lsof -i :5173 -t | xargs kill
```

### Prisma errors

```bash
# "DATABASE_URL not set"
# Make sure .env file exists in output/server/
cat output/server/.env

# "Can't reach database server"
# Re-push the schema
cd output/server && npx prisma db push
```

### Missing dependencies

```bash
# If you see "module not found" errors
cd output/server && npm install
cd output/client && npm install
```

### Stale output

```bash
# Always clean before switching apps
rm -rf output
```

### tsx not found

```bash
# Make sure project dependencies are installed
cd /path/to/AirEngine && npm install
```

See [troubleshooting-local.md](troubleshooting-local.md) for more.
