/**
 * Runtime/Env Remediation Lane (H11 — Batch 1)
 *
 * Classifies runtime/environment failures from QA results and executes
 * deterministic, idempotent remediation actions. Targets issues that are
 * NOT transpiler bugs: missing deps, server down, port conflicts, DB issues,
 * migration/seed missing, auth/session boot failures.
 *
 * Actions are safe: bounded attempts, never patch generated output,
 * only touch the output directory's infrastructure (package.json, .env, etc.).
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { RuntimeQAResult, PreflightResult } from './runtime-qa.js';

// ---- Types ----

export type RuntimeIssueKind =
  | 'preflight-health-down'
  | 'dependency-missing'
  | 'server-not-running'
  | 'migration-seed-missing'
  | 'port-conflict'
  | 'db-connection-failure'
  | 'auth-session-boot';

export interface RuntimeIssue {
  kind: RuntimeIssueKind;
  severity: 'critical' | 'high' | 'medium';
  details: string;
  evidence: string[];
}

export interface RemediationAction {
  id: string;
  kind: RuntimeIssueKind;
  description: string;
  idempotent: true;
  execute: (ctx: RemediationContext) => RemediationActionResult;
}

export interface RemediationContext {
  outputDir: string;
  clientPort: number;
  serverPort: number;
  hasBackend: boolean;
  /** Allow mock execution for tests */
  dryRun?: boolean;
}

export interface RemediationActionResult {
  action_id: string;
  status: 'pass' | 'fail' | 'skip';
  description: string;
  details: string;
  durationMs: number;
}

export interface RemediationReport {
  issues: RuntimeIssue[];
  actions: RemediationActionResult[];
  issuesFixed: number;
  issuesPending: number;
  durationMs: number;
}

// ---- Classifier ----

/**
 * Classify runtime/env issues from QA results and preflight data.
 * Returns issues sorted by severity (critical first).
 */
export function classifyRuntimeIssues(
  qaResult: RuntimeQAResult,
  outputDir: string,
  hasBackend: boolean,
): RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];

  // 1. Preflight health down
  if (qaResult.preflight.status === 'fail') {
    const error = qaResult.preflight.error || 'unknown';
    if (error.includes('ECONNREFUSED') || error.includes('fetch failed')) {
      issues.push({
        kind: 'server-not-running',
        severity: 'critical',
        details: `Server not responding: ${error}`,
        evidence: [error],
      });
    } else {
      issues.push({
        kind: 'preflight-health-down',
        severity: 'critical',
        details: `Health check failed: ${error}`,
        evidence: [error],
      });
    }
  }

  // 2. Console errors → classify further
  const consoleErrors = qaResult.steps
    .flatMap(s => s.evidence.console_errors)
    .filter(Boolean);

  for (const err of consoleErrors) {
    const lower = err.toLowerCase();

    // DB connection failures
    if (lower.includes('prisma') || lower.includes('database') || lower.includes('econnrefused') && lower.includes('5432')) {
      if (!issues.some(i => i.kind === 'db-connection-failure')) {
        issues.push({
          kind: 'db-connection-failure',
          severity: 'critical',
          details: 'Database connection failed',
          evidence: [err],
        });
      }
    }

    // Module not found → dependency missing
    if (lower.includes('module not found') || lower.includes('cannot find module') || lower.includes('err_module_not_found')) {
      if (!issues.some(i => i.kind === 'dependency-missing')) {
        issues.push({
          kind: 'dependency-missing',
          severity: 'high',
          details: 'Missing npm dependency detected',
          evidence: [err],
        });
      }
    }

    // Migration/seed missing
    if (lower.includes('migration') || lower.includes('table') && lower.includes('does not exist') || lower.includes('relation') && lower.includes('does not exist')) {
      if (!issues.some(i => i.kind === 'migration-seed-missing')) {
        issues.push({
          kind: 'migration-seed-missing',
          severity: 'high',
          details: 'Database migration or seed data missing',
          evidence: [err],
        });
      }
    }

    // Auth/session boot
    if (lower.includes('jwt') || lower.includes('token') && lower.includes('invalid') || lower.includes('unauthorized') || lower.includes('session') && lower.includes('expired')) {
      if (!issues.some(i => i.kind === 'auth-session-boot')) {
        issues.push({
          kind: 'auth-session-boot',
          severity: 'medium',
          details: 'Auth/session boot issue detected',
          evidence: [err],
        });
      }
    }
  }

  // 3. Check for missing node_modules in output dir
  if (hasBackend) {
    const serverDir = join(outputDir, 'server');
    const clientDir = join(outputDir, 'client');
    if (existsSync(serverDir) && !existsSync(join(serverDir, 'node_modules'))) {
      issues.push({
        kind: 'dependency-missing',
        severity: 'high',
        details: 'Server node_modules missing',
        evidence: [`${serverDir}/node_modules not found`],
      });
    }
    if (existsSync(clientDir) && !existsSync(join(clientDir, 'node_modules'))) {
      issues.push({
        kind: 'dependency-missing',
        severity: 'high',
        details: 'Client node_modules missing',
        evidence: [`${clientDir}/node_modules not found`],
      });
    }
  } else {
    if (existsSync(outputDir) && !existsSync(join(outputDir, 'node_modules'))) {
      issues.push({
        kind: 'dependency-missing',
        severity: 'high',
        details: 'Client node_modules missing',
        evidence: [`${outputDir}/node_modules not found`],
      });
    }
  }

  // 4. Port conflict detection (from network request failures)
  const networkErrors = qaResult.steps
    .flatMap(s => s.evidence.network_requests)
    .filter(r => r && (r.includes('ERR_CONNECTION_REFUSED') || r.includes('EADDRINUSE')));
  if (networkErrors.length > 0 && !issues.some(i => i.kind === 'port-conflict')) {
    issues.push({
      kind: 'port-conflict',
      severity: 'high',
      details: 'Port conflict or connection refused on expected port',
      evidence: networkErrors,
    });
  }

  // Sort: critical > high > medium
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}

