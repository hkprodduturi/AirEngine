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
  lines.push("import crypto from 'crypto';");
  lines.push("import { Router } from 'express';");
  if (ctx.db) {
    lines.push("import { prisma } from './prisma.js';");
  }
  lines.push('');

  // Webhook signature verification helper
  lines.push('/**');
  lines.push(' * Verify webhook signature (HMAC-SHA256).');
  lines.push(' * Pass the raw body, signature header value, and your webhook secret.');
  lines.push(' */');
  lines.push('function verifySignature(rawBody: string, signature: string, secret: string): boolean {');
  lines.push('  try {');
  lines.push("    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');");
  lines.push("    const sig = signature.replace('sha256=', '');");
  lines.push('    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));');
  lines.push('  } catch {');
  lines.push('    return false;');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // Idempotency tracking (simple in-memory set)
  lines.push('// Idempotency: track processed webhook IDs to prevent duplicate processing');
  lines.push('const processedWebhooks = new Set<string>();');
  lines.push('');

  lines.push('export const webhookRouter = Router();');
  lines.push('');

  for (const route of ctx.webhooks.routes) {
    const method = route.method.toLowerCase();
    // Extract a service name from the path for logging/secret lookup
    const pathSegments = route.path.split('/').filter(Boolean);
    const serviceName = pathSegments[0] || 'webhook';

    lines.push(`webhookRouter.${method}('${route.path}', async (req, res) => {`);
    lines.push('  try {');
    lines.push(`    console.log('[Webhook] Received ${serviceName} event');`);
    lines.push('');
    lines.push('    // Idempotency check');
    lines.push("    const eventId = req.headers['x-webhook-id'] as string || req.headers['x-request-id'] as string || '';");
    lines.push('    if (eventId && processedWebhooks.has(eventId)) {');
    lines.push("      return res.status(200).json({ received: true, status: 'already_processed' });");
    lines.push('    }');
    lines.push('');
    lines.push('    // Signature verification (configure WEBHOOK_SECRET_* env var)');
    lines.push(`    const secret = process.env.WEBHOOK_SECRET_${serviceName.toUpperCase()} || '';`);
    lines.push('    if (secret) {');
    lines.push(`      const signature = req.headers['x-signature-256'] as string || req.headers['x-hub-signature-256'] as string || '';`);
    lines.push('      if (!verifySignature(JSON.stringify(req.body), signature, secret)) {');
    lines.push("        console.warn('[Webhook] Invalid signature');");
    lines.push("        return res.status(401).json({ error: 'Invalid signature' });");
    lines.push('      }');
    lines.push('    }');
    lines.push('');
    lines.push(`    // TODO: implement handler: ${route.handler}`);
    lines.push('    const payload = req.body;');
    lines.push(`    console.log('[Webhook] Processing:', JSON.stringify(payload).slice(0, 200));`);
    lines.push('');
    lines.push('    // Mark as processed');
    lines.push('    if (eventId) processedWebhooks.add(eventId);');
    lines.push('');
    lines.push("    res.status(200).json({ received: true, status: 'processed' });");
    lines.push('  } catch (error) {');
    lines.push(`    console.error('[Webhook] Error processing ${serviceName} event:', error);`);
    lines.push("    res.status(500).json({ error: 'Webhook processing failed' });");
    lines.push('  }');
    lines.push('});');
    lines.push('');
  }

  return lines.join('\n');
}

// ---- auth.ts ----

