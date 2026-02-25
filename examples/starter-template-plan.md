# Phase 4.5 — Functional Starter Upgrade Plan

## Goal

Upgrade 10 of the 20 base templates into **functional starter templates** that feel 30–50% app-ready, measured by the [readiness rubric](starter-readiness-rubric.md).

Starters are built **on top of** existing base templates — same structural layout, same canonical families, but with real domain entities, working workflows, auth flows, and seed data plans.

---

## Selected Starters (10)

Selected for highest user demand, broadest use-case coverage, and `.air` feasibility.

| # | starter_id | base_id | Domain | Target Score |
|---|-----------|---------|--------|:------------:|
| 1 | saas-admin | crud-admin | SaaS administration panel | 42 |
| 2 | project-mgmt | kanban | Project / task management | 40 |
| 3 | booking-system | scheduler | Appointment booking | 36 |
| 4 | restaurant-pos | pos | Restaurant point-of-sale | 38 |
| 5 | inventory-mgmt | warehouse | Warehouse inventory | 36 |
| 6 | online-marketplace | marketplace | Two-sided marketplace | 35 |
| 7 | ecommerce-store | storefront | Online retail store | 42 |
| 8 | ai-assistant | ai-chat | AI chatbot interface | 33 |
| 9 | help-desk | inbox | Customer support ticketing | 40 |
| 10 | support-portal | portal | Self-service support KB | 35 |

### Why not the other 10?

| Base | Why skipped |
|------|------------|
| command-center | Overlaps with saas-admin (monitoring dashboard) |
| gantt | Low demand; progress bars + timeline are thin in .air |
| analytics | Overlaps with saas-admin dashboard; chart data needs real backend |
| noc | Niche (NOC ops); 2-page app has limited starter value |
| doc-editor | Rich text is unsupported in .air; starter would feel hollow |
| wizard | One-time flow; not a standalone app |
| patient-chart | Healthcare compliance makes a starter misleading |
| feed | Social feed needs real-time, infinite scroll — poor .air fit |
| learning | Course content authoring needs rich text |
| ledger | Overlaps with saas-admin; double-entry is niche |

---

## File Naming Convention

```
examples/starter-<starter_id>.air
```

Examples:
- `examples/starter-saas-admin.air`
- `examples/starter-project-mgmt.air`
- `examples/starter-booking-system.air`

This keeps domain focus (not structural base) as the identifier.

---

## Manifest Extensions

`_template_manifest.json` entries for starters add these fields:

```json
{
  "template_type": "starter",
  "starter_id": "saas-admin",
  "base_id": "crud-admin",
  "readiness_score": 42,
  "workflow_coverage": ["user-management", "org-settings", "audit-log"],
  "entities": ["User", "Organization", "Member", "Invitation", "AuditLog", "Setting"],
  "roles": ["admin", "editor", "viewer"],
  "starter_version": "1.0.0"
}
```

Existing base entries remain unchanged (their `template_type` defaults to `"base"`).

---

## Starter Details

---

### 1. saas-admin (base: crud-admin)

**Domain:** Multi-tenant SaaS administration panel
**Target users:** SaaS founders, internal tool builders
**Readiness target:** 42/100 (Starter Mid)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 9/15 | User, Organization, Member, Invitation, AuditLog, Setting — missing billing, API keys, notifications |
| Workflows | 11/25 | User invite+manage, org settings, audit log — missing billing, SSO, webhook management |
| CRUD | 8/15 | Full CRUD for users, members; partial for settings; no bulk operations |
| Auth/roles | 7/10 | Login+register, admin/editor/viewer, route guards, role badge — no MFA, SSO |
| Search/filter | 4/10 | User search, role filter, dashboard stats — no advanced reporting, export |
| Seed data | 5/10 | Sample org, 5 users, some audit logs, settings — not production-like |
| States | 5/5 | Preserved from base |
| Settings | 4/5 | Profile + org settings + admin panel |
| Feasibility | 4/5 | All native .air |

