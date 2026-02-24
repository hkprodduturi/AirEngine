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
  lines.push('# ---- Build stage ----');
  lines.push(`FROM node:${nodeVersion}-alpine AS builder`);
  lines.push('WORKDIR /app');
  lines.push('');
  lines.push('# Install dependencies first (layer caching)');
  lines.push('COPY package.json package-lock.json* ./');
  lines.push('RUN npm ci');
  lines.push('');
  lines.push('# Copy source and build');
  lines.push('COPY . .');
  if (hasDb) {
    lines.push('RUN npx prisma generate');
  }
  lines.push('RUN npm run build');
  lines.push('');
  lines.push('# ---- Production stage ----');
  lines.push(`FROM node:${nodeVersion}-alpine`);
  lines.push('');
  lines.push('# Security: run as non-root user');
  lines.push('RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup');
  lines.push('WORKDIR /app');
  lines.push('');
  lines.push('ENV NODE_ENV=production');
  lines.push('');
  lines.push('# Copy production deps and built output');
  lines.push('COPY --from=builder /app/package.json ./');
  lines.push('COPY --from=builder /app/package-lock.json* ./');
  lines.push('RUN npm ci --omit=dev && npm cache clean --force');
  lines.push('');
  lines.push('COPY --from=builder /app/dist ./dist');
  if (hasDb) {
    lines.push('COPY --from=builder /app/prisma ./prisma');
    lines.push('COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma');
    lines.push('COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma');
    lines.push('');
    lines.push('# Create data directory for SQLite');
    lines.push('RUN mkdir -p /app/data && chown appuser:appgroup /app/data');
  }
  lines.push('');
  lines.push('USER appuser');
  lines.push('');
  lines.push(`EXPOSE ${port}`);
  lines.push(`HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\`);
  lines.push(`  CMD wget -qO- http://localhost:${port}/api/health || exit 1`);
  lines.push('');
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
    lines.push('      - app-data:/app/data');
  }
  lines.push('    restart: unless-stopped');
  lines.push('    healthcheck:');
  lines.push(`      test: ["CMD", "wget", "-qO-", "http://localhost:${port}/api/health"]`);
  lines.push('      interval: 30s');
  lines.push('      timeout: 5s');
  lines.push('      retries: 3');
  lines.push('      start_period: 10s');
  if (hasDb) {
    lines.push('');
    lines.push('volumes:');
    lines.push('  app-data:');
  }
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
.env.local
*.log
.git
.gitignore
*.db
.DS_Store
coverage
data
.air-cache
*.md
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
  lines.push('# --- Core ---');

  if (ctx.db) {
    lines.push('DATABASE_URL=file:/app/data/app.db   # Database connection URL (absolute for Docker)');
  }
  lines.push(`PORT=${port}   # Server port`);
  lines.push('NODE_ENV=production');
  lines.push('');

  if (ctx.auth) {
    lines.push('# --- Authentication ---');
    lines.push('JWT_SECRET=   # REQUIRED: set a strong secret for production (e.g., openssl rand -hex 32)');
    lines.push('');
  }

  lines.push('# --- CORS ---');
  lines.push('CORS_ORIGIN=   # Frontend URL (e.g., https://myapp.com), leave empty to reflect origin');
  lines.push('');

  // Add @env vars (excluding already-handled vars)
  const handled = new Set(['PORT', 'DATABASE_URL', 'NODE_ENV', 'JWT_SECRET', 'CORS_ORIGIN']);
  if (ctx.env) {
    const extraVars = ctx.env.vars.filter(v => !handled.has(v.name));
    if (extraVars.length > 0) {
      lines.push('# --- Application ---');
      for (const v of extraVars) {
        const reqLabel = v.required ? 'REQUIRED' : 'optional';
        const defaultVal = v.default !== undefined ? String(v.default) : '';
        lines.push(`${v.name}=${defaultVal}   # ${reqLabel}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