// ---- Remediation Actions ----

const REMEDIATION_ACTIONS: RemediationAction[] = [
  {
    id: 'REM-001',
    kind: 'dependency-missing',
    description: 'Install missing npm dependencies',
    idempotent: true,
    execute: (ctx) => {
      const start = performance.now();
      if (ctx.dryRun) {
        return { action_id: 'REM-001', status: 'pass', description: 'Install dependencies (dry run)', details: 'Skipped in dry run', durationMs: 0 };
      }

      const dirs: string[] = [];
      if (ctx.hasBackend) {
        const clientDir = join(ctx.outputDir, 'client');
        const serverDir = join(ctx.outputDir, 'server');
        if (existsSync(join(clientDir, 'package.json'))) dirs.push(clientDir);
        if (existsSync(join(serverDir, 'package.json'))) dirs.push(serverDir);
      } else {
        if (existsSync(join(ctx.outputDir, 'package.json'))) dirs.push(ctx.outputDir);
      }

      const results: string[] = [];
      for (const dir of dirs) {
        try {
          execSync('npm install --prefer-offline', { cwd: dir, timeout: 60000, stdio: 'pipe' });
          results.push(`Installed deps in ${dir}`);
        } catch (err) {
          return {
            action_id: 'REM-001', status: 'fail',
            description: 'Install dependencies',
            details: `npm install failed in ${dir}: ${err instanceof Error ? err.message : String(err)}`,
            durationMs: Math.round(performance.now() - start),
          };
        }
      }

      return {
        action_id: 'REM-001', status: dirs.length > 0 ? 'pass' : 'skip',
        description: 'Install dependencies',
        details: results.join('; ') || 'No package.json found',
        durationMs: Math.round(performance.now() - start),
      };
    },
  },
  {
    id: 'REM-002',
    kind: 'db-connection-failure',
    description: 'Create .env with default DATABASE_URL if missing',
    idempotent: true,
    execute: (ctx) => {
      const start = performance.now();
      if (ctx.dryRun) {
        return { action_id: 'REM-002', status: 'pass', description: 'Create .env (dry run)', details: 'Skipped in dry run', durationMs: 0 };
      }

      const serverDir = join(ctx.outputDir, 'server');
      const envPath = join(serverDir, '.env');

      if (!existsSync(serverDir)) {
        return { action_id: 'REM-002', status: 'skip', description: 'Create .env', details: 'No server directory', durationMs: Math.round(performance.now() - start) };
      }

      if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf-8');
        if (content.includes('DATABASE_URL')) {
          return { action_id: 'REM-002', status: 'skip', description: 'Create .env', details: 'DATABASE_URL already set', durationMs: Math.round(performance.now() - start) };
        }
      }

      const envContent = [
        '# Auto-generated by AirEngine self-heal',
        'DATABASE_URL="file:./dev.db"',
        'JWT_SECRET="dev-secret-change-in-production"',
        'PORT=' + ctx.serverPort,
        '',
      ].join('\n');

      writeFileSync(envPath, envContent, 'utf-8');
      return {
        action_id: 'REM-002', status: 'pass',
        description: 'Create .env with SQLite fallback',
        details: `Created ${envPath} with DATABASE_URL=file:./dev.db`,
        durationMs: Math.round(performance.now() - start),
      };
    },
  },
  {
    id: 'REM-003',
    kind: 'migration-seed-missing',
    description: 'Run Prisma migration and seed',
    idempotent: true,
    execute: (ctx) => {
      const start = performance.now();
      if (ctx.dryRun) {
        return { action_id: 'REM-003', status: 'pass', description: 'Run migration/seed (dry run)', details: 'Skipped in dry run', durationMs: 0 };
      }

      const serverDir = join(ctx.outputDir, 'server');
      if (!existsSync(join(serverDir, 'prisma'))) {
        return { action_id: 'REM-003', status: 'skip', description: 'Run migration/seed', details: 'No prisma directory', durationMs: Math.round(performance.now() - start) };
      }

      try {
        execSync('npx prisma db push --accept-data-loss', { cwd: serverDir, timeout: 30000, stdio: 'pipe' });
        return {
          action_id: 'REM-003', status: 'pass',
          description: 'Run Prisma db push',
          details: 'Database schema pushed successfully',
          durationMs: Math.round(performance.now() - start),
        };
      } catch (err) {
        return {
          action_id: 'REM-003', status: 'fail',
          description: 'Run Prisma db push',
          details: `prisma db push failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Math.round(performance.now() - start),
        };
      }
    },
  },
  {
    id: 'REM-004',
    kind: 'port-conflict',
    description: 'Detect and report port conflicts',
    idempotent: true,
    execute: (ctx) => {
      const start = performance.now();
      if (ctx.dryRun) {
        return { action_id: 'REM-004', status: 'pass', description: 'Check ports (dry run)', details: 'Skipped in dry run', durationMs: 0 };
      }

      const conflicts: string[] = [];
      for (const port of [ctx.clientPort, ctx.serverPort]) {
        try {
          const result = execSync(`lsof -i :${port} -t`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
          if (result) {
            conflicts.push(`Port ${port} in use by PID ${result.split('\n')[0]}`);
          }
        } catch {
          // lsof returns non-zero when port is free — that's good
        }
      }

      return {
        action_id: 'REM-004',
        status: conflicts.length > 0 ? 'fail' : 'pass',
        description: 'Check port availability',
        details: conflicts.length > 0 ? conflicts.join('; ') : 'Ports available',
        durationMs: Math.round(performance.now() - start),
      };
    },
  },
  {
    id: 'REM-005',
    kind: 'auth-session-boot',
    description: 'Ensure JWT_SECRET is set in .env',
    idempotent: true,
    execute: (ctx) => {
      const start = performance.now();
      if (ctx.dryRun) {
        return { action_id: 'REM-005', status: 'pass', description: 'Check JWT_SECRET (dry run)', details: 'Skipped in dry run', durationMs: 0 };
      }

      const serverDir = join(ctx.outputDir, 'server');
      const envPath = join(serverDir, '.env');

      if (!existsSync(serverDir)) {
        return { action_id: 'REM-005', status: 'skip', description: 'Check JWT_SECRET', details: 'No server directory', durationMs: Math.round(performance.now() - start) };
      }

      if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf-8');
        if (content.includes('JWT_SECRET')) {
          return { action_id: 'REM-005', status: 'skip', description: 'Check JWT_SECRET', details: 'JWT_SECRET already set', durationMs: Math.round(performance.now() - start) };
        }
        // Append JWT_SECRET
        writeFileSync(envPath, content + '\nJWT_SECRET="dev-secret-change-in-production"\n', 'utf-8');
      } else {
        writeFileSync(envPath, 'JWT_SECRET="dev-secret-change-in-production"\n', 'utf-8');
      }

      return {
        action_id: 'REM-005', status: 'pass',
        description: 'Set JWT_SECRET in .env',
        details: `Added JWT_SECRET to ${envPath}`,
        durationMs: Math.round(performance.now() - start),
      };
    },
  },
  {
    id: 'REM-006',
    kind: 'server-not-running',
    description: 'Verify server process and suggest restart',
    idempotent: true,
    execute: (ctx) => {
      const start = performance.now();
      // This is advisory — the DevServer manages processes. We just verify.
      if (ctx.dryRun) {
        return { action_id: 'REM-006', status: 'pass', description: 'Check server (dry run)', details: 'Skipped in dry run', durationMs: 0 };
      }

      if (!ctx.hasBackend) {
        return { action_id: 'REM-006', status: 'skip', description: 'Check server', details: 'No backend', durationMs: Math.round(performance.now() - start) };
      }

      const serverDir = join(ctx.outputDir, 'server');
      if (!existsSync(join(serverDir, 'server.ts'))) {
        return {
          action_id: 'REM-006', status: 'fail',
          description: 'Check server entry',
          details: 'server.ts not found in server directory',
          durationMs: Math.round(performance.now() - start),
        };
      }

      return {
        action_id: 'REM-006', status: 'pass',
        description: 'Server entry file exists',
        details: 'server.ts found — DevServer should manage the process',
        durationMs: Math.round(performance.now() - start),
      };
    },
  },
  {
    id: 'REM-007',
    kind: 'preflight-health-down',
    description: 'Verify health endpoint configuration',
    idempotent: true,
    execute: (ctx) => {
      const start = performance.now();
      if (ctx.dryRun) {
        return { action_id: 'REM-007', status: 'pass', description: 'Check health endpoint (dry run)', details: 'Skipped in dry run', durationMs: 0 };
      }

      // Check if server has a health endpoint
      const serverDir = join(ctx.outputDir, 'server');
      const serverEntry = join(serverDir, 'server.ts');
      if (!existsSync(serverEntry)) {
        return { action_id: 'REM-007', status: 'skip', description: 'Check health endpoint', details: 'No server.ts', durationMs: Math.round(performance.now() - start) };
      }

      const content = readFileSync(serverEntry, 'utf-8');
      if (content.includes('/api/health') || content.includes('/health')) {
        return { action_id: 'REM-007', status: 'pass', description: 'Health endpoint present', details: '/api/health route found in server.ts', durationMs: Math.round(performance.now() - start) };
      }

      return {
        action_id: 'REM-007', status: 'fail',
        description: 'Health endpoint missing',
        details: 'No /api/health route found in server.ts',
        durationMs: Math.round(performance.now() - start),
      };
    },
  },
];

// ---- Runner ----

/**
 * Run remediation actions for classified issues.
 * Actions are matched by issue kind and executed in order.
 * Max one action per issue kind (idempotent).
 */
export function runRemediation(
  issues: RuntimeIssue[],
  ctx: RemediationContext,
  maxActions: number = 5,
): RemediationReport {
  const start = performance.now();
  const results: RemediationActionResult[] = [];
  const handledKinds = new Set<RuntimeIssueKind>();

  for (const issue of issues) {
    if (handledKinds.has(issue.kind)) continue;
    if (results.length >= maxActions) break;

    const action = REMEDIATION_ACTIONS.find(a => a.kind === issue.kind);
    if (!action) continue;

    handledKinds.add(issue.kind);
    const result = action.execute(ctx);
    results.push(result);
  }

  const fixed = results.filter(r => r.status === 'pass').length;
  const pending = issues.length - fixed;

  return {
    issues,
    actions: results,
    issuesFixed: fixed,
    issuesPending: Math.max(0, pending),
    durationMs: Math.round(performance.now() - start),
  };
}

/**
 * Quick check: does the QA result suggest runtime/env issues
 * that remediation could help with?
 */
export function hasRuntimeIssues(qaResult: RuntimeQAResult): boolean {
  if (qaResult.preflight.status === 'fail') return true;
  const consoleErrors = qaResult.steps.flatMap(s => s.evidence.console_errors).filter(Boolean);
  return consoleErrors.some(e => {
    const lower = e.toLowerCase();
    return lower.includes('econnrefused') || lower.includes('module not found') ||
      lower.includes('cannot find module') || lower.includes('err_module_not_found') ||
      lower.includes('prisma') || lower.includes('database') ||
      lower.includes('eaddrinuse') || lower.includes('jwt') ||
      lower.includes('unauthorized');
  });
}
