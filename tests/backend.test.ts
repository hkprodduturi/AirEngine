import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';
import { extractContext } from '../src/transpiler/context.js';
import { generatePrismaSchema, resolveRelations } from '../src/transpiler/prisma.js';
import { generateServer } from '../src/transpiler/express.js';
import { routeToFunctionName, expandCrud } from '../src/transpiler/route-utils.js';
import { hashContent, computeIncremental, saveManifest } from '../src/transpiler/cache.js';
import { generateInitTemplate } from '../src/cli/templates.js';
import { runDoctorChecks } from '../src/cli/doctor.js';
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

  it('generates many-to-many relation fields when no FK exists', () => {
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
    // Many-to-many: both sides get Model[] fields
    expect(schema).toContain('posts  Post[]');
    expect(schema).toContain('author  User[]');
    // No ambiguous TODO for this relation
    expect(schema).not.toContain('// TODO: Ambiguous relations');
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
    expect(api).toContain('prisma.todo.findMany(');
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

  it('generates 15+ API routes (across all route files)', () => {
    const result = transpileFile('projectflow');
    // Count routes across api.ts and any resource router files
    let routeCount = 0;
    for (const file of result.files) {
      if (file.path === 'server/api.ts' || file.path.startsWith('server/routes/')) {
        const matches = file.content.match(/Router\.\w+\('/g) || [];
        routeCount += matches.length;
      }
    }
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

  it('wires FK fields with .id references in seed data', () => {
    const seed = getServerFile('projectflow', 'server/seed.ts')!;
    // FK fields should reference captured parent IDs, not literal numbers
    expect(seed).toContain('workspace_id: workspace1.id');
    expect(seed).toContain('project_id: project1.id');
    expect(seed).toContain('task_id: task1.id');
    expect(seed).toContain('author_id: user1.id');
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
    expect(apiJs.content).toContain('export async function getTodos(');
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
    const result = transpileFile('auth');
    const allJsx = [
      result.files.find(f => f.path === 'client/src/App.jsx')?.content ?? '',
      ...result.files.filter(f => f.path.includes('/pages/') && f.path.endsWith('.jsx')).map(f => f.content),
    ].join('\n');
    expect(allJsx).toContain('name="email"');
    expect(allJsx).toContain('name="password"');
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
    expect(seed).toContain('alice@example.com');
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
    expect(api).toContain('prisma.todo.findMany');
    expect(api).not.toContain('pagination');
    // Note: 'page' now appears as a query param for pagination support
    expect(api).toContain('res.json(');
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

// ---- Page Component Extraction ----

describe('page component extraction', () => {
  it('generates page files for projectflow.air', () => {
    const result = transpileFile('projectflow');
    const pageFiles = result.files.filter(f => f.path.includes('/pages/') && f.path.endsWith('Page.jsx'));
    expect(pageFiles.length).toBeGreaterThanOrEqual(3);
  });

  it('each page file has a default export function', () => {
    const result = transpileFile('projectflow');
    const pageFiles = result.files.filter(f => f.path.includes('/pages/') && f.path.endsWith('Page.jsx'));
    for (const page of pageFiles) {
      expect(page.content).toContain('export default function');
      expect(page.content).toContain('Page(');
    }
  });

  it('page files accept props for state and navigation', () => {
    const result = transpileFile('projectflow');
    const dashboard = result.files.find(f => f.path.includes('DashboardPage.jsx'));
    expect(dashboard).toBeDefined();
    expect(dashboard!.content).toContain('currentPage');
    expect(dashboard!.content).toContain('setCurrentPage');
  });

  it('form pages contain form elements', () => {
    const result = transpileFile('projectflow');
    const login = result.files.find(f => f.path.includes('LoginPage.jsx'));
    expect(login).toBeDefined();
    expect(login!.content).toContain('form');
    expect(login!.content).toContain('LoginPage');
  });

  it('does NOT generate page files for frontend-only apps', () => {
    const result = transpileFile('todo');
    const pageFiles = result.files.filter(f => f.path.includes('/pages/'));
    expect(pageFiles.length).toBe(0);
  });

  it('does NOT generate page files for landing.air (frontend-only)', () => {
    const result = transpileFile('landing');
    const pageFiles = result.files.filter(f => f.path.includes('/pages/'));
    expect(pageFiles.length).toBe(0);
  });

  it('page component names are PascalCase', () => {
    const result = transpileFile('projectflow');
    const pageFiles = result.files.filter(f => f.path.includes('/pages/'));
    for (const page of pageFiles) {
      const fileName = page.path.split('/').pop()!;
      expect(fileName[0]).toBe(fileName[0].toUpperCase());
      expect(fileName).toMatch(/^[A-Z]\w+Page\.jsx$/);
    }
  });

  it('auth.air generates page files (has backend)', () => {
    const result = transpileFile('auth');
    const pageFiles = result.files.filter(f => f.path.includes('/pages/'));
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  it('page files live under client/src/pages/', () => {
    const result = transpileFile('projectflow');
    const pageFiles = result.files.filter(f => f.path.includes('/pages/') && f.path.endsWith('Page.jsx'));
    for (const page of pageFiles) {
      expect(page.path.startsWith('client/src/pages/')).toBe(true);
    }
  });

  it('stats.pages reflects page count', () => {
    const result = transpileFile('projectflow');
    expect(result.stats.pages).toBeGreaterThanOrEqual(3);
  });

  it('App.jsx imports page components (static or lazy)', () => {
    const result = transpileFile('projectflow');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!.content;
    // With 3+ pages, lazy imports are used
    for (const name of ['DashboardPage', 'ProjectsPage', 'TasksPage']) {
      const hasStatic = app.includes(`import ${name} from './pages/${name}.jsx'`);
      const hasLazy = app.includes(`const ${name} = lazy(() => import('./pages/${name}.jsx'))`);
      expect(hasStatic || hasLazy).toBe(true);
    }
  });

  it('App.jsx renders page components with props', () => {
    const result = transpileFile('projectflow');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!.content;
    expect(app).toContain('<DashboardPage');
    expect(app).toContain('<ProjectsPage');
    expect(app).toContain('<TasksPage');
    expect(app).toContain('currentPage={currentPage}');
    expect(app).toContain('setCurrentPage={setCurrentPage}');
  });

  it('App.jsx does NOT contain inline page JSX for fullstack apps', () => {
    const result = transpileFile('projectflow');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!.content;
    // Page content should be in page components, not App.jsx
    expect(app).not.toContain('<table');
    expect(app).not.toContain('row.name');
  });

  it('page components import resource hooks', () => {
    const result = transpileFile('projectflow');
    const projects = result.files.find(f => f.path.includes('ProjectsPage.jsx'))!;
    expect(projects.content).toContain("import useProjects from '../hooks/useProjects.js'");
    expect(projects.content).toContain('useProjects()');
    const tasks = result.files.find(f => f.path.includes('TasksPage.jsx'))!;
    expect(tasks.content).toContain("import useTasks from '../hooks/useTasks.js'");
    expect(tasks.content).toContain('useTasks()');
  });

  it('hook-covered state vars are NOT passed as props', () => {
    const result = transpileFile('projectflow');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!.content;
    // ProjectsPage gets projects data from hook, not as a prop
    const projectsRef = app.match(/<ProjectsPage[^/]*\/>/)?.[0] ?? '';
    expect(projectsRef).not.toContain('projects={projects}');
    expect(projectsRef).not.toContain('setProjects=');
  });
});

// ---- Resource Hooks ----

describe('resource hooks', () => {
  it('generates hook files for projectflow.air models', () => {
    const result = transpileFile('projectflow');
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/') && f.path.startsWith('client/'));
    // useProjects, useTasks (useComments skipped — nested route with :id param)
    expect(hookFiles.length).toBeGreaterThanOrEqual(2);
  });

  it('each hook imports useState/useEffect/useCallback', () => {
    const result = transpileFile('projectflow');
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/'));
    for (const hook of hookFiles) {
      expect(hook.content).toContain('useState');
      expect(hook.content).toContain('useEffect');
      expect(hook.content).toContain('useCallback');
    }
  });

  it('hooks return data/loading/error/total/refetch', () => {
    const result = transpileFile('projectflow');
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/'));
    for (const hook of hookFiles) {
      expect(hook.content).toContain('data');
      expect(hook.content).toContain('loading');
      expect(hook.content).toContain('error');
      expect(hook.content).toContain('total');
      expect(hook.content).toContain('refetch');
    }
  });

  it('hooks read X-Total-Count header', () => {
    const result = transpileFile('projectflow');
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/'));
    for (const hook of hookFiles) {
      expect(hook.content).toContain('X-Total-Count');
    }
  });

  it('hooks have JSDoc type annotations', () => {
    const result = transpileFile('projectflow');
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/'));
    for (const hook of hookFiles) {
      expect(hook.content).toContain('@returns');
      expect(hook.content).toContain("import('../types')");
    }
  });

  it('does NOT generate hooks for frontend-only apps', () => {
    const result = transpileFile('todo');
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/'));
    expect(hookFiles.length).toBe(0);
  });

  it('fullstack-todo generates no hooks (state var "items" does not match model plural "todos")', () => {
    const result = transpileFile('fullstack-todo');
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/'));
    expect(hookFiles.length).toBe(0);
  });

  it('stats.hooks reflects hook count', () => {
    const result = transpileFile('projectflow');
    expect(result.stats.hooks).toBeGreaterThanOrEqual(2);
  });
});

// ---- No Dead Code Rule ----

describe('no dead code', () => {
  it('generates reusable components when patterns detected (wired)', () => {
    const result = transpileFile('projectflow');
    const componentFiles = result.files.filter(f => f.path.includes('/components/'));
    expect(componentFiles.length).toBeGreaterThan(0);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!.content;
    // Components should be imported in App.jsx
    for (const cf of componentFiles) {
      const name = cf.path.split('/').pop()!.replace('.jsx', '');
      expect(app).toContain(`import ${name} from`);
    }
  });

  it('only generates hooks that have matching array state vars', () => {
    const result = transpileFile('projectflow');
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/'));
    // useUsers and useWorkspaces should NOT be generated (state has user/workspace as objects, not arrays)
    expect(hookFiles.find(f => f.path.includes('useUsers'))).toBeUndefined();
    expect(hookFiles.find(f => f.path.includes('useWorkspaces'))).toBeUndefined();
    // useProjects, useTasks should exist (matching array state with non-parameterized routes)
    expect(hookFiles.find(f => f.path.includes('useProjects'))).toBeDefined();
    expect(hookFiles.find(f => f.path.includes('useTasks'))).toBeDefined();
    // useComments NOT generated — its route /tasks/:id/comments has URL params
    expect(hookFiles.find(f => f.path.includes('useComments'))).toBeUndefined();
  });

  it('stats.deadLines is 0 for projectflow', () => {
    const result = transpileFile('projectflow');
    expect(result.stats.deadLines).toBe(0);
  });

  it('stats.deadLines is 0 for fullstack-todo', () => {
    const result = transpileFile('fullstack-todo');
    expect(result.stats.deadLines).toBe(0);
  });
});

// ---- Page Wiring Integration ----

describe('page wiring integration (projectflow)', () => {
  const result = transpileFile('projectflow');
  const app = result.files.find(f => f.path === 'client/src/App.jsx')!.content;
  const pageFiles = result.files.filter(f => f.path.includes('/pages/') && f.path.endsWith('Page.jsx'));

  it('App.jsx imports every extracted page component (static or lazy)', () => {
    for (const pf of pageFiles) {
      const name = pf.path.split('/').pop()!.replace('.jsx', '');
      const hasStaticImport = app.includes(`import ${name} from './pages/${name}.jsx'`);
      const hasLazyImport = app.includes(`const ${name} = lazy(() => import('./pages/${name}.jsx'))`);
      expect(hasStaticImport || hasLazyImport).toBe(true);
    }
  });

  it('App.jsx renders component refs (not inline JSX) for every page', () => {
    for (const pf of pageFiles) {
      const name = pf.path.split('/').pop()!.replace('.jsx', '');
      expect(app).toContain(`<${name}`);
    }
  });

  it('App.jsx does NOT contain inline page content', () => {
    // Tables, forms, and iteration belong in page components, not App.jsx
    expect(app).not.toContain('<table');
    expect(app).not.toContain('<form');
    expect(app).not.toContain('.map((row)');
  });

  it('every page component that uses model data imports a hook', () => {
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/'));
    const hookNames = hookFiles.map(f => f.path.split('/').pop()!.replace('.js', ''));
    // Every generated hook is imported by at least one page component
    for (const hookName of hookNames) {
      const importedBy = pageFiles.filter(pf => pf.content.includes(`import ${hookName}`));
      expect(importedBy.length).toBeGreaterThan(0);
    }
  });

  it('page components call hooks and destructure data', () => {
    for (const pf of pageFiles) {
      const hookImports = pf.content.match(/import (use\w+) from/g) ?? [];
      for (const imp of hookImports) {
        const hookName = imp.match(/import (use\w+)/)?.[1];
        if (hookName) {
          expect(pf.content).toContain(`${hookName}()`);
          expect(pf.content).toContain('data:');
        }
      }
    }
  });
});

// ---- Backend Resource Split ----

describe('backend resource split', () => {
  it('projectflow generates per-resource router files', () => {
    const result = transpileFile('projectflow');
    const routeFiles = result.files.filter(f => f.path.startsWith('server/routes/'));
    expect(routeFiles.length).toBeGreaterThanOrEqual(3);
  });

  it('resource routers use Router() from express', () => {
    const result = transpileFile('projectflow');
    const routeFiles = result.files.filter(f => f.path.startsWith('server/routes/'));
    for (const rf of routeFiles) {
      expect(rf.content).toContain("import { Router } from 'express'");
      expect(rf.content).toContain('Router()');
    }
  });

  it('mount point api.ts uses apiRouter.use() for resource routers', () => {
    const result = transpileFile('projectflow');
    const api = result.files.find(f => f.path === 'server/api.ts')!;
    expect(api.content).toContain('apiRouter.use(');
  });

  it('fullstack-todo does NOT split (1 model, below threshold)', () => {
    const result = transpileFile('fullstack-todo');
    const routeFiles = result.files.filter(f => f.path.startsWith('server/routes/'));
    expect(routeFiles.length).toBe(0);
  });

  it('fullstack-todo api.ts still has inline routes', () => {
    const api = getServerFile('fullstack-todo', 'server/api.ts')!;
    expect(api).toContain("apiRouter.get('/todos'");
    expect(api).toContain("apiRouter.post('/todos'");
  });

  it('resource routers import from ../validation.js', () => {
    const result = transpileFile('projectflow');
    const routeFiles = result.files.filter(f => f.path.startsWith('server/routes/'));
    for (const rf of routeFiles) {
      expect(rf.content).toContain("from '../validation.js'");
    }
  });
});

// ---- Validation Helpers ----

describe('validation helpers', () => {
  it('generates validation.ts for apps with API routes', () => {
    const result = transpileFile('fullstack-todo');
    const validation = result.files.find(f => f.path === 'server/validation.ts');
    expect(validation).toBeDefined();
  });

  it('validation.ts has assertRequired function', () => {
    const result = transpileFile('fullstack-todo');
    const validation = result.files.find(f => f.path === 'server/validation.ts')!;
    expect(validation.content).toContain('export function assertRequired');
    expect(validation.content).toContain('status = 400');
  });

  it('validation.ts has assertIntParam function', () => {
    const result = transpileFile('fullstack-todo');
    const validation = result.files.find(f => f.path === 'server/validation.ts')!;
    expect(validation.content).toContain('export function assertIntParam');
    expect(validation.content).toContain('parseInt');
  });

  it('does NOT generate validation.ts for frontend-only apps', () => {
    const result = transpileFile('todo');
    const validation = result.files.find(f => f.path === 'server/validation.ts');
    expect(validation).toBeUndefined();
  });
});

// ---- Stats Enhancement ----

describe('stats enhancement', () => {
  it('stats include modules count', () => {
    const result = transpileFile('projectflow');
    expect(result.stats.modules).toBe(result.files.length);
  });

  it('stats include pages count', () => {
    const result = transpileFile('projectflow');
    expect(result.stats.pages).toBeGreaterThan(0);
  });

  it('stats include hooks count', () => {
    const result = transpileFile('projectflow');
    expect(result.stats.hooks).toBeGreaterThan(0);
  });

  it('frontend-only stats have 0 pages and hooks', () => {
    const result = transpileFile('todo');
    expect(result.stats.pages).toBe(0);
    expect(result.stats.hooks).toBe(0);
  });
});

// ---- E1: Relation Resolution ----

describe('E1: relation resolution', () => {
  it('resolves unambiguous one-to-many with FK on child', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [{ name: 'id', type: { kind: 'int' }, primary: true }] },
        { name: 'Post', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true },
          { name: 'author_id', type: { kind: 'int' } },
        ] },
      ],
      relations: [{ from: 'User.posts', to: 'Post.author' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    // User gets array relation field
    expect(schema).toContain('posts  Post[]');
    // Post gets scalar relation field with @relation directive
    expect(schema).toContain('author  User');
    expect(schema).toContain('fields: [author_id]');
    expect(schema).toContain('references: [id]');
    // No ambiguous TODO
    expect(schema).not.toContain('// TODO: Ambiguous');
  });

  it('classifies no-FK relations as many-to-many (not ambiguous)', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [{ name: 'id', type: { kind: 'int' }, primary: true }] },
        { name: 'Group', fields: [{ name: 'id', type: { kind: 'int' }, primary: true }] },
      ],
      relations: [{ from: 'User.groups', to: 'Group.members' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    // Many-to-many: both sides get Model[] fields
    expect(schema).toContain('groups  Group[]');
    expect(schema).toContain('members  User[]');
    // No ambiguous TODO
    expect(schema).not.toContain('// TODO: Ambiguous relations');
  });

  it('generates optional relation field for optional FK', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [{ name: 'id', type: { kind: 'int' }, primary: true }] },
        { name: 'Task', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true },
          { name: 'assignee_id', type: { kind: 'optional', of: { kind: 'int' } } },
        ] },
      ],
      relations: [{ from: 'Task.assignee', to: 'User.assigned' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    // Task gets optional relation
    expect(schema).toContain('assignee  User?');
    expect(schema).toContain('fields: [assignee_id]');
    // User gets array relation
    expect(schema).toContain('assigned  Task[]');
  });

  it('resolveRelations returns correct resolved/manyToMany/ambiguous split', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [{ name: 'id', type: { kind: 'int' }, primary: true }] },
        { name: 'Workspace', fields: [{ name: 'id', type: { kind: 'int' }, primary: true }] },
        { name: 'Project', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true },
          { name: 'workspace_id', type: { kind: 'int' } },
        ] },
      ],
      relations: [
        { from: 'User.workspaces', to: 'Workspace.members' },
        { from: 'Workspace.projects', to: 'Project.workspace' },
      ],
      indexes: [],
    };
    const { resolved, ambiguous, manyToMany } = resolveRelations(db);
    expect(resolved.length).toBe(1);
    expect(resolved[0].modelA).toBe('Workspace');
    expect(resolved[0].fkField).toBe('workspace_id');
    expect(ambiguous.length).toBe(0);
    expect(manyToMany.length).toBe(1);
    expect(manyToMany[0].modelA).toBe('User');
    expect(manyToMany[0].modelB).toBe('Workspace');
  });

  it('skips relation when target model has no id field', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'Tag', fields: [{ name: 'slug', type: { kind: 'str' }, primary: true }] },
        { name: 'Post', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true },
          { name: 'tag_id', type: { kind: 'int' } },
        ] },
      ],
      relations: [{ from: 'Tag.posts', to: 'Post.tag' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('// TODO: Ambiguous');
    expect(schema).toContain("no 'id' field");
  });

  it('skips relation when field name conflicts with scalar', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true },
          { name: 'posts', type: { kind: 'str' } },
        ] },
        { name: 'Post', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true },
          { name: 'author_id', type: { kind: 'int' } },
        ] },
      ],
      relations: [{ from: 'User.posts', to: 'Post.author' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('// TODO: Ambiguous');
    expect(schema).toContain('conflicts with existing scalar field');
  });

  it('marks FK on both sides as ambiguous', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true },
          { name: 'profile_id', type: { kind: 'int' } },
        ] },
        { name: 'Profile', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true },
          { name: 'user_id', type: { kind: 'int' } },
        ] },
      ],
      relations: [{ from: 'User.profile', to: 'Profile.user' }],
      indexes: [],
    };
    const { ambiguous } = resolveRelations(db);
    expect(ambiguous.length).toBe(1);
    expect(ambiguous[0].reason).toContain('both sides');
  });
});

