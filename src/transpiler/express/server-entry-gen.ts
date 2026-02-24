/**
 * Server Entry & Config Generators
 *
 * Generates server.ts (main entry point), middleware.ts, prisma.ts client,
 * package.json, tsconfig.json, .env, and validation.ts.
 */

import type { TranspileContext } from '../context.js';

// ---- server.ts (entry point) ----

export function generateServerEntry(ctx: TranspileContext): string {
  const lines: string[] = [];

  lines.push("import express from 'express';");
  lines.push("import cors from 'cors';");
  lines.push("import helmet from 'helmet';");
  lines.push("import 'dotenv/config';");
  lines.push("import { requestLogger, errorHandler } from './middleware.js';");

  if (ctx.apiRoutes.length > 0) {
    lines.push("import { apiRouter } from './api.js';");
  }
  if (ctx.webhooks) {
    lines.push("import { webhookRouter } from './webhooks.js';");
  }
  if (ctx.auth) {
    lines.push("import { requireAuth } from './auth.js';");
  }
  if (ctx.db) {
    lines.push("import { prisma } from './prisma.js';");
  }

  // Resolve CORS origin from @env or default (true = reflect request origin, safe for dev)
  let corsOrigin = "process.env.CORS_ORIGIN || true";
  if (ctx.env) {
    const originVar = ctx.env.vars.find(v => v.name === 'CORS_ORIGIN' || v.name === 'CLIENT_URL');
    if (originVar) corsOrigin = `process.env.${originVar.name} || true`;
  }

  lines.push('');
  lines.push('const app = express();');
  lines.push('');

  // Middleware stack (order matters: security → parsing → logging → rate limit → auth → routes → errors)
  lines.push('// Security');
  lines.push('app.use(helmet());');
  lines.push(`app.use(cors({ origin: ${corsOrigin}, credentials: true, exposedHeaders: ['X-Total-Count'] }));`);
  lines.push('');
  lines.push('// Parsing');
  lines.push("app.use(express.json({ limit: '10mb' }));");
  lines.push('');
  lines.push('// Logging');
  lines.push('app.use(requestLogger);');
  lines.push('');

  // Simple in-memory rate limiter
  lines.push('// Rate limiting (in-memory, per-IP, auto-cleanup)');
  lines.push('const rateLimitMap = new Map<string, { count: number; start: number }>();');
  lines.push('const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes');
  lines.push('const RATE_LIMIT_MAX = 100;');
  lines.push('');
  lines.push('// Periodically clean stale entries to prevent memory leaks');
  lines.push('const rateLimitCleanup = setInterval(() => {');
  lines.push('  const now = Date.now();');
  lines.push('  for (const [key, entry] of rateLimitMap) {');
  lines.push('    if (now - entry.start > RATE_LIMIT_WINDOW) rateLimitMap.delete(key);');
  lines.push('  }');
  lines.push('}, RATE_LIMIT_WINDOW);');
  lines.push('rateLimitCleanup.unref();');
  lines.push('');
  lines.push('app.use((req, res, next) => {');
  lines.push("  const key = req.ip ?? 'unknown';");
  lines.push('  const now = Date.now();');
  lines.push('  const entry = rateLimitMap.get(key) || { count: 0, start: now };');
  lines.push('  if (now - entry.start > RATE_LIMIT_WINDOW) { entry.count = 0; entry.start = now; }');
  lines.push('  entry.count++;');
  lines.push('  rateLimitMap.set(key, entry);');
  lines.push("  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));");
  lines.push("  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX - entry.count)));");
  lines.push("  if (entry.count > RATE_LIMIT_MAX) {");
  lines.push("    return res.status(429).json({ error: 'Too many requests', details: 'Rate limit exceeded. Try again later.' });");
  lines.push('  }');
  lines.push('  next();');
  lines.push('});');
  lines.push('');

  // Health check endpoint (always available, before auth middleware)
  lines.push('// Health check');
  lines.push("app.get('/api/health', async (_req, res) => {");
  if (ctx.db) {
    lines.push('  try {');
    lines.push("    await prisma.$queryRaw`SELECT 1`;");
    lines.push("    res.json({ status: 'ok', timestamp: new Date().toISOString(), db: 'connected' });");
    lines.push('  } catch {');
    lines.push("    res.status(503).json({ status: 'error', timestamp: new Date().toISOString(), db: 'disconnected' });");
    lines.push('  }');
  } else {
    lines.push("  res.json({ status: 'ok', timestamp: new Date().toISOString() });");
  }
  lines.push('});');
  lines.push('');

  // Auth middleware: protect API routes except auth endpoints and health
  if (ctx.auth) {
    lines.push('// Protect API routes except auth endpoints and health check');
    lines.push("app.use('/api', (req, res, next) => {");
    lines.push("  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();");
    lines.push('  requireAuth(req, res, next);');
    lines.push('});');
    lines.push('');
  }

  // Routes
  if (ctx.apiRoutes.length > 0) {
    lines.push("app.use('/api', apiRouter);");
  }
  if (ctx.webhooks) {
    lines.push("app.use('/webhooks', webhookRouter);");
  }

  lines.push('');

  // 404 handler for unmatched routes
  lines.push('// 404 for unmatched routes');
  lines.push("app.use((_req, res) => {");
  lines.push("  res.status(404).json({ error: 'Not found' });");
  lines.push('});');
  lines.push('');

  lines.push('// Error handler (must be last)');
  lines.push('app.use(errorHandler);');
  lines.push('');
  lines.push("const PORT = parseInt(process.env.PORT || '3001', 10);");

  // Graceful shutdown
  lines.push('const server = app.listen(PORT, () => {');
  lines.push('  console.log(`Server running on port ${PORT}`);');
  lines.push('});');
  lines.push('');

  lines.push('// Graceful shutdown');
  lines.push('function shutdown() {');
  lines.push("  console.log('Shutting down gracefully...');");
  lines.push('  server.close(() => {');
  if (ctx.db) {
    lines.push('    prisma.$disconnect().then(() => {');
    lines.push("      console.log('Database disconnected');");
    lines.push('      process.exit(0);');
    lines.push('    });');
  } else {
    lines.push('    process.exit(0);');
  }
  lines.push('  });');
  lines.push('  // Force exit after 10s');
  lines.push('  setTimeout(() => process.exit(1), 10_000).unref();');
  lines.push('}');
  lines.push("process.on('SIGTERM', shutdown);");
  lines.push("process.on('SIGINT', shutdown);");

  return lines.join('\n') + '\n';
}

