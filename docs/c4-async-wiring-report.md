# C4 — Async Wiring Implementation Report

## Summary

C4 wires `sendEmail` calls from `@email` template definitions into the generated Express route handlers. All 3 G12 gap tests now pass, completing the entire complex-app gap suite at 32/32.

## Results

| Metric | Before | After |
|--------|--------|-------|
| Default CI tests | 931 pass, 4 skip | 931 pass, 4 skip |
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

### Design Decisions

- **Fire-and-forget**: `sendEmail().catch(() => {})` — email failures don't block or error the HTTP response
- **Template matching**: Convention-based (`{model}Created`, `{model}Resolved`) rather than explicit wiring — keeps `.air` grammar unchanged
- **Import scoping**: `sendEmail` is only imported in resource routers that have matching templates, avoiding unused imports

### Snapshot Updates

Golden snapshot hash updated for `helpdesk.air` (tickets route changed).

## Verification Commands

| # | Command | Exit Code | Result |
|---|---------|-----------|--------|
| 1 | `npx tsc --noEmit` | 0 | Clean |
| 2 | `npx vitest run` | 0 | 931 pass, 4 skip |
| 3 | `npm run quality-gate -- --mode offline` | 0 | PASS (3/3) |
| 4 | `npm run test:complex-baseline` | 0 | 3/3 pass |
| 5 | `npm run test:complex-gaps` | 0 | **32/32 pass** |
| 6 | `npm run stability-sweep` | 0 | 12/12 |
| 7 | `npm run release-rehearsal -- --mode offline` | 0 | GO |

## Files Changed

| File | Change |
|------|--------|
| `src/transpiler/express/api-router-gen.ts` | sendEmail import + create/update email wiring in generateResourceRouter |
| `tests/__snapshots__/golden.json` | Updated hash for helpdesk |
| `docs/c4-async-wiring-report.md` | This report |

## Roadmap Status

The complex-app gap suite is now **fully passing** (32/32). All helpdesk flagship capabilities are implemented:
- C0: Baseline audit + gap test suite
- C1: Status workflow, aggregates, detail pages, assignment
- C2: Server-side filter/sort, RBAC UI gating, form validation
- C3: Pagination controls
- C4: Email route wiring

Remaining item: A8 full live rehearsal (with `ANTHROPIC_API_KEY`) — tracked as a separate release task.
