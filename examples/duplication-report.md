# AirEngine Template Library — Full Duplication Report (Phase 4)

## Summary

- **20 base templates** implemented in `.air` code
- **190 pairwise comparisons** checked
- **0 violations** — no pair shares 3+ of 5 canonical families
- **14 closest pairs** share exactly 2 families (all pass)

---

## 1. Canonical Family Check (from specs)

### Pairwise Distribution

| Shared families | Pair count | Status |
|:-:|:-:|:-:|
| 0 | 137 | Trivially distinct |
| 1 | 39 | Distinct |
| **2** | **14** | **Closest — all pass** |
| 3 | 0 | — |
| 4 | 0 | — |
| 5 | 0 | — |
| **Total** | **190** | **ALL PASS** |

### The 14 Closest Pairs (exactly 2 shared)

| Pair | Shared families | Different families (3) | Pass? |
|------|:-:|:-:|:-:|
| command-center ↔ noc | interaction:monitor-ack, mobile:stack-vertical | nav, surface, flow | PASS |
| command-center ↔ patient-chart | nav:top-tabs, flow:tab-switch | surface, interaction, mobile | PASS |
| crud-admin ↔ ai-chat | nav:sidebar, mobile:collapse-nav | surface, flow, interaction | PASS |
| crud-admin ↔ learning | nav:sidebar, mobile:collapse-nav | surface, flow, interaction | PASS |
| crud-admin ↔ ledger | surface:data-table, interaction:crud-forms | nav, flow, mobile | PASS |
| inbox ↔ ai-chat | nav:sidebar, surface:list-pane | flow, interaction, mobile | PASS |
| noc ↔ pos | nav:none, flow:single-screen | surface, interaction, mobile | PASS |
| doc-editor ↔ ai-chat | flow:select-edit, mobile:collapse-nav | nav, surface, interaction | PASS |
| doc-editor ↔ learning | surface:content-canvas, mobile:collapse-nav | nav, flow, interaction | PASS |
| marketplace ↔ storefront | surface:card-grid, mobile:collapse-nav | nav, flow, interaction | PASS |
| wizard ↔ learning | flow:sequential, interaction:step-submit | nav, surface, mobile | PASS |
| feed ↔ warehouse | nav:bottom-tabs, mobile:native-mobile | surface, flow, interaction | PASS |
| ai-chat ↔ learning | nav:sidebar, mobile:collapse-nav | surface, flow, interaction | PASS |
| storefront ↔ portal | nav:top-bar, interaction:navigate-consume | surface, flow, mobile | PASS |

### Canonical Value Reuse

| Family | Value | Used by |
|--------|-------|---------|
| nav | sidebar | crud-admin, inbox, ai-chat, learning (4) |
| nav | top-tabs | command-center, gantt, patient-chart (3) |
| nav | top-bar | storefront, ledger, portal (3) |
| nav | bottom-tabs | feed, warehouse (2) |
| nav | none | noc, pos (2) |
| nav | toolbar | analytics, doc-editor (2) |
| surface | data-table | crud-admin, ledger (2) |
| surface | list-pane | inbox, ai-chat (2) |
| surface | card-grid | marketplace, storefront (2) |
| surface | content-canvas | doc-editor, learning (2) |
| flow | tab-switch | command-center, feed, patient-chart (3) |
| flow | single-screen | noc, pos (2) |
| flow | filter-driven | analytics, ledger (2) |
| flow | sequential | wizard, learning (2) |
| flow | select-edit | doc-editor, ai-chat (2) |
| interaction | monitor-ack | command-center, noc (2) |
| interaction | step-submit | scheduler, wizard, learning (3) |
| interaction | move-organize | kanban, gantt (2) |
| interaction | crud-forms | crud-admin, ledger (2) |
| interaction | filter-drill | analytics, marketplace (2) |
| interaction | compose-react | feed, ai-chat (2) |
| interaction | navigate-consume | storefront, portal (2) |
| mobile | collapse-nav | crud-admin, doc-editor, marketplace, ai-chat, storefront, learning (6) |
| mobile | stack-vertical | command-center, kanban, analytics, noc, portal (5) |
| mobile | simplify-view | scheduler, gantt, pos (3) |
| mobile | native-mobile | wizard, feed, warehouse (3) |
| mobile | scroll-horizontal | patient-chart, ledger (2) |
| mobile | screen-drill | inbox (1) |

**13 canonical values** are unique to a single template (indicating strong diversity).

---

## 2. `.air` Structural Comparison

### Element Usage Matrix