**Core workflows:**
1. **User management:** Invite user → user registers → admin assigns role → admin can deactivate
2. **Organization settings:** Admin views org details → edits name/description → saves
3. **Audit trail:** Admin views audit log filtered by date/action → sees who did what

**Included features:**
- User CRUD with role assignment (admin/editor/viewer)
- Organization profile + settings
- Member invitations (create invitation → pending state)
- Audit log with action/user/timestamp
- Dashboard with user count, member count, recent activity stats
- Search users by name/email, filter by role/status

**Out-of-scope:**
- Billing / subscription management
- SSO / OAuth / MFA
- API key management
- Webhook configuration
- Email notifications (sending)
- Multi-tenancy data isolation
- Permission matrices / fine-grained ACL

**Pages reused from base:** login, dashboard (upgraded), entities (→ users), settings (upgraded)
**Pages added:** members, invitations, audit-log

**`.air` feasibility:** All features native. Sidebar nav, data tables, CRUD forms, stat cards, role-based `@auth` — no workarounds needed.

---

### 2. project-mgmt (base: kanban)

**Domain:** Team project and task management
**Target users:** Small teams, freelancers, agencies
**Readiness target:** 40/100 (Starter Mid)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 8/15 | User, Project, Board, Column, Card, Label, Comment — missing sprints, time tracking, attachments |
| Workflows | 10/25 | Create project → board → cards → move → comment — missing sprints, assignments, due dates |
| CRUD | 8/15 | Full CRUD for cards/columns/boards; comments create-only |
| Auth/roles | 6/10 | Login+register, owner/member/viewer per project |
| Search/filter | 4/10 | Card search, label/priority filter — no cross-project search |
| Seed data | 5/10 | Sample project, 3 columns, 6–8 cards with labels |
| States | 5/5 | Preserved |
| Settings | 3/5 | Profile, project settings |
| Feasibility | 4/5 | Move buttons workaround (no drag-drop), all else native |

**Core workflows:**
1. **Board workflow:** Create board → add columns (To Do, In Progress, Done) → add cards → move cards between columns
2. **Card detail:** Click card → see description, labels, assignee, comments → add comment
3. **Project management:** Create project → select board → manage team members

**Included features:**
- Project CRUD with member list
- Board CRUD with ordered columns
- Card CRUD with title, description, label, priority, assignee
- Button-based card movement between columns
- Comments on cards
- Card search + label/priority filter
- Project dashboard with card count stats

**Out-of-scope:**
- Drag-and-drop card movement
- Sprint planning / story points
- Time tracking / timers
- File attachments
- Due dates with calendar integration
- Gantt view / timeline
- Board templates

**Pages reused from base:** login, boardList (upgraded), board (upgraded)
**Pages added:** cardDetail, projectSettings

**`.air` feasibility:** Column grid and card lists are native. Drag-drop replaced with move buttons (documented workaround from Phase 1). Card detail uses conditional section `?selectedCard>card(...)`.

---

### 3. booking-system (base: scheduler)

**Domain:** Service appointment booking system
**Target users:** Salons, clinics, consultants, tutors
**Readiness target:** 36/100 (Starter Low)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 7/15 | User, Service, Provider, Appointment, TimeSlot, Client — missing payments, reminders, waitlist |
| Workflows | 9/25 | Book appointment (select service → provider → slot), view schedule — missing reschedule, cancellation policy |
| CRUD | 7/15 | CRUD for services, providers, appointments; slots read-only |
| Auth/roles | 6/10 | Login, admin/provider/client roles, route guards |
| Search/filter | 3/10 | Date-based appointment filter, provider filter — no availability search |
| Seed data | 4/10 | Sample services, 2 providers, some appointments |
| States | 5/5 | Preserved |
| Settings | 3/5 | Profile, basic admin settings |
| Feasibility | 3/5 | Calendar grid via table workaround; time slots via list |

