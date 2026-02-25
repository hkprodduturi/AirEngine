# AirEngine Base Template Matrix

20 structurally distinct base templates for the 100-template library (Phase 1).

## Canonical Family Legend

| Dimension | Values |
|-----------|--------|
| **nav** | `sidebar` · `top-tabs` · `top-bar` · `bottom-tabs` · `toolbar` · `dropdown-header` · `step-indicator` · `search-bar` · `date-controls` · `none` |
| **surface** | `data-table` · `card-grid` · `stat-dashboard` · `chart-grid` · `column-layout` · `list-pane` · `content-canvas` · `centered-form` · `tile-wall` · `date-grid` · `card-feed` · `split-panels` · `mixed-sections` · `tab-panels` · `action-primary` · `progress-rows` |
| **flow** | `list-detail` · `tab-switch` · `filter-driven` · `sequential` · `board-centric` · `search-browse` · `browse-checkout` · `select-edit` · `calendar-drill` · `section-browse` · `action-confirm` · `three-pane-drill` · `single-screen` · `split-view` |
| **interact** | `crud-forms` · `monitor-ack` · `filter-drill` · `compose-react` · `move-organize` · `navigate-consume` · `step-submit` · `transact-checkout` · `select-act` · `scan-confirm` · `switch-edit` · `toolbar-edit` |
| **mobile** | `collapse-nav` · `stack-vertical` · `screen-drill` · `simplify-view` · `native-mobile` · `scroll-horizontal` |

## Template Matrix

| # | template_id | App Type | nav | surface | flow | interact | mobile | Risk | P3? |
|---|-------------|----------|-----|---------|------|----------|--------|------|-----|
| 01 | `command-center` | Real-time ops dashboard | top-tabs | stat-dashboard | tab-switch | monitor-ack | stack-vertical | low | |
| 02 | `crud-admin` | Data management panel | sidebar | data-table | list-detail | crud-forms | collapse-nav | low | |
| 03 | `kanban` | Visual task management | dropdown-header | column-layout | board-centric | move-organize | stack-vertical | medium | ✅ |
| 04 | `inbox` | Email / message client | sidebar | list-pane | three-pane-drill | select-act | screen-drill | high | ✅ |
| 05 | `scheduler` | Calendar / booking | date-controls | date-grid | calendar-drill | step-submit | simplify-view | high | ✅ |
| 06 | `gantt` | Project timeline | top-tabs | progress-rows | split-view | move-organize | simplify-view | medium | |
| 07 | `analytics` | Data viz / reporting | toolbar | chart-grid | filter-driven | filter-drill | stack-vertical | low | |
| 08 | `noc` | Network ops / status wall | none | tile-wall | single-screen | monitor-ack | stack-vertical | low | |
| 09 | `doc-editor` | Notes / wiki editor | toolbar | content-canvas | select-edit | toolbar-edit | collapse-nav | medium | |
| 10 | `marketplace` | Search-first discovery | search-bar | card-grid | search-browse | filter-drill | collapse-nav | low | |
| 11 | `wizard` | Multi-step setup flow | step-indicator | centered-form | sequential | step-submit | native-mobile | medium | |
| 12 | `pos` | Point-of-sale checkout | none | split-panels | single-screen | transact-checkout | simplify-view | medium | ✅ |
| 13 | `feed` | Social feed / forum | bottom-tabs | card-feed | tab-switch | compose-react | native-mobile | low | |
| 14 | `ai-chat` | Chat interface | sidebar | list-pane | select-edit | compose-react | collapse-nav | low | |
| 15 | `storefront` | Online store | top-bar | card-grid | browse-checkout | navigate-consume | collapse-nav | low | |
| 16 | `patient-chart` | Medical record viewer | top-tabs | tab-panels | tab-switch | switch-edit | scroll-horizontal | low | |
| 17 | `learning` | Course / lesson viewer | sidebar | content-canvas | sequential | step-submit | collapse-nav | low | |
| 18 | `ledger` | Bookkeeping / transactions | top-bar | data-table | filter-driven | crud-forms | scroll-horizontal | low | |
| 19 | `portal` | Self-service support | top-bar | mixed-sections | section-browse | navigate-consume | stack-vertical | low | |
| 20 | `warehouse` | Mobile inventory scanner | bottom-tabs | action-primary | action-confirm | scan-confirm | native-mobile | medium | ✅ |

