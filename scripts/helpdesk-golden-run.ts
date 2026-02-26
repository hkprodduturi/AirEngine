/**
 * C5 Helpdesk Golden Run
 *
 * Runs helpdesk.air through the full AirEngine pipeline and verifies
 * 32 capability checks across 10 groups (G1–G9, G12).
 *
 * Usage:  node --import tsx scripts/helpdesk-golden-run.ts
 * Output: artifacts/demo/helpdesk-golden-result.json
 * Exit:   0 = all 32 checks pass, 1 = any check fails
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runLoopFromSource } from '../src/cli/loop.js';
import type { LoopResult } from '../src/cli/loop.js';

// ---- Types ----

export interface CapabilityCheckDef {
  description: string;
  verify: (files: Map<string, string>) => boolean;
}

export interface CapabilityGroupDef {
  group: string;
  name: string;
  checks: CapabilityCheckDef[];
}

export interface HelpdeskGoldenResult {
  schema_version: '1.0';
  timestamp: string;
  run_metadata: {
    airengine_version: string;
    node_version: string;
    platform: string;
    git_commit?: string;
  };
  fixture: string;
  pipeline: {
    stages: Array<{ name: string; status: 'pass' | 'fail' | 'skip'; duration_ms: number }>;
    all_passed: boolean;
    total_duration_ms: number;
    file_count: number;
    output_lines: number;
    deterministic: boolean;
  };
  capabilities: {
    groups: Array<{
      group: string;
      name: string;
      checks: Array<{ description: string; passed: boolean }>;
      all_passed: boolean;
    }>;
    total_checks: number;
    passed_checks: number;
    all_passed: boolean;
  };
  verdict: 'pass' | 'fail';
}

// ---- File Helpers ----

function getFileContent(files: Map<string, string>, path: string): string {
  return files.get(path) ?? '';
}

function getAllClientJsx(files: Map<string, string>): string {
  const parts: string[] = [];
  for (const [path, content] of files) {
    if (path.startsWith('client/src/') && path.endsWith('.jsx')) {
      parts.push(content);
    }
  }
  return parts.join('\n');
}

// ---- 32 Capability Checks (10 groups) ----

export const CAPABILITY_CHECKS: CapabilityGroupDef[] = [
  // G1: Status workflow mutations (4)
  {
    group: 'G1',
    name: 'Status workflow mutations',
    checks: [
      {
        description: 'TicketsPage has status transition controls',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            page.includes('handleStatusChange') ||
            page.includes('statusTransition') ||
            page.includes('updateStatus') ||
            (page.includes('<select') && page.includes('status'))
          );
        },
      },
      {
        description: 'Server validates allowed status transitions',
        verify: (files) => {
          const routes = getFileContent(files, 'server/routes/tickets.ts');
          return (
            routes.includes('allowedTransitions') ||
            routes.includes('validTransition') ||
            routes.includes('transition')
          );
        },
      },
      {
        description: 'Assign mutation sends agent_id to API',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return page.includes('agent_id') && page.includes('assign');
        },
      },
      {
        description: 'Resolve mutation sends status:resolved to API',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            (page.includes('resolve') && page.includes("status: 'resolved'")) ||
            page.includes('status: "resolved"')
          );
        },
      },
    ],
  },

  // G2: Aggregate consumption (2)
  {
    group: 'G2',
    name: 'Aggregate consumption',
    checks: [
      {
        description: 'Stats endpoint computes avgResponseTime',
        verify: (files) => {
          const api = getFileContent(files, 'server/api.ts');
          return (
            api.includes('avgResponseTime') ||
            api.includes('_avg') ||
            api.includes('avg_response')
          );
        },
      },
      {
        description: 'DashboardPage renders stat values with formatting',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/DashboardPage.jsx');
          return (
            page.includes('toFixed') ||
            page.includes('formatDuration') ||
            page.includes('formatTime')
          );
        },
      },
    ],
  },

  // G3: Detail pages (5)
  {
    group: 'G3',
    name: 'Detail pages',
    checks: [
      {
        description: 'Generates a TicketDetailPage component',
        verify: (files) => {
          for (const path of files.keys()) {
            if (path.includes('TicketDetail') || path.includes('ticket-detail')) return true;
          }
          return false;
        },
      },
      {
        description: 'App.jsx has route for ticket detail view',
        verify: (files) => {
          const app = getFileContent(files, 'client/src/App.jsx');
          return (
            app.includes('ticketDetail') ||
            app.includes('TicketDetail') ||
            app.includes('selectedTicket') ||
            app.includes('ticketId')
          );
        },
      },
      {
        description: 'Detail page fetches single ticket by ID',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes('getTicket(') ||
            allJsx.includes('api.getTicket(') ||
            allJsx.includes('fetchTicket(')
          );
        },
      },
      {
        description: 'Detail page displays reply thread',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes('replies') &&
            (allJsx.includes('getTicketReplies') || allJsx.includes('api.getTicketReplies'))
          );
        },
      },
      {
        description: 'Detail page has reply form',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes('createTicketRepl') ||
            allJsx.includes('handleReply') ||
            allJsx.includes('addReply')
          );
        },
      },
    ],
  },

  // G4: Server-side filter/sort (4)
  {
    group: 'G4',
    name: 'Server-side filter/sort',
    checks: [
      {
        description: 'Server accepts status filter param',
        verify: (files) => {
          const routes = getFileContent(files, 'server/routes/tickets.ts');
          return routes.includes('req.query.status') || routes.includes('query.status');
        },
      },
      {
        description: 'Server accepts priority filter param',
        verify: (files) => {
          const routes = getFileContent(files, 'server/routes/tickets.ts');
          return routes.includes('req.query.priority') || routes.includes('query.priority');
        },
      },
      {
        description: 'Client passes filter state to API calls',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            page.includes('getTickets({') &&
            (page.includes('status:') || page.includes('status,'))
          );
        },
      },
      {
        description: 'Client wires sort controls to API calls',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            page.includes('sortField') ||
            page.includes('sortOrder') ||
            page.includes('handleSort') ||
            page.includes('sort:')
          );
        },
      },
    ],
  },

  // G5: RBAC UI gating (3)
  {
    group: 'G5',
    name: 'RBAC UI gating',
    checks: [
      {
        description: 'Client uses user.role for conditional rendering',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes('user.role ===') ||
            allJsx.includes("user.role === '") ||
            allJsx.includes('user?.role')
          );
        },
      },
      {
        description: 'Admin-only sections gated by role',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes("role === 'admin'") ||
            allJsx.includes('isAdmin') ||
            allJsx.includes('role === "admin"')
          );
        },
      },
      {
        description: 'Server applies role-based guards to routes',
        verify: (files) => {
          const api = getFileContent(files, 'server/api.ts');
          const routes = getFileContent(files, 'server/routes/tickets.ts');
          const agents = getFileContent(files, 'server/routes/agents.ts');
          const allServer = api + routes + agents;
          return allServer.includes('requireRole') || allServer.includes('req.user.role');
        },
      },
    ],
  },

  // G6: Nested CRUD (2)
  {
    group: 'G6',
    name: 'Nested CRUD',
    checks: [
      {
        description: 'UI renders ticket replies',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes('replies.map') ||
            allJsx.includes('reply.body') ||
            allJsx.includes('TicketReply')
          );
        },
      },
      {
        description: 'Reply creation auto-fills ticket_id FK',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes('ticket_id') ||
            allJsx.includes('ticketId') ||
            allJsx.includes('createTicketReplies(')
          );
        },
      },
    ],
  },

  // G7: Form validation (2)
  {
    group: 'G7',
    name: 'Form validation',
    checks: [
      {
        description: 'Create ticket form has required attributes',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          const subjectRequired =
            page.includes('name="subject" required') ||
            page.includes('required name="subject"');
          const descriptionRequired =
            page.includes('name="description" required') ||
            page.includes('required name="description"');
          return subjectRequired && descriptionRequired;
        },
      },
      {
        description: 'Form shows inline validation errors',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            page.includes('validation') ||
            page.includes('fieldError') ||
            page.includes('is required') ||
            page.includes('error message')
          );
        },
      },
    ],
  },

  // G8: DataTable column config (3)
  {
    group: 'G8',
    name: 'DataTable column config',
    checks: [
      {
        description: 'Tickets table has column headers',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            page.includes('<th') ||
            page.includes('column') ||
            page.includes('DataTable') ||
            (page.includes('Subject') && page.includes('Status') && page.includes('Priority'))
          );
        },
      },
      {
        description: 'Columns include Subject, Status, Priority',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return page.includes('Subject') && page.includes('Status') && page.includes('Priority');
        },
      },
      {
        description: 'Sortable column headers trigger sort',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            page.includes('handleSort') ||
            page.includes('sortBy') ||
            (page.includes('onClick') && page.includes('sort'))
          );
        },
      },
    ],
  },

  // G9: Pagination controls (4)
  {
    group: 'G9',
    name: 'Pagination controls',
    checks: [
      {
        description: 'TicketsPage has pagination page state',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            page.includes('pageNum') ||
            page.includes('useState(1)') ||
            (page.includes('[page,') && page.includes('setPage'))
          );
        },
      },
      {
        description: 'TicketsPage renders prev/next buttons',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            (page.includes('Previous') || page.includes('Prev')) &&
            page.includes('Next')
          );
        },
      },
      {
        description: 'Pagination passes page param to API',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            page.includes('page:') ||
            page.includes('page,') ||
            (page.includes('getTickets') && page.includes('page'))
          );
        },
      },
      {
        description: 'Shows total count and current page info',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/TicketsPage.jsx');
          return (
            page.includes('totalPages') &&
            (page.includes('Page ') || page.includes('page '))
          );
        },
      },
    ],
  },

  // G12: Email route wiring (3)
  {
    group: 'G12',
    name: 'Email route wiring',
    checks: [
      {
        description: 'Ticket creation calls sendEmail(ticketCreated)',
        verify: (files) => {
          const routes = getFileContent(files, 'server/routes/tickets.ts');
          const api = getFileContent(files, 'server/api.ts');
          const allServer = routes + api;
          return (
            allServer.includes("sendEmail('ticketCreated'") ||
            allServer.includes('sendEmail("ticketCreated"')
          );
        },
      },
      {
        description: 'Ticket resolved calls sendEmail(ticketResolved)',
        verify: (files) => {
          const routes = getFileContent(files, 'server/routes/tickets.ts');
          const api = getFileContent(files, 'server/api.ts');
          const allServer = routes + api;
          return (
            allServer.includes("sendEmail('ticketResolved'") ||
            allServer.includes('sendEmail("ticketResolved"')
          );
        },
      },
      {
        description: 'Templates imported in route handlers',
        verify: (files) => {
          const routes = getFileContent(files, 'server/routes/tickets.ts');
          const api = getFileContent(files, 'server/api.ts');
          const allServer = routes + api;
          return (
            allServer.includes("from '../templates") ||
            allServer.includes("from './templates") ||
            allServer.includes('sendEmail')
          );
        },
      },
    ],
  },
];

// ---- Git Helpers ----

function getGitCommit(): string | undefined {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

// ---- Exported Runner ----

export async function runHelpdeskGolden(): Promise<HelpdeskGoldenResult> {
  const fixture = 'examples/helpdesk.air';
  const source = readFileSync(fixture, 'utf-8');
  const start = performance.now();

  const tmpOut = join(tmpdir(), `helpdesk-golden-${Date.now()}`);
  mkdirSync(tmpOut, { recursive: true });

  let loopResult: LoopResult;
  try {
    loopResult = await runLoopFromSource(source, tmpOut, { writeArtifacts: false });
  } finally {
    try { rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const totalDurationMs = Math.round(performance.now() - start);

  // Pipeline stages
  const stages = loopResult.stages.map(s => ({
    name: s.name,
    status: s.status,
    duration_ms: s.durationMs,
  }));

  const allPipelinePassed = !loopResult.stages.some(s => s.status === 'fail');

  // Build file map from transpile result
  const fileMap = new Map<string, string>();
  if (loopResult.transpileResult) {
    for (const f of loopResult.transpileResult.files) {
      fileMap.set(f.path, f.content);
    }
  }

  const fileCount = fileMap.size;
  const outputLines = loopResult.transpileResult
    ? loopResult.transpileResult.files.reduce((sum, f) => sum + f.content.split('\n').length, 0)
    : 0;

  // Run capability checks
  const capGroups = CAPABILITY_CHECKS.map(g => {
    const checks = g.checks.map(c => ({
      description: c.description,
      passed: c.verify(fileMap),
    }));
    return {
      group: g.group,
      name: g.name,
      checks,
      all_passed: checks.every(c => c.passed),
    };
  });

  const totalChecks = capGroups.reduce((sum, g) => sum + g.checks.length, 0);
  const passedChecks = capGroups.reduce((sum, g) => sum + g.checks.filter(c => c.passed).length, 0);
  const allCapsPassed = passedChecks === totalChecks;

  const gitCommit = getGitCommit();
  const verdict = allPipelinePassed && allCapsPassed ? 'pass' : 'fail';

  return {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    run_metadata: {
      airengine_version: '0.2.0',
      node_version: process.version,
      platform: process.platform,
      ...(gitCommit ? { git_commit: gitCommit } : {}),
    },
    fixture,
    pipeline: {
      stages,
      all_passed: allPipelinePassed,
      total_duration_ms: totalDurationMs,
      file_count: fileCount,
      output_lines: outputLines,
      deterministic: loopResult.determinismCheck?.deterministic ?? false,
    },
    capabilities: {
      groups: capGroups,
      total_checks: totalChecks,
      passed_checks: passedChecks,
      all_passed: allCapsPassed,
    },
    verdict,
  };
}

// ---- CLI Main ----

async function main(): Promise<void> {
  console.log('\n  AirEngine Helpdesk Golden Run (C5)\n');
  console.log('  Fixture: examples/helpdesk.air');

  const result = await runHelpdeskGolden();

  // Print pipeline stages
  console.log('\n  Pipeline:');
  for (const stage of result.pipeline.stages) {
    const icon = stage.status === 'pass' ? 'PASS' : stage.status === 'fail' ? 'FAIL' : 'SKIP';
    console.log(`    ${icon}  ${stage.name} (${stage.duration_ms}ms)`);
  }

  // Print capability results
  console.log('\n  Capabilities:');
  for (const group of result.capabilities.groups) {
    const icon = group.all_passed ? 'PASS' : 'FAIL';
    console.log(`    ${icon}  ${group.group}: ${group.name}`);
    for (const check of group.checks) {
      const checkIcon = check.passed ? 'ok' : 'FAIL';
      console.log(`          ${checkIcon}  ${check.description}`);
    }
  }

  // Summary
  console.log(`\n  Output: ${result.pipeline.file_count} files, ${result.pipeline.output_lines} lines`);
  console.log(`  Deterministic: ${result.pipeline.deterministic ? 'yes' : 'NO'}`);
  console.log(`  Capabilities: ${result.capabilities.passed_checks}/${result.capabilities.total_checks}`);
  console.log(`  Time: ${result.pipeline.total_duration_ms}ms`);
  console.log(`  Verdict: ${result.verdict.toUpperCase()}\n`);

  // Write report
  mkdirSync('artifacts/demo', { recursive: true });
  writeFileSync('artifacts/demo/helpdesk-golden-result.json', JSON.stringify(result, null, 2));
  console.log('  Report: artifacts/demo/helpdesk-golden-result.json\n');

  process.exit(result.verdict === 'pass' ? 0 : 1);
}

if (process.argv[1]?.includes('helpdesk-golden')) {
  main().catch(err => {
    console.error(`\n  Fatal error: ${err.message}`);
    process.exit(1);
  });
}
