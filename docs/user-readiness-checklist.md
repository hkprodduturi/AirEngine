# User Readiness Checklist — Showcase Examples

Minimum checks for declaring an AirEngine example "showcase-ready".

## Pipeline Health

- [ ] Loop pipeline succeeds (validate → repair → transpile → smoke → determinism)
- [ ] Output is deterministic across repeated transpilations
- [ ] No warnings in diagnostics (zero errors is mandatory)
- [ ] Repair stage is skip (clean parse) or pass (repair compensated)

## Domain Correctness

- [ ] CRUD operations match the domain (e.g. todo has add/toggle/delete)
- [ ] Auth is present where expected (dashboard, fullstack apps)
- [ ] API routes match @db models (no orphan endpoints)
- [ ] Relations and cascading deletes are correct for multi-model apps

## UI Completeness

- [ ] Forms have all necessary input fields
- [ ] Validation feedback on required fields
- [ ] Empty states for lists/tables (no blank screen on first load)
- [ ] Loading indicators for async operations
- [ ] Error states for failed API calls

## Generated Code Quality

- [ ] No runtime crashes (App.jsx renders without errors)
- [ ] All imports resolve (no missing modules)
- [ ] package.json has correct dependencies
- [ ] Security headers present in Express server (helmet, CORS, rate-limit)
- [ ] Prisma schema is valid (if @db is present)

## Showcase Fitness

- [ ] App name is clear and descriptive
- [ ] Domain is realistic and relatable
- [ ] Progressive complexity (simple → medium → complex across the set)
- [ ] .air source is readable and demonstrates AIR idioms
- [ ] Output file count and line count are reasonable for the complexity level
