# C4 — Async Wiring Implementation Report

## Summary

C4 wires async infrastructure into generated Express apps: `sendEmail` calls from `@email` templates into route handlers (G12), cron job initialization from `@cron` blocks into server startup (G10), and queue worker readiness from `@queue` blocks into server startup (G11). All 3 G12 gap tests pass, completing the complex-app gap suite at 32/32. G10/G11 are scaffolding-only (no gap tests) with full stability sweep coverage.

## Results

| Metric | Before | After |
|--------|--------|-------|
| Default CI tests | 931 passed, 4 skipped (935 total) | 931 passed, 4 skipped (935 total) |
| Gap tests passing | 29/32 | **32/32** |
| Stability sweep | 12/12 | 12/12 |
| Quality gate (offline) | PASS | PASS |
| Release rehearsal (offline) | GO | GO |

### Gap Test Breakdown (Final)

| Group | Tests | Status |
|-------|-------|--------|
| G1: Status workflow | 4/4 | Pass (C1) |
| G2: Aggregate consumption | 2/2 | Pass (C1) |
| G3: Detail pages | 5/5 | Pass (C1) |
| G4: Server-side filter/sort | 4/4 | Pass (C2) |
| G5: RBAC UI gating | 3/3 | Pass (C2) |
| G6: Assignment workflow | 2/2 | Pass (C1) |
| G7: Form validation | 2/2 | Pass (C2) |
| G8: DataTable column config | 3/3 | Pass (pre-existing) |
| G9: Pagination controls | 4/4 | Pass (C3) |
| G12: Email route wiring | 3/3 | **Pass (C4)** |
| **Total** | **32/32** | **All passing** |

## Implementation Details

### G12: Email Route Wiring (3 tests)

**File changed:** `src/transpiler/express/api-router-gen.ts`

#### 1. Import wiring
In `generateResourceRouter()`, when `ctx.email` has templates and the resource group contains models matching template names, `import { sendEmail } from '../templates.js'` is added.

Template-to-resource matching: template names like `ticketCreated` are matched to resource models by stripping the suffix (`Created`/`Resolved`/`Updated`/`Deleted`) and comparing to model names in the resource group.

#### 2. Create handler email notification
After a POST create handler's Prisma call succeeds, if a matching `{model}Created` template exists, a fire-and-forget `sendEmail` call is injected:
```typescript
sendEmail('ticketCreated', result.email || '', { name: result.name, subject: result.subject }).catch(() => {});
```

Template params are mapped from the created record's fields.

#### 3. Update handler email notification (status-based)
After a PUT update handler's Prisma call succeeds, if a matching `{model}Resolved` template exists, a conditional `sendEmail` call is injected:
```typescript
if (status === 'resolved') {
  sendEmail('ticketResolved', result.email || '', { name: result.name, subject: result.subject }).catch(() => {});
}
```

The email is only sent when the status field is set to `'resolved'`.

### G10: Cron Activation (dev-mode scaffold)

**File changed:** `src/transpiler/express/server-entry-gen.ts`

When `ctx.cron` exists (`.air` file contains `@cron` block):

1. **Import**: `import { startCronJobs } from './cron.js'` added to generated `server.ts`
2. **Initialization**: `startCronJobs()` called inside the `app.listen()` callback, after the server starts

The existing `startCronJobs()` in `cron.ts` (from `generateCronStub`) iterates all registered jobs and logs their names and schedules. The `cron.schedule()` call remains commented — developers uncomment after installing `node-cron`. Dev-mode behavior is safe (log-only).

**Affected examples**: projectflow.air, booking.air, inventory.air, survey.air, lms.air, analytics.air

### G11: Queue Activation (dev-mode scaffold)

**File changed:** `src/transpiler/express/server-entry-gen.ts`

When `ctx.queue` exists (`.air` file contains `@queue` block):

1. **Import**: `import { queueJobs } from './queue.js'` added to generated `server.ts`
2. **Readiness log**: `console.log(`[Queue] ${Object.keys(queueJobs).length} job(s) registered — dispatch() available`)` logged on startup

The existing `queue.ts` (from `generateQueueStub`) already provides a working in-memory `dispatch()` function with retry logic and exponential backoff. Route handlers can import and use `dispatch()` directly. Dev-mode behavior is safe (in-process, no external dependencies).

**Affected examples**: projectflow.air, inventory.air

### Design Decisions

- **Fire-and-forget email**: `sendEmail().catch(() => {})` — email failures don't block or error the HTTP response
- **Template matching**: Convention-based (`{model}Created`, `{model}Resolved`) rather than explicit wiring — keeps `.air` grammar unchanged
- **Import scoping**: `sendEmail` only imported in resource routers with matching templates; `startCronJobs`/`queueJobs` only imported when respective blocks exist
- **Dev-mode safe**: Cron logs registrations without scheduling. Queue provides in-memory dispatch without external dependencies. No side effects at import time.

### Snapshot Updates

Golden snapshot hashes updated for all affected examples (helpdesk, projectflow, booking, inventory, survey, lms, analytics).

## Verification Commands

| # | Command | Exit Code | Result |
|---|---------|-----------|--------|
| 1 | `npx tsc --noEmit` | 0 | Clean |
| 2 | `npx vitest run` | 0 | 931 passed, 4 skipped (935 total) |
| 3 | `npm run quality-gate -- --mode offline` | 0 | PASS (3/3) |
| 4 | `npm run test:complex-baseline` | 0 | 3/3 pass |
| 5 | `npm run test:complex-gaps` | 0 | **32/32 pass** |
| 6 | `npm run stability-sweep` | 0 | 12/12 |
| 7 | `npm run release-rehearsal -- --mode offline` | 0 | GO |

## Files Changed

| File | Change |
|------|--------|
| `src/transpiler/express/api-router-gen.ts` | G12: sendEmail import + create/update email wiring in generateResourceRouter |
| `src/transpiler/express/server-entry-gen.ts` | G10: startCronJobs import + call after listen. G11: queueJobs import + readiness log |
| `tests/__snapshots__/golden.json` | Updated hashes for affected examples |
| `docs/c4-async-wiring-report.md` | This report |

## Roadmap Status

The complex-app gap suite is now **fully passing** (32/32). All helpdesk flagship capabilities are implemented:
- C0: Baseline audit + gap test suite
- C1: Status workflow, aggregates, detail pages, assignment
- C2: Server-side filter/sort, RBAC UI gating, form validation
- C3: Pagination controls
- C4: Email route wiring, cron activation, queue activation

Remaining item: A8 full live rehearsal (with `ANTHROPIC_API_KEY`) — tracked as a separate release task.