**Core workflows:**
1. **Booking flow:** Client selects service → selects provider → picks date → picks time slot → confirms booking
2. **Provider schedule:** Provider views their appointments for a day/week → sees client details
3. **Service management:** Admin creates/edits services with duration and price

**Included features:**
- Service catalog (name, duration, price, category)
- Provider profiles with specialties
- Appointment booking with date/time selection
- Calendar view (table-based) with appointment indicators
- Client list with appointment history
- Admin: manage services, providers, view all appointments

**Out-of-scope:**
- Payment processing
- Email/SMS reminders
- Recurring appointments
- Waitlist / cancellation management
- Online/video appointments
- Calendar sync (Google, iCal)
- Buffer times between appointments

**Pages reused from base:** login, calendar (upgraded), myEvents (→ appointments)
**Pages added:** services, providers, bookingFlow

**`.air` feasibility:** Calendar grid uses table workaround (from Phase 3). Time slot selection uses list with button selection. Service/provider CRUD is native.

---

### 4. restaurant-pos (base: pos)

**Domain:** Restaurant point-of-sale terminal
**Target users:** Restaurant owners, café operators
**Readiness target:** 38/100 (Starter Low–Mid)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 8/15 | User, Category, MenuItem, Modifier, Order, OrderItem, Table — missing reservations, inventory, suppliers |
| Workflows | 10/25 | Open order → add items → checkout; table management — missing kitchen display, split bills, refunds |
| CRUD | 7/15 | Menu CRUD, order create+complete; no modifier CRUD, no bulk ops |
| Auth/roles | 6/10 | Login, cashier/manager; manager-only menu editing |
| Search/filter | 3/10 | Category tabs, order history date filter — no sales reporting |
| Seed data | 5/10 | 10+ menu items across categories, sample orders, 4–6 tables |
| States | 5/5 | Preserved |
| Settings | 3/5 | Profile, basic restaurant settings |
| Feasibility | 4/5 | Split-panel (sidebar receipt) is documented workaround |

**Core workflows:**
1. **Order flow:** Cashier taps category → taps menu item → item appears on receipt → adjusts quantity → taps checkout → order completed
2. **Table service:** Assign order to table → table status updates → close table
3. **Menu management:** Manager adds/edits menu items with category, price, modifiers

**Included features:**
- Menu items with categories, prices, availability toggle
- Category tab filtering on terminal screen
- Split-panel: product grid (left) + live receipt (right)
- Quantity adjustment (+/−) per line item
- Running subtotal, tax, grand total
- Checkout → order moves to history
- Table list with status (available/occupied/reserved)
- Order history with date filter
- Manager-only menu editing

**Out-of-scope:**
- Kitchen display system (KDS)
- Split bills / separate checks
- Tips / gratuity
- Payment gateway integration
- Receipt printing
- Inventory tracking / ingredient management
- Reservations
- Modifier customization (extra cheese, no onions)

**Pages reused from base:** login, terminal (upgraded), history (upgraded)
**Pages added:** menuManagement, tables

**`.air` feasibility:** Split-panel via `main()+sidebar()` (Phase 3 workaround). Category tabs, product grid, receipt list, quantity buttons all native.

---

### 5. inventory-mgmt (base: warehouse)

**Domain:** Warehouse inventory management
**Target users:** Small warehouses, retail stockrooms, e-commerce fulfillment
**Readiness target:** 36/100 (Starter Low)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 7/15 | User, Product, Category, BinLocation, StockMovement, PickOrder, PickItem — missing suppliers, purchase orders, lot tracking |
| Workflows | 9/25 | Scan → confirm, create pick order → fulfill — missing receiving, returns, cycle counts |
| CRUD | 7/15 | Product CRUD, scan log, pick order status updates |
| Auth/roles | 6/10 | Login, picker/supervisor/admin roles with route guards |
| Search/filter | 4/10 | SKU/name search, category filter, low-stock alerts |
| Seed data | 5/10 | 10+ products in bins, sample pick orders, stock movements |
| States | 5/5 | Preserved |
| Settings | 3/5 | Profile, basic warehouse settings |
| Feasibility | 3/5 | Scan button workaround (no camera access); bottom tabs per page |