## Layout Signatures

| # | template_id | layout_signature |
|---|-------------|-----------------|
| 01 | command-center | `nav:top-tabs\|surface:stat-dashboard\|flow:tab-switch\|interact:monitor-ack\|mobile:stack-vertical` |
| 02 | crud-admin | `nav:sidebar\|surface:data-table\|flow:list-detail\|interact:crud-forms\|mobile:collapse-nav` |
| 03 | kanban | `nav:dropdown-header\|surface:column-layout\|flow:board-centric\|interact:move-organize\|mobile:stack-vertical` |
| 04 | inbox | `nav:sidebar\|surface:list-pane\|flow:three-pane-drill\|interact:select-act\|mobile:screen-drill` |
| 05 | scheduler | `nav:date-controls\|surface:date-grid\|flow:calendar-drill\|interact:step-submit\|mobile:simplify-view` |
| 06 | gantt | `nav:top-tabs\|surface:progress-rows\|flow:split-view\|interact:move-organize\|mobile:simplify-view` |
| 07 | analytics | `nav:toolbar\|surface:chart-grid\|flow:filter-driven\|interact:filter-drill\|mobile:stack-vertical` |
| 08 | noc | `nav:none\|surface:tile-wall\|flow:single-screen\|interact:monitor-ack\|mobile:stack-vertical` |
| 09 | doc-editor | `nav:toolbar\|surface:content-canvas\|flow:select-edit\|interact:toolbar-edit\|mobile:collapse-nav` |
| 10 | marketplace | `nav:search-bar\|surface:card-grid\|flow:search-browse\|interact:filter-drill\|mobile:collapse-nav` |
| 11 | wizard | `nav:step-indicator\|surface:centered-form\|flow:sequential\|interact:step-submit\|mobile:native-mobile` |
| 12 | pos | `nav:none\|surface:split-panels\|flow:single-screen\|interact:transact-checkout\|mobile:simplify-view` |
| 13 | feed | `nav:bottom-tabs\|surface:card-feed\|flow:tab-switch\|interact:compose-react\|mobile:native-mobile` |
| 14 | ai-chat | `nav:sidebar\|surface:list-pane\|flow:select-edit\|interact:compose-react\|mobile:collapse-nav` |
| 15 | storefront | `nav:top-bar\|surface:card-grid\|flow:browse-checkout\|interact:navigate-consume\|mobile:collapse-nav` |
| 16 | patient-chart | `nav:top-tabs\|surface:tab-panels\|flow:tab-switch\|interact:switch-edit\|mobile:scroll-horizontal` |
| 17 | learning | `nav:sidebar\|surface:content-canvas\|flow:sequential\|interact:step-submit\|mobile:collapse-nav` |
| 18 | ledger | `nav:top-bar\|surface:data-table\|flow:filter-driven\|interact:crud-forms\|mobile:scroll-horizontal` |
| 19 | portal | `nav:top-bar\|surface:mixed-sections\|flow:section-browse\|interact:navigate-consume\|mobile:stack-vertical` |
| 20 | warehouse | `nav:bottom-tabs\|surface:action-primary\|flow:action-confirm\|interact:scan-confirm\|mobile:native-mobile` |

## AIR Risk Distribution

| Risk | Count | Templates |
|------|-------|-----------|
| **high** | 2 | inbox (04), scheduler (05) |
| **medium** | 6 | kanban (03), gantt (06), doc-editor (09), wizard (11), pos (12), warehouse (20) |
| **low** | 12 | command-center (01), crud-admin (02), analytics (07), noc (08), marketplace (10), feed (13), ai-chat (14), storefront (15), patient-chart (16), learning (17), ledger (18), portal (19) |

## Phase 3 Priority (First 5 Implementations)

Risk-ordered for maximum learning:

1. **scheduler** (high) — table-based calendar, date navigation
2. **inbox** (high) — three-pane simulation
3. **kanban** (medium) — column layout, move interaction
4. **pos** (medium) — split-panel simulation
5. **warehouse** (medium) — mobile-first bottom tabs, large targets