| Template | Lines | Pages | Sections | Sidebar | Table | Grid | List | Chart | Stat | Tabs | Footer | Forms | DB Models | API Routes |
|----------|:-----:|:-----:|:--------:|:-------:|:-----:|:----:|:----:|:-----:|:----:|:----:|:------:|:-----:|:---------:|:----------:|
| command-center | 177 | 5 | 0 | 0 | 3 | 3 | 1 | 2 | 6 | 1 | 0 | 1 | 4 | 5 |
| crud-admin | 179 | 4 | 0 | 3 | 2 | 2 | 0 | 0 | 3 | 1 | 0 | 2 | 2 | 5 |
| kanban | 144 | 3 | 1 | 0 | 0 | 3 | 1 | 0 | 1 | 0 | 0 | 1 | 4 | 12 |
| inbox | 150 | 3 | 2 | 1 | 0 | 2 | 3 | 0 | 0 | 0 | 0 | 3 | 4 | 11 |
| scheduler | 141 | 3 | 2 | 0 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 2 | 2 | 6 |
| gantt | 206 | 5 | 0 | 1 | 1 | 2 | 4 | 0 | 1 | 0 | 0 | 3 | 4 | 10 |
| analytics | 140 | 3 | 0 | 0 | 1 | 2 | 0 | 4 | 4 | 1 | 0 | 1 | 4 | 6 |
| noc | 117 | 2 | 0 | 0 | 0 | 2 | 1 | 0 | 4 | 0 | 0 | 1 | 3 | 4 |
| doc-editor | 147 | 3 | 2 | 1 | 1 | 1 | 1 | 0 | 1 | 0 | 0 | 3 | 2 | 6 |
| marketplace | 144 | 3 | 1 | 0 | 0 | 3 | 0 | 0 | 1 | 1 | 0 | 1 | 3 | 8 |
| wizard | 160 | 6 | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 4 | 1 | 2 |
| pos | 148 | 3 | 1 | 1 | 1 | 2 | 1 | 0 | 1 | 1 | 0 | 1 | 4 | 6 |
| feed | 217 | 5 | 1 | 0 | 0 | 1 | 4 | 0 | 1 | 0 | 4 | 3 | 5 | 9 |
| ai-chat | 124 | 2 | 1 | 1 | 0 | 1 | 2 | 0 | 0 | 0 | 1 | 1 | 3 | 7 |
| storefront | 225 | 5 | 2 | 0 | 1 | 2 | 2 | 0 | 1 | 1 | 0 | 2 | 4 | 6 |
| patient-chart | 263 | 6 | 0 | 0 | 3 | 2 | 2 | 0 | 4 | 0 | 0 | 3 | 6 | 9 |
| learning | 163 | 3 | 2 | 1 | 0 | 2 | 2 | 0 | 1 | 0 | 0 | 2 | 5 | 8 |
| ledger | 202 | 4 | 0 | 0 | 2 | 2 | 0 | 2 | 6 | 1 | 1 | 2 | 3 | 7 |
| portal | 220 | 5 | 1 | 0 | 1 | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 4 | 6 |
| warehouse | 196 | 5 | 1 | 0 | 0 | 1 | 3 | 0 | 1 | 0 | 4 | 1 | 5 | 6 |

### Structural Uniqueness Indicators

Templates with unique element profiles (elements they use that no/few others do):

| Template | Unique structural trait |
|----------|----------------------|
| **analytics** | 4 chart elements (only chart-heavy template) |
| **wizard** | 6 pages, 0 tables/lists/sidebars, 4 forms (form-only, no data display) |
| **noc** | 2 pages only, no sidebar/table/chart (minimal, wall-only) |
| **ai-chat** | 2 pages, footer input (chat-specific pinned input) |
| **feed** / **warehouse** | 4 footer elements (bottom tab duplication per page) |
| **kanban** | 12 API routes, 0 tables (highest API density, no tabular data) |
| **inbox** | 3 lists, 2 sections, 0 stats (three-pane list-heavy) |
| **patient-chart** | 6 pages, 6 DB models, 4 stats (medical-specific multi-tab) |
| **ledger** | 6 stats, 2 charts, footer summary (financial summary emphasis) |
| **command-center** | 6 stats, 2 charts, 3 tables (mixed monitoring surface) |
| **scheduler** | 2 tables, 2 sections (calendar grid + event forms) |
| **crud-admin** | 3 sidebar duplicates (consistent sidebar across pages) |
| **storefront** | 5 pages with public/auth mix, localStorage cart |
| **portal** | Hero section + FAQ list + ticket form (mixed content types) |
| **gantt** | sidebar+main split, 4 lists, progress bars |
| **doc-editor** | 2 sections (edit vs preview mode toggle) |

---

## 3. Screenshot / Rendered Comparison Notes (Closest Pairs)