**Core workflows:**
1. **Scan flow:** Picker taps "Scan" → enters/selects SKU → sees product details + bin location → confirms scan → stock movement logged
2. **Pick order:** Supervisor creates pick order → assigns to picker → picker picks items → marks complete
3. **Inventory check:** User searches by SKU/name → sees bin location, quantity, movement history

**Included features:**
- Product catalog with SKU, name, bin location, quantity, category, min stock
- Barcode scan flow (button-triggered, SKU input)
- Stock movement logging (scan, pick, restock, adjust)
- Pick order management with item checklist
- Inventory search by SKU/name with category filter
- Low-stock alerts (quantity < min_stock)
- Movement history per product

**Out-of-scope:**
- Barcode camera scanning (hardware integration)
- Multi-warehouse support
- Purchase order / supplier management
- Lot / batch tracking
- Expiry date management
- Shipping label generation
- Cycle count scheduling
- Receiving workflow

**Pages reused from base:** login, scan (upgraded), pick (upgraded), inventorySearch (upgraded), profile
**Pages added:** productDetail, stockMovements

**`.air` feasibility:** Bottom-tabs via footer nav per page (Phase 3 pattern). Scan button with confirm flow is native. Product CRUD is native. No camera access (documented limitation).

---

### 6. online-marketplace (base: marketplace)

**Domain:** Two-sided online marketplace
**Target users:** Marketplace founders, community commerce
**Readiness target:** 35/100 (Starter Low)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 7/15 | User, Listing, Category, Review, SavedItem, SellerProfile, Message — missing payments, disputes, shipping |
| Workflows | 8/25 | Create listing → browse/search → save → review — missing checkout, payment, delivery tracking |
| CRUD | 7/15 | Listing CRUD, review create, save/unsave — no messaging CRUD |
| Auth/roles | 5/10 | Login+register, buyer/seller distinction — no admin moderation |
| Search/filter | 5/10 | Hero search, category tabs, sort, price display — no price range filter |
| Seed data | 5/10 | 10+ listings across categories, sample reviews, seller profiles |
| States | 5/5 | Preserved |
| Settings | 3/5 | Profile with seller view |
| Feasibility | 4/5 | All native; search-bar hero, card grid |

**Core workflows:**
1. **Listing creation:** Seller creates listing → adds title, description, price, category → listing appears in search
2. **Discovery:** Buyer searches → filters by category → sorts by price/date → views listing detail
3. **Engagement:** Buyer saves listing → leaves review → views saved items

**Included features:**
- Listing CRUD with title, description, price, category, images (URL)
- Hero search bar with live filtering
- Category tabs + sort dropdown
- Seller profiles with listing count and rating
- Reviews with star rating and text
- Save/unsave listings
- Listing detail view
- My Listings (seller view)

**Out-of-scope:**
- Payment processing / escrow
- In-app messaging between buyer/seller
- Shipping / delivery tracking
- Dispute resolution
- Featured / promoted listings
- Admin moderation panel
- Seller verification / KYC
- Price negotiation / offers

**Pages reused from base:** login, explore (upgraded), saved (upgraded)
**Pages added:** createListing, listingDetail, sellerProfile, myListings

**`.air` feasibility:** Search bar, card grid, category tabs, reviews (list+form) all native. No payment integration needed at starter level.

---

### 7. ecommerce-store (base: storefront)

