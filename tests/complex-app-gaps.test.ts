/**
 * Complex App Gap Tests (C0)
 *
 * Targeted tests for each gap identified in the capability audit.
 * These are acceptance criteria for phases C1–C4.
 *
 * NOT included in the default `npx vitest run` CI path.
 * Run explicitly via: npm run test:complex-gaps
 *
 * Each test verifies a specific missing capability against helpdesk.air output.
 * As C1–C4 phases land, these tests flip from failing to passing.
 *
 * Current status: 32 failing (expected — capabilities not yet implemented)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';

// ---- Helpers ----

function transpileFile(name: string) {
  const source = readFileSync(`examples/${name}.air`, 'utf-8');
  const ast = parse(source);
  return transpile(ast, { sourceLines: source.split('\n').length });
}

function getFile(name: string, filePath: string): string | undefined {
  const result = transpileFile(name);
  return result.files.find(f => f.path === filePath)?.content;
}

function getAllClientJsx(name: string): string {
  const result = transpileFile(name);
  const jsxFiles = result.files.filter(f =>
    f.path.startsWith('client/src/') && f.path.endsWith('.jsx')
  );
  return jsxFiles.map(f => f.content).join('\n');
}

// ---- G1: Status Workflow Mutations ----

describe('G1: Status workflow mutations', () => {
  it('TicketsPage has status transition controls (not just generic edit)', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    // Should have a status transition mechanism (select/dropdown for status change)
    // Not just a generic edit form — a dedicated status change UI per ticket row
    const hasStatusTransition =
      page.includes('handleStatusChange') ||
      page.includes('statusTransition') ||
      page.includes('updateStatus') ||
      // Or a select element specifically for transitioning status
      (page.includes('<select') && page.includes('status'));

    expect(hasStatusTransition, 'TicketsPage should have dedicated status transition UI').toBe(true);
  });

  it('server validates allowed status transitions', () => {
    const routes = getFile('helpdesk', 'server/routes/tickets.ts')!;

    // PUT /tickets/:id should validate that the status transition is allowed
    // e.g., can't go from "closed" directly to "in_progress"
    const hasTransitionValidation =
      routes.includes('allowedTransitions') ||
      routes.includes('validTransition') ||
      routes.includes('transition');

    expect(hasTransitionValidation, 'Server should validate allowed status transitions').toBe(true);
  });

  it('assign mutation sends agent_id to API', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    // !assign should call api.updateTicket with agent_id
    // Not just a generic update — should set the agent_id field
    const hasAssignWithAgentId =
      page.includes('agent_id') &&
      page.includes('assign');

    expect(hasAssignWithAgentId, 'assign mutation should send agent_id to api.updateTicket').toBe(true);
  });

  it('resolve mutation sends status:resolved to API', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    // !resolve should call api.updateTicket with { status: 'resolved' }
    // Not just having 'resolved' as a tab filter label
    const hasResolveFunction =
      page.includes('resolve') &&
      page.includes("status: 'resolved'") || page.includes('status: "resolved"');

    expect(hasResolveFunction, 'resolve mutation should send { status: "resolved" } to api').toBe(true);
  });
});

// ---- G2: Aggregate Consumption ----

describe('G2: Aggregate consumption', () => {
  it('stats endpoint computes avgResponseTime', () => {
    const api = getFile('helpdesk', 'server/api.ts')!;

    // GET /stats should compute average response time, not just counts
    const hasAvgResponseTime =
      api.includes('avgResponseTime') ||
      api.includes('_avg') ||
      api.includes('avg_response');

    expect(hasAvgResponseTime, 'Stats endpoint should compute avgResponseTime').toBe(true);
  });

  it('DashboardPage renders stat values with proper formatting', () => {
    const page = getFile('helpdesk', 'client/src/pages/DashboardPage.jsx')!;

    // Stats should render with proper number formatting (not raw object access)
    // avgResponseTime should have a unit (e.g., "2.5h" or "2h 30m")
    const hasFormatting =
      page.includes('toFixed') ||
      page.includes('formatDuration') ||
      page.includes('formatTime');

    expect(hasFormatting, 'Dashboard stats should have proper number formatting').toBe(true);
  });
});

// ---- G3: Detail Pages ----

describe('G3: Detail pages', () => {
  it('generates a TicketDetailPage component', () => {
    const result = transpileFile('helpdesk');
    const detailPage = result.files.find(f =>
      f.path.includes('TicketDetail') || f.path.includes('ticket-detail')
    );

    expect(detailPage, 'Should generate a TicketDetailPage or TicketDetail component').toBeDefined();
  });

  it('App.jsx has a route for /tickets/:id', () => {
    const app = getFile('helpdesk', 'client/src/App.jsx')!;

    const hasDetailRoute =
      app.includes('ticketDetail') ||
      app.includes('TicketDetail') ||
      app.includes('selectedTicket') ||
      app.includes('ticketId');

    expect(hasDetailRoute, 'App.jsx should have a route or state for ticket detail view').toBe(true);
  });

  it('detail page fetches single ticket by ID', () => {
    const allJsx = getAllClientJsx('helpdesk');

    // Should have a single-resource fetch: GET /tickets/:id
    const hasSingleFetch =
      allJsx.includes('getTicket(') || // singular fetch
      allJsx.includes('api.getTicket(') ||
      allJsx.includes('fetchTicket(');

    expect(hasSingleFetch, 'Detail page should fetch a single ticket by ID').toBe(true);
  });

  it('detail page displays reply thread', () => {
    const allJsx = getAllClientJsx('helpdesk');

    // Should render ticket replies
    const hasReplies =
      allJsx.includes('replies') &&
      (allJsx.includes('getTicketReplies') || allJsx.includes('api.getTicketReplies'));

    expect(hasReplies, 'Detail page should display ticket reply thread').toBe(true);
  });

  it('detail page has reply form', () => {
    const allJsx = getAllClientJsx('helpdesk');

    // Should have a form to create new replies
    const hasReplyForm =
      allJsx.includes('createTicketRepl') ||
      allJsx.includes('handleReply') ||
      allJsx.includes('addReply');

    expect(hasReplyForm, 'Detail page should have a reply creation form').toBe(true);
  });
});

// ---- G4: Server-side Filter/Sort ----

describe('G4: Server-side filter/sort', () => {
  it('server accepts status filter param', () => {
    const routes = getFile('helpdesk', 'server/routes/tickets.ts')!;

    // GET /tickets should accept ?status=open and filter by it
    const hasStatusFilter =
      routes.includes('req.query.status') ||
      routes.includes("query.status");

    expect(hasStatusFilter, 'GET /tickets should accept ?status= filter param').toBe(true);
  });

  it('server accepts priority filter param', () => {
    const routes = getFile('helpdesk', 'server/routes/tickets.ts')!;

    const hasPriorityFilter =
      routes.includes('req.query.priority') ||
      routes.includes("query.priority");

    expect(hasPriorityFilter, 'GET /tickets should accept ?priority= filter param').toBe(true);
  });

  it('client passes filter state to API calls', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    // When statusFilter changes, load() should pass it as query param
    // getTickets should be called with a filter object like { status: statusFilter }
    const passesFilter =
      page.includes('getTickets({') &&
      (page.includes('status:') || page.includes('status,'));

    expect(passesFilter, 'TicketsPage should pass filter state to getTickets({ status }) call').toBe(true);
  });

  it('client wires sort controls to API calls', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    const hasSort =
      page.includes('sortField') ||
      page.includes('sortOrder') ||
      page.includes('handleSort') ||
      page.includes('sort:');

    expect(hasSort, 'TicketsPage should have sort controls wired to API').toBe(true);
  });
});

// ---- G5: RBAC UI Gating ----

describe('G5: RBAC UI gating', () => {
  it('client uses user.role for conditional rendering', () => {
    const allJsx = getAllClientJsx('helpdesk');

    // Not just having user object — must actively USE role for conditional rendering
    const hasRoleConditional =
      allJsx.includes('user.role ===') ||
      allJsx.includes("user.role === '") ||
      allJsx.includes('user?.role');

    expect(hasRoleConditional, 'Client should use user.role for conditional rendering').toBe(true);
  });

  it('admin-only sections are gated by role', () => {
    const allJsx = getAllClientJsx('helpdesk');

    // Admin-only UI (e.g., agent management) should be conditionally rendered
    const hasRoleGating =
      allJsx.includes("role === 'admin'") ||
      allJsx.includes('isAdmin') ||
      allJsx.includes("role === \"admin\"");

    expect(hasRoleGating, 'Admin-only sections should be gated by role check').toBe(true);
  });

  it('server applies role-based guards to sensitive routes', () => {
    const api = getFile('helpdesk', 'server/api.ts')!;
    const routes = getFile('helpdesk', 'server/routes/tickets.ts')!;
    const agents = getFile('helpdesk', 'server/routes/agents.ts')!;

    const allServer = api + routes + agents;
    const hasRoleGuard =
      allServer.includes('requireRole') ||
      allServer.includes('req.user.role');

    expect(hasRoleGuard, 'Server should have role-based guards on sensitive routes').toBe(true);
  });
});

// ---- G6: Nested CRUD ----

describe('G6: Nested CRUD', () => {
  it('UI renders ticket replies (nested data display)', () => {
    const allJsx = getAllClientJsx('helpdesk');

    const rendersReplies =
      allJsx.includes('replies.map') ||
      allJsx.includes('reply.body') ||
      allJsx.includes('TicketReply');

    expect(rendersReplies, 'UI should render ticket replies').toBe(true);
  });

  it('reply creation form auto-fills ticket_id FK', () => {
    const allJsx = getAllClientJsx('helpdesk');

    // When creating a reply, ticket_id should be auto-filled from parent context
    const autoFillsFK =
      allJsx.includes('ticket_id') ||
      allJsx.includes('ticketId') ||
      allJsx.includes('createTicketReplies(');

    expect(autoFillsFK, 'Reply creation should auto-fill ticket_id foreign key').toBe(true);
  });
});

// ---- G7: Form Validation ----

describe('G7: Form validation', () => {
  it('create ticket form has required attributes', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    // Subject and description are marked :required in @db
    // Generated form inputs should have required attribute
    const subjectRequired =
      page.includes('name="subject" required') ||
      page.includes("name=\"subject\" required") ||
      page.includes('required name="subject"');
    const descriptionRequired =
      page.includes('name="description" required') ||
      page.includes("name=\"description\" required") ||
      page.includes('required name="description"');

    expect(subjectRequired, 'Subject input should have required attribute').toBe(true);
    expect(descriptionRequired, 'Description input should have required attribute').toBe(true);
  });

  it('form shows inline validation errors', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    const hasInlineErrors =
      page.includes('validation') ||
      page.includes('fieldError') ||
      page.includes('is required') ||
      page.includes('error message');

    expect(hasInlineErrors, 'Form should show inline validation error messages').toBe(true);
  });
});

// ---- G8: DataTable Column Config ----

describe('G8: DataTable column config', () => {
  it('tickets table has column headers', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    // Should have a proper table with thead/th or column header labels
    const hasColumnHeaders =
      page.includes('<th') ||
      page.includes('column') ||
      page.includes('DataTable') ||
      (page.includes('Subject') && page.includes('Status') && page.includes('Priority'));

    expect(hasColumnHeaders, 'Tickets list should have labeled column headers').toBe(true);
  });

  it('columns are auto-generated from model fields', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    // Column definitions should include subject, status, priority, assignee, createdAt
    const hasSubjectCol = page.includes('Subject');
    const hasStatusCol = page.includes('Status');
    const hasPriorityCol = page.includes('Priority');
    const hasAssigneeCol = page.includes('Assignee') || page.includes('assignee');

    expect(hasSubjectCol && hasStatusCol && hasPriorityCol,
      'Table should have Subject, Status, Priority columns').toBe(true);
  });

  it('sortable column headers trigger sort API calls', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    const hasSortableHeaders =
      page.includes('handleSort') ||
      page.includes('sortBy') ||
      page.includes('onClick') && page.includes('sort');

    expect(hasSortableHeaders, 'Column headers should be sortable with onClick handlers').toBe(true);
  });
});

// ---- G9: Pagination Controls ----

describe('G9: Pagination controls', () => {
  it('TicketsPage has dedicated pagination page state (not nav page)', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    // Should have a page number state for pagination, not just currentPage (which is nav page)
    const hasPaginationState =
      page.includes('pageNum') ||
      page.includes("useState(1)") ||
      (page.includes('[page,') && page.includes('setPage'));

    expect(hasPaginationState, 'TicketsPage should have pagination page state (not nav currentPage)').toBe(true);
  });

  it('TicketsPage renders prev/next pagination buttons', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    const hasPaginationUI =
      (page.includes('Previous') || page.includes('Prev')) &&
      page.includes('Next');

    expect(hasPaginationUI, 'TicketsPage should render Previous/Next pagination buttons').toBe(true);
  });

  it('pagination buttons pass page param to API', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    const passesPageParam =
      page.includes('page:') ||
      page.includes('page,') ||
      (page.includes('getTickets') && page.includes('page'));

    expect(passesPageParam, 'Pagination should pass page param to getTickets() call').toBe(true);
  });

  it('shows total count and current page info', () => {
    const page = getFile('helpdesk', 'client/src/pages/TicketsPage.jsx')!;

    // Should show "Page X of Y" or similar pagination info
    const showsPageInfo =
      page.includes('totalPages') &&
      (page.includes('Page ') || page.includes('page '));

    expect(showsPageInfo, 'Should display page info (e.g., "Page 1 of 5")').toBe(true);
  });
});

// ---- G12: Email Route Wiring ----

describe('G12: Email route wiring', () => {
  it('ticket creation route calls sendEmail(ticketCreated)', () => {
    const routes = getFile('helpdesk', 'server/routes/tickets.ts')!;
    const api = getFile('helpdesk', 'server/api.ts')!;
    const allServer = routes + api;

    const callsSendEmail =
      allServer.includes("sendEmail('ticketCreated'") ||
      allServer.includes('sendEmail("ticketCreated"') ||
      allServer.includes("sendEmail(`ticketCreated`");

    expect(callsSendEmail, 'POST /tickets should call sendEmail(ticketCreated)').toBe(true);
  });

  it('ticket resolved route calls sendEmail(ticketResolved)', () => {
    const routes = getFile('helpdesk', 'server/routes/tickets.ts')!;
    const api = getFile('helpdesk', 'server/api.ts')!;
    const allServer = routes + api;

    const callsSendEmail =
      allServer.includes("sendEmail('ticketResolved'") ||
      allServer.includes('sendEmail("ticketResolved"') ||
      allServer.includes("sendEmail(`ticketResolved`");

    expect(callsSendEmail, 'Status change to resolved should call sendEmail(ticketResolved)').toBe(true);
  });

  it('templates.ts is imported in route handlers', () => {
    const routes = getFile('helpdesk', 'server/routes/tickets.ts')!;
    const api = getFile('helpdesk', 'server/api.ts')!;
    const allServer = routes + api;

    const importsTemplates =
      allServer.includes("from '../templates") ||
      allServer.includes("from './templates") ||
      allServer.includes('sendEmail');

    expect(importsTemplates, 'Route handlers should import sendEmail from templates').toBe(true);
  });
});
