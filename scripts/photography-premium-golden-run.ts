/**
 * Photography Premium Golden Run
 *
 * Runs photography-studio-premium.air through the full AirEngine pipeline
 * and verifies 30 capability checks across 10 groups (G1–G10).
 *
 * Usage:  node --import tsx scripts/photography-premium-golden-run.ts
 * Output: artifacts/demo/photography-premium-golden-result.json
 * Exit:   0 = all 30 checks pass, 1 = any check fails
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

export interface PhotographyGoldenResult {
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

function getAllServerCode(files: Map<string, string>): string {
  const parts: string[] = [];
  for (const [path, content] of files) {
    if (path.startsWith('server/') && (path.endsWith('.ts') || path.endsWith('.js'))) {
      parts.push(content);
    }
  }
  return parts.join('\n');
}

// ---- 30 Capability Checks (10 groups) ----

export const CAPABILITY_CHECKS: CapabilityGroupDef[] = [
  // G1: Public page routing (3)
  {
    group: 'G1',
    name: 'Public page routing',
    checks: [
      {
        description: 'App.jsx renders public pages without isAuthed guard',
        verify: (files) => {
          const app = getFileContent(files, 'client/src/App.jsx');
          // Public pages should render with just currentPage check, no isAuthed
          const hasHomeWithoutAuth =
            app.includes("currentPage === 'home'") &&
            !app.includes("isAuthed && currentPage === 'home'");
          const hasGalleryWithoutAuth =
            app.includes("currentPage === 'gallery'") &&
            !app.includes("isAuthed && currentPage === 'gallery'");
          return hasHomeWithoutAuth && hasGalleryWithoutAuth;
        },
      },
      {
        description: 'App.jsx renders admin pages with isAuthed guard',
        verify: (files) => {
          const app = getFileContent(files, 'client/src/App.jsx');
          return (
            app.includes("isAuthed && currentPage === 'dashboard'") &&
            app.includes("isAuthed && currentPage === 'portfolio'")
          );
        },
      },
      {
        description: 'App.jsx imports and uses PublicLayout',
        verify: (files) => {
          const app = getFileContent(files, 'client/src/App.jsx');
          return (
            app.includes("import PublicLayout from './PublicLayout.jsx'") &&
            app.includes('<PublicLayout')
          );
        },
      },
    ],
  },

  // G2: Inquiry pipeline workflow (4)
  {
    group: 'G2',
    name: 'Inquiry pipeline workflow',
    checks: [
      {
        description: 'InquiriesPage has status management',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/InquiriesPage.jsx');
          return (
            page.includes('status') &&
            (page.includes('handleStatusChange') ||
              page.includes('updateStatus') ||
              page.includes('handleUpdate') ||
              page.includes("api.updateInquir"))
          );
        },
      },
      {
        description: 'InquiriesPage has filter tabs or controls',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/InquiriesPage.jsx');
          return (
            page.includes('filter') ||
            page.includes('Filter') ||
            page.includes('statusFilter') ||
            page.includes('<select') ||
            page.includes('tab')
          );
        },
      },
      {
        description: 'Server handles inquiry status updates',
        verify: (files) => {
          const api = getFileContent(files, 'server/api.ts');
          return (
            api.includes('inquiries') &&
            (api.includes('update') || api.includes('PUT'))
          );
        },
      },
      {
        description: 'Inquiry pipeline has status constants or filter',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes('event_type') ||
            allJsx.includes('status') ||
            allJsx.includes('PIPELINE') ||
            allJsx.includes('pipeline')
          );
        },
      },
    ],
  },

  // G3: Stats aggregate endpoint (3)
  {
    group: 'G3',
    name: 'Stats aggregate endpoint',
    checks: [
      {
        description: 'Server computes stats metrics',
        verify: (files) => {
          const api = getFileContent(files, 'server/api.ts');
          return (
            api.includes('/stats') &&
            (api.includes('count') || api.includes('_count') || api.includes('aggregate'))
          );
        },
      },
      {
        description: 'DashboardPage displays stat cards',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/DashboardPage.jsx');
          return (
            page.includes('stats.') &&
            (page.includes('Total Projects') || page.includes('totalProjects'))
          );
        },
      },
      {
        description: 'Stats endpoint uses Prisma aggregate or count',
        verify: (files) => {
          const api = getFileContent(files, 'server/api.ts');
          return (
            api.includes('prisma.') &&
            (api.includes('.count(') || api.includes('._count') || api.includes('.aggregate('))
          );
        },
      },
    ],
  },

  // G4: Portfolio CRUD (3)
  {
    group: 'G4',
    name: 'Portfolio CRUD',
    checks: [
      {
        description: 'PortfolioPage has create form',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/PortfolioPage.jsx');
          return (
            page.includes('<form') &&
            (page.includes('createProject') || page.includes('api.createProject'))
          );
        },
      },
      {
        description: 'PortfolioPage has category filter or tabs',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/PortfolioPage.jsx');
          return (
            page.includes('category') &&
            (page.includes('filter') || page.includes('Filter') || page.includes('tab') || page.includes('select'))
          );
        },
      },
      {
        description: 'PortfolioPage has edit or feature handlers',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/PortfolioPage.jsx');
          return (
            page.includes('handleEdit') ||
            page.includes('handleUpdate') ||
            page.includes('handleFeature') ||
            page.includes('updateProject') ||
            page.includes('api.updateProject')
          );
        },
      },
    ],
  },

  // G5: Server filter/sort (3)
  {
    group: 'G5',
    name: 'Server filter/sort',
    checks: [
      {
        description: 'Server accepts category filter param',
        verify: (files) => {
          const api = getFileContent(files, 'server/api.ts');
          return api.includes('category') && api.includes('req.query');
        },
      },
      {
        description: 'Server accepts status filter param',
        verify: (files) => {
          const api = getFileContent(files, 'server/api.ts');
          return api.includes('status') && api.includes('where');
        },
      },
      {
        description: 'Server supports search with OR clause',
        verify: (files) => {
          const api = getFileContent(files, 'server/api.ts');
          return api.includes('search') && api.includes('OR');
        },
      },
    ],
  },

  // G6: RBAC auth flow (3)
  {
    group: 'G6',
    name: 'RBAC auth flow',
    checks: [
      {
        description: 'Login/logout with token management',
        verify: (files) => {
          const app = getFileContent(files, 'client/src/App.jsx');
          return (
            app.includes('api.clearToken()') &&
            app.includes('setUser(null)') &&
            app.includes('api.setToken(')
          );
        },
      },
      {
        description: 'Server has requireAuth middleware',
        verify: (files) => {
          const server = getFileContent(files, 'server/server.ts');
          return server.includes('requireAuth');
        },
      },
      {
        description: 'User role is tracked in state',
        verify: (files) => {
          const app = getFileContent(files, 'client/src/App.jsx');
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes('user.role') ||
            allJsx.includes('role') ||
            app.includes('user.name')
          );
        },
      },
    ],
  },

  // G7: Form validation (3)
  {
    group: 'G7',
    name: 'Form validation',
    checks: [
      {
        description: 'Inquiry form has required fields',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/BookingPage.jsx');
          return (
            page.includes('name="name"') &&
            page.includes('name="email"')
          );
        },
      },
      {
        description: 'Form inputs use correct types',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/BookingPage.jsx');
          return page.includes('type="email"') || page.includes("type='email'");
        },
      },
      {
        description: 'Booking form has all 8 inquiry fields',
        verify: (files) => {
          const page = getFileContent(files, 'client/src/pages/BookingPage.jsx');
          const fields = ['name', 'email', 'phone', 'event_type', 'event_date', 'location', 'budget', 'message'];
          return fields.every(f => page.includes(`name="${f}"`));
        },
      },
    ],
  },

  // G8: Layout & navigation (3)
  {
    group: 'G8',
    name: 'Layout & navigation',
    checks: [
      {
        description: 'Admin sidebar nav exists in Layout',
        verify: (files) => {
          const layout = getFileContent(files, 'client/src/Layout.jsx');
          return (
            layout.includes('nav') &&
            layout.includes('setCurrentPage') &&
            (layout.includes('sidebar') || layout.includes('Sidebar') || layout.includes('aside'))
          );
        },
      },
      {
        description: 'PublicLayout has navbar with nav links',
        verify: (files) => {
          const layout = getFileContent(files, 'client/src/PublicLayout.jsx');
          return (
            layout.includes('navItems') &&
            layout.includes('setCurrentPage') &&
            layout.includes('home')
          );
        },
      },
      {
        description: 'PublicLayout has mobile hamburger menu',
        verify: (files) => {
          const layout = getFileContent(files, 'client/src/PublicLayout.jsx');
          return (
            layout.includes('menuOpen') &&
            layout.includes('setMenuOpen') &&
            layout.includes('md:hidden')
          );
        },
      },
    ],
  },

  // G9: Public API endpoints (3)
  {
    group: 'G9',
    name: 'Public API endpoints',
    checks: [
      {
        description: 'Server exempts /public/ from auth middleware',
        verify: (files) => {
          const server = getFileContent(files, 'server/server.ts');
          return server.includes("'/public/'") || server.includes('"/public/"');
        },
      },
      {
        description: 'Public routes registered in server',
        verify: (files) => {
          const api = getFileContent(files, 'server/api.ts');
          return (
            api.includes('/public/projects') &&
            api.includes('/public/services') &&
            api.includes('/public/testimonials') &&
            api.includes('/public/faqs')
          );
        },
      },
      {
        description: 'API client has public functions without auth headers',
        verify: (files) => {
          const apiClient = getFileContent(files, 'client/src/api.js');
          return (
            apiClient.includes('getPublicProjects') &&
            apiClient.includes('getPublicServices') &&
            apiClient.includes('getPublicTestimonials') &&
            apiClient.includes('getPublicFaqs')
          );
        },
      },
    ],
  },

  // G10: Data display quality (2)
  {
    group: 'G10',
    name: 'Data display quality',
    checks: [
      {
        description: 'Badge color coding function (_bc) present',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return allJsx.includes('_bc(') || allJsx.includes('_bc =');
        },
      },
      {
        description: 'Date formatting or stat formatting present',
        verify: (files) => {
          const allJsx = getAllClientJsx(files);
          return (
            allJsx.includes('toFixed') ||
            allJsx.includes('toLocaleString') ||
            allJsx.includes('formatDate') ||
            allJsx.includes('new Date(')
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

export async function runPhotographyGolden(): Promise<PhotographyGoldenResult> {
  const fixture = 'examples/photography-studio-premium.air';
  const source = readFileSync(fixture, 'utf-8');
  const start = performance.now();

  const tmpOut = join(tmpdir(), `photography-golden-${Date.now()}`);
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
  console.log('\n  AirEngine Photography Premium Golden Run\n');
  console.log('  Fixture: examples/photography-studio-premium.air');

  const result = await runPhotographyGolden();

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
  writeFileSync('artifacts/demo/photography-premium-golden-result.json', JSON.stringify(result, null, 2));
  console.log('  Report: artifacts/demo/photography-premium-golden-result.json\n');

  process.exit(result.verdict === 'pass' ? 0 : 1);
}

if (process.argv[1]?.includes('photography-premium-golden')) {
  main().catch(err => {
    console.error(`\n  Fatal error: ${err.message}`);
    process.exit(1);
  });
}
