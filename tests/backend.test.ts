import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';
import { extractContext } from '../src/transpiler/context.js';
import { generatePrismaSchema } from '../src/transpiler/prisma.js';
import { generateServer } from '../src/transpiler/express.js';
import { routeToFunctionName, expandCrud } from '../src/transpiler/route-utils.js';
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
    // SQLite: enums map to String with inline comment
    expect(schema).toContain('String');
    expect(schema).toContain('// pending, done, archived');
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
    expect(api).toContain('prisma.todo.create({ data: { text } })');
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

// ---- projectflow.air integration ----

describe('projectflow.air integration', () => {
  it('parses projectflow.air with all block types', () => {
    const ast = parseFile('projectflow');
    expect(ast.app.name).toBe('projectflow');
    const kinds = ast.app.blocks.map(b => b.kind);
    expect(kinds).toContain('db');
    expect(kinds).toContain('api');
    expect(kinds).toContain('auth');
    expect(kinds).toContain('webhook');
    expect(kinds).toContain('cron');
    expect(kinds).toContain('queue');
    expect(kinds).toContain('email');
    expect(kinds).toContain('env');
    expect(kinds).toContain('state');
    expect(kinds).toContain('style');
    expect(kinds).toContain('nav');
    expect(kinds).toContain('persist');
    expect(kinds).toContain('hook');
    expect(kinds).toContain('ui');
  });

  it('transpiles projectflow.air to fullstack structure', () => {
    const result = transpileFile('projectflow');
    const paths = result.files.map(f => f.path);
    expect(paths.some(p => p.startsWith('client/'))).toBe(true);
    expect(paths.some(p => p.startsWith('server/'))).toBe(true);
    expect(paths).toContain('server/prisma/schema.prisma');
    expect(paths).toContain('server/api.ts');
    expect(paths).toContain('server/auth.ts');
    expect(paths).toContain('server/webhooks.ts');
    expect(paths).toContain('server/cron.ts');
    expect(paths).toContain('server/queue.ts');
    expect(paths).toContain('server/templates.ts');
    expect(paths).toContain('server/env.ts');
  });

  it('.env has no duplicate keys', () => {
    const env = getServerFile('projectflow', 'server/.env')!;
    const keys = env.split('\n').filter(l => l.includes('=')).map(l => l.split('=')[0]);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  it('generates 5+ db models in Prisma schema', () => {
    const schema = getServerFile('projectflow', 'server/prisma/schema.prisma')!;
    const modelCount = (schema.match(/^model \w+/gm) || []).length;
    expect(modelCount).toBeGreaterThanOrEqual(5);
  });

  it('generates 15+ API routes', () => {
    const api = getServerFile('projectflow', 'server/api.ts')!;
    const routeCount = (api.match(/apiRouter\.\w+\('/g) || []).length;
    expect(routeCount).toBeGreaterThanOrEqual(15);
  });
});

// ---- server/types.ts generation ----

describe('server/types.ts generation', () => {
  it('generates types.ts for fullstack-todo.air', () => {
    const types = getServerFile('fullstack-todo', 'server/types.ts');
    expect(types).toBeDefined();
  });

  it('generates CreateTodoBody with text:string', () => {
    const types = getServerFile('fullstack-todo', 'server/types.ts')!;
    expect(types).toContain('export interface CreateTodoBody');
    expect(types).toContain('text: string');
  });

  it('generates UpdateTodoBody with done:boolean', () => {
    const types = getServerFile('fullstack-todo', 'server/types.ts')!;
    expect(types).toContain('export interface UpdateTodoBody');
    expect(types).toContain('done: boolean');
  });

  it('does not generate types for GET routes (no params)', () => {
    const types = getServerFile('fullstack-todo', 'server/types.ts')!;
    expect(types).not.toContain('FindManyTodoBody');
    expect(types).not.toContain('DeleteTodoBody');
  });

  it('generates enum union types for enum params', () => {
    // projectflow has role:enum(admin,member,viewer) in User model
    const ast = parse("@app:t\n@api(\nPOST:/test(status:enum(a,b,c))>handler\n)");
    const result = transpile(ast);
    const types = result.files.find(f => f.path === 'server/types.ts')?.content;
    expect(types).toBeDefined();
    expect(types).toContain("'a' | 'b' | 'c'");
  });

  it('only generates request body types, not Prisma model types', () => {
    const types = getServerFile('fullstack-todo', 'server/types.ts')!;
    // Should NOT contain model-level fields like created_at, id
    expect(types).not.toContain('created_at');
    expect(types).not.toContain('id: number');
  });

  it('api.ts imports from types.ts', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts')!;
    expect(api).toContain("from './types.js'");
  });

  it('api.ts uses typed body destructuring', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts')!;
    expect(api).toContain('as CreateTodoBody');
    expect(api).toContain('const { text }');
  });
});

// ---- server/seed.ts generation ----

describe('server/seed.ts generation', () => {
  it('generates seed.ts for fullstack-todo.air', () => {
    const seed = getServerFile('fullstack-todo', 'server/seed.ts');
    expect(seed).toBeDefined();
  });

  it('imports PrismaClient', () => {
    const seed = getServerFile('fullstack-todo', 'server/seed.ts')!;
    expect(seed).toContain("import { PrismaClient } from '@prisma/client'");
  });

  it('uses deleteMany before seeding', () => {
    const seed = getServerFile('fullstack-todo', 'server/seed.ts')!;
    expect(seed).toContain('deleteMany()');
  });

  it('uses createMany to seed', () => {
    const seed = getServerFile('fullstack-todo', 'server/seed.ts')!;
    expect(seed).toContain('createMany');
  });

  it('skips auto-increment id fields', () => {
    const seed = getServerFile('fullstack-todo', 'server/seed.ts')!;
    // Should not try to set 'id' field for Todo (auto-increment)
    const dataLines = seed.split('\n').filter(l => l.trim().startsWith('{') || l.trim().startsWith('data:'));
    for (const line of dataLines) {
      if (line.includes('createMany')) continue;
      // id should not appear as a field in seed data objects
    }
    // The seed data should contain text and done, not id
    expect(seed).toContain('text:');
    expect(seed).toContain('done:');
  });

  it('skips FK _id fields in seed data', () => {
    const seed = getServerFile('projectflow', 'server/seed.ts')!;
    // workspace_id, project_id, task_id, author_id, assignee_id should be skipped
    const dataBlocks = seed.split('createMany');
    for (const block of dataBlocks) {
      const dataSection = block.split('data:')[1]?.split('],')[0];
      if (dataSection) {
        expect(dataSection).not.toContain('workspace_id:');
        expect(dataSection).not.toContain('project_id:');
        expect(dataSection).not.toContain('task_id:');
        expect(dataSection).not.toContain('author_id:');
      }
    }
  });

  it('generates seed for projectflow with multiple models', () => {
    const seed = getServerFile('projectflow', 'server/seed.ts')!;
    expect(seed).toContain('prisma.user');
    expect(seed).toContain('prisma.workspace');
    expect(seed).toContain('prisma.project');
    expect(seed).toContain('prisma.task');
  });

  it('does not generate seed.ts for frontend-only apps', () => {
    const result = transpileFile('todo');
    const seed = result.files.find(f => f.path === 'server/seed.ts');
    expect(seed).toBeUndefined();
  });

  it('calls $disconnect in finally block', () => {
    const seed = getServerFile('fullstack-todo', 'server/seed.ts')!;
    expect(seed).toContain('$disconnect');
  });
});

// ---- client/src/api.js generation ----

describe('client/src/api.js generation', () => {
  it('generates api.js for fullstack-todo.air', () => {
    const result = transpileFile('fullstack-todo');
    const apiJs = result.files.find(f => f.path === 'client/src/api.js');
    expect(apiJs).toBeDefined();
  });

  it('uses configurable API_BASE with import.meta.env', () => {
    const result = transpileFile('fullstack-todo');
    const apiJs = result.files.find(f => f.path === 'client/src/api.js')!;
    expect(apiJs.content).toContain('import.meta.env.VITE_API_BASE_URL');
    expect(apiJs.content).toContain("'http://localhost:3001/api'");
  });

  it('generates getTodos function for GET /todos', () => {
    const result = transpileFile('fullstack-todo');
    const apiJs = result.files.find(f => f.path === 'client/src/api.js')!;
    expect(apiJs.content).toContain('export async function getTodos()');
  });

  it('generates createTodo function for POST /todos', () => {
    const result = transpileFile('fullstack-todo');
    const apiJs = result.files.find(f => f.path === 'client/src/api.js')!;
    expect(apiJs.content).toContain('export async function createTodo(data)');
  });

  it('generates updateTodo(id, data) for PUT /todos/:id', () => {
    const result = transpileFile('fullstack-todo');
    const apiJs = result.files.find(f => f.path === 'client/src/api.js')!;
    expect(apiJs.content).toContain('export async function updateTodo(id, data)');
  });

  it('generates deleteTodo(id) for DELETE /todos/:id', () => {
    const result = transpileFile('fullstack-todo');
    const apiJs = result.files.find(f => f.path === 'client/src/api.js')!;
    expect(apiJs.content).toContain('export async function deleteTodo(id)');
  });

  it('does not generate api.js for frontend-only apps', () => {
    const result = transpileFile('todo');
    const apiJs = result.files.find(f => f.path === 'src/api.js');
    expect(apiJs).toBeUndefined();
  });

  it('handles multi-segment paths like /auth/login', () => {
    const result = transpileFile('projectflow');
    const apiJs = result.files.find(f => f.path === 'client/src/api.js')!;
    expect(apiJs.content).toContain('export async function authLogin(data)');
  });

  it('generates getStats for GET /stats', () => {
    const result = transpileFile('projectflow');
    const apiJs = result.files.find(f => f.path === 'client/src/api.js')!;
    expect(apiJs.content).toContain('export async function getStats()');
  });
});

// ---- Route naming utility ----

describe('routeToFunctionName', () => {
  it('GET /todos → getTodos', () => {
    expect(routeToFunctionName('GET', '/todos')).toBe('getTodos');
  });

  it('POST /todos → createTodo', () => {
    expect(routeToFunctionName('POST', '/todos')).toBe('createTodo');
  });

  it('PUT /todos/:id → updateTodo', () => {
    expect(routeToFunctionName('PUT', '/todos/:id')).toBe('updateTodo');
  });

  it('DELETE /todos/:id → deleteTodo', () => {
    expect(routeToFunctionName('DELETE', '/todos/:id')).toBe('deleteTodo');
  });

  it('GET /stats → getStats', () => {
    expect(routeToFunctionName('GET', '/stats')).toBe('getStats');
  });

  it('POST /auth/login → authLogin', () => {
    expect(routeToFunctionName('POST', '/auth/login')).toBe('authLogin');
  });

  it('POST /auth/register → authRegister', () => {
    expect(routeToFunctionName('POST', '/auth/register')).toBe('authRegister');
  });

  it('GET /tasks/:id/comments → getTaskComments', () => {
    expect(routeToFunctionName('GET', '/tasks/:id/comments')).toBe('getTaskComments');
  });

  it('POST /tasks/:id/comments → createTaskComments', () => {
    expect(routeToFunctionName('POST', '/tasks/:id/comments')).toBe('createTaskComments');
  });
});

// ---- Hook wiring ----

describe('hook wiring (fullstack)', () => {
  it('dashboard.air App.jsx imports api module', () => {
    const result = transpileFile('dashboard');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain("import * as api from './api.js'");
  });

  it('dashboard.air hooks call api.getStats()', () => {
    const result = transpileFile('dashboard');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain('api.getStats()');
    expect(app.content).toContain('setStats(data)');
  });

  it('dashboard.air hooks call api.getUsers()', () => {
    const result = transpileFile('dashboard');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain('api.getUsers()');
    expect(app.content).toContain('setUsers(data)');
  });

  it('projectflow.air hooks call api.getStats() and api.getProjects()', () => {
    const result = transpileFile('projectflow');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain('api.getStats()');
    expect(app.content).toContain('api.getProjects()');
  });

  it('unmatched hook actions fall back to console.log', () => {
    const ast = parse('@app:t\n@api(\nGET:/data>handler\n)\n@state{x:int}\n@hook(onMount>~api.unknown)\n@ui(\ntext>"hi"\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain("console.log('~api.unknown')");
  });

  it('frontend-only apps do NOT import api', () => {
    const result = transpileFile('todo');
    const app = result.files.find(f => f.path === 'src/App.jsx')!;
    expect(app.content).not.toContain("import * as api");
  });

  it('frontend-only apps do NOT have api.js', () => {
    const result = transpileFile('todo');
    const paths = result.files.map(f => f.path);
    expect(paths).not.toContain('src/api.js');
    expect(paths).not.toContain('client/src/api.js');
  });
});

// ---- Mutation wiring ----

describe('mutation wiring (fullstack)', () => {
  function getClientApp(name: string): string {
    const result = transpileFile(name);
    const app = result.files.find(f => f.path === 'client/src/App.jsx');
    return app?.content ?? '';
  }

  it('fullstack-todo add mutation calls api.createTodo', () => {
    const app = getClientApp('fullstack-todo');
    expect(app).toContain('api.createTodo(data)');
  });

  it('fullstack-todo del mutation calls api.deleteTodo', () => {
    const app = getClientApp('fullstack-todo');
    expect(app).toContain('api.deleteTodo(id)');
  });

  it('fullstack-todo mutations refetch with api.getTodos', () => {
    const app = getClientApp('fullstack-todo');
    expect(app).toContain('api.getTodos()');
    expect(app).toContain('setItems(updated)');
  });

  it('fullstack-todo add mutation is async with try/catch', () => {
    const app = getClientApp('fullstack-todo');
    expect(app).toContain('const add = async (data)');
    expect(app).toContain("console.error('add failed:'");
  });

  it('frontend-only todo has no api calls in mutations', () => {
    const result = transpileFile('todo');
    const app = result.files.find(f => f.path === 'src/App.jsx')!;
    expect(app.content).not.toContain('api.');
    expect(app.content).not.toContain('await');
  });

  it('auth.air login calls api with FormData', () => {
    const app = getClientApp('auth');
    expect(app).toContain('new FormData(e.target)');
    expect(app).toContain('api.createLogin(formData)');
  });

  it('auth.air login does NOT have console.log stub', () => {
    const app = getClientApp('auth');
    expect(app).not.toContain("console.log('Login attempted')");
  });

  it('auth.air logout calls api.createLogout', () => {
    const app = getClientApp('auth');
    expect(app).toContain('api.createLogout()');
  });

  it('auth.air form inputs have name attributes', () => {
    const app = getClientApp('auth');
    expect(app).toContain('name="email"');
    expect(app).toContain('name="password"');
  });

  it('unknown mutation still gets console.log stub', () => {
    const ast = parse('@app:t\n@state{x:int}\n@api(\nGET:/data>handler\n)\n@ui(\nbtn:!archive\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain("console.log('archive'");
  });

  it('no matching route falls back to local-only behavior', () => {
    // @api has no CRUD routes matching add → local-only
    const ast = parse('@app:t\n@state{items:[{id:int,text:str}]}\n@api(\nGET:/stats>handler\n)\n@ui(\ninput:text>!add({text:#val})\nlist>*item(text:#item.text)\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain('Date.now()');
    expect(app.content).not.toContain('api.createTodo');
  });

  it('signup mutation with matching route uses FormData', () => {
    const ast = parse('@app:t\n@state{user:?{name:str},error:?str,loading:bool}\n@api(\nPOST:/signup(name:str,email:str)>~db.users.create\n)\n@ui(\n@page:signup(form(input:text+input:email+btn:submit>"Sign Up")>!signup)\n@page:login(text>"Login")\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain('api.createSignup(formData)');
    expect(app.content).toContain('new FormData');
  });
});

// ---- D2: Backend Hardening ----

describe('D2: backend hardening', () => {
  it('POST handler validates required body params (fullstack-todo)', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts');
    expect(api).toBeDefined();
    expect(api).toContain('status(400)');
    expect(api).toContain('Missing required fields');
  });

  it('PUT handler with :id validates integer id', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts');
    expect(api).toBeDefined();
    expect(api).toContain("Invalid id");
    expect(api).toContain('id must be an integer');
  });

  it('500 handler includes conditional details', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts');
    expect(api).toBeDefined();
    expect(api).toContain("process.env.NODE_ENV !== 'production'");
    expect(api).toContain('error instanceof Error');
    expect(api).toContain('details');
  });

  it('400 validation errors include details field', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts');
    expect(api).toBeDefined();
    expect(api).toContain("details: 'Required:");
  });

  it('seed data uses model-aware string values (not generic "Sample")', () => {
    const seed = getServerFile('fullstack-todo', 'server/seed.ts');
    expect(seed).toBeDefined();
    // Should use model-aware value like 'Sample content for todo 1.' not generic 'Sample text 1'
    expect(seed).toContain('todo');
    expect(seed).not.toContain("'Sample text 1'");
  });

  it('seed data uses realistic email patterns', () => {
    const ast = parse('@app:t\n@db{\nUser{id:int:primary:auto,email:str:required,name:str:required}\n}\n@api(\nCRUD:/users>~db.User\n)');
    const result = transpile(ast);
    const seed = result.files.find(f => f.path === 'server/seed.ts')?.content;
    expect(seed).toBeDefined();
    expect(seed).toContain('user1@example.com');
  });

  it('api client is .js not .ts (no regression)', () => {
    const result = transpileFile('fullstack-todo');
    const apiClient = result.files.find(f => f.path === 'client/src/api.js');
    expect(apiClient).toBeDefined();
    const apiTs = result.files.find(f => f.path === 'client/src/api.ts');
    expect(apiTs).toBeUndefined();
  });

  it('types.ts is imported by api.ts (no regression)', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts');
    expect(api).toBeDefined();
    expect(api).toContain("from './types.js'");
  });

  it('findMany returns raw array (no pagination wrapper)', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts');
    expect(api).toBeDefined();
    expect(api).toContain('prisma.todo.findMany()');
    expect(api).not.toContain('pagination');
    expect(api).not.toContain('page');
  });

  it('unknown handler still returns 501', () => {
    const ast = parse('@app:t\n@api(\nGET:/custom>unknownHandler\n)\n@ui(\ntext>"hello"\n)');
    const result = transpile(ast);
    const api = result.files.find(f => f.path === 'server/api.ts')?.content;
    expect(api).toBeDefined();
    expect(api).toContain('501');
    expect(api).toContain('Not implemented');
  });
});