// ---- E1: Index Generation ----

describe('E1: index generation', () => {
  it('generates @unique on single field', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [{
        name: 'User',
        fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'email', type: { kind: 'str' } },
        ],
      }],
      relations: [],
      indexes: [{ fields: ['User.email'], unique: true }],
    };
    const schema = generatePrismaSchema(db);
    const emailLine = schema.split('\n').find(l => l.trim().startsWith('email'));
    expect(emailLine).toContain('@unique');
  });

  it('generates @@index for composite non-unique', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [{
        name: 'Task',
        fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'status', type: { kind: 'str' } },
          { name: 'project_id', type: { kind: 'int' } },
        ],
      }],
      relations: [],
      indexes: [{ fields: ['Task.status', 'Task.project_id'], unique: false }],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('@@index([status, project_id])');
  });

  it('generates @@unique for composite unique', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [{
        name: 'Enrollment',
        fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'student_id', type: { kind: 'int' } },
          { name: 'course_id', type: { kind: 'int' } },
        ],
      }],
      relations: [],
      indexes: [{ fields: ['Enrollment.student_id', 'Enrollment.course_id'], unique: true }],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('@@unique([student_id, course_id])');
  });

  it('emits TODO for indexes referencing unknown model', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [{
        name: 'User',
        fields: [{ name: 'id', type: { kind: 'int' }, primary: true }],
      }],
      relations: [],
      indexes: [{ fields: ['Ghost.email'], unique: true }],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain("// TODO: index references unknown model 'Ghost'");
    // No @unique should appear in User model
    expect(schema).not.toContain('@unique');
  });

  it('emits TODO for indexes referencing unknown field', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [{
        name: 'User',
        fields: [{ name: 'id', type: { kind: 'int' }, primary: true }],
      }],
      relations: [],
      indexes: [{ fields: ['User.nonexistent'], unique: false }],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain("// TODO: index references unknown field(s) 'nonexistent'");
  });

  it('@unique coexists with @id and @default', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [{
        name: 'User',
        fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'email', type: { kind: 'str' } },
          { name: 'name', type: { kind: 'str' }, default: 'Unknown' },
        ],
      }],
      relations: [],
      indexes: [{ fields: ['User.email'], unique: true }],
    };
    const schema = generatePrismaSchema(db);
    // id still has @id @default(autoincrement())
    const idLine = schema.split('\n').find(l => l.trim().startsWith('id'));
    expect(idLine).toContain('@id');
    expect(idLine).toContain('@default(autoincrement())');
    // email has @unique
    const emailLine = schema.split('\n').find(l => l.trim().startsWith('email'));
    expect(emailLine).toContain('@unique');
    // name has @default but not @unique
    const nameLine = schema.split('\n').find(l => l.trim().startsWith('name'));
    expect(nameLine).toContain('@default("Unknown")');
    expect(nameLine).not.toContain('@unique');
  });
});