// ---- middleware.ts ----

export function generateMiddleware(): string {
  const lines: string[] = [];

  lines.push("import type { Request, Response, NextFunction } from 'express';");
  lines.push('');
  lines.push('/** Log incoming requests with method, path, status, and duration */');
  lines.push('export function requestLogger(req: Request, res: Response, next: NextFunction) {');
  lines.push('  const start = Date.now();');
  lines.push("  res.on('finish', () => {");
  lines.push('    const duration = Date.now() - start;');
  lines.push('    const status = res.statusCode;');
  lines.push("    const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';");
  lines.push('    console.log(`[${level}] ${req.method} ${req.path} ${status} ${duration}ms`);');
  lines.push('  });');
  lines.push('  next();');
  lines.push('}');
  lines.push('');
  lines.push('/** Map common error types to HTTP status codes and user-friendly messages */');
  lines.push('function classifyError(err: Error & { status?: number; code?: string }): { status: number; message: string } {');
  lines.push("  if (err.status) return { status: err.status, message: err.message };");
  lines.push('');
  lines.push('  // Prisma known request errors');
  lines.push("  if (err.code === 'P2025') return { status: 404, message: 'Record not found' };");
  lines.push("  if (err.code === 'P2002') return { status: 409, message: 'A record with that value already exists' };");
  lines.push("  if (err.code === 'P2003') return { status: 400, message: 'Related record not found' };");
  lines.push("  if (err.code === 'P2014') return { status: 400, message: 'Constraint violation' };");
  lines.push('');
  lines.push("  // JSON parse errors");
  lines.push("  if (err.type === 'entity.parse.failed') return { status: 400, message: 'Invalid JSON in request body' };");
  lines.push('');
  lines.push("  return { status: 500, message: 'Internal server error' };");
  lines.push('}');
  lines.push('');
  lines.push('/** Global error handler — classifies errors and returns consistent JSON responses */');
  lines.push('export function errorHandler(err: Error & { status?: number; code?: string; type?: string }, _req: Request, res: Response, _next: NextFunction) {');
  lines.push('  const { status, message } = classifyError(err);');
  lines.push("  if (status >= 500) console.error('Server error:', err);");
  lines.push("  const details = process.env.NODE_ENV !== 'production' ? err.message : undefined;");
  lines.push('  res.status(status).json({ error: message, ...(details && { details }) });');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ---- prisma.ts (PrismaClient singleton) ----

export function generatePrismaClient(): string {
  return `import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV !== 'production' ? ['warn', 'error'] : ['error'],
});
`;
}

// ---- package.json ----

export function generateServerPackageJson(ctx: TranspileContext): string {
  const scripts: Record<string, string> = {
    dev: 'tsx watch server.ts',
    build: ctx.db ? 'prisma generate && tsc' : 'tsc',
    start: 'node dist/server.js',
  };
  if (ctx.db) {
    scripts['db:push'] = 'prisma db push';
    scripts['db:seed'] = 'tsx seed.ts';
    scripts['db:studio'] = 'prisma studio';
  }

  const pkg: Record<string, unknown> = {
    name: `${ctx.appName}-server`,
    private: true,
    type: 'module',
    scripts,
    dependencies: {
      express: '^4.18.2',
      cors: '^2.8.5',
      helmet: '^7.1.0',
      dotenv: '^16.4.0',
      ...(ctx.db ? { '@prisma/client': '^5.10.0' } : {}),
    },
    devDependencies: {
      typescript: '^5.4.0',
      '@types/express': '^4.17.21',
      '@types/cors': '^2.8.17',
      '@types/node': '^20.11.0',
      tsx: '^4.7.0',
      ...(ctx.db ? { prisma: '^5.10.0' } : {}),
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

// ---- tsconfig.json ----

export function generateTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      esModuleInterop: true,
      strict: true,
      outDir: './dist',
      rootDir: '.',
      skipLibCheck: true,
    },
    include: ['./**/*.ts'],
    exclude: ['node_modules', 'dist'],
  }, null, 2) + '\n';
}

