/**
 * Deploy Generators
 *
 * Generates deployment artifacts (Dockerfile, docker-compose.yml, .dockerignore,
 * .env.example) from the @deploy block. Only emits files for target:docker.
 * Apps without @deploy or without a backend produce no deploy files.
 */

import type { TranspileContext } from './context.js';

// ---- Helpers ----

function resolvePort(ctx: TranspileContext): string {
  // @deploy.port takes priority
  if (ctx.deploy?.properties.port !== undefined) {
    return String(ctx.deploy.properties.port);
  }
  // Fall back to @env PORT default
  if (ctx.env) {
    const portVar = ctx.env.vars.find(v => v.name === 'PORT');
    if (portVar?.default !== undefined) return String(portVar.default);
  }
  return '3001';
}

function resolveNodeVersion(ctx: TranspileContext): string {
  if (ctx.deploy?.properties.node !== undefined) {
    return String(ctx.deploy.properties.node);
  }
  return '20';
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Generators ----

export function generateDockerfile(ctx: TranspileContext): string {
  if (!ctx.hasBackend || !ctx.deploy) return '';
  const target = String(ctx.deploy.properties.target ?? 'docker');
  if (target !== 'docker') return '';

  const nodeVersion = resolveNodeVersion(ctx);
  const port = resolvePort(ctx);
  const hasDb = Boolean(ctx.db);

  const lines: string[] = [];
  lines.push('# ---- Build ----');
  lines.push(`FROM node:${nodeVersion}-alpine AS builder`);
  lines.push('WORKDIR /app');
  lines.push('COPY package.json ./');
  lines.push('RUN npm install');
  lines.push('COPY . .');
  if (hasDb) {
    lines.push('RUN npx prisma generate');
  }
  lines.push('RUN npm run build');
  lines.push('');
  lines.push('# ---- Production ----');
  lines.push(`FROM node:${nodeVersion}-alpine`);
  lines.push('WORKDIR /app');
  lines.push('ENV NODE_ENV=production');
  lines.push('COPY --from=builder /app/dist ./dist');
  lines.push('COPY --from=builder /app/package.json ./');
  lines.push('RUN npm install --omit=dev');
  if (hasDb) {
    lines.push('COPY --from=builder /app/prisma ./prisma');
    lines.push('COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma');
    lines.push('COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma');
  }
  lines.push(`EXPOSE ${port}`);
  const healthPath = ctx.apiRoutes.length > 0 ? '/api' : '/';
  lines.push(`HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${port}${healthPath} || exit 1`);
  lines.push('CMD ["node", "dist/server.js"]');
  lines.push('');

  return lines.join('\n');
}

export function generateDockerCompose(ctx: TranspileContext): string {
  if (!ctx.hasBackend || !ctx.deploy) return '';
  const target = String(ctx.deploy.properties.target ?? 'docker');
  if (target !== 'docker') return '';

  const port = resolvePort(ctx);
  const hasDb = Boolean(ctx.db);

  const lines: string[] = [];
  lines.push('services:');
  lines.push('  server:');
  lines.push('    build:');
  lines.push('      context: ./server');
  lines.push('      dockerfile: Dockerfile');
  lines.push('    ports:');
  lines.push(`      - "${port}:${port}"`);
  lines.push('    env_file: ./server/.env');
  lines.push('    environment:');
  lines.push('      - NODE_ENV=production');
  lines.push(`      - PORT=${port}`);
  if (hasDb) {
    lines.push('      - DATABASE_URL=file:/app/data/app.db');
    lines.push('    volumes:');
    lines.push('      - ./server/data:/app/data');
  }
  lines.push('    restart: unless-stopped');
  lines.push('');

  return lines.join('\n');
}

export function generateDockerignore(_ctx: TranspileContext): string {
  if (!_ctx.hasBackend || !_ctx.deploy) return '';
  const target = String(_ctx.deploy.properties.target ?? 'docker');
  if (target !== 'docker') return '';

  return `node_modules
dist
.env
*.log
.git
.gitignore
*.db
.DS_Store
coverage
`;
}

export function generateEnvExample(ctx: TranspileContext): string {
  if (!ctx.hasBackend || !ctx.deploy) return '';
  const target = String(ctx.deploy.properties.target ?? 'docker');
  if (target !== 'docker') return '';

  const port = resolvePort(ctx);
  const lines: string[] = [];

  lines.push(`# Environment variables for ${capitalize(ctx.appName)} server`);
  lines.push('# Copy to .env and fill in production values');
  lines.push('');

  if (ctx.db) {
    lines.push('DATABASE_URL=file:/app/data/app.db   # str — Database connection URL (absolute for Docker)');
  }
  lines.push(`PORT=${port}   # int — Server port`);

  // Add @env vars (excluding PORT and DATABASE_URL which are already handled)
  if (ctx.env) {
    for (const v of ctx.env.vars) {
      if (v.name === 'PORT' || v.name === 'DATABASE_URL') continue;
      const reqLabel = v.required ? 'required' : 'optional';
      const defaultVal = v.default !== undefined ? String(v.default) : '';
      lines.push(`${v.name}=${defaultVal}   # ${v.type}, ${reqLabel}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}