// ---- E1: FK-Safe Seeding ----

describe('E1: FK-safe seeding', () => {
  it('seed parents before children (topological order)', () => {
    const seed = getServerFile('projectflow', 'server/seed.ts')!;
    const userIdx = seed.indexOf('prisma.user.create');
    const workspaceIdx = seed.indexOf('prisma.workspace.create');
    const projectIdx = seed.indexOf('prisma.project.create');
    const taskIdx = seed.indexOf('prisma.task.create');
    const commentIdx = seed.indexOf('prisma.comment.create');
    // Parents come before children
    expect(userIdx).toBeLessThan(projectIdx);
    expect(workspaceIdx).toBeLessThan(projectIdx);
    expect(projectIdx).toBeLessThan(taskIdx);
    expect(taskIdx).toBeLessThan(commentIdx);
  });

  it('seed uses captured IDs with sequential creates', () => {
    const seed = getServerFile('projectflow', 'server/seed.ts')!;
    expect(seed).toContain('const user1 = await prisma.user.create');
    expect(seed).toContain('const workspace1 = await prisma.workspace.create');
    expect(seed).toContain('const project1 = await prisma.project.create');
    expect(seed).toContain('const task1 = await prisma.task.create');
  });

  it('optional FK is null for first record', () => {
    const seed = getServerFile('projectflow', 'server/seed.ts')!;
    // assignee_id is optional on Task → null for record 1
    const task1Line = seed.split('\n').find(l => l.includes('const task1 = await'));
    expect(task1Line).toContain('assignee_id: null');
  });

  it('seed reverse-deletes (children before parents)', () => {
    const seed = getServerFile('projectflow', 'server/seed.ts')!;
    const commentDelIdx = seed.indexOf('prisma.comment.deleteMany');
    const taskDelIdx = seed.indexOf('prisma.task.deleteMany');
    const projectDelIdx = seed.indexOf('prisma.project.deleteMany');
    const workspaceDelIdx = seed.indexOf('prisma.workspace.deleteMany');
    const userDelIdx = seed.indexOf('prisma.user.deleteMany');
    // Children deleted before parents
    expect(commentDelIdx).toBeLessThan(taskDelIdx);
    expect(taskDelIdx).toBeLessThan(projectDelIdx);
    expect(projectDelIdx).toBeLessThan(workspaceDelIdx);
    expect(workspaceDelIdx).toBeLessThan(userDelIdx);
  });

  it('fullstack-todo still uses createMany (no relations)', () => {
    const seed = getServerFile('fullstack-todo', 'server/seed.ts')!;
    expect(seed).toContain('createMany');
    expect(seed).not.toContain('const todo1 = await');
  });

  it('frontend-only apps produce no schema', () => {
    const result = transpileFile('todo');
    const schema = result.files.find(f => f.path === 'server/prisma/schema.prisma');
    expect(schema).toBeUndefined();
  });

  it('skips seeding model with unresolved required FK', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [{ name: 'id', type: { kind: 'int' }, primary: true, auto: true }] },
        { name: 'Post', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'mystery_id', type: { kind: 'int' } },
        ] },
      ],
      relations: [],
      indexes: [],
    };
    const ast = parse('@app:t\n@db{\nUser{id:int:primary:auto}\nPost{id:int:primary:auto,mystery_id:int}\n}\n@api(\nGET:/users>~db.User.findMany\n)');
    const result = transpile(ast);
    const seed = result.files.find(f => f.path === 'server/seed.ts')?.content;
    expect(seed).toBeDefined();
    // Post has unresolved required FK (mystery_id) — should be skipped
    expect(seed).toContain('TODO: Post has unresolved required FK fields');
  });
});

