/**
 * Block Generators
 *
 * Generates webhook, auth, env, cron, queue, and email stubs
 * from their respective @-blocks.
 */

import type { TranspileContext } from '../context.js';

// ---- webhooks.ts ----

export function generateWebhooks(ctx: TranspileContext): string {
  if (!ctx.webhooks) return '';
  const lines: string[] = [];
  lines.push("import { Router } from 'express';");
  if (ctx.db) {
    lines.push("import { prisma } from './prisma.js';");
  }
  lines.push('');
  lines.push('export const webhookRouter = Router();');
  lines.push('');

  for (const route of ctx.webhooks.routes) {
    const method = route.method.toLowerCase();
    lines.push(`webhookRouter.${method}('${route.path}', async (req, res) => {`);
    lines.push(`  // TODO: implement handler: ${route.handler}`);
    lines.push("  res.status(501).json({ error: 'Not implemented' });");
    lines.push('});');
    lines.push('');
  }

  return lines.join('\n');
}

// ---- auth.ts ----

export function generateAuthMiddleware(ctx: TranspileContext): string {
  if (!ctx.auth) return '';
  const lines: string[] = [];

  lines.push("import type { Request, Response, NextFunction } from 'express';");
  lines.push('');
  lines.push('export function requireAuth(req: Request, res: Response, next: NextFunction) {');
  lines.push('  // TODO: Implement authentication check');
  lines.push("  const token = req.headers.authorization?.split(' ')[1];");
  lines.push("  if (!token) return res.status(401).json({ error: 'Unauthorized' });");
  lines.push('  // TODO: Verify token');
  lines.push('  next();');
  lines.push('}');

  if (ctx.auth.role) {
    lines.push('');
    const roleType = typeof ctx.auth.role === 'string'
      ? `'${ctx.auth.role}'`
      : ctx.auth.role.values.map(v => `'${v}'`).join(' | ');
    lines.push(`export function requireRole(role: ${roleType}) {`);
    lines.push('  return (req: Request, res: Response, next: NextFunction) => {');
    lines.push('    // TODO: Check user role');
    lines.push('    next();');
    lines.push('  };');
    lines.push('}');
  }

  return lines.join('\n') + '\n';
}

// ---- env.ts ----

export function generateEnvValidator(ctx: TranspileContext): string {
  if (!ctx.env) return '';
  const lines: string[] = [];

  lines.push("import 'dotenv/config';");
  lines.push('');
  lines.push('export const env = {');

  if (ctx.db) {
    lines.push('  DATABASE_URL: process.env.DATABASE_URL!,');
  }

  for (const v of ctx.env.vars) {
    lines.push(`  ${v.name}: process.env.${v.name}!,`);
  }

  lines.push('};');
  lines.push('');

  // Validate required vars
  const requiredVars = ctx.env.vars.filter(v => v.required);
  if (requiredVars.length > 0) {
    lines.push('// Validate required environment variables');
    lines.push(`const required = [${requiredVars.map(v => `'${v.name}'`).join(', ')}];`);
    lines.push('for (const key of required) {');
    lines.push('  if (!process.env[key]) {');
    lines.push('    throw new Error(`Missing required env var: ${key}`);');
    lines.push('  }');
    lines.push('}');
  }

  return lines.join('\n') + '\n';
}

// ---- cron.ts ----

export function generateCronStub(ctx: TranspileContext): string {
  if (!ctx.cron) return '';
  const lines: string[] = [];

  lines.push('// Cron jobs from @cron block');
  lines.push('// TODO: Add node-cron or similar scheduler');
  lines.push('');
  lines.push('export const cronJobs = [');

  for (const job of ctx.cron.jobs) {
    lines.push(`  { name: '${job.name}', schedule: '${job.schedule}', handler: () => { /* TODO: ${job.handler} */ } },`);
  }

  lines.push('];');

  return lines.join('\n') + '\n';
}

// ---- queue.ts ----

export function generateQueueStub(ctx: TranspileContext): string {
  if (!ctx.queue) return '';
  const lines: string[] = [];

  lines.push('// Queue jobs from @queue block');
  lines.push('// TODO: Add bull/bullmq or similar queue');
  lines.push('');
  lines.push('export const queueJobs = {');

  for (const job of ctx.queue.jobs) {
    lines.push(`  ${job.name}: async (data: unknown) => { /* TODO: ${job.handler} */ },`);
  }

  lines.push('};');

  return lines.join('\n') + '\n';
}

// ---- templates.ts (email) ----

export function generateEmailStub(ctx: TranspileContext): string {
  if (!ctx.email) return '';
  const lines: string[] = [];

  lines.push('// Email templates from @email block');
  lines.push('');
  lines.push('export const emailTemplates = {');

  for (const tmpl of ctx.email.templates) {
    lines.push(`  ${tmpl.name}: { subject: '${tmpl.subject}', render: (params: Record<string, unknown>) => '<!-- TODO -->' },`);
  }

  lines.push('};');

  return lines.join('\n') + '\n';
}
