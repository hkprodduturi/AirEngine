import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';
import { extractContext } from '../src/transpiler/context.js';
import { generatePrismaSchema } from '../src/transpiler/prisma.js';
import { generateServer } from '../src/transpiler/express.js';
import type { AirDbBlock } from '../src/parser/types.js';

// ---- Helpers ----

function parseFile(name: string) {
  const source = readFileSync(`examples/${name}.air`, 'utf-8');
  return parse(source);
}

function transpileFile(name: string) {
  const ast = parseFile(name);
  return transpile(ast);
}

function getServerFile(name: string, filePath: string): string | undefined {
  const result = transpileFile(name);
  return result.files.find(f => f.path === filePath)?.content;
}

// ---- Prisma Schema Generation ----

describe('Prisma schema generation', () => {
  it('generates model from fullstack-todo.air @db', () => {
    const ast = parseFile('fullstack-todo');
    const db = ast.app.blocks.find(b => b.kind === 'db') as AirDbBlock;
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('model Todo {');
    expect(schema).toContain('@id');
    expect(schema).toContain('@default(autoincrement())');
    expect(schema).toContain('@default(now())');
    expect(schema).toContain('@default(false)');
    expect(schema).toContain('String');
    expect(schema).toContain('Boolean');
    expect(schema).toContain('DateTime');
  });

  it('includes generator and datasource headers', () => {
    const ast = parseFile('fullstack-todo');
    const db = ast.app.blocks.find(b => b.kind === 'db') as AirDbBlock;
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('generator client {');
    expect(schema).toContain('provider = "prisma-client-js"');
    expect(schema).toContain('datasource db {');
    expect(schema).toContain('provider = "sqlite"');
    expect(schema).toContain('env("DATABASE_URL")');
  });

  it('maps int:primary:auto to @id @default(autoincrement())', () => {
    const ast = parseFile('fullstack-todo');
    const db = ast.app.blocks.find(b => b.kind === 'db') as AirDbBlock;
    const schema = generatePrismaSchema(db);
    // The id field should have both @id and @default(autoincrement())
    const idLine = schema.split('\n').find(l => l.trim().startsWith('id'));
    expect(idLine).toContain('@id');
    expect(idLine).toContain('@default(autoincrement())');
    expect(idLine).toContain('Int');
  });

  it('maps datetime:auto to DateTime @default(now())', () => {
    const ast = parseFile('fullstack-todo');
    const db = ast.app.blocks.find(b => b.kind === 'db') as AirDbBlock;
    const schema = generatePrismaSchema(db);
    const line = schema.split('\n').find(l => l.trim().startsWith('created_at'));
    expect(line).toContain('DateTime');
    expect(line).toContain('@default(now())');
  });

  it('maps str:required to plain String (no ?)', () => {
    const ast = parseFile('fullstack-todo');
    const db = ast.app.blocks.find(b => b.kind === 'db') as AirDbBlock;
    const schema = generatePrismaSchema(db);
    const textLine = schema.split('\n').find(l => l.trim().startsWith('text'));
    expect(textLine).toContain('String');
    expect(textLine).not.toContain('?');
  });

  it('generates enum blocks for enum fields', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [{
        name: 'Task',
        fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'status', type: { kind: 'enum', values: ['pending', 'done', 'archived'] } },
        ],
      }],
      relations: [],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('enum TaskStatus {');
    expect(schema).toContain('  pending');
    expect(schema).toContain('  done');
    expect(schema).toContain('  archived');
  });

  it('generates TODO comments for relations', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [{ name: 'id', type: { kind: 'int' }, primary: true }] },
        { name: 'Post', fields: [{ name: 'id', type: { kind: 'int' }, primary: true }] },
      ],
      relations: [{ from: 'User.posts', to: 'Post.author' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('// TODO: Prisma relation fields');
    expect(schema).toContain('User.posts <-> Post.author');
  });
});

// ---- Express Server Generation ----