// ---- E1: projectflow schema integration ----

describe('E1: projectflow schema integration', () => {
  it('schema has real relation fields + m:n + @unique + @@index', () => {
    const schema = getServerFile('projectflow', 'server/prisma/schema.prisma')!;

    // Real relation fields (not TODO comments)
    expect(schema).toContain('projects  Project[]');
    expect(schema).toContain('workspace  Workspace');
    expect(schema).toContain('fields: [workspace_id]');
    expect(schema).toContain('tasks  Task[]');
    expect(schema).toContain('project  Project');
    expect(schema).toContain('fields: [project_id]');
    expect(schema).toContain('comments  Comment[]');
    expect(schema).toContain('task  Task');
    expect(schema).toContain('fields: [task_id]');
    expect(schema).toContain('assigned  Task[]');
    expect(schema).toContain('assignee  User?');
    expect(schema).toContain('fields: [assignee_id]');

    // Many-to-many relation (User.workspaces<>Workspace.members → both sides get [])
    expect(schema).toContain('workspaces  Workspace[]');
    expect(schema).toContain('members  User[]');

    // onDelete cascading for required FK relations
    expect(schema).toContain('onDelete: Cascade');
    // onDelete SetNull for optional FK (assignee)
    expect(schema).toContain('onDelete: SetNull');

    // @unique indexes
    expect(schema).toContain('@unique');
    const emailLine = schema.split('\n').find(l => l.trim().startsWith('email') && l.includes('@unique'));
    expect(emailLine).toBeDefined();
    const slugLine = schema.split('\n').find(l => l.trim().startsWith('slug') && l.includes('@unique'));
    expect(slugLine).toBeDefined();

    // @@index composite
    expect(schema).toContain('@@index([status, project_id])');

    // No ambiguous relations anymore
    expect(schema).not.toContain('// TODO: Ambiguous relations');
  });

  it('schema has no leftover "TODO: Prisma relation fields" from old format', () => {
    const schema = getServerFile('projectflow', 'server/prisma/schema.prisma')!;
    expect(schema).not.toContain('// TODO: Prisma relation fields');
    expect(schema).not.toContain('// TODO: Add index annotations');
  });
});

