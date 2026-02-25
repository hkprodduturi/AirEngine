# AirEngine Wireframe Notes — Phase 2

Grayscale wireframe notes for all 20 base templates. Desktop and mobile layouts, required states (empty/loading/error/success), and `.air` feasibility workarounds for medium/high risk templates.

Phase 3 first five (scheduler, inbox, kanban, pos, warehouse) receive expanded detail.

---

## State Contract (All Templates)

Every base must render four states. These are the `.air` patterns used across all templates:

| State | Pattern | Visual |
|-------|---------|--------|
| **empty** | `?items.length==0>card(h2>"No items yet"+p>"Get started by...")` | Centered card, muted text, CTA button |
| **loading** | `?loading>spinner` | Centered spinner element |
| **error** | `?error>alert:error>#error` | Red alert banner at top of content area |
| **success** | Normal populated render | Data-filled layout (default) |

---

## Phase 3 Priority Templates (Expanded Detail)

---

### BASE-05: Scheduler (high risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| [< Prev]    February 2026    [Next >]    [Day|Week|Month]        |
+------------------------------------------------------------------+
| Mon    | Tue    | Wed    | Thu    | Fri    | Sat    | Sun         |
+--------+--------+--------+--------+--------+--------+------------+
|        |        |  1     |  2     |  3     |  4     |  5         |
|        |        |[badge] |        |[badge] |        |            |
+--------+--------+--------+--------+--------+--------+------------+
|  6     |  7     |  8     |  9     | 10     | 11     | 12         |
|[badge] |        |[badge] |        |        |        |            |
+--------+--------+--------+--------+--------+--------+------------+
|  ...                                                              |
+------------------------------------------------------------------+
| Selected: Feb 3                                                   |
| +--------------------------------------------------------------+ |
| | Event: Team Standup  9:00 AM    [Edit] [Delete]              | |
| | Event: Sprint Review 2:00 PM   [Edit] [Delete]              | |
| +--------------------------------------------------------------+ |
| [+ New Event]                                                     |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| < Feb 2026 >            |
| [Day|Week|Month]        |
+-------------------------+
| List view (simplified)  |
| +---------+-----------+ |
| | Feb 3   | Standup   | |
| |         | 9:00 AM   | |
| +---------+-----------+ |
| | Feb 3   | Sprint    | |
| |         | 2:00 PM   | |
| +---------+-----------+ |
| | Feb 8   | Design    | |
| |         | 10:00 AM  | |
| +---------+-----------+ |
| [+ New Event]           |
+-------------------------+
```

**States**
- **empty**: Calendar grid visible but no event badges. Below grid: `card(h2>"No events"+p>"Click a date to create your first event"+btn:primary>"+ New Event")`
- **loading**: `spinner` centered over the calendar grid area
- **error**: `alert:error>"Failed to load events"` above the calendar grid
- **success**: Calendar grid with event badges on dates, event list below when date selected

**AIR Feasibility Workarounds (high risk)**

| Challenge | Workaround | `.air` pattern |
|-----------|-----------|---------------|
| 7-column grid | Use `table` with 7 header columns (Mon-Sun). Each cell is a `td` containing date number + optional event badges. `.air` tables support arbitrary column counts. | `table(thead(tr(*th("Mon","Tue",...)))+tbody(tr(*td(...))))` |
| Month navigation | Row of ghost buttons flanking a heading. State variable `currentMonth` drives which month data to render. | `row(btn:ghost>"<"+h2>#currentMonthLabel+btn:ghost>">")` with `!prevMonth` / `!nextMonth` mutations |
| Day/Week/Month toggle | Native `tabs` element. Conditional sections render different views per mode. | `tabs>viewMode.set(day,week,month)` + `?viewMode==month>@section:monthView(...)` |
| Click-to-create | Button appears in selected-date detail area below grid, not inline in cell. No click-on-cell interaction. | `?selectedDate>row(btn:primary>"+ New Event">!showCreateForm)` |
| Mobile simplification | Replace 7-column grid with a vertical event list sorted by date. Tabs still work. Date controls shrink to single row. | `list>events|month>*event(card(row(text>#e.date+text>#e.title+text>#e.time)))` |

---

### BASE-04: Inbox (high risk)

**Desktop Layout**
```
+------------+--------------------+----------------------------+
| FOLDERS    | THREAD LIST        | MESSAGE DETAIL             |
+------------+--------------------+----------------------------+
| [Inbox (5)]| * John: Re: Q4... | From: John <john@co.com>   |
| [Sent     ]| * Sarah: Design   | Date: Feb 24, 2026         |
| [Drafts   ]|   Mike: Lunch?    | Subject: Re: Q4 Planning   |
| [Archive  ]|   HR: Benefits    | __________________________ |
| [Trash    ]|                    | Hi team,                   |
|            |                    |                            |
|            |                    | Here are the Q4 numbers... |
|            |                    |                            |
|            |                    | [Reply] [Forward] [Archive]|
+------------+--------------------+----------------------------+
| [Compose]  | search: [________] |                            |
+------------+--------------------+----------------------------+
```

**Mobile Layout**
```
+-------------------------+      +-------------------------+
| Inbox (5)           [=] |      | < Back                  |
+-------------------------+      +-------------------------+
| * John: Re: Q4...      |  ->  | From: John              |
|   Feb 24                |      | Re: Q4 Planning         |
+-------------------------+      +-------------------------+
| * Sarah: Design review  |      | Hi team,                |
|   Feb 24                |      |                         |
+-------------------------+      | Here are the Q4         |
|   Mike: Lunch tomorrow? |      | numbers...              |
|   Feb 23                |      |                         |
+-------------------------+      +-------------------------+
| [Compose]               |      | [Reply] [Forward]       |
+-------------------------+      +-------------------------+
  Screen 1: Thread list           Screen 2: Message detail
```

**States**
- **empty**: Middle pane shows `card(h2>"No messages"+p>"Your inbox is empty")`. Right pane shows muted placeholder text.
- **loading**: `spinner` centered in thread list pane
- **error**: `alert:error>"Failed to load messages"` spanning thread list pane
- **success**: Three-pane layout with thread list populated, selected thread detail shown

**AIR Feasibility Workarounds (high risk)**

| Challenge | Workaround | `.air` pattern |
|-----------|-----------|---------------|
| Three-pane layout | Sidebar for folders (native). Main area uses a `row()` containing two div-like children: thread list on left, detail on right. Tailwind flexbox handles the 40/60 split. | `sidebar(list>folders>*f(...))+main(row(@section:threadList(...)+@section:detail(...)))` |
| Simultaneous panels | Both thread list and detail are always rendered. Detail content is conditional on `?activeThread`. | `@section:detail(?activeThread>card(h2>#msg.subject+p>#msg.body):card(p:"Select a thread"))` |
| Middle pane scroll | List element provides native vertical scroll for thread list. Detail pane scrolls independently. | `list>threads|folder>*thread(card(...))` — list handles overflow |
| Mobile drill-down | On mobile, hide detail pane by default. When thread selected, show detail as new "screen" (conditional render replaces list). Back button returns to list. | `?mobileDetailView>@section:detail(...):@section:threadList(...)` |
| Unread indicators | Bold text for unread uses badge or conditional styling. `.air` badge on each thread row. | `*thread(row(?thread.unread>badge:"new"+text>#thread.subject:text>#thread.subject))` |
| Folder counts | Badge element next to folder name. | `btn:ghost>#f.name+badge:#f.unreadCount` |

---

### BASE-03: Kanban Board (medium risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| [v Board: Sprint 23]   [+ New Board]            [Settings]       |
+------------------------------------------------------------------+
| To Do (3)       | In Progress (2) | Review (1)   | Done (4)     |
+-----------------+-----------------+--------------+--------------+
| +-------------+ | +-------------+ | +-----------+| +-----------+|
| | Task: Login  | | | Task: API   | | | Task: DB  || | Task: UI  ||
| | @john        | | | @sarah      | | | @mike     || | @john     ||
| | [bug] [high] | | | [feat]      | | | [feat]    || | [feat]    ||
| | [Move >]     | | | [Move >]    | | | [Move >]  || |           ||
| +-------------+ | +-------------+ | +-----------+| +-----------+|
| +-------------+ | +-------------+ |              | +-----------+|
| | Task: Signup | | | Task: Auth  | |              | | Task: Nav ||
| | @sarah       | | | @john       | |              | | @sarah    ||
| | [feat]       | | | [bug] [med] | |              | |           ||
| | [Move >]     | | | [Move >]    | |              | +-----------+|
| +-------------+ | +-------------+ |              |              |
| [+ Add Card]   | [+ Add Card]   | [+ Add Card]  |              |
+-----------------+-----------------+--------------+--------------+
```

**Mobile Layout**
```
+-------------------------+
| [v Sprint 23]           |
+-------------------------+
| [To Do|In Prog|Rev|Done]|
+-------------------------+
| To Do (3)               |
| +---------------------+ |
| | Task: Login page    | |
| | @john  [bug] [high] | |
| | [< Move] [Move >]   | |
| +---------------------+ |
| +---------------------+ |
| | Task: Signup flow   | |
| | @sarah  [feat]      | |
| | [< Move] [Move >]   | |
| +---------------------+ |
| [+ Add Card]            |
+-------------------------+
```

**States**
- **empty**: Single column visible with `card(h2>"No cards yet"+p>"Add your first card to get started"+btn:primary>"+ Add Card")`
- **loading**: `spinner` centered in board area
- **error**: `alert:error>"Failed to load board"` above columns
- **success**: Multiple columns with cards, each card showing title, assignee badge, label badges, move buttons

**AIR Feasibility Workarounds (medium risk)**

| Challenge | Workaround | `.air` pattern |
|-----------|-----------|---------------|
| Multi-column layout | `grid:4` with each grid child being a section containing a filtered card list. Columns are sections, not true swimlanes. | `grid:4(@section:todo(h3>"To Do"+list>cards|status:todo>*c(card(...)))+@section:inprog(...)+...)` |
| Drag-and-drop | Not supported. Each card has "Move >" and "< Move" ghost buttons that call a mutation to update the card's status column. | `btn:ghost>"Move >">!moveCard(#card.id, "next")` |
| Card detail/edit | `details(summary>...)` for inline expand, or conditional section that appears below the card when selected. | `details(summary>text>#card.title+card(p>#card.description+form(input:text>#card.title+btn:primary>"Save")))` |
| Mobile stacking | On mobile, columns stack vertically. Tabs at top let user switch which column is visible (only one column shown at a time). | Tabs `>activeColumn.set(todo,inprog,review,done)` + conditional `?activeColumn==todo>@section:todo(...)` |
| Board selector | Dropdown header pattern. Select element bound to `currentBoard` state. | `select>#currentBoard>boards>*b(option>#b.name)` |
| Column card count | Badge next to column header. | `h3>"To Do"+badge:#todoCards.length` |

---

### BASE-12: POS Terminal (medium risk)

**Desktop Layout**
```
+------------------------------------------+---------------------+
| PRODUCTS                                 | RECEIPT              |
| [Food] [Drinks] [Other]                 |                      |
+------------------------------------------+ Order #1042          |
| +----------+ +----------+ +----------+  +---------------------+
| | Burger   | | Fries    | | Salad    |  | Burger    x1  $8.99 |
| | $8.99    | | $3.99    | | $7.49    |  | Fries     x2  $7.98 |
| | [+ Add]  | | [+ Add]  | | [+ Add]  |  | Cola      x1  $2.49 |
| +----------+ +----------+ +----------+  |                     |
| +----------+ +----------+ +----------+  | [-] Fries x2 [+]    |
| | Cola     | | Water    | | Coffee   |  |                     |
| | $2.49    | | $1.99    | | $3.49    |  +---------------------+
| | [+ Add]  | | [+ Add]  | | [+ Add]  |  | Subtotal     $19.46 |
| +----------+ +----------+ +----------+  | Tax (8%)      $1.56 |
|                                          | TOTAL        $21.02 |
|                                          +---------------------+
|                                          | [CHECKOUT]          |
+------------------------------------------+---------------------+
```

**Mobile Layout**
```
+-------------------------+
| POS Terminal            |
| [Food|Drinks|Other]     |
+-------------------------+
| +----------+----------+ |
| | Burger   | Fries    | |
| | $8.99    | $3.99    | |
| | [+ Add]  | [+ Add]  | |
| +----------+----------+ |
| +----------+----------+ |
| | Cola     | Water    | |
| | $2.49    | $1.99    | |
| | [+ Add]  | [+ Add]  | |
| +----------+----------+ |
+-------------------------+
| Cart (3 items)  $21.02  |
| [View Cart / Checkout]  |
+-------------------------+
```

**States**
- **empty**: Receipt panel shows `card(h2>"No items"+p>"Tap a product to start an order")`. Product grid is populated.
- **loading**: `spinner` centered in product grid area
- **error**: `alert:error>"Failed to load products"` above product grid
- **success**: Product grid + receipt with running totals, checkout button enabled

**AIR Feasibility Workarounds (medium risk)**

| Challenge | Workaround | `.air` pattern |
|-----------|-----------|---------------|
| 60/40 split | Use `sidebar` for the receipt (right side, ~40% width) and `main` for products. Sidebar is semantically correct here — it's a persistent side panel. | `main(tabs>category+grid:3>products|category>*p(card(...)))+sidebar(h2>"Receipt"+list>cart>*item(...)+stat:"Total">#total+btn:primary>"Checkout")` |
| Real-time receipt updates | Cart is a state array. Adding a product pushes to cart. Mutations `!addToCart(#p.id)` and `!removeFromCart(#item.id)` modify the array. Total is derived state. | `@state(cart:[], cartTotal:0)` with mutations on add/remove |
| Quantity adjustment | Each cart line shows +/- buttons. These call mutations that modify the quantity field. | `row(btn:ghost>"-">!decrementQty(#item.id)+text>#item.qty+btn:ghost>"+">!incrementQty(#item.id))` |
| Mobile simplification | On mobile, sidebar collapses to a sticky footer bar showing item count + total + "View Cart" button. Full receipt view replaces product grid on tap. | `footer(row(text>#cart.length+" items"+stat:"Total">#total+btn:primary>"Checkout"))` |
| Category filtering | Native `tabs` above product grid. Each tab filters the product list by category. | `tabs>category.set(food,drinks,other)` + `grid:3>products|category>*p(...)` |

---

### BASE-20: Warehouse Mobile (medium risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| (Desktop renders same as mobile — single-column, centered,       |
|  max-width container. This is a mobile-first app.)               |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |                                                              | |
| |              [====== SCAN BARCODE ======]                    | |
| |                                                              | |
| +--------------------------------------------------------------+ |
| Recent Scans                                                     |
| +--------------------------------------------------------------+ |
| | SKU-4821  |  Widget Assembly Kit  |  Bin: A-14  | [Confirm] | |
| | SKU-9933  |  Bolt Pack (100ct)    |  Bin: C-02  | [Confirm] | |
| | SKU-1157  |  Safety Goggles       |  Bin: B-07  | [Confirm] | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
| [Scan]     [Pick]     [Inventory]     [Profile]                  |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
|                         |
| [=== SCAN BARCODE ===]  |
|                         |
+-------------------------+
| Recent Scans            |
| +---------------------+ |
| | SKU-4821            | |
| | Widget Assembly Kit | |
| | Bin: A-14           | |
| | [Confirm]           | |
| +---------------------+ |
| +---------------------+ |
| | SKU-9933            | |
| | Bolt Pack (100ct)   | |
| | Bin: C-02           | |
| | [Confirm]           | |
| +---------------------+ |
+-------------------------+
| [Scan] [Pick] [Inv] [Me]|
+-------------------------+
```

**States**
- **empty**: Large scan button visible. Below it: `card(h2>"No recent scans"+p>"Scan a barcode to get started")`
- **loading**: `spinner` below the scan button while processing a scan
- **error**: `alert:error>"Scan failed — item not found"` below scan button
- **success**: Scan button + recent scan cards with confirm actions + success alert after confirmation

**AIR Feasibility Workarounds (medium risk)**

| Challenge | Workaround | `.air` pattern |
|-----------|-----------|---------------|
| Large scan button | Use `btn:primary` with Tailwind's padding/text-size classes. The generated CSS from `.air` applies standard button sizing; the "large" effect comes from being the sole primary content in a centered section. | `@section:scanArea(btn:primary>"SCAN BARCODE">!scanBarcode)` — Tailwind's flex-center on section + large font |
| Bottom tab bar | `footer` with horizontal `nav` containing ghost buttons. Fixed to bottom via Tailwind `fixed bottom-0`. | `footer(nav(btn:ghost>"Scan"+btn:ghost>"Pick"+btn:ghost>"Inventory"+btn:ghost>"Profile"))` |
| Scan confirmation flow | Two-step: scan button triggers mutation that returns item info + shows confirm card. Confirm button triggers `!confirmScan`. | `?scannedItem>card(h3>#scannedItem.name+text>"Bin: "#scannedItem.bin+btn:primary>"Confirm">!confirmScan)` |
| Success feedback | `alert:success` appears after confirmation, auto-dismissed by state timeout or next action. | `?scanSuccess>alert:success>"Item confirmed and logged"` |
| Pick Orders screen | Tab-switched view. List of orders with item counts and status badges. Each order expands to show pick list. | `list>orders>*o(card(row(text>#o.id+badge:#o.itemCount+badge:#o.status)+details(summary>"Items"+list>o.items>*i(...))))` |

---

## Remaining 15 Templates

---

### BASE-01: Command Center (low risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| [Overview] [Systems] [Alerts] [Logs] [Settings]                  |
+------------------------------------------------------------------+
| +--------+ +--------+ +--------+ +--------+                     |
| | CPU    | | Memory | | Disk   | | Net    |                     |
| | 72%    | | 4.2 GB | | 340 GB | | 1.2 Gb |                     |
| +--------+ +--------+ +--------+ +--------+                     |
+------------------------------------------------------------------+
| +---------------------------+ +---------------------------+      |
| | chart:line (CPU 24h)      | | chart:bar (Requests/hr)  |      |
| |                           | |                           |      |
| +---------------------------+ +---------------------------+      |
+------------------------------------------------------------------+
| Alerts  [All|Critical|Warning|Info]                              |
| +--------------------------------------------------------------+ |
| | CRITICAL | DB connection pool exhausted    | 2m ago  | [Ack] | |
| | WARNING  | High memory on worker-3        | 15m ago | [Ack] | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [Overview|Alerts|Logs]  |
+-------------------------+
| CPU: 72%   Mem: 4.2 GB  |
| Disk: 340  Net: 1.2 Gb  |
+-------------------------+
| [chart:line CPU 24h]    |
+-------------------------+
| Alerts                  |
| CRITICAL | DB conn pool |
| 2m ago        [Ack]     |
+-------------------------+
| WARNING | High memory   |
| 15m ago       [Ack]     |
+-------------------------+
```

**States**
- **empty**: Stats show "--", charts show "No data yet", alert table empty with `card(p>"No active alerts")`
- **loading**: `spinner` centered in stat grid area
- **error**: `alert:error>"Failed to connect to monitoring service"` above stats
- **success**: Stats populated, charts rendered, alert table filled

---

### BASE-02: CRUD Admin (low risk)

**Desktop Layout**
```
+----------+-------------------------------------------------------+
| SIDEBAR  | Dashboard                                    [+ New]  |
+----------+-------------------------------------------------------+
| Dashboard| search: [________________]  [Filter v]                |
| Entities | +----------------------------------------------------+|
| Settings | | Name       | Status   | Created    | Actions       ||
|          | |------------|----------|------------|---------------||
|          | | Widget A   | Active   | 2026-02-01 | [Edit] [Del]  ||
|          | | Widget B   | Draft    | 2026-02-10 | [Edit] [Del]  ||
|          | | Widget C   | Active   | 2026-02-15 | [Edit] [Del]  ||
|          | +----------------------------------------------------+|
|          | [< 1 2 3 >]                                           |
+----------+-------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [=] CRUD Admin          |
+-------------------------+
| search: [____________]  |
+-------------------------+
| Widget A       Active   |
| 2026-02-01   [Edit|Del] |
+-------------------------+
| Widget B       Draft    |
| 2026-02-10   [Edit|Del] |
+-------------------------+
| [< 1 2 3 >]            |
+-------------------------+
```

**States**
- **empty**: Table area shows `card(h2>"No entities yet"+p>"Create your first entity"+btn:primary>"+ Create")`
- **loading**: `spinner` centered in table area
- **error**: `alert:error>"Failed to load entities"` above table
- **success**: Populated table with pagination

---

### BASE-06: Gantt Planner (medium risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| [Timeline] [Tasks] [Milestones] [Team]                           |
+------------------------------------------------------------------+
| TASK LIST (left)         | TIMELINE (right)                      |
+--------------------------+---------------------------------------+
| > Phase 1: Planning      | [====progress=40%====]                |
|   - Research             | [==prog=25%===]                       |
|   - Requirements         | [=========prog=60%========]           |
| > Phase 2: Development   | [====progress=20%====]                |
|   - Backend API          | [==prog=10%===]                       |
|   - Frontend UI          | [===prog=30%====]                     |
+--------------------------+---------------------------------------+
| Milestones: [Alpha: Mar 1] [Beta: Apr 15] [Launch: Jun 1]       |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [Timeline|Tasks|Miles]  |
+-------------------------+
| Phase 1: Planning       |
| [====== 40% =========]  |
|  Research         25%   |
|  Requirements     60%   |
+-------------------------+
| Phase 2: Development    |
| [====== 20% =========]  |
|  Backend API      10%   |
|  Frontend UI      30%   |
+-------------------------+
```

**States**
- **empty**: `card(h2>"No tasks yet"+p>"Create your first task to build a timeline"+btn:primary>"+ Add Task")`
- **loading**: `spinner` centered in timeline area
- **error**: `alert:error>"Failed to load project timeline"` above split view
- **success**: Split view with task list and progress bars

**AIR Workarounds (medium risk)**
- **Dependency arrows**: Unsupported. Documented as limitation. Tasks list dependencies as text badges.
- **Expand/collapse groups**: `details(summary>...)` for task groups — flat expand, not tree hierarchy.
- **Split view**: `sidebar(list>tasks)` + `main(list>*task(row(text+progress:bar)))` — sidebar holds task names, main holds bars.

---

### BASE-07: Analytics Studio (low risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| [Date: Feb 1 - Feb 24]  [Report: Traffic v]  [Export]            |
+------------------------------------------------------------------+
| +--------+ +--------+ +--------+ +--------+                     |
| | Total  | | Avg    | | Peak   | | Growth |                     |
| | 14,230 | | 508/d  | | 1,241  | | +12.3% |                     |
| +--------+ +--------+ +--------+ +--------+                     |
+------------------------------------------------------------------+
| +---------------------------+ +---------------------------+      |
| | chart:line (Daily visits) | | chart:bar (Top pages)     |      |
| |                           | |                           |      |
| +---------------------------+ +---------------------------+      |
| +---------------------------+ +---------------------------+      |
| | chart:bar (Traffic src)   | | chart:line (Bounce rate)  |      |
| |                           | |                           |      |
| +---------------------------+ +---------------------------+      |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [Date] [Report v]       |
+-------------------------+
| Total: 14,230  Avg: 508 |
| Peak: 1,241   +12.3%    |
+-------------------------+
| [chart:line Daily]      |
+-------------------------+
| [chart:bar Pages]       |
+-------------------------+
| [chart:bar Sources]     |
+-------------------------+
```

**States**
- **empty**: Charts show "No data for selected period". Stats show "--".
- **loading**: `spinner` in chart grid area
- **error**: `alert:error>"Failed to load analytics data"`
- **success**: Stats row + 2x2 chart grid populated

---

### BASE-08: Monitoring NOC (low risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
|                        STATUS WALL                                |
+------------------------------------------------------------------+
| +-----------+ +-----------+ +-----------+ +-----------+          |
| | web-01    | | web-02    | | db-main   | | db-replica|          |
| | [HEALTHY] | | [HEALTHY] | | [DEGRADED]| | [HEALTHY] |          |
| | CPU: 42%  | | CPU: 38%  | | CPU: 89%  | | CPU: 55%  |          |
| | Mem: 2.1G | | Mem: 1.8G | | Mem: 7.2G | | Mem: 3.1G |          |
| +-----------+ +-----------+ +-----------+ +-----------+          |
| +-----------+ +-----------+ +-----------+ +-----------+          |
| | cache-01  | | queue-01  | | worker-01 | | worker-02 |          |
| | [HEALTHY] | | [HEALTHY] | | [DOWN]    | | [HEALTHY] |          |
| | CPU: 15%  | | CPU: 22%  | | CPU: 0%   | | CPU: 67%  |          |
| +-----------+ +-----------+ +-----------+ +-----------+          |
+------------------------------------------------------------------+
| Alert Feed                                                       |
| CRITICAL | worker-01 unreachable              | 5m ago            |
| WARNING  | db-main CPU above 85% threshold    | 12m ago           |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| STATUS WALL             |
+-------------------------+
| web-01       [HEALTHY]  |
| CPU: 42%     Mem: 2.1G  |
+-------------------------+
| db-main      [DEGRADED] |
| CPU: 89%     Mem: 7.2G  |
+-------------------------+
| worker-01    [DOWN]     |
| CPU: 0%                 |
+-------------------------+
| Alerts                  |
| CRIT | worker-01 down   |
+-------------------------+
```

**States**
- **empty**: Tile grid shows placeholder tiles with "No servers configured"
- **loading**: `spinner` centered in wall area
- **error**: `alert:error>"Lost connection to monitoring service"` full-width
- **success**: Color-coded tiles + alert feed

---

### BASE-09: Document Editor (medium risk)

**Desktop Layout**
```
+----------+-------------------------------------------------------+
| DOCS     | [B] [I] [H1] [H2] [Code] [Preview]       [Save]     |
+----------+-------------------------------------------------------+
| > My Docs| # Document Title                                      |
|   Notes  |                                                       |
|   Ideas  | ## Section One                                        |
|   Draft  |                                                       |
|          | Lorem ipsum dolor sit amet, consectetur                |
| [+ New]  | adipiscing elit. Sed do eiusmod tempor...              |
|          |                                                       |
|          | ```                                                    |
|          | const x = 42;                                         |
|          | ```                                                    |
|          |                                                       |
|          | ## Section Two                                        |
|          |                                                       |
+----------+-------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [=] [B][I][H1] [Save]  |
+-------------------------+
| # Document Title        |
|                         |
| ## Section One          |
|                         |
| Lorem ipsum dolor sit   |
| amet, consectetur...    |
|                         |
| ```                     |
| const x = 42;           |
| ```                     |
+-------------------------+
```

**States**
- **empty**: Canvas area shows `card(h2>"No document selected"+p>"Choose a document from the sidebar or create a new one"+btn:primary>"+ New Document")`
- **loading**: `spinner` centered in canvas
- **error**: `alert:error>"Failed to save document"`
- **success**: Toolbar active, content rendered, document list in sidebar

**AIR Workarounds (medium risk)**
- **Rich text editing**: Unsupported (no `contenteditable`). Fallback: display rendered content in view mode, switch to form inputs in edit mode via `?editMode>form(...)`.
- **Format toolbar**: Row of ghost buttons at top. Each button triggers a mutation (e.g., `!toggleBold`) that modifies state. Not WYSIWYG — more like a markdown editor.
- **Preview toggle**: Conditional render — `?previewMode>@section:preview(...)` vs `?!previewMode>@section:editor(...)`.

---

### BASE-10: Marketplace Search (low risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
|              [======================== Search ==============]     |
+------------------------------------------------------------------+
| FILTERS        | Results for "widget" (142)          [Sort: v]   |
+----------------+-------------------------------------------------+
| Category       | +----------+ +----------+ +----------+         |
| [ ] Electronics| | Widget A | | Widget B | | Widget C |         |
| [ ] Home       | | $29.99   | | $14.99   | | $49.99   |         |
| [ ] Office     | | ****     | | ***      | | *****    |         |
|                | +----------+ +----------+ +----------+         |
| Price Range    | +----------+ +----------+ +----------+         |
| [$10] - [$100] | | Widget D | | Widget E | | Widget F |         |
|                | | $9.99    | | $34.99   | | $22.99   |         |
| Rating         | | **       | | ****     | | ***      |         |
| [3+] stars     | +----------+ +----------+ +----------+         |
+----------------+-------------------------------------------------+
| [< 1 2 3 4 5 >]                                                  |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [Search ____________]   |
| [Filters v] [Sort v]   |
+-------------------------+
| +---------------------+ |
| | Widget A            | |
| | $29.99  ****        | |
| +---------------------+ |
| +---------------------+ |
| | Widget B            | |
| | $14.99  ***         | |
| +---------------------+ |
| [< 1 2 3 >]            |
+-------------------------+
```

**States**
- **empty**: `card(h2>"No results"+p>"Try adjusting your filters or search terms")`
- **loading**: `spinner` in grid area
- **error**: `alert:error>"Search failed — please try again"`
- **success**: Card grid with pagination, active filter sidebar

---

### BASE-11: Onboarding Wizard (medium risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
|              [1]---[2]---[3]---[4]                               |
|              Acct  Prof  Pref  Review                            |
+------------------------------------------------------------------+
| [=============== 50% ================                    ]       |
+------------------------------------------------------------------+
|                                                                   |
|                    Step 2: Profile                                |
|                                                                   |
|              Full Name:  [________________]                      |
|              Company:    [________________]                      |
|              Role:       [Developer    v]                        |
|              Avatar:     [Upload]                                |
|                                                                   |
|              [<- Back]              [Next ->]                    |
|                                                                   |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| Step 2 of 4             |
| [======= 50% ========] |
+-------------------------+
| Profile                 |
|                         |
| Full Name:              |
| [__________________]    |
|                         |
| Company:                |
| [__________________]    |
|                         |
| Role:                   |
| [Developer         v]  |
|                         |
| [<- Back]  [Next ->]   |
+-------------------------+
```

**States**
- **empty**: N/A (wizard always starts at step 1 with empty form)
- **loading**: `spinner` after final submit while account is being created
- **error**: `alert:error>"Failed to save — please try again"` above form fields
- **success**: Step 4 (Review) shows summary, then confirmation page with `alert:success>"Account created!"`

**AIR Workarounds (medium risk)**
- **Step indicator**: `row(badge:"1"+text:"—"+badge:"2"+...)` to simulate stepper. Active step gets different badge style.
- **Conditional steps**: `?currentStep==2>@section:step2(form(...))` — only one step rendered at a time.

---

### BASE-13: Community Feed (low risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
|                    Community Feed                                  |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| | What's on your mind?  [________________________________]     | |
| | [Post]                                                       | |
| +--------------------------------------------------------------+ |
| +--------------------------------------------------------------+ |
| | @sarah · 2h ago                                              | |
| | Just shipped the new dashboard! Check it out.                | |
| | [heart 12] [comment 3] [share]                               | |
| +--------------------------------------------------------------+ |
| +--------------------------------------------------------------+ |
| | @john · 5h ago                                               | |
| | Anyone else excited about the new API changes?               | |
| | [heart 8] [comment 7] [share]                                | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
| [Feed]     [Trending]     [Profile]     [Notifs (3)]             |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [Post something...]     |
+-------------------------+
| @sarah · 2h             |
| Just shipped the new    |
| dashboard!              |
| [heart 12] [comment 3]  |
+-------------------------+
| @john · 5h              |
| Anyone else excited     |
| about the new API?      |
| [heart 8] [comment 7]   |
+-------------------------+
| [Feed][Trend][Me][Notif]|
+-------------------------+
```

**States**
- **empty**: `card(h2>"No posts yet"+p>"Be the first to share something!"+btn:primary>"Create Post")`
- **loading**: `spinner` in feed area
- **error**: `alert:error>"Failed to load feed"`
- **success**: Vertical card list with compose box at top, bottom tabs

---

### BASE-14: AI Workspace (low risk)

**Desktop Layout**
```
+----------+-------------------------------------------------------+
| CHATS    | AI Workspace                                          |
+----------+-------------------------------------------------------+
| [+ New]  |                                                       |
|          | [user]     What is recursion?                          |
| > Q&A    |                                                       |
|   Debug  | [assistant] Recursion is a programming concept        |
|   Ideas  |             where a function calls itself...           |
|          |                                                       |
|          | [user]     Can you give an example?                    |
|          |                                                       |
|          | [assistant] Sure! Here's a factorial function:         |
|          |             ```                                       |
|          |             function factorial(n) { ... }              |
|          |             ```                                       |
+----------+-------------------------------------------------------+
|          | [Type a message...___________________]  [Send]         |
+----------+-------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [=] AI Workspace        |
+-------------------------+
| [user] What is          |
|        recursion?       |
+-------------------------+
| [asst] Recursion is a   |
|        programming...   |
+-------------------------+
| [user] Example?         |
+-------------------------+
| [asst] Sure! ...        |
+-------------------------+
| [Type message...] [Send]|
+-------------------------+
```

**States**
- **empty**: `card(h2>"Start a conversation"+p>"Type a message below to begin")`
- **loading**: `spinner` inline after last user message (assistant typing indicator)
- **error**: `alert:error>"Failed to send message — check connection"`
- **success**: Message stream with role badges, pinned input footer

---

### BASE-15: Ecommerce Storefront (low risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| Logo  [All] [Electronics] [Clothing] [Home]        [Cart (3)]   |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |          Summer Sale — 30% Off Everything                    | |
| |                    [Shop Now]                                 | |
| +--------------------------------------------------------------+ |
| +----------+ +----------+ +----------+ +----------+             |
| | Headphone| | Sneakers | | Backpack | | Watch    |             |
| | $79.99   | | $129.99  | | $49.99   | | $199.99  |             |
| | [Add]    | | [Add]    | | [Add]    | | [Add]    |             |
| +----------+ +----------+ +----------+ +----------+             |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| Logo        [Cart (3)]  |
| [All|Elec|Cloth|Home]   |
+-------------------------+
| Summer Sale - 30% Off   |
| [Shop Now]              |
+-------------------------+
| +----------+----------+ |
| | Headphone| Sneakers | |
| | $79.99   | $129.99  | |
| | [Add]    | [Add]    | |
| +----------+----------+ |
+-------------------------+
```

**States**
- **empty**: Product grid shows `card(h2>"No products found"+p>"Check back soon!")`
- **loading**: `spinner` in product grid area
- **error**: `alert:error>"Failed to load products"`
- **success**: Hero banner + product grid + category nav active

---

### BASE-16: Patient Chart (low risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| Patient: Jane Doe  DOB: 1985-03-12  MRN: #PT-4821               |
+------------------------------------------------------------------+
| [Vitals] [History] [Medications] [Notes] [Labs]                  |
+------------------------------------------------------------------+
|                         Vitals                                    |
| +--------+ +--------+ +--------+ +--------+                     |
| | BP     | | HR     | | Temp   | | O2 Sat |                     |
| | 120/80 | | 72 bpm | | 98.6°F | | 99%    |                     |
| +--------+ +--------+ +--------+ +--------+                     |
| +--------------------------------------------------------------+ |
| | Date       | BP      | HR  | Temp  | O2   | Notes           | |
| |------------|---------|-----|-------|------|------------------| |
| | 2026-02-24 | 120/80  | 72  | 98.6  | 99%  | Routine check   | |
| | 2026-02-10 | 118/78  | 68  | 98.4  | 98%  | Follow-up       | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| Jane Doe  #PT-4821      |
| DOB: 1985-03-12         |
+-------------------------+
| [Vitals|Hist|Meds|Notes]|
+-------------------------+   (horizontal scroll on tabs)
| BP: 120/80  HR: 72 bpm  |
| Temp: 98.6  O2: 99%     |
+-------------------------+
| Recent Readings          |
| 2026-02-24  120/80      |
| 2026-02-10  118/78      |
+-------------------------+
```

**States**
- **empty**: `card(h2>"No patient selected"+p>"Search for a patient to view their chart")`
- **loading**: `spinner` in active tab panel
- **error**: `alert:error>"Failed to load patient data"`
- **success**: Patient header + active tab panel with data

---

### BASE-17: Learning Platform (low risk)

**Desktop Layout**
```
+----------+-------------------------------------------------------+
| LESSONS  | Lesson 3: Variables                                   |
+----------+-------------------------------------------------------+
| [=== 40% ===========================                    ]       |
+----------+-------------------------------------------------------+
| [x] 1.Intro| # Variables in JavaScript                          |
| [x] 2.Types|                                                     |
| [>] 3.Vars | Variables are containers for storing data values.   |
| [ ] 4.Funcs| You declare them with `let`, `const`, or `var`.     |
| [ ] 5.Loops|                                                     |
| [ ] 6.Quiz | ```javascript                                       |
|            | let name = "Alice";                                  |
|            | const age = 30;                                      |
|            | ```                                                   |
|            |                                                      |
|            | [Mark Complete]                [Next ->]             |
+----------+-------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [=] Lesson 3: Variables |
| [======== 40% ========] |
+-------------------------+
| # Variables in JS       |
|                         |
| Variables are           |
| containers for storing  |
| data values...          |
|                         |
| ```                     |
| let name = "Alice";     |
| ```                     |
|                         |
| [Mark Complete] [Next>] |
+-------------------------+
```

**States**
- **empty**: Course list page shows `card(h2>"No courses available"+p>"Check back soon for new content")`
- **loading**: `spinner` in content canvas
- **error**: `alert:error>"Failed to load lesson content"`
- **success**: Sidebar with progress checkmarks, content canvas with text, mark-complete + next buttons

---

### BASE-18: Finance Ledger (low risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| Finance Ledger   [Accounts v]   [Reconcile]   [Reports]          |
+------------------------------------------------------------------+
| [All] [Assets] [Liabilities] [Revenue] [Expenses]                |
| Date: [2026-02-01] to [2026-02-24]                               |
+------------------------------------------------------------------+
| Date       | Description          | Debit    | Credit   | Balance|
|------------|----------------------|----------|----------|--------|
| 2026-02-01 | Opening Balance      |          |          | $5,000 |
| 2026-02-03 | Office Supplies      | $142.50  |          | $4,857 |
| 2026-02-05 | Client Payment       |          | $3,200   | $8,057 |
| 2026-02-10 | Rent                 | $1,500   |          | $6,557 |
| [________] | [__________________] | [$_____] | [$_____] | [Add]  |
+------------------------------------------------------------------+
| Total Debits: $1,642.50  |  Total Credits: $3,200  |  Bal: $6,557|
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+   (horizontal scroll on table)
| Finance Ledger          |
| [All|Assets|Liab|Rev]   |
+-------------------------+
| Feb 3  Office Supplies  |
|   Debit: $142.50        |
+-------------------------+
| Feb 5  Client Payment   |
|   Credit: $3,200        |
+-------------------------+
| Feb 10  Rent            |
|   Debit: $1,500         |
+-------------------------+
| Bal: $6,557.50          |
+-------------------------+
```

**States**
- **empty**: Table shows `card(h2>"No transactions"+p>"Add your first transaction using the form below")`
- **loading**: `spinner` in table area
- **error**: `alert:error>"Failed to load transactions"`
- **success**: Full-width table with running balance, summary footer, inline add form

---

### BASE-19: Customer Portal (low risk)

**Desktop Layout**
```
+------------------------------------------------------------------+
| Logo  [Home] [Support] [Docs] [Account]                         |
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| |         Welcome to Support                                   | |
| |         [Search documentation...___________________]         | |
| +--------------------------------------------------------------+ |
| +------------------+ +------------------+ +------------------+   |
| | Quick Start      | | API Docs         | | FAQ              |   |
| | Get up and       | | Reference for    | | Common questions |   |
| | running fast     | | all endpoints    | | answered         |   |
| +------------------+ +------------------+ +------------------+   |
+------------------------------------------------------------------+
| Frequently Asked Questions                                       |
| [v] How do I reset my password?                                  |
|     Go to Settings > Security > Reset Password...                |
| [>] How do I upgrade my plan?                                    |
| [>] What are the API rate limits?                                |
+------------------------------------------------------------------+
| [Submit a Ticket]                                                |
+------------------------------------------------------------------+
```

**Mobile Layout**
```
+-------------------------+
| [=] Support Portal      |
+-------------------------+
| Welcome to Support      |
| [Search...___________]  |
+-------------------------+
| [Quick Start]           |
| [API Docs]              |
| [FAQ]                   |
+-------------------------+
| FAQ                     |
| [v] Reset password?     |
|   Go to Settings >...   |
| [>] Upgrade plan?       |
+-------------------------+
| [Submit a Ticket]       |
+-------------------------+
```

**States**
- **empty**: N/A (portal always has static content). Knowledge base search shows "No results" when query returns nothing.
- **loading**: `spinner` in search results area
- **error**: `alert:error>"Failed to load support articles"`
- **success**: Hero + card grid + FAQ accordion + ticket form

---

## Cross-Template Patterns

### Mobile Adaptation Strategies

| mobile_family | Strategy | Templates |
|---------------|----------|-----------|
| `collapse-nav` | Sidebar collapses to hamburger menu icon. Navigation slides in on tap. | crud-admin, doc-editor, marketplace, ai-chat, storefront, learning |
| `stack-vertical` | Multi-column layouts stack to single column. Grid items flow vertically. | command-center, kanban, analytics, noc |
| `simplify-view` | Complex views simplify: calendar → list, split-panel → single panel with toggle, gantt → stacked progress bars. | scheduler, gantt, pos |
| `native-mobile` | Already single-column. Large touch targets. No adaptation needed beyond minor spacing. | wizard, feed, warehouse |
| `scroll-horizontal` | Wide tables/tab bars become horizontally scrollable. Content stays tabular. | patient-chart, ledger |
| `screen-drill` | Multi-pane views become sequential screens. User drills into detail, back button returns to list. | inbox |

### Shared Empty State Patterns

All templates use the same empty state structure:
```
?items.length==0>card(
  h2>"No {entity} yet"
  p>"Get started by {action description}"
  btn:primary>"{CTA text}"
)
```

### Shared Loading Pattern

All templates:
```
?loading>spinner
```
Spinner is centered in the primary content area (not full-page overlay).

### Shared Error Pattern

All templates:
```
?error>alert:error>#errorMessage
```
Error alert appears at the top of the content area, above the primary surface. Dismissible via state reset.