describe('Express server generation', () => {
  it('generates server files for fullstack-todo.air', () => {
    const result = transpileFile('fullstack-todo');
    const paths = result.files.map(f => f.path);
    expect(paths).toContain('server/server.ts');
    expect(paths).toContain('server/api.ts');
    expect(paths).toContain('server/package.json');
    expect(paths).toContain('server/.env');
    expect(paths).toContain('server/prisma/schema.prisma');
    expect(paths).toContain('server/prisma.ts');
    expect(paths).toContain('server/tsconfig.json');
  });

  it('api.ts contains all four CRUD routes', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts')!;
    expect(api).toContain("apiRouter.get('/todos'");
    expect(api).toContain("apiRouter.post('/todos'");
    expect(api).toContain("apiRouter.put('/todos/:id'");
    expect(api).toContain("apiRouter.delete('/todos/:id'");
  });

  it('api.ts maps handlers to Prisma calls', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts')!;
    expect(api).toContain('prisma.todo.findMany()');
    expect(api).toContain('prisma.todo.create({ data: req.body })');
    expect(api).toContain('prisma.todo.update(');
    expect(api).toContain('prisma.todo.delete(');
  });

  it('api.ts uses parseInt for int primary key id params', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts')!;
    expect(api).toContain('parseInt(req.params.id)');
  });

  it('api.ts routes are mounted under /api in server.ts', () => {
    const server = getServerFile('fullstack-todo', 'server/server.ts')!;
    expect(server).toContain("app.use('/api', apiRouter)");
  });

  it('server.ts imports apiRouter from api.js', () => {
    const server = getServerFile('fullstack-todo', 'server/server.ts')!;
    expect(server).toContain("import { apiRouter } from './api.js'");
  });

  it('prisma.ts exports PrismaClient', () => {
    const prismaFile = getServerFile('fullstack-todo', 'server/prisma.ts')!;
    expect(prismaFile).toContain("import { PrismaClient } from '@prisma/client'");
    expect(prismaFile).toContain('export const prisma = new PrismaClient()');
  });

  it('api.ts imports prisma from prisma.ts (no circular import)', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts')!;
    expect(api).toContain("import { prisma } from './prisma.js'");
    // server.ts should NOT export prisma
    const server = getServerFile('fullstack-todo', 'server/server.ts')!;
    expect(server).not.toContain('export const prisma');
  });

  it('.env contains DATABASE_URL and PORT', () => {
    const env = getServerFile('fullstack-todo', 'server/.env')!;
    expect(env).toContain('DATABASE_URL=');
    expect(env).toContain('PORT=3001');
  });

  it('server package.json has correct dependencies', () => {
    const raw = getServerFile('fullstack-todo', 'server/package.json')!;
    const pkg = JSON.parse(raw);
    expect(pkg.dependencies.express).toBeDefined();
    expect(pkg.dependencies.cors).toBeDefined();
    expect(pkg.dependencies['@prisma/client']).toBeDefined();
    expect(pkg.devDependencies.prisma).toBeDefined();
    expect(pkg.devDependencies.tsx).toBeDefined();
    expect(pkg.type).toBe('module');
  });

  it('generates auth middleware stub for dashboard.air', () => {
    const result = transpileFile('dashboard');
    const auth = result.files.find(f => f.path === 'server/auth.ts');
    expect(auth).toBeDefined();
    expect(auth!.content).toContain('requireAuth');
    expect(auth!.content).toContain('TODO: Implement authentication');
  });

  it('unknown handler returns 501', () => {
    // Synthesize an AST with unknown handler pattern
    const ast = parse('@app:t\n@api(\nGET:/test>custom.handler\n)');
    const result = transpile(ast);
    const api = result.files.find(f => f.path === 'server/api.ts');
    expect(api).toBeDefined();
    expect(api!.content).toContain('501');
    expect(api!.content).toContain('Not implemented');
    expect(api!.content).toContain('TODO: implement handler');
  });
});

// ---- CRUD expansion ----