Visual comparison notes for the 14 closest pairs. Based on transpiled output structure (pages, layout elements, DOM hierarchy).

### command-center ↔ noc (shared: interaction:monitor-ack, mobile:stack-vertical)
- **Command center**: 5 pages (overview/systems/alerts/logs), stats+charts on overview, severity tabs on alerts, top-tabs navigation
- **NOC**: 2 pages only (login+wall), fullscreen tile grid, NO navigation at all
- **Visual difference**: Multi-page dashboard with charts vs. single dense status wall

### command-center ↔ patient-chart (shared: nav:top-tabs, flow:tab-switch)
- **Command center**: Dark theme, stat widgets + charts, server monitoring data, alert acknowledge flow
- **Patient chart**: Light teal theme, medical data (vitals/history/meds/notes), patient header bar persists across tab pages
- **Visual difference**: Ops dashboard with charts vs. clinical record viewer with medical-specific forms

### crud-admin ↔ ai-chat (shared: nav:sidebar, mobile:collapse-nav)
- **CRUD admin**: Sidebar with nav links, main area is data table with search/filter/CRUD, entity detail panel
- **AI chat**: Sidebar is conversation list, main area is message stream with role badges, footer input
- **Visual difference**: Table-centric entity management vs. chat stream with pinned input

### crud-admin ↔ learning (shared: nav:sidebar, mobile:collapse-nav)
- **CRUD admin**: Sidebar with static nav links, data table primary, CRUD forms, entity categories
- **Learning**: Sidebar is ordered lesson list with completion badges, main is text content + quiz, progress bar
- **Visual difference**: Data management interface vs. sequential content consumption

### crud-admin ↔ ledger (shared: surface:data-table, interaction:crud-forms)
- **CRUD admin**: Sidebar navigation, entity categories, search+filter, detail panel
- **Ledger**: Top-bar navigation, account filter tabs, date range inputs, debit/credit columns, summary footer stats
- **Visual difference**: Generic admin panel vs. financial double-entry table with monetary formatting

### inbox ↔ ai-chat (shared: nav:sidebar, surface:list-pane)
- **Inbox**: Sidebar is folder list with unread counts, main has thread list + message detail (two sections), compose page
- **AI chat**: Sidebar is conversation titles, main is single message stream with role badges, pinned footer input
- **Visual difference**: Three-pane email client vs. two-pane chat interface

### noc ↔ pos (shared: nav:none, flow:single-screen)
- **NOC**: Dark theme, status tile grid (3-column), alert feed below, stats for CPU/memory/disk, no sidebar
- **POS**: Dark theme, product grid (main) + receipt sidebar (split-panel), category tabs, checkout flow
- **Visual difference**: Monitoring wall with status tiles vs. split-screen point-of-sale terminal

### doc-editor ↔ ai-chat (shared: flow:select-edit, mobile:collapse-nav)
- **Doc editor**: Toolbar buttons (B/I/H1/Code/Save), sidebar doc list, edit/preview toggle sections
- **AI chat**: No toolbar, conversation sidebar, message stream with role badges, pinned footer input
- **Visual difference**: Format toolbar + content canvas vs. chat messages + input footer

### doc-editor ↔ learning (shared: surface:content-canvas, mobile:collapse-nav)
- **Doc editor**: Toolbar-driven interaction, edit/preview modes, document CRUD
- **Learning**: Sidebar lesson outline with checkmarks, sequential content, quiz forms, completion tracking
- **Visual difference**: Edit-focused with toolbar vs. consume-focused with progress tracking

### marketplace ↔ storefront (shared: surface:card-grid, mobile:collapse-nav)
- **Marketplace**: Hero search bar as primary nav element, faceted filters via tabs+select, save items, seller info
- **Storefront**: Top category navigation bar, hero banner section, add-to-cart flow, checkout process, order history
- **Visual difference**: Search-first discovery vs. browse-and-buy commerce flow

### wizard ↔ learning (shared: flow:sequential, interaction:step-submit)
- **Wizard**: 6 separate step pages, badge step indicator, centered single form per step, Back/Next buttons
- **Learning**: Sidebar lesson list, sidebar + main split, content canvas, quiz forms, progress bar
- **Visual difference**: Full-screen centered forms with step navigation vs. sidebar + content with progress tracking

### feed ↔ warehouse (shared: nav:bottom-tabs, mobile:native-mobile)
- **Feed**: Card feed (vertical post stream), compose box at top, like/comment reactions, notification badge
- **Warehouse**: Action-primary (large scan button), recent scan list, pick order cards, inventory search
- **Visual difference**: Social content stream vs. task-oriented action buttons