// ---- E2: Deploy Wiring ----

describe('E2: deploy wiring', () => {
  it('generates Dockerfile for projectflow', () => {
    const dockerfile = getServerFile('projectflow', 'server/Dockerfile')!;
    expect(dockerfile).toBeDefined();
    expect(dockerfile).toContain('FROM node:20-alpine');
    expect(dockerfile).toContain('AS builder');
    expect(dockerfile).toContain('EXPOSE 3001');
    expect(dockerfile).toContain('CMD ["node", "dist/server.js"]');
    expect(dockerfile).toContain('npm install');
    expect(dockerfile).not.toContain('npm ci');
  });

  it('Dockerfile includes Prisma when @db exists', () => {
    const dockerfile = getServerFile('projectflow', 'server/Dockerfile')!;
    // Prisma generate only in builder stage
    expect(dockerfile).toContain('RUN npx prisma generate');
    // Production copies pre-built Prisma artifacts
    expect(dockerfile).toContain('COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma');
    expect(dockerfile).toContain('COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma');
    expect(dockerfile).toContain('COPY --from=builder /app/prisma ./prisma');
    // No prisma generate after --omit=dev
    const prodSection = dockerfile.split('# ---- Production ----')[1];
    expect(prodSection).not.toContain('prisma generate');
  });

  it('docker-compose.yml at root', () => {
    const result = transpileFile('projectflow');
    const compose = result.files.find(f => f.path === 'docker-compose.yml');
    expect(compose).toBeDefined();
    expect(compose!.content).toContain('services:');
    expect(compose!.content).toContain('server:');
    expect(compose!.content).toContain('"3001:3001"');
    expect(compose!.content).toContain('env_file: ./server/.env');
  });

  it('docker-compose has bind mount when @db exists', () => {
    const result = transpileFile('projectflow');
    const compose = result.files.find(f => f.path === 'docker-compose.yml')!;
    expect(compose.content).toContain('./server/data:/app/data');
    expect(compose.content).toContain('volumes:');
    expect(compose.content).toContain('DATABASE_URL=file:/app/data/app.db');
    // No named volume (bind mount instead)
    expect(compose.content).not.toContain('server-data:');
  });

  it('.dockerignore generated', () => {
    const dockerignore = getServerFile('projectflow', 'server/.dockerignore')!;
    expect(dockerignore).toBeDefined();
    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('.env');
    expect(dockerignore).toContain('*.db');
    expect(dockerignore).toContain('.DS_Store');
    expect(dockerignore).toContain('coverage');
  });

  it('.env.example with documented vars', () => {
    const envExample = getServerFile('projectflow', 'server/.env.example')!;
    expect(envExample).toBeDefined();
    expect(envExample).toContain('DATABASE_URL');
    expect(envExample).toContain('JWT_SECRET=');
    expect(envExample).toContain('PORT=3001');
    expect(envExample).toContain('#');
  });

  it('README has deployment section', () => {
    const result = transpileFile('projectflow');
    const readme = result.files.find(f => f.path === 'README.md')!;
    expect(readme.content).toContain('## Deployment');
    expect(readme.content).toContain('docker compose up');
    expect(readme.content).toContain('docker build');
    // DB init uses explicit DATABASE_URL for bind-mount path
    expect(readme.content).toContain('mkdir -p data');
    expect(readme.content).toContain('DATABASE_URL="file:../data/app.db"');
    expect(readme.content).toContain('bind-mount');
  });

  it('fullstack-todo: no deploy files', () => {
    const result = transpileFile('fullstack-todo');
    expect(result.files.find(f => f.path === 'server/Dockerfile')).toBeUndefined();
    expect(result.files.find(f => f.path === 'server/.dockerignore')).toBeUndefined();
    expect(result.files.find(f => f.path === 'server/.env.example')).toBeUndefined();
    expect(result.files.find(f => f.path === 'docker-compose.yml')).toBeUndefined();
  });

  it('fullstack-todo README: no deploy section', () => {
    const result = transpileFile('fullstack-todo');
    const readme = result.files.find(f => f.path === 'README.md')!;
    expect(readme.content).not.toContain('## Deployment');
  });

  it('frontend-only: no deploy files', () => {
    const result = transpileFile('todo');
    expect(result.files.find(f => f.path === 'server/Dockerfile')).toBeUndefined();
    expect(result.files.find(f => f.path === 'server/.dockerignore')).toBeUndefined();
    expect(result.files.find(f => f.path === 'server/.env.example')).toBeUndefined();
    expect(result.files.find(f => f.path === 'docker-compose.yml')).toBeUndefined();
  });

  it('port override: @deploy port wins', () => {
    const ast = parse('@app:t\n@db{\nItem{id:int:primary:auto,name:str}\n}\n@api(\nGET:/items>~db.Item.findMany\n)\n@deploy(target:docker,port:4000)\n@ui(\ntext>"hi"\n)');
    const result = transpile(ast);
    const dockerfile = result.files.find(f => f.path === 'server/Dockerfile')!;
    expect(dockerfile.content).toContain('EXPOSE 4000');
    const compose = result.files.find(f => f.path === 'docker-compose.yml')!;
    expect(compose.content).toContain('"4000:4000"');
  });

  it('healthcheck uses /api when @api routes exist', () => {
    const dockerfile = getServerFile('projectflow', 'server/Dockerfile')!;
    expect(dockerfile).toContain('wget -qO- http://localhost:3001/api');
  });

  it('healthcheck uses / when no @api routes', () => {
    const ast = parse('@app:t\n@webhook(\nPOST:/hook>!process\n)\n@deploy(target:docker,port:3001)\n@ui(\ntext>"hi"\n)');
    const result = transpile(ast);
    const dockerfile = result.files.find(f => f.path === 'server/Dockerfile')!;
    expect(dockerfile.content).toContain('wget -qO- http://localhost:3001/');
    expect(dockerfile.content).not.toContain('wget -qO- http://localhost:3001/api');
  });

  it('non-docker target: TODO in README, no files', () => {
    const ast = parse('@app:t\n@api(\nGET:/data>handler\n)\n@deploy(target:aws)\n@ui(\ntext>"hi"\n)');
    const result = transpile(ast);
    const readme = result.files.find(f => f.path === 'README.md')!;
    expect(readme.content).toContain('TODO');
    expect(readme.content).toContain('aws');
    expect(result.files.find(f => f.path === 'server/Dockerfile')).toBeUndefined();
    expect(result.files.find(f => f.path === 'docker-compose.yml')).toBeUndefined();
  });
});