**Domain:** Online retail store with full purchase flow
**Target users:** Small business owners, D2C brands
**Readiness target:** 42/100 (Starter Mid)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 9/15 | User, Product, Category, Cart, CartItem, Order, OrderItem, Address, Review — missing coupons, wishlists, variants |
| Workflows | 11/25 | Browse → cart → checkout → order tracking; admin product management — missing returns, refunds, inventory sync |
| CRUD | 8/15 | Product CRUD (admin), cart operations, order creation — no variant CRUD |
| Auth/roles | 6/10 | Login+register, customer/admin; public browse, auth-gated checkout |
| Search/filter | 5/10 | Product search, category filter, sort, price display, order status filter |
| Seed data | 6/10 | 12+ products, 3+ categories, sample orders with items |
| States | 5/5 | Preserved |
| Settings | 3/5 | Profile + address management |
| Feasibility | 4/5 | localStorage cart, public routes — all native |

**Core workflows:**
1. **Shopping flow:** Browse products → filter by category → add to cart → adjust quantities → proceed to checkout → enter shipping info → place order
2. **Order tracking:** Customer views order list → sees status (pending/shipped/delivered)
3. **Admin management:** Admin adds/edits products → manages categories → views all orders → updates order status

**Included features:**
- Product catalog with name, description, price, category, stock status
- Category navigation (top bar tabs)
- Hero banner on shop page
- Cart management (add, remove, quantity +/−)
- Cart persistence (localStorage)
- Checkout form (name, address, city)
- Order creation with line items
- Order history with status badges
- Admin product CRUD
- Admin order status management
- Product search + category filter

**Out-of-scope:**
- Payment gateway (Stripe, PayPal)
- Shipping calculation / rates
- Product variants (size, color)
- Inventory sync / stock management
- Coupons / discount codes
- Wishlists / favorites
- Product reviews on shop page
- Tax calculation
- Multi-currency

**Pages reused from base:** login, shop (upgraded), cart (upgraded), checkout (upgraded), orders (upgraded)
**Pages added:** adminProducts, adminOrders, productDetail

**`.air` feasibility:** Public routes via `@auth(optional)`, cart via `@persist:localStorage(cart)`. Product grid, cart list, checkout form all native. Hero section with `@section:hero(...)`.

---

### 8. ai-assistant (base: ai-chat)

**Domain:** AI chatbot / assistant interface
**Target users:** AI product builders, chatbot startups
**Readiness target:** 33/100 (Starter Low)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 6/15 | User, Conversation, Message, SystemPrompt, PromptPreset — missing plugins, tools, files, embeddings |
| Workflows | 7/25 | Start chat → send message → view response; manage conversations — missing streaming, tool use, RAG |
| CRUD | 6/15 | Conversation CRUD, message create; prompt preset CRUD |
| Auth/roles | 5/10 | Login+register, user/admin; admin manages presets |
| Search/filter | 3/10 | Conversation search by title — no message search |
| Seed data | 4/10 | 3 sample conversations with messages, 2–3 presets |
| States | 5/5 | Preserved |
| Settings | 3/5 | Profile, model/preset selection |
| Feasibility | 4/5 | All native; no actual AI backend needed at starter level |

**Core workflows:**
1. **Chat flow:** User creates new conversation → types message → message appears with "user" role badge → "assistant" response placeholder → conversation saved
2. **Conversation management:** User views conversation list → selects conversation → messages load → can delete conversation
3. **Preset management:** Admin creates system prompt presets → user selects preset when starting new chat

**Included features:**
- Conversation sidebar with title and timestamp
- Message stream with role badges (user/assistant/system)
- Pinned input footer with send button
- New conversation creation
- Conversation deletion
- System prompt presets (selectable templates)
- Typing indicator placeholder
- Message timestamps
- Conversation title auto-generation

**Out-of-scope:**
- Actual AI/LLM integration (API calls)
- Streaming responses
- Tool use / function calling
- File uploads / image analysis
- Code execution / sandboxing
- RAG / knowledge base integration
- Model selection (GPT-4, Claude, etc.)
- Usage tracking / token counting
- Plugins / extensions

