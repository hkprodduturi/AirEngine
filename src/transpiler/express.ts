/**
 * Express Server Generator
 *
 * Generates a complete Express + Prisma server from backend blocks.
 * Output is an array of OutputFile[] for the server/ directory.
 *
 * Layout: server/server.ts, server/api.ts, server/prisma.ts (client),
 *         server/prisma/schema.prisma, server/.env, server/tsconfig.json
 *
 * Prisma client is exported from prisma.ts to avoid circular imports
 * (server.ts imports api.ts, api.ts imports prisma.ts).
 */

import type { TranspileContext } from './context.js';
import type { OutputFile } from './index.js';
import type { AirRoute, AirDbBlock, AirDbModel } from '../parser/types.js';
import { generatePrismaSchema } from './prisma.js';
import { expandCrud } from './route-utils.js';
import { generateTypesFile, getGeneratedTypeNames } from './types-gen.js';
import { generateSeedFile } from './seed-gen.js';

// ---- Main entry ----

export function generateServer(ctx: TranspileContext): OutputFile[] {
  const files: OutputFile[] = [];

  // package.json
  files.push({ path: 'server/package.json', content: generateServerPackageJson(ctx) });

  // tsconfig.json
  files.push({ path: 'server/tsconfig.json', content: generateTsConfig() });

  // .env
  files.push({ path: 'server/.env', content: generateEnvFile(ctx) });

  // Prisma schema (only if @db exists)
  if (ctx.db) {
    files.push({ path: 'server/prisma/schema.prisma', content: generatePrismaSchema(ctx.db) });
  }

  // prisma.ts — PrismaClient singleton (avoids circular imports)
  if (ctx.db) {
    files.push({ path: 'server/prisma.ts', content: generatePrismaClient() });
  }

  // seed.ts — database seeding (only if @db exists)
  if (ctx.db) {
    files.push({ path: 'server/seed.ts', content: generateSeedFile(ctx) });
  }

  // types.ts — request body / DTO types
  if (ctx.apiRoutes.length > 0) {
    files.push({ path: 'server/types.ts', content: generateTypesFile(ctx) });
  }

  // api.ts — Express router from @api routes
  if (ctx.apiRoutes.length > 0) {
    files.push({ path: 'server/api.ts', content: generateApiRouter(ctx) });
  }

  // webhooks.ts — if @webhook exists
  if (ctx.webhooks) {
    files.push({ path: 'server/webhooks.ts', content: generateWebhooks(ctx) });
  }

  // auth.ts — if @auth exists
  if (ctx.auth) {
    files.push({ path: 'server/auth.ts', content: generateAuthMiddleware(ctx) });
  }

  // env.ts — if @env exists
  if (ctx.env) {
    files.push({ path: 'server/env.ts', content: generateEnvValidator(ctx) });
  }

  // cron.ts — if @cron exists
  if (ctx.cron) {
    files.push({ path: 'server/cron.ts', content: generateCronStub(ctx) });
  }

  // queue.ts — if @queue exists
  if (ctx.queue) {
    files.push({ path: 'server/queue.ts', content: generateQueueStub(ctx) });
  }

  // templates.ts — if @email exists
  if (ctx.email) {
    files.push({ path: 'server/templates.ts', content: generateEmailStub(ctx) });
  }

  // server.ts — main entry point (always last so we know what to import)
  files.push({ path: 'server/server.ts', content: generateServerEntry(ctx) });

  return files;
}

// ---- package.json ----

