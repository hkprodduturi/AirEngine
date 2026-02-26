# CRM Sales Pipeline — Flagship App Runbook

## Overview

**App**: SalesPipe CRM — A real-world CRM with leads, contacts, accounts, deals, tasks, and activity timeline.
**Source**: `examples/crm-sales-pipeline.air` (319 lines)
**Output**: `demo-output/crm-sales-pipeline/` (42 files, ~4450 lines)
**Stack**: React + Tailwind (client) / Express + Prisma + SQLite (server)

---

## Quick Start

### 1. Transpile

```bash
npx tsx src/cli/index.ts transpile examples/crm-sales-pipeline.air -o demo-output/crm-sales-pipeline
```

### 2. Server Setup

```bash
cd demo-output/crm-sales-pipeline/server
npm install
echo 'DATABASE_URL="file:./dev.db"' > .env
echo 'JWT_SECRET="dev-secret-change-me"' >> .env
echo 'SMTP_HOST="localhost"' >> .env
echo 'PORT=3010' >> .env

# Generate Prisma client and push schema
npx prisma generate
npx prisma db push
```

### 3. Seed Data

```bash
# Copy seed script into server directory (needs Prisma client)
cp ../../scripts/generate-crm-seed.ts .
npx tsx generate-crm-seed.ts
```

424 records: 6 users, 25 accounts, 60 contacts, 40 leads, 35 opportunities, 50 tasks, 80 activities, 128 tags.

### 4. Start Server

```bash
PORT=3010 npx tsx server.ts
# Server: http://localhost:3010
# Cron jobs: staleLeads (9am), taskReminders (8am)
# Queue: sendEmail, importLeads
```

### 5. Client Setup

```bash
cd ../client
npm install
echo 'VITE_API_BASE_URL=http://localhost:3010/api' > .env
npx vite --port 5190
# Client: http://localhost:5190
```

---

## Login Credentials

| Email | Password | Role |
|-------|----------|------|
| sarah@salespipe.com | admin123 | admin |
| mike@salespipe.com | manager1 | sales_manager |
| lisa@salespipe.com | rep123 | sales_rep |
| james@salespipe.com | rep123 | sales_rep |
| ana@salespipe.com | rep123 | sales_rep |
| tom@salespipe.com | rep123 | sales_rep |

---

## Pages

| Page | Route | Key Features |
|------|-------|-------------|
| Login | `/login` | Auth form, JWT tokens |
| Dashboard | `/dashboard` | 6 stat cards, deal pipeline table, recent activity |
| Leads | `/leads` | CRUD, status tabs (new/contacted/qualified/unqualified), search, qualify/convert/assign actions |
| Contacts | `/contacts` | CRUD, search, company resolution via account relation |
| Accounts | `/accounts` | CRUD, status tabs (active/inactive/prospect), revenue display |
| Deals | `/deals` | CRUD, stage tabs (7 stages), advance/won/lost actions, probability display |
| Tasks | `/tasks` | CRUD, status tabs, complete/assign actions, related entity display |
| Activities | `/activities` | Card-based timeline, type badges (call/email/meeting/note), log activity form |

---

## API Endpoints (28)

- `POST /auth/login` / `POST /auth/register`
- `GET /users` / `PUT /users/:id`
- `GET /accounts` / `POST /accounts` / `PUT /accounts/:id` / `DELETE /accounts/:id`
- `GET /contacts` / `POST /contacts` / `PUT /contacts/:id` / `DELETE /contacts/:id`
- `GET /leads` / `POST /leads` / `PUT /leads/:id` / `DELETE /leads/:id`
- `GET /opportunities` / `POST /opportunities` / `PUT /opportunities/:id` / `DELETE /opportunities/:id`
- `GET /opportunities/:id/activities` / `POST /opportunities/:id/activities`
- `GET /tasks` / `POST /tasks` / `PUT /tasks/:id` / `DELETE /tasks/:id`
- `GET /activities` / `POST /activities`
- `GET /stats`

All list endpoints support pagination (`?page=N&limit=N`), sorting (`?sort=field:asc`), search (`?search=term`), and filter params.

---

## Messy Seed Data

The seed data is intentionally messy to test real-world resilience:

- **Mixed casing**: "RACHEL Kim", "bob Anderson", "IronClad Sec"
- **Inconsistent phones**: "(555) 123-4567", "555.123.4567", "+1-555-123-4567"
- **Missing optional fields**: ~20% of leads have no email, some tasks have no description
- **Extra whitespace**: "  Sarah Chen " (leading/trailing spaces)
- **Overdue tasks**: Tasks with past due dates still marked as pending
- **Duplicate tags**: Same entity tagged multiple times with different capitalizations
- **Empty notes**: Some leads have `""` or `"   "` as notes

---

## Verification

```bash
# From repo root:
npx tsc --noEmit                          # TypeScript check
npx vitest run                            # 943 passed, 4 skipped
npm run quality-gate -- --mode offline    # PASS (3/3)
npm run helpdesk-golden                   # 32/32 PASS
npm run eval-complex                      # 5/5 PASS
```