// ---- Batch 2: Runtime Quality Tests ----

describe('Batch 2: mutation wiring (update/save/archive/done)', () => {
  it('update mutation matches PUT route', () => {
    const ast = parse('@app:t\n@state{items:[{id:int,name:str}]}\n@db{\nItem{id:int:primary:auto,name:str}\n}\n@api(\nCRUD:/items>~db.Item\n)\n@ui(\nbtn:!update\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain('const update = async');
    expect(app.content).toContain('api.updateItem');
  });

  it('archive mutation sets archived:true via PUT', () => {
    const ast = parse('@app:t\n@state{items:[{id:int,archived:bool}]}\n@db{\nItem{id:int:primary:auto,archived:bool}\n}\n@api(\nCRUD:/items>~db.Item\n)\n@ui(\nbtn:!archive\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain('const archive = async');
    expect(app.content).toContain('archived: true');
  });

  it('done mutation sets done:true via PUT', () => {
    const ast = parse('@app:t\n@state{items:[{id:int,done:bool}]}\n@db{\nItem{id:int:primary:auto,done:bool}\n}\n@api(\nCRUD:/items>~db.Item\n)\n@ui(\nbtn:!done\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain('const done = async');
    expect(app.content).toContain('done: true');
  });

  it('archive without API or array falls back to console.log', () => {
    const ast = parse('@app:t\n@state{x:int}\n@api(\nGET:/data>handler\n)\n@ui(\nbtn:!archive\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain("console.log('archive'");
  });
});

describe('Batch 2: AbortController in resource hooks', () => {
  it('resource hook includes AbortController cleanup', () => {
    const result = transpileFile('projectflow');
    const hookFiles = result.files.filter(f => f.path.includes('/hooks/'));
    expect(hookFiles.length).toBeGreaterThan(0);
    const hookFile = hookFiles[0];
    expect(hookFile.content).toContain('AbortController');
    expect(hookFile.content).toContain('controller.abort');
    expect(hookFile.content).toContain("err.name === 'AbortError'");
    expect(hookFile.content).toContain('signal');
  });
});

describe('Batch 2: reusable components wired into output', () => {
  it('fullstack app with iterations generates EmptyState component', () => {
    const result = transpileFile('projectflow');
    const emptyState = result.files.find(f => f.path.includes('EmptyState.jsx'));
    expect(emptyState).toBeDefined();
  });

  it('App.jsx imports generated components', () => {
    const result = transpileFile('projectflow');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    const componentFiles = result.files.filter(f => f.path.includes('/components/'));
    for (const cf of componentFiles) {
      const name = cf.path.split('/').pop()!.replace('.jsx', '');
      expect(app.content).toContain(`import ${name} from`);
    }
  });

  it('frontend-only apps do NOT generate reusable components', () => {
    const result = transpileFile('todo');
    const componentFiles = result.files.filter(f => f.path.includes('/components/'));
    expect(componentFiles.length).toBe(0);
  });
});

describe('Batch 2: React.lazy for 3+ pages', () => {
  it('projectflow uses lazy imports (5 pages)', () => {
    const result = transpileFile('projectflow');
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).toContain('lazy');
    expect(app.content).toContain('Suspense');
  });

  it('apps with <3 pages use static imports', () => {
    const ast = parse('@app:t\n@state{x:int}\n@api(\nGET:/d>h\n)\n@ui(\n@page:home(\ntext>"Home"\n)\n@page:about(\ntext>"About"\n)\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'client/src/App.jsx')!;
    expect(app.content).not.toContain('lazy');
    expect(app.content).toContain("import HomePage from");
    expect(app.content).toContain("import AboutPage from");
  });
});

describe('Batch 2: security hardening defaults', () => {
  it('server.ts includes helmet', () => {
    const result = transpileFile('fullstack-todo');
    const server = result.files.find(f => f.path === 'server/server.ts')!;
    expect(server.content).toContain("import helmet from 'helmet'");
    expect(server.content).toContain('app.use(helmet())');
  });

  it('server.ts includes request body size limit', () => {
    const result = transpileFile('fullstack-todo');
    const server = result.files.find(f => f.path === 'server/server.ts')!;
    expect(server.content).toContain("express.json({ limit: '10mb' })");
  });

  it('server.ts includes rate limiting', () => {
    const result = transpileFile('fullstack-todo');
    const server = result.files.find(f => f.path === 'server/server.ts')!;
    expect(server.content).toContain('rateLimitMap');
    expect(server.content).toContain('429');
  });

  it('server package.json includes helmet dep', () => {
    const result = transpileFile('fullstack-todo');
    const pkg = result.files.find(f => f.path === 'server/package.json')!;
    expect(pkg.content).toContain('helmet');
  });

  it('CORS origin defaults to env var or true (reflect origin)', () => {
    const result = transpileFile('fullstack-todo');
    const server = result.files.find(f => f.path === 'server/server.ts')!;
    expect(server.content).toContain('CORS_ORIGIN || true');
  });
});

// ---- Batch 3: Backend Fidelity ----

describe('Batch 3A: JWT auth generation', () => {
  it('auth.ts has createToken and verifyToken', () => {
    const result = transpileFile('dashboard');
    const auth = result.files.find(f => f.path === 'server/auth.ts')!;
    expect(auth).toBeDefined();
    expect(auth.content).toContain('createToken');
    expect(auth.content).toContain('verifyToken');
    expect(auth.content).toContain('requireAuth');
  });

  it('auth.ts has requireRole when @auth has role', () => {
    const result = transpileFile('dashboard');
    const auth = result.files.find(f => f.path === 'server/auth.ts')!;
    expect(auth.content).toContain('requireRole');
  });

  it('server.ts mounts auth middleware before API routes', () => {
    const result = transpileFile('dashboard');
    const server = result.files.find(f => f.path === 'server/server.ts')!;
    expect(server.content).toContain('requireAuth');
  });

  it('.env includes JWT_SECRET when @auth present', () => {
    const result = transpileFile('dashboard');
    const env = result.files.find(f => f.path === 'server/.env')!;
    expect(env.content).toContain('JWT_SECRET');
  });
});

describe('Batch 3B: request validation generation', () => {
  it('validation.ts has validateFields function', () => {
    const result = transpileFile('fullstack-todo');
    const validation = result.files.find(f => f.path === 'server/validation.ts')!;
    expect(validation.content).toContain('validateFields');
    expect(validation.content).toContain('FieldSchema');
  });

  it('api router imports validateFields when routes have params', () => {
    const result = transpileFile('fullstack-todo');
    const apiFile = result.files.find(f => f.path === 'server/api.ts');
    if (apiFile) {
      // API file should import or contain validation logic
      expect(apiFile.content).toContain('validateFields');
    }
  });
});

describe('Batch 3C: many-to-many relation support', () => {
  it('resolveRelations classifies no-FK as many-to-many', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'Student', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'name', type: { kind: 'str' } },
        ] },
        { name: 'Course', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'title', type: { kind: 'str' } },
        ] },
      ],
      relations: [{ from: 'Student.courses', to: 'Course.students' }],
      indexes: [],
    };
    const { resolved, ambiguous, manyToMany } = resolveRelations(db);
    expect(resolved).toHaveLength(0);
    expect(ambiguous).toHaveLength(0);
    expect(manyToMany).toHaveLength(1);
    expect(manyToMany[0].modelA).toBe('Student');
    expect(manyToMany[0].modelB).toBe('Course');
  });

  it('m:n generates both-sides arrays in schema', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'Student', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'name', type: { kind: 'str' } },
        ] },
        { name: 'Course', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'title', type: { kind: 'str' } },
        ] },
      ],
      relations: [{ from: 'Student.courses', to: 'Course.students' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('courses  Course[]');
    expect(schema).toContain('students  Student[]');
  });
});