function generateServerPackageJson(ctx: TranspileContext): string {
  const pkg: Record<string, unknown> = {
    name: `${ctx.appName}-server`,
    private: true,
    type: 'module',
    scripts: {
      dev: 'tsx server.ts',
      build: 'prisma generate && tsc',
      'db:push': 'prisma db push',
      'db:seed': 'tsx seed.ts',
    },
    dependencies: {
      express: '^4.18.2',
      cors: '^2.8.5',
      dotenv: '^16.4.0',
      ...(ctx.db ? { '@prisma/client': '^5.10.0' } : {}),
    },
    devDependencies: {
      typescript: '^5.4.0',
      '@types/express': '^4.17.21',
      '@types/cors': '^2.8.17',
      tsx: '^4.7.0',
      ...(ctx.db ? { prisma: '^5.10.0' } : {}),
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

// ---- tsconfig.json ----

function generateTsConfig(): string {
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

function generateEnvFile(ctx: TranspileContext): string {
  // Use a Map to deduplicate — @env defaults merge with built-in defaults
  const vars = new Map<string, string>();

  // Built-in defaults
  if (ctx.db) {
    vars.set('DATABASE_URL', '"file:./dev.db"');
  }
  vars.set('PORT', '3001');

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
  for (const [key, value] of vars) {
    lines.push(value ? `${key}=${value}` : `${key}=`);
  }
  return lines.join('\n') + '\n';
}

// ---- prisma.ts (PrismaClient singleton) ----

function generatePrismaClient(): string {
  return `import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
`;
}

// ---- api.ts ----

function generateApiRouter(ctx: TranspileContext): string {
  const lines: string[] = [];
  lines.push("import { Router } from 'express';");
  if (ctx.db) {
    lines.push("import { prisma } from './prisma.js';");
  }

  // Expand CRUD shortcut into individual routes
  const routes = expandCrud(ctx.apiRoutes);

  // Collect type names used by routes in this file
  const typeNames = getGeneratedTypeNames(ctx);
  const usedTypes: string[] = [];
  for (const route of routes) {
    // Find matching original route (expanded routes share params reference)
    for (const [origRoute, typeName] of typeNames) {
      if (origRoute === route || (origRoute.params === route.params && route.params && route.params.length > 0)) {
        if (!usedTypes.includes(typeName)) usedTypes.push(typeName);
      }
    }
  }

  if (usedTypes.length > 0) {
    lines.push(`import type { ${usedTypes.join(', ')} } from './types.js';`);
  }

  lines.push('');
  lines.push('export const apiRouter = Router();');
  lines.push('');

  for (const route of routes) {
    const method = route.method.toLowerCase();
    const path = route.path;
    const handler = route.handler;

    lines.push(`apiRouter.${method}('${path}', async (req, res) => {`);
    lines.push('  try {');

    // Validate :id param for integer primary keys
    const hasIdParam = path.includes(':id');
    if (hasIdParam && ctx.db) {
      const modelMatch = handler.match(/^~db\.(\w+)\./);
      if (modelMatch) {
        const isIntId = hasIntPrimaryKey(modelMatch[1], ctx.db);
        if (isIntId) {
          lines.push("    if (isNaN(parseInt(req.params.id))) {");
          lines.push("      return res.status(400).json({ error: 'Invalid id', details: 'id must be an integer' });");
          lines.push('    }');
        }
      }
    }

    // Get body type name for typed destructuring
    let bodyTypeName: string | undefined;
    if (route.params && route.params.length > 0) {
      for (const [origRoute, typeName] of typeNames) {
        if (origRoute === route || origRoute.params === route.params) {
          bodyTypeName = typeName;
          break;
        }
      }
    }

    const prismaCall = mapHandlerToPrisma(handler, route, ctx.db, bodyTypeName);
    if (prismaCall) {
      // Add typed destructuring with validation if we have params and a body type
      if (bodyTypeName && route.params && route.params.length > 0) {
        // Use _body to avoid collision when a param is named 'body'
        const hasBodyParam = route.params.some(p => p.name === 'body');
        const bodyVar = hasBodyParam ? '_body' : 'body';
        lines.push(`    const ${bodyVar} = (req.body ?? {}) as ${bodyTypeName};`);
        const paramNames = route.params.map(p => p.name).join(', ');
        lines.push(`    const { ${paramNames} } = ${bodyVar};`);

        // Validate required params
        const requiredParams = route.params.filter(p => p.type.kind !== 'optional');
        if (requiredParams.length > 0) {
          const checks = requiredParams.map(p => `${p.name} === undefined || ${p.name} === null`).join(' || ');
          const names = requiredParams.map(p => p.name).join(', ');
          lines.push(`    if (${checks}) {`);
          lines.push(`      return res.status(400).json({ error: 'Missing required fields', details: 'Required: ${names}' });`);
          lines.push('    }');
        }
      }
      lines.push(`    const result = ${prismaCall};`);
      lines.push('    res.json(result);');
    } else {
      lines.push(`    // TODO: implement handler: ${handler}`);
      lines.push("    res.status(501).json({ error: 'Not implemented' });");
    }

    lines.push('  } catch (error) {');
    lines.push("    const details = process.env.NODE_ENV !== 'production' && error instanceof Error ? error.message : undefined;");
    lines.push("    res.status(500).json({ error: 'Internal server error', ...(details && { details }) });");
    lines.push('  }');
    lines.push('});');
    lines.push('');
  }

  return lines.join('\n');
}

// ---- Handler → Prisma mapping ----

function mapHandlerToPrisma(
  handler: string,
  route: AirRoute,
  db: AirDbBlock | null,
  bodyTypeName?: string,
): string | null {
  // Pattern: ~db.Model.operation
  const match = handler.match(/^~db\.(\w+)\.(\w+)$/);
  if (!match || !db) return null;

  const [, modelName, operation] = match;
  const modelVar = modelName.charAt(0).toLowerCase() + modelName.slice(1);

  // Check if :id param exists → extract with type coercion
  const hasIdParam = route.path.includes(':id');
  const idExpr = getIdExpression(modelName, db);

  // Use destructured param names if typed body is available
  const hasTypedBody = bodyTypeName && route.params && route.params.length > 0;
  const dataExpr = hasTypedBody
    ? `{ ${route.params!.map(p => p.name).join(', ')} }`
    : 'req.body';

  switch (operation) {
    case 'findMany':
      return `await prisma.${modelVar}.findMany()`;
    case 'findUnique':
      return hasIdParam
        ? `await prisma.${modelVar}.findUnique({ where: { id: ${idExpr} } })`
        : `await prisma.${modelVar}.findUnique({ where: req.body })`;
    case 'create':
      return `await prisma.${modelVar}.create({ data: ${dataExpr} })`;
    case 'update':
      return hasIdParam
        ? `await prisma.${modelVar}.update({ where: { id: ${idExpr} }, data: ${dataExpr} })`
        : `await prisma.${modelVar}.update({ where: req.body.where, data: req.body.data })`;
    case 'delete':
      return hasIdParam
        ? `await prisma.${modelVar}.delete({ where: { id: ${idExpr} } })`
        : `await prisma.${modelVar}.delete({ where: req.body })`;
    default:
      return null;
  }
}

/** Check if a model has an integer primary key */
function hasIntPrimaryKey(modelName: string, db: AirDbBlock): boolean {
  for (const model of db.models) {
    if (model.name === modelName) {
      for (const field of model.fields) {
        if (field.primary && field.name === 'id') {
          return unwrapKind(field.type) === 'int';
        }
      }
    }
  }
  return false;
}

/** Determine id expression: parseInt for int primary keys, string otherwise */
function getIdExpression(modelName: string, db: AirDbBlock): string {
  for (const model of db.models) {
    if (model.name === modelName) {
      for (const field of model.fields) {
        if (field.primary && field.name === 'id') {
          const baseKind = unwrapKind(field.type);
          if (baseKind === 'int') return 'parseInt(req.params.id)';
          return 'req.params.id';
        }
      }
    }
  }
  return 'req.params.id';
}

function unwrapKind(type: { kind: string; of?: unknown }): string {
  if (type.kind === 'optional' && type.of && typeof type.of === 'object' && 'kind' in type.of) {
    return unwrapKind(type.of as { kind: string; of?: unknown });
  }
  return type.kind;
}

// ---- server.ts (entry point) ----

function generateServerEntry(ctx: TranspileContext): string {
  const lines: string[] = [];

  lines.push("import express from 'express';");
  lines.push("import cors from 'cors';");
  lines.push("import 'dotenv/config';");

  if (ctx.apiRoutes.length > 0) {
    lines.push("import { apiRouter } from './api.js';");
  }
  if (ctx.webhooks) {
    lines.push("import { webhookRouter } from './webhooks.js';");
  }
  if (ctx.auth) {
    lines.push("import { requireAuth } from './auth.js';");
  }

  lines.push('');
  lines.push('const app = express();');
  lines.push('app.use(cors());');
  lines.push('app.use(express.json());');
  lines.push('');

  if (ctx.apiRoutes.length > 0) {
    lines.push("app.use('/api', apiRouter);");
  }
  if (ctx.webhooks) {
    lines.push("app.use('/webhooks', webhookRouter);");
  }

  lines.push('');
  lines.push("const PORT = process.env.PORT || 3001;");
  lines.push('app.listen(PORT, () => {');
  lines.push('  console.log(`Server running on port ${PORT}`);');
  lines.push('});');

  return lines.join('\n') + '\n';
}

// ---- webhooks.ts ----

function generateWebhooks(ctx: TranspileContext): string {
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

function generateAuthMiddleware(ctx: TranspileContext): string {
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

function generateEnvValidator(ctx: TranspileContext): string {
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

function generateCronStub(ctx: TranspileContext): string {
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

function generateQueueStub(ctx: TranspileContext): string {
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

function generateEmailStub(ctx: TranspileContext): string {
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