describe('CRUD route expansion', () => {
  it('expands CRUD shorthand to GET, POST, PUT, DELETE', () => {
    const ast = parse('@app:t\n@db{\nItem{id:int:primary:auto,name:str}\n}\n@api(\nCRUD:/items>~db.Item\n)');
    const result = transpile(ast);
    const api = result.files.find(f => f.path === 'server/api.ts')!.content;
    expect(api).toContain("apiRouter.get('/items'");
    expect(api).toContain("apiRouter.post('/items'");
    expect(api).toContain("apiRouter.put('/items/:id'");
    expect(api).toContain("apiRouter.delete('/items/:id'");
  });
});

// ---- Integration: fullstack vs frontend-only ----

describe('fullstack vs frontend-only output structure', () => {
  it('fullstack-todo.air produces client/ + server/ structure', () => {
    const result = transpileFile('fullstack-todo');
    const paths = result.files.map(f => f.path);
    const clientPaths = paths.filter(p => p.startsWith('client/'));
    const serverPaths = paths.filter(p => p.startsWith('server/'));
    expect(clientPaths.length).toBeGreaterThan(0);
    expect(serverPaths.length).toBeGreaterThan(0);
    // Client has scaffold files
    expect(paths).toContain('client/package.json');
    expect(paths).toContain('client/src/App.jsx');
    expect(paths).toContain('client/index.html');
  });

  it('todo.air produces flat structure (no client/ directory)', () => {
    const result = transpileFile('todo');
    const paths = result.files.map(f => f.path);
    expect(paths.some(p => p.startsWith('client/'))).toBe(false);
    expect(paths.some(p => p.startsWith('server/'))).toBe(false);
    expect(paths).toContain('src/App.jsx');
    expect(paths).toContain('package.json');
  });

  it('expense-tracker.air produces flat structure', () => {
    const result = transpileFile('expense-tracker');
    const paths = result.files.map(f => f.path);
    expect(paths.some(p => p.startsWith('client/'))).toBe(false);
    expect(paths.some(p => p.startsWith('server/'))).toBe(false);
  });

  it('landing.air produces flat structure', () => {
    const result = transpileFile('landing');
    const paths = result.files.map(f => f.path);
    expect(paths.some(p => p.startsWith('client/'))).toBe(false);
    expect(paths.some(p => p.startsWith('server/'))).toBe(false);
  });

  it('dashboard.air (has @api) produces fullstack structure', () => {
    const result = transpileFile('dashboard');
    const paths = result.files.map(f => f.path);
    expect(paths.some(p => p.startsWith('client/'))).toBe(true);
    expect(paths.some(p => p.startsWith('server/'))).toBe(true);
  });

  it('auth.air (has @api) produces fullstack structure', () => {
    const result = transpileFile('auth');
    const paths = result.files.map(f => f.path);
    expect(paths.some(p => p.startsWith('client/'))).toBe(true);
    expect(paths.some(p => p.startsWith('server/'))).toBe(true);
  });

  it('stats include both client and server files', () => {
    const result = transpileFile('fullstack-todo');
    expect(result.stats.outputLines).toBeGreaterThan(0);
  });
});

// ---- hasBackend detection ----

describe('hasBackend detection', () => {
  it('is true when @db exists', () => {
    const ast = parse('@app:t\n@db{\nUser{id:int}\n}');
    const ctx = extractContext(ast);
    expect(ctx.hasBackend).toBe(true);
  });

  it('is true when @api exists', () => {
    const ast = parse('@app:t\n@api(\nGET:/test>handler\n)');
    const ctx = extractContext(ast);
    expect(ctx.hasBackend).toBe(true);
  });

  it('is true when @env exists', () => {
    const ast = parse('@app:t\n@env(\nAPI_KEY:str:required\n)');
    const ctx = extractContext(ast);
    expect(ctx.hasBackend).toBe(true);
  });

  it('is true when @webhook exists', () => {
    const ast = parse('@app:t\n@webhook(\nPOST:/stripe>!processPayment\n)');
    const ctx = extractContext(ast);
    expect(ctx.hasBackend).toBe(true);
  });

  it('is false when only frontend blocks exist', () => {
    const ast = parse('@app:t\n@state{x:int}\n@style(theme:dark)\n@ui(\ntext>"hello"\n)');
    const ctx = extractContext(ast);
    expect(ctx.hasBackend).toBe(false);
  });
});