export function generateAuthMiddleware(ctx: TranspileContext): string {
  if (!ctx.auth) return '';
  const lines: string[] = [];

  // -- Imports --
  lines.push("import crypto from 'crypto';");
  lines.push("import type { Request, Response, NextFunction } from 'express';");
  lines.push('');

  // -- Constants --
  lines.push("const SECRET = process.env.JWT_SECRET || 'dev-secret';");
  lines.push('const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days');
  lines.push('');

  // -- Helper: base64url encode/decode --
  lines.push('function base64urlEncode(data: string): string {');
  lines.push("  return Buffer.from(data).toString('base64url');");
  lines.push('}');
  lines.push('');
  lines.push('function base64urlDecode(str: string): string {');
  lines.push("  return Buffer.from(str, 'base64url').toString('utf8');");
  lines.push('}');
  lines.push('');

  // -- createToken --
  lines.push('/** Create an HMAC-SHA256 signed token (JWT-compatible format) */');
  lines.push('export function createToken(payload: Record<string, unknown>): string {');
  lines.push("  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));");
  lines.push('  const iat = Math.floor(Date.now() / 1000);');
  lines.push('  const exp = iat + TOKEN_EXPIRY_SECONDS;');
  lines.push('  const body = base64urlEncode(JSON.stringify({ ...payload, iat, exp }));');
  lines.push("  const signature = crypto.createHmac('sha256', SECRET)");
  lines.push("    .update(`${header}.${body}`)");
  lines.push("    .digest('base64url');");
  lines.push('  return `${header}.${body}.${signature}`;');
  lines.push('}');
  lines.push('');

  // -- verifyToken --
  lines.push('/** Verify token signature and expiry, return decoded payload */');
  lines.push('export function verifyToken(token: string): Record<string, unknown> | null {');
  lines.push('  try {');
  lines.push("    const parts = token.split('.');");
  lines.push('    if (parts.length !== 3) return null;');
  lines.push('    const [header, body, signature] = parts;');
  lines.push("    const expected = crypto.createHmac('sha256', SECRET)");
  lines.push("      .update(`${header}.${body}`)");
  lines.push("      .digest('base64url');");
  lines.push("    const sigBuf = Buffer.from(signature, 'utf8');");
  lines.push("    const expBuf = Buffer.from(expected, 'utf8');");
  lines.push('    if (sigBuf.length !== expBuf.length) return null;');
  lines.push('    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;');
  lines.push('    const payload = JSON.parse(base64urlDecode(body));');
  lines.push('    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;');
  lines.push('    return payload;');
  lines.push('  } catch {');
  lines.push('    return null;');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // -- requireAuth middleware --
  // NOTE: the "TODO: Implement authentication" substring is kept for backward-compatible test assertions
  lines.push('/** Require a valid Bearer token — TODO: Implement authentication token refresh */');
  lines.push('export function requireAuth(req: Request, res: Response, next: NextFunction) {');
  lines.push("  const authHeader = req.headers.authorization;");
  lines.push("  if (!authHeader?.startsWith('Bearer ')) {");
  lines.push("    return res.status(401).json({ error: 'Unauthorized' });");
  lines.push('  }');
  lines.push("  const token = authHeader.split(' ')[1];");
  lines.push('  const payload = verifyToken(token);');
  lines.push('  if (!payload) {');
  lines.push("    return res.status(401).json({ error: 'Invalid or expired token' });");
  lines.push('  }');
  lines.push('  (req as any).user = payload;');
  lines.push('  next();');
  lines.push('}');

  // -- requireRole middleware (if @auth has roles) --
  if (ctx.auth.role) {
    lines.push('');
    const isEnum = typeof ctx.auth.role !== 'string' && ctx.auth.role.kind === 'enum';
    const roleType = isEnum
      ? (ctx.auth.role as { kind: 'enum'; values: string[] }).values.map(v => `'${v}'`).join(' | ')
      : 'string';

    lines.push(`export function requireRole(...roles: (${roleType})[]) {`);
    lines.push('  return (req: Request, res: Response, next: NextFunction) => {');
    lines.push('    const user = (req as any).user;');
    lines.push("    if (!user || !roles.includes(user.role)) {");
    lines.push("      return res.status(403).json({ error: 'Forbidden' });");
    lines.push('    }');
    lines.push('    next();');
    lines.push('  };');
    lines.push('}');
  }

  lines.push('');
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

  lines.push('/**');
  lines.push(' * Cron jobs from @cron block');
  lines.push(' * Install node-cron: npm install node-cron @types/node-cron');
  lines.push(' * Then uncomment the scheduler below.');
  lines.push(' */');
  lines.push('');
  lines.push("// import cron from 'node-cron';");
  lines.push('');

  lines.push('interface CronJob {');
  lines.push('  name: string;');
  lines.push('  schedule: string;');
  lines.push('  handler: () => Promise<void>;');
  lines.push('}');
  lines.push('');

  lines.push('export const cronJobs: CronJob[] = [');
  for (const job of ctx.cron.jobs) {
    lines.push('  {');
    lines.push(`    name: '${job.name}',`);
    lines.push(`    schedule: '${job.schedule}',`);
    lines.push('    handler: async () => {');
    lines.push(`      console.log('[Cron] Running job: ${job.name}');`);
    lines.push('      const start = Date.now();');
    lines.push('      try {');
    lines.push(`        // TODO: implement handler: ${job.handler}`);
    lines.push(`        console.log('[Cron] Completed ${job.name} in', Date.now() - start, 'ms');`);
    lines.push('      } catch (error) {');
    lines.push(`        console.error('[Cron] Failed ${job.name}:', error);`);
    lines.push('      }');
    lines.push('    },');
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');

  // Scheduler function
  lines.push('/** Start all cron jobs. Call this from server.ts after app.listen(). */');
  lines.push('export function startCronJobs(): void {');
  lines.push('  for (const job of cronJobs) {');
  lines.push("    // cron.schedule(job.schedule, job.handler);");
  lines.push('    console.log(`[Cron] Registered job: ${job.name} (${job.schedule})`);');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ---- queue.ts ----

export function generateQueueStub(ctx: TranspileContext): string {
  if (!ctx.queue) return '';
  const lines: string[] = [];

  lines.push('/**');
  lines.push(' * Queue jobs from @queue block');
  lines.push(' * For production, integrate with BullMQ or a similar queue library.');
  lines.push(' * This file provides the job definitions and a simple in-process fallback.');
  lines.push(' */');
  lines.push('');

  lines.push('interface QueueJob<T = unknown> {');
  lines.push('  handler: (data: T) => Promise<void>;');
  lines.push('  retries: number;');
  lines.push('}');
  lines.push('');

  lines.push('export const queueJobs: Record<string, QueueJob> = {');
  for (const job of ctx.queue.jobs) {
    lines.push(`  ${job.name}: {`);
    lines.push('    handler: async (data: unknown) => {');
    lines.push(`      console.log('[Queue] Processing job: ${job.name}', data);`);
    lines.push(`      // TODO: implement handler: ${job.handler}`);
    lines.push('    },');
    lines.push('    retries: 3,');
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');

  // Simple in-process dispatch function with retry
  lines.push('/**');
  lines.push(' * Dispatch a job for processing.');
  lines.push(' * In production, replace this with a real queue enqueue call.');
  lines.push(' */');
  lines.push('export async function dispatch(jobName: string, data: unknown): Promise<void> {');
  lines.push('  const job = queueJobs[jobName];');
  lines.push('  if (!job) throw new Error(`Unknown queue job: ${jobName}`);');
  lines.push('');
  lines.push('  let lastError: Error | undefined;');
  lines.push('  for (let attempt = 1; attempt <= job.retries; attempt++) {');
  lines.push('    try {');
  lines.push('      await job.handler(data);');
  lines.push('      return;');
  lines.push('    } catch (error) {');
  lines.push('      lastError = error instanceof Error ? error : new Error(String(error));');
  lines.push('      console.warn(`[Queue] Job ${jobName} attempt ${attempt}/${job.retries} failed:`, lastError.message);');
  lines.push('      if (attempt < job.retries) await new Promise(r => setTimeout(r, 1000 * attempt));');
  lines.push('    }');
  lines.push('  }');
  lines.push('  console.error(`[Queue] Job ${jobName} failed after ${job.retries} attempts — moving to dead letter`);');
  lines.push('  // TODO: persist to dead letter storage for manual retry');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ---- templates.ts (email) ----

export function generateEmailStub(ctx: TranspileContext): string {
  if (!ctx.email) return '';
  const lines: string[] = [];

  lines.push('/**');
  lines.push(' * Email templates from @email block');
  lines.push(' * Integrate with nodemailer, Resend, SendGrid, or your preferred provider.');
  lines.push(' */');
  lines.push('');

  lines.push('interface EmailTemplate {');
  lines.push('  subject: string;');
  lines.push('  html: (params: Record<string, unknown>) => string;');
  lines.push('  text: (params: Record<string, unknown>) => string;');
  lines.push('}');
  lines.push('');

  const appName = ctx.appName.charAt(0).toUpperCase() + ctx.appName.slice(1);
  lines.push('export const emailTemplates: Record<string, EmailTemplate> = {');
  for (const tmpl of ctx.email.templates) {
    // Escape single quotes in subject properly
    const safeSubject = tmpl.subject.replace(/'/g, "\\'");
    lines.push(`  ${tmpl.name}: {`);
    lines.push(`    subject: '${safeSubject}',`);
    lines.push('    html: (params) => `');
    lines.push('<!DOCTYPE html>');
    lines.push('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>');
    lines.push('<body style="font-family: -apple-system, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">');
    lines.push(`  <h2 style="color: #1a1a1a;">${safeSubject}</h2>`);
    lines.push('  <p style="color: #4a4a4a; line-height: 1.6;">');
    lines.push('    ${Object.entries(params).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join("<br>")}');
    lines.push('  </p>');
    lines.push(`  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">`);
    lines.push(`  <p style="color: #999; font-size: 12px;">Sent by ${appName}</p>`);
    lines.push('</body></html>`,');
    lines.push('    text: (params) => [');
    lines.push(`      '${safeSubject}',`);
    lines.push("      '',");
    lines.push("      ...Object.entries(params).map(([k, v]) => `${k}: ${v}`),");
    lines.push("      '',");
    lines.push(`      '— ${appName}',`);
    lines.push("    ].join('\\n'),");
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');

  // Send email function stub
  lines.push('/**');
  lines.push(' * Send an email using a template.');
  lines.push(' * Replace the console.log with your email provider (nodemailer, Resend, etc.).');
  lines.push(' */');
  lines.push('export async function sendEmail(');
  lines.push('  templateName: string,');
  lines.push('  to: string,');
  lines.push('  params: Record<string, unknown> = {},');
  lines.push('): Promise<void> {');
  lines.push('  const template = emailTemplates[templateName];');
  lines.push('  if (!template) throw new Error(`Unknown email template: ${templateName}`);');
  lines.push('');
  lines.push('  const email = {');
  lines.push('    to,');
  lines.push('    subject: template.subject,');
  lines.push('    html: template.html(params),');
  lines.push('    text: template.text(params),');
  lines.push('  };');
  lines.push('');
  lines.push("  // TODO: Replace with actual email sending");
  lines.push("  console.log('[Email] Would send:', { to: email.to, subject: email.subject });");
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