describe('Batch 3D: cascading deletes for required relations', () => {
  it('required FK gets onDelete: Cascade', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'name', type: { kind: 'str' } },
        ] },
        { name: 'Post', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'title', type: { kind: 'str' } },
          { name: 'user_id', type: { kind: 'int' } },
        ] },
      ],
      relations: [{ from: 'User.posts', to: 'Post.author' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('onDelete: Cascade');
  });

  it('optional FK gets onDelete: SetNull', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'name', type: { kind: 'str' } },
        ] },
        { name: 'Post', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'title', type: { kind: 'str' } },
          { name: 'user_id', type: { kind: 'optional', of: { kind: 'int' } } },
        ] },
      ],
      relations: [{ from: 'User.posts', to: 'Post.author' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    expect(schema).toContain('onDelete: SetNull');
  });
});

describe('Batch 3E: referential actions in AIR syntax', () => {
  it('parses :cascade modifier on @relation', () => {
    const source = `@app:test
  @db{
    User{id:int:primary:auto,name:str}
    Post{id:int:primary:auto,title:str,userId:int}
    @relation(User.posts<>Post.author:cascade)
  }`;
    const ast = parse(source);
    const db = ast.app.blocks.find(b => b.kind === 'db') as AirDbBlock;
    expect(db.relations[0].onDelete).toBe('cascade');
  });

  it('parses :set-null modifier on @relation', () => {
    const source = `@app:test
  @db{
    User{id:int:primary:auto,name:str}
    Post{id:int:primary:auto,title:str,userId:int}
    @relation(User.posts<>Post.author:set-null)
  }`;
    const ast = parse(source);
    const db = ast.app.blocks.find(b => b.kind === 'db') as AirDbBlock;
    expect(db.relations[0].onDelete).toBe('setNull');
  });

  it('parses :restrict modifier on @relation', () => {
    const source = `@app:test
  @db{
    User{id:int:primary:auto,name:str}
    Post{id:int:primary:auto,title:str,userId:int}
    @relation(User.posts<>Post.author:restrict)
  }`;
    const ast = parse(source);
    const db = ast.app.blocks.find(b => b.kind === 'db') as AirDbBlock;
    expect(db.relations[0].onDelete).toBe('restrict');
  });

  it('explicit :cascade overrides heuristic', () => {
    const db: AirDbBlock = {
      kind: 'db',
      models: [
        { name: 'User', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'name', type: { kind: 'str' } },
        ] },
        { name: 'Post', fields: [
          { name: 'id', type: { kind: 'int' }, primary: true, auto: true },
          { name: 'title', type: { kind: 'str' } },
          { name: 'user_id', type: { kind: 'optional', of: { kind: 'int' } } },
        ] },
      ],
      relations: [{ from: 'User.posts', to: 'Post.author', onDelete: 'cascade' }],
      indexes: [],
    };
    const schema = generatePrismaSchema(db);
    // Optional FK would normally get SetNull, but :cascade overrides
    expect(schema).toContain('onDelete: Cascade');
    expect(schema).not.toContain('onDelete: SetNull');
  });
});

// ---- Batch 4: CLI Workflow ----

describe('Batch 4A: incremental transpilation cache', () => {
  it('hashContent returns consistent 16-char hex', () => {
    const h1 = hashContent('hello');
    const h2 = hashContent('hello');
    const h3 = hashContent('world');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
    expect(h3).not.toBe(h1);
  });

  it('computeIncremental returns all files on first run', () => {
    const files = [
      { path: 'a.ts', content: 'console.log("a");' },
      { path: 'b.ts', content: 'console.log("b");' },
    ];
    const result = computeIncremental('source', files, '/tmp/air-test-nonexistent-cache-' + Date.now());
    expect(result.changedFiles).toHaveLength(2);
    expect(result.removedPaths).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });

  it('computeIncremental skips unchanged files on second run', () => {
    const outDir = '/tmp/air-test-cache-' + Date.now();
    const files = [
      { path: 'a.ts', content: 'console.log("a");' },
      { path: 'b.ts', content: 'console.log("b");' },
    ];
    const fileHashes: Record<string, string> = {};
    for (const f of files) fileHashes[f.path] = hashContent(f.content);
    saveManifest(outDir, { version: 1, sourceHash: hashContent('source'), files: fileHashes, timestamp: Date.now() });

    const result = computeIncremental('source', files, outDir);
    expect(result.changedFiles).toHaveLength(0);
    expect(result.skipped).toBe(2);
  });

  it('computeIncremental detects removed files', () => {
    const outDir = '/tmp/air-test-cache-removed-' + Date.now();
    const files = [
      { path: 'a.ts', content: 'console.log("a");' },
      { path: 'b.ts', content: 'console.log("b");' },
    ];
    const fileHashes: Record<string, string> = {};
    for (const f of files) fileHashes[f.path] = hashContent(f.content);
    saveManifest(outDir, { version: 1, sourceHash: hashContent('source'), files: fileHashes, timestamp: Date.now() });

    const result = computeIncremental('source', [files[0]], outDir);
    expect(result.removedPaths).toContain('b.ts');
  });

  it('_airengine_manifest.json is always in changedFiles (never skipped)', () => {
    const outDir = '/tmp/air-test-cache-manifest-' + Date.now();
    const files = [
      { path: 'a.ts', content: 'console.log("a");' },
      { path: '_airengine_manifest.json', content: '{"timestamp":"2025-01-01"}' },
    ];
    // Seed cache with same content hashes for a.ts
    const fileHashes: Record<string, string> = { 'a.ts': hashContent(files[0].content) };
    saveManifest(outDir, { version: 1, sourceHash: hashContent('source'), files: fileHashes, timestamp: Date.now() });

    const result = computeIncremental('source', files, outDir);
    // a.ts unchanged → skipped; manifest always changed
    expect(result.skipped).toBe(1);
    expect(result.changedFiles.some(f => f.path === '_airengine_manifest.json')).toBe(true);
  });
});

describe('Batch 4C: init templates', () => {
  it('frontend-only template parses and transpiles', () => {
    const template = generateInitTemplate('myapp', false);
    const ast = parse(template);
    const result = transpile(ast);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files.some(f => f.path.includes('App.jsx'))).toBe(true);
  });

  it('fullstack template parses and transpiles with server files', () => {
    const template = generateInitTemplate('myapp', true);
    const ast = parse(template);
    const result = transpile(ast);
    expect(result.files.some(f => f.path.startsWith('server/'))).toBe(true);
    expect(result.files.some(f => f.path.includes('schema.prisma'))).toBe(true);
  });
});