**Pages reused from base:** login, chat (upgraded)
**Pages added:** presets, settings

**`.air` feasibility:** Sidebar conversation list, message stream, pinned footer — all native. Typing indicator via `?isTyping>text:"muted">"..."`. No actual AI integration (documented as out-of-scope; starter provides the UI shell).

---

### 9. help-desk (base: inbox)

**Domain:** Customer support ticketing system
**Target users:** Support teams, SaaS companies, agencies
**Readiness target:** 40/100 (Starter Mid)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 8/15 | User, Ticket, Message, Label, Priority, CannedResponse, Customer, Agent — missing SLA, satisfaction, knowledge base |
| Workflows | 10/25 | Customer submits ticket → agent responds → resolves; label/prioritize — missing auto-assign, SLA, escalation |
| CRUD | 8/15 | Ticket CRUD, message create, label management, canned responses |
| Auth/roles | 7/10 | Login+register, customer/agent/admin; agent sees queue, customer sees own tickets |
| Search/filter | 4/10 | Ticket search, status/priority filter, agent filter — no reporting |
| Seed data | 5/10 | 8+ tickets in various states, canned responses, sample customers |
| States | 5/5 | Preserved |
| Settings | 3/5 | Profile, canned response management |
| Feasibility | 4/5 | Three-pane workaround from Phase 3; labels as badges |

**Core workflows:**
1. **Ticket lifecycle:** Customer submits ticket (subject + description) → appears in agent queue → agent opens ticket → reads messages → sends reply → marks resolved/closed
2. **Triage:** Agent views queue → filters by status/priority → assigns label → changes priority
3. **Canned responses:** Admin creates canned responses → agent selects canned response → inserts into reply

**Included features:**
- Ticket queue (three-pane: labels sidebar, ticket list, ticket detail)
- Ticket status workflow: open → in_progress → resolved → closed
- Priority levels: low, medium, high, urgent
- Labels / categories for ticket classification
- Message thread per ticket
- Canned responses (create, select, insert)
- Customer profile with ticket history
- Agent assignment
- Ticket search + status/priority filter
- Unread ticket indicators

**Out-of-scope:**
- SLA timers / escalation rules
- Auto-assignment / round-robin
- Customer satisfaction surveys (CSAT)
- Knowledge base integration
- Email integration (receive tickets via email)
- Collision detection (two agents on same ticket)
- Merge / link tickets
- Reporting / analytics dashboard

**Pages reused from base:** login, mail (→ queue, upgraded), compose (→ submitTicket)
**Pages added:** ticketDetail (enhanced message thread), cannedResponses, customerProfile

**`.air` feasibility:** Three-pane via sidebar+main sections (Phase 3 workaround). Ticket list, message thread, canned responses — all native. Labels as badge elements.

---

### 10. support-portal (base: portal)

**Domain:** Self-service customer support portal
**Target users:** SaaS companies, product teams
**Readiness target:** 35/100 (Starter Low)

**Readiness breakdown:**
| Criterion | Score | Notes |
|-----------|:-----:|-------|
| Domain model | 7/15 | User, Article, Category, Ticket, FAQ, Feedback, Tag — missing community forums, live chat, videos |
| Workflows | 8/25 | Search KB → read article → submit ticket; author publishes articles — missing article versioning, analytics |
| CRUD | 7/15 | Article CRUD (author), ticket create (customer), FAQ management |
| Auth/roles | 5/10 | Login+register, customer/author/admin; public KB, auth-gated tickets |
| Search/filter | 5/10 | Article search, category filter, FAQ display — no search analytics |
| Seed data | 5/10 | 8+ articles in categories, 5+ FAQs, sample tickets |
| States | 5/5 | Preserved |
| Settings | 3/5 | Profile, basic admin |
| Feasibility | 4/5 | Hero, FAQ cards, article list — all native |