// ---- .env ----

export function generateEnvFile(ctx: TranspileContext): string {
  // Use a Map to deduplicate — @env defaults merge with built-in defaults
  const vars = new Map<string, string>();

  // Built-in defaults
  if (ctx.db) {
    vars.set('DATABASE_URL', '"file:./dev.db"');
  }
  if (ctx.auth) {
    vars.set('JWT_SECRET', '"dev-secret-change-in-production"');
  }
  vars.set('PORT', '3001');
  vars.set('CORS_ORIGIN', 'http://localhost:5173');
  vars.set('NODE_ENV', 'development');

  // @env block vars — override/add
  if (ctx.env) {
    for (const v of ctx.env.vars) {
      // Skip if already set and @env has no default
      if (vars.has(v.name) && v.default === undefined) continue;
      if (v.default !== undefined) {
        vars.set(v.name, JSON.stringify(String(v.default)));
      } else {
        vars.set(v.name, '');
      }
    }
  }

  const lines: string[] = [];
  lines.push(`# Environment variables for ${ctx.appName}`);
  lines.push('# Copy to .env.local for overrides, never commit secrets');
  lines.push('');
  for (const [key, value] of vars) {
    lines.push(value ? `${key}=${value}` : `${key}=`);
  }
  return lines.join('\n') + '\n';
}

// ---- validation.ts ----

export function generateValidation(): string {
  const lines: string[] = [];

  lines.push("import type { Request, Response, NextFunction } from 'express';");
  lines.push('');
  lines.push('/**');
  lines.push(' * Assert that all required fields are present in the request body.');
  lines.push(' * Throws an error with status 400 if any field is missing.');
  lines.push(' */');
  lines.push('export function assertRequired(body: Record<string, unknown>, fields: string[]): void {');
  lines.push('  const missing = fields.filter(f => body[f] === undefined || body[f] === null);');
  lines.push('  if (missing.length > 0) {');
  lines.push("    const err = new Error(`Missing required fields: ${missing.join(', ')}`) as Error & { status: number };");
  lines.push('    err.status = 400;');
  lines.push('    throw err;');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push('/**');
  lines.push(' * Parse and validate an integer route parameter.');
  lines.push(' * Throws an error with status 400 if the value is not a valid integer.');
  lines.push(' */');
  lines.push('export function assertIntParam(value: string, name = "id"): number {');
  lines.push('  const parsed = parseInt(value, 10);');
  lines.push('  if (isNaN(parsed)) {');
  lines.push('    const err = new Error(`Invalid ${name}: must be an integer`) as Error & { status: number };');
  lines.push('    err.status = 400;');
  lines.push('    throw err;');
  lines.push('  }');
  lines.push('  return parsed;');
  lines.push('}');
  lines.push('');
  lines.push('type FieldSchema = Record<string, "string" | "number" | "boolean" | "object" | "optional_string" | "optional_number" | "optional_boolean" | "optional_object">;');
  lines.push('');
  lines.push('/**');
  lines.push(' * Validate request body fields against a schema.');
  lines.push(' * Returns array of error messages (empty = valid).');
  lines.push(' */');
  lines.push('export function validateFields(body: Record<string, unknown>, schema: FieldSchema): string[] {');
  lines.push('  const errors: string[] = [];');
  lines.push('  for (const [field, expected] of Object.entries(schema)) {');
  lines.push('    const value = body[field];');
  lines.push('    const isOptional = expected.startsWith("optional_");');
  lines.push('    const baseType = isOptional ? expected.slice(9) : expected;');
  lines.push('    if (value === undefined || value === null) {');
  lines.push('      if (!isOptional) errors.push(`${field} is required`);');
  lines.push('      continue;');
  lines.push('    }');
  lines.push('    if (typeof value !== baseType) {');
  lines.push('      errors.push(`${field} must be a ${baseType}, got ${typeof value}`);');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return errors;');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
