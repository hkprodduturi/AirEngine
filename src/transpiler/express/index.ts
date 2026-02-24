/**
 * Express Server Generator — Orchestrator
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

import type { TranspileContext } from '../context.js';
import type { OutputFile } from '../index.js';
import { generatePrismaSchema } from '../prisma.js';
import { generateTypesFile } from '../types-gen.js';
import { generateSeedFile } from '../seed-gen.js';

import {
  generateApiRouter,
  groupRoutesByModel,
  shouldSplitRoutes,
  generateResourceRouter,
  generateMountPointApi,
} from './api-router-gen.js';

import {
  generateServerEntry,
  generateMiddleware,
  generatePrismaClient,
  generateServerPackageJson,
  generateTsConfig,
  generateEnvFile,
  generateValidation,
} from './server-entry-gen.js';

import {
  generateWebhooks,
  generateAuthMiddleware,
  generateEnvValidator,
  generateCronStub,
  generateQueueStub,
  generateEmailStub,
} from './blocks-gen.js';

import {
  generateDockerfile,
  generateDockerCompose,
  generateDockerignore,
  generateEnvExample,
} from '../deploy-gen.js';

export { generateReadme } from './readme-gen.js';

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
    files.push({ path: 'server/prisma/schema.prisma', content: generatePrismaSchema(ctx.db, { hasAuth: !!ctx.auth }) });
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

  // validation.ts — shared validation helpers
  if (ctx.apiRoutes.length > 0) {
    files.push({ path: 'server/validation.ts', content: generateValidation() });
  }

  // api.ts — Express router from @api routes
  // If 3+ model groups, split into per-resource routers
  if (ctx.apiRoutes.length > 0) {
    const expanded = ctx.expandedRoutes;
    const groups = groupRoutesByModel(expanded);
    if (shouldSplitRoutes(groups)) {
      // Per-resource router files
      for (const [key, routes] of groups) {
        if (key === '__misc__') continue;
        files.push({
          path: `server/routes/${key}.ts`,
          content: generateResourceRouter(key, routes, ctx),
        });
      }
      // Mount point api.ts
      files.push({ path: 'server/api.ts', content: generateMountPointApi(groups, ctx) });
    } else {
      files.push({ path: 'server/api.ts', content: generateApiRouter(ctx) });
    }
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

  // middleware.ts — request logger + error handler
  files.push({ path: 'server/middleware.ts', content: generateMiddleware() });

  // server.ts — main entry point (always last so we know what to import)
  files.push({ path: 'server/server.ts', content: generateServerEntry(ctx) });

  // Deploy artifacts (only if @deploy exists with target:docker)
  if (ctx.deploy) {
    const dockerfile = generateDockerfile(ctx);
    if (dockerfile) files.push({ path: 'server/Dockerfile', content: dockerfile });
    const dockerignore = generateDockerignore(ctx);
    if (dockerignore) files.push({ path: 'server/.dockerignore', content: dockerignore });
    const envExample = generateEnvExample(ctx);
    if (envExample) files.push({ path: 'server/.env.example', content: envExample });
    const compose = generateDockerCompose(ctx);
    if (compose) files.push({ path: 'docker-compose.yml', content: compose });
  }

  return files;
}