**Core workflows:**
1. **Self-service:** Customer searches knowledge base → reads article → problem solved (or) → submits ticket
2. **Article management:** Author creates article (title, summary, content, category) → publishes → appears in KB
3. **Ticket submission:** Customer fills out ticket form → sees ticket status in "My Tickets"

**Included features:**
- Knowledge base with articles (title, summary, content, category)
- Article search with live filtering
- Category-based article browsing
- FAQ section with question/answer pairs
- Hero banner with search
- Feature card grid (quick links to sections)
- Ticket submission form
- Ticket status tracking (My Tickets)
- Article CRUD for authors
- Feedback on articles (helpful/not helpful)

**Out-of-scope:**
- Community forums / discussions
- Live chat / chatbot widget
- Article versioning / drafts
- Search analytics (popular queries)
- Video tutorials / embeds
- Multilingual content
- Article comments
- Related articles / suggestions
- Analytics dashboard (views, searches, deflection rate)

**Pages reused from base:** login, home (upgraded), knowledgeBase (upgraded), support (upgraded), account
**Pages added:** articleDetail, articleEditor, faqManager

**`.air` feasibility:** Hero section, card grid, article list, FAQ cards, ticket form — all native. Public KB via `@auth(optional)`. Accordion-style FAQ using card list (no `details/summary` needed since answers shown inline).

---

## Implementation Preview

### Proposed file structure

```
examples/
  starter-saas-admin.air
  starter-project-mgmt.air
  starter-booking-system.air
  starter-restaurant-pos.air
  starter-inventory-mgmt.air
  starter-online-marketplace.air
  starter-ecommerce-store.air
  starter-ai-assistant.air
  starter-help-desk.air
  starter-support-portal.air
  starter-specs.json            ← machine-readable specs
  starter-template-plan.md      ← this file
  starter-readiness-rubric.md   ← scoring rubric
```

### Manifest extension schema

Each starter entry in `_template_manifest.json`:

```json
{
  "template_type": "starter",
  "starter_id": "saas-admin",
  "base_id": "crud-admin",
  "air_file": "starter-saas-admin.air",
  "layout_signature": "nav:sidebar|surface:data-table|flow:list-detail|interact:crud-forms|mobile:collapse-nav",
  "canonical": { ... },
  "screens": ["login", "dashboard", "users", "members", "invitations", "auditLog", "settings"],
  "readiness_score": 42,
  "workflow_coverage": ["user-management", "org-settings", "audit-log"],
  "entities": ["User", "Organization", "Member", "Invitation", "AuditLog", "Setting"],
  "roles": ["admin", "editor", "viewer"],
  "air_risk_level": "low",
  "starter_version": "1.0.0",
  "version": "1.0.0"
}
```

### Implementation order (by readiness score, descending)

| Priority | Starter | Score | Rationale |
|:--------:|---------|:-----:|-----------|
| 1 | ecommerce-store | 42 | Highest demand, fully native |
| 2 | saas-admin | 42 | Universal need, fully native |
| 3 | help-desk | 40 | High demand, three-pane proven |
| 4 | project-mgmt | 40 | Popular category, move buttons proven |
| 5 | restaurant-pos | 38 | Strong niche, split-panel proven |
| 6 | booking-system | 36 | Service industry demand |
| 7 | inventory-mgmt | 36 | Logistics demand |
| 8 | online-marketplace | 35 | Two-sided platform demand |
| 9 | support-portal | 35 | SaaS standard |
| 10 | ai-assistant | 33 | Growing demand, UI shell value |

---

## Validation Appendix

**Phase 4 test command:**
```
npx vitest run
```

**Phase 4 test results:** 7 suites passed, 1 suite failed (pre-existing transpiler.test.ts module load error from deleted airengine-site.air), 423 individual tests passed, 0 failed, 0 skipped. Phase 4 did not modify any parser, transpiler, or test files.