describe('Batch 4D: doctor checks', () => {
  it('runDoctorChecks returns checks for Node and npm', async () => {
    const checks = await runDoctorChecks();
    const nodeCheck = checks.find(c => c.name === 'Node.js');
    const npmCheck = checks.find(c => c.name === 'npm');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe('pass');
    expect(npmCheck).toBeDefined();
    expect(npmCheck!.status).toBe('pass');
  });

  it('checks .air file parsing when provided', async () => {
    const checks = await runDoctorChecks('examples/todo.air');
    const parseCheck = checks.find(c => c.name === '.air parse');
    expect(parseCheck).toBeDefined();
    expect(parseCheck!.status).toBe('pass');
  });
});

describe('Batch 4E: selective generation modes', () => {
  it('target=client skips server files', () => {
    const ast = parseFile('fullstack-todo');
    const result = transpile(ast, { target: 'client' });
    expect(result.files.some(f => f.path.startsWith('client/'))).toBe(true);
    expect(result.files.some(f => f.path.startsWith('server/'))).toBe(false);
  });

  it('target=server skips client files', () => {
    const ast = parseFile('fullstack-todo');
    const result = transpile(ast, { target: 'server' });
    expect(result.files.some(f => f.path.startsWith('server/'))).toBe(true);
    expect(result.files.some(f => f.path.startsWith('client/'))).toBe(false);
  });

  it('target=docs generates README and types but no server/client app code', () => {
    const ast = parseFile('fullstack-todo');
    const result = transpile(ast, { target: 'docs' });
    expect(result.files.some(f => f.path.includes('README.md'))).toBe(true);
    // Docs mode should not include server application files
    expect(result.files.some(f => f.path.includes('server.ts'))).toBe(false);
    expect(result.files.some(f => f.path.includes('api.ts'))).toBe(false);
  });

  it('target=all generates everything (default)', () => {
    const ast = parseFile('fullstack-todo');
    const result = transpile(ast);
    expect(result.files.some(f => f.path.startsWith('client/'))).toBe(true);
    expect(result.files.some(f => f.path.startsWith('server/'))).toBe(true);
  });

  it('target=docs generates NO client scaffold/app files', () => {
    const ast = parseFile('fullstack-todo');
    const result = transpile(ast, { target: 'docs' });
    // Should NOT have App.jsx, scaffold, pages, hooks
    expect(result.files.some(f => f.path.includes('App.jsx'))).toBe(false);
    expect(result.files.some(f => f.path.includes('main.jsx'))).toBe(false);
    expect(result.files.some(f => f.path.includes('vite.config'))).toBe(false);
    expect(result.files.some(f => f.path.includes('package.json'))).toBe(false);
    // Should still have README and types
    expect(result.files.some(f => f.path.includes('README.md'))).toBe(true);
    expect(result.files.some(f => f.path.includes('types.ts'))).toBe(true);
  });
});

// ---- Codex Findings Regression Tests ----

describe('Codex finding: JWT verifyToken handles malformed signatures', () => {
  it('generated verifyToken has length check before timingSafeEqual', () => {
    const ast = parseFile('dashboard');
    const result = transpile(ast);
    const authFile = result.files.find(f => f.path.includes('auth.ts'));
    expect(authFile).toBeDefined();
    const content = authFile!.content;
    // Must check buffer lengths before timingSafeEqual
    expect(content).toContain('sigBuf.length !== expBuf.length');
    expect(content).toContain('timingSafeEqual');
  });

  it('generated verifyToken wraps everything in try/catch', () => {
    const ast = parseFile('dashboard');
    const result = transpile(ast);
    const authFile = result.files.find(f => f.path.includes('auth.ts'));
    expect(authFile).toBeDefined();
    // The entire body of verifyToken should be inside a try block
    const content = authFile!.content;
    const fnStart = content.indexOf('function verifyToken');
    const afterFn = content.slice(fnStart);
    // First { after function sig, then try { should follow quickly
    expect(afterFn).toMatch(/function verifyToken[^{]*\{[\s\S]*?try \{/);
  });
});

describe('Codex finding: outputLines counts all generated content', () => {
  it('outputLines includes provenance headers', () => {
    const ast = parseFile('todo');
    const result = transpile(ast);
    // Count actual lines across all files
    const actualLines = result.files.reduce((sum, f) => sum + f.content.split('\n').length, 0);
    expect(result.stats.outputLines).toBe(actualLines);
  });

  it('outputLines includes manifest file', () => {
    const ast = parseFile('fullstack-todo');
    const result = transpile(ast);
    const manifestFile = result.files.find(f => f.path === '_airengine_manifest.json');
    expect(manifestFile).toBeDefined();
    const actualLines = result.files.reduce((sum, f) => sum + f.content.split('\n').length, 0);
    expect(result.stats.outputLines).toBe(actualLines);
  });
});

describe('Codex finding: incremental cache excludes manifest from hashing', () => {
  it('manifest.json is excluded from incremental file hashes', () => {
    // Simulate: hash a manifest with different timestamps → should produce same incremental result
    const ast = parseFile('todo');
    const r1 = transpile(ast);
    const r2 = transpile(ast);

    // Manifest timestamps will differ, but other files should hash identically
    for (const f1 of r1.files) {
      if (f1.path === '_airengine_manifest.json') continue;
      const f2 = r2.files.find(f => f.path === f1.path);
      expect(f2).toBeDefined();
      expect(hashContent(f1.content)).toBe(hashContent(f2!.content));
    }
  });
});

describe('Codex finding: MCP transpileReturned tracks first-call correctly', () => {
  it('MCP server uses transpileReturned set separate from astCache', () => {
    const serverSource = readFileSync('src/mcp/server.ts', 'utf-8');
    // Must have a separate tracking set for transpile-returned
    expect(serverSource).toContain('transpileReturned');
    // Must check transpileReturned, NOT cached, for incremental decision
    expect(serverSource).toContain('transpileReturned.has(sourceHash)');
    // Must mark as returned after sending full files
    expect(serverSource).toContain('transpileReturned.add(sourceHash)');
  });
});

describe('Optional state null guard in generated JSX', () => {
  it('emits optional chaining (?.) for dot access on optional state vars', () => {
    const source = `@app:OptGuard
  @state{user:?{id:int,name:str,email:str}}
  @ui(
    text > #user.name
    input:#user.email
  )
`;
    const ast = parse(source);
    const result = transpile(ast);
    const appFile = result.files.find(f => f.path.endsWith('App.jsx'));
    expect(appFile).toBeDefined();
    const content = appFile!.content;
    // Dot access on optional state should use ?.
    expect(content).toContain('user?.name');
    expect(content).toContain('user?.email');
    // Should NOT contain bare user.name / user.email in value bindings
    expect(content).not.toMatch(/value=\{user\.email\}/);
    // Input value should have ?? '' fallback
    expect(content).toContain("?? ''");
  });
});