### ai-chat ↔ learning (shared: nav:sidebar, mobile:collapse-nav)
- **AI chat**: Conversation list in sidebar, message stream with role badges, single pinned input
- **Learning**: Ordered lesson list with completion checkmarks, text content canvas, quiz forms, Next/Previous nav
- **Visual difference**: Real-time chat interaction vs. sequential content progression

### storefront ↔ portal (shared: nav:top-bar, interaction:navigate-consume)
- **Storefront**: Product grid with prices, add-to-cart buttons, cart/checkout flow, order tracking
- **Portal**: Hero banner with search, feature card grid, FAQ accordion, support ticket form, knowledge base
- **Visual difference**: E-commerce purchase flow vs. self-service support with FAQ/ticket system

---

## 4. Validation Summary

### Parse/Transpile Results (all 20 templates)

| Template | Source Lines | Generated Lines | Ratio | Time (ms) | Pages Generated | Status |
|----------|:-----------:|:---------------:|:-----:|:---------:|:---------------:|:------:|
| command-center | 177 | 1903 | 10.7x | 10.5 | 5 | PASS |
| crud-admin | 179 | 1873 | 10.4x | 8.3 | 4 | PASS |
| kanban | 144 | 2036 | 14.0x | 9.4 | 3 | PASS |
| inbox | 150 | 1842 | 12.2x | 10.1 | 3 | PASS |
| scheduler | 141 | 1867 | 13.1x | 61.6 | 3 | PASS |
| gantt | 206 | 2288 | 11.1x | 9.3 | 5 | PASS |
| analytics | 140 | 1807 | 12.8x | 9.4 | 3 | PASS |
| noc | 117 | 1430 | 12.1x | 8.5 | 2 | PASS |
| doc-editor | 147 | 1822 | 12.3x | 8.4 | 3 | PASS |
| marketplace | 144 | 1777 | 12.3x | 8.4 | 3 | PASS |
| wizard | 160 | 1595 | 9.9x | 7.6 | 6 | PASS |
| pos | 148 | 1699 | 11.4x | 8.1 | 3 | PASS |
| feed | 217 | 2044 | 9.4x | 9.0 | 5 | PASS |
| ai-chat | 124 | 1573 | 12.6x | 8.7 | 2 | PASS |
| storefront | 225 | 1905 | 8.4x | 8.8 | 5 | PASS |
| patient-chart | 263 | 2167 | 8.2x | 10.4 | 6 | PASS |
| learning | 163 | 1783 | 10.9x | 8.5 | 3 | PASS |
| ledger | 202 | 2041 | 10.1x | 8.2 | 4 | PASS |
| portal | 220 | 2017 | 9.1x | 10.2 | 5 | PASS |
| warehouse | 196 | 1875 | 9.5x | 8.4 | 5 | PASS |

**Totals**: 3,523 source lines → 37,344 generated lines (10.6x avg). All 20 parse and transpile with zero errors.

### Manifest Integrity

- 20 entries in `_template_manifest.json`
- All 20 `layout_signature` values match `base-template-specs.json` exactly
- All 20 canonical family values match specs exactly

### Pairwise Duplication Status

- **190 pairs checked** (20 choose 2)
- **0 violations** (no pair shares ≥3 families)
- **14 closest pairs** share exactly 2 families — all documented above with visual comparison notes

### Test Command and Results

```
npx vitest run
```

| Metric | Value |
|--------|-------|
| Test suites passed | 7 |
| Test suites failed | 1 (transpiler.test.ts — pre-existing module load error from deleted airengine-site.air) |
| Individual tests passed | **423** |
| Individual tests failed | **0** |
| Individual tests skipped | **0** |

The failed suite is unchanged from Phase 3 — `transpiler.test.ts:1163` references `airengine-site.air` which was deleted in commit `a4c6a5e` (before Phase 3). Phase 4 did not modify any test files or parser/transpiler code.

### Diff Summary (Phase 4 changes)

| Action | Count | Files |
|--------|:-----:|-------|
| Added | 15 | `base-command-center.air`, `base-crud-admin.air`, `base-gantt.air`, `base-analytics.air`, `base-noc.air`, `base-doc-editor.air`, `base-marketplace.air`, `base-wizard.air`, `base-feed.air`, `base-ai-chat.air`, `base-storefront.air`, `base-patient-chart.air`, `base-learning.air`, `base-ledger.air`, `base-portal.air` |
| Added | 0 | `duplication-report.md` was updated (already existed from Phase 1) |
| Modified | 2 | `_template_manifest.json` (5 → 20 entries), `duplication-report.md` (Phase 1 lightweight → Phase 4 full) |
| Modified | 0 | No parser, transpiler, or test files changed |

**17 files total** (15 added, 2 modified).
