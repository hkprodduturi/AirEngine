import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser/index.js';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AirStateBlock,
  AirStyleBlock,
  AirUIBlock,
  AirAPIBlock,
  AirAuthBlock,
  AirNavBlock,
  AirPersistBlock,
  AirHookBlock,
  AirDbBlock,
  AirCronBlock,
  AirWebhookBlock,
  AirQueueBlock,
  AirEmailBlock,
  AirEnvBlock,
  AirDeployBlock,
} from '../src/parser/types.js';

function readExample(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'examples', name + '.air'), 'utf8');
}

// ---- @app ----

describe('@app declaration', () => {
  it('should parse @app:name', () => {
    const ast = parse('@app:todo');
    expect(ast.app.name).toBe('todo');
  });

  it('should parse hyphenated app name', () => {
    const ast = parse('@app:expense-tracker');
    expect(ast.app.name).toBe('expense-tracker');
  });

  it('should throw on missing @app', () => {
    expect(() => parse('@state{items:[str]}')).toThrow('Missing @app');
  });

  it('should ignore comments before @app', () => {
    const ast = parse('# comment\n@app:my-app');
    expect(ast.app.name).toBe('my-app');
  });

  it('should set version', () => {
    const ast = parse('@app:test');
    expect(ast.version).toBe('0.1');
  });
});

// ---- @state ----

describe('@state block', () => {
  it('should parse simple fields', () => {
    const ast = parse('@app:t\n@state{name:str,age:int}');
    const state = ast.app.blocks[0] as AirStateBlock;
    expect(state.kind).toBe('state');
    expect(state.fields).toHaveLength(2);
    expect(state.fields[0]).toEqual({ name: 'name', type: { kind: 'str' } });
    expect(state.fields[1]).toEqual({ name: 'age', type: { kind: 'int' } });
  });

  it('should parse array types', () => {
    const ast = parse('@app:t\n@state{items:[str]}');
    const state = ast.app.blocks[0] as AirStateBlock;
    expect(state.fields[0].type).toEqual({ kind: 'array', of: { kind: 'str' } });
  });

  it('should parse nested object types', () => {
    const ast = parse('@app:t\n@state{user:{name:str,email:str}}');
    const state = ast.app.blocks[0] as AirStateBlock;
    const userType = state.fields[0].type;
    expect(userType.kind).toBe('object');
    if (userType.kind === 'object') {
      expect(userType.fields).toHaveLength(2);
    }
  });

  it('should parse optional types', () => {
    const ast = parse('@app:t\n@state{error:?str}');
    const state = ast.app.blocks[0] as AirStateBlock;
    expect(state.fields[0].type).toEqual({ kind: 'optional', of: { kind: 'str' } });
  });

  it('should parse enum types', () => {
    const ast = parse('@app:t\n@state{filter:enum(all,active,done)}');
    const state = ast.app.blocks[0] as AirStateBlock;
    expect(state.fields[0].type).toEqual({ kind: 'enum', values: ['all', 'active', 'done'] });
  });

  it('should parse default values', () => {
    const ast = parse('@app:t\n@state{budget:float(2000)}');
    const state = ast.app.blocks[0] as AirStateBlock;
    expect(state.fields[0].type).toEqual({ kind: 'float', default: 2000 });
  });

  it('should parse ref types', () => {
    const ast = parse('@app:t\n@state{author:#User}');
    const state = ast.app.blocks[0] as AirStateBlock;
    expect(state.fields[0].type).toEqual({ kind: 'ref', entity: 'User' });
  });

  it('should parse array of objects', () => {
    const ast = parse('@app:t\n@state{items:[{id:int,text:str,done:bool}]}');
    const state = ast.app.blocks[0] as AirStateBlock;
    const arrType = state.fields[0].type;
    expect(arrType.kind).toBe('array');
    if (arrType.kind === 'array') {
      expect(arrType.of.kind).toBe('object');
    }
  });

  it('should parse multi-line state', () => {
    const src = `@app:t
@state{
  name:str,
  count:int,
  active:bool
}`;
    const ast = parse(src);
    const state = ast.app.blocks[0] as AirStateBlock;
    expect(state.fields).toHaveLength(3);
  });

  it('should parse optional nested object', () => {
    const ast = parse('@app:t\n@state{user:?{name:str,email:str,token:str}}');
    const state = ast.app.blocks[0] as AirStateBlock;
    const t = state.fields[0].type;
    expect(t.kind).toBe('optional');
    if (t.kind === 'optional') {
      expect(t.of.kind).toBe('object');
    }
  });
});

// ---- @style ----

describe('@style block', () => {
  it('should parse key-value properties', () => {
    const ast = parse('@app:t\n@style(theme:dark,radius:12)');
    const style = ast.app.blocks[0] as AirStyleBlock;
    expect(style.kind).toBe('style');
    expect(style.properties.theme).toBe('dark');
    expect(style.properties.radius).toBe(12);
  });

  it('should parse hex colors', () => {
    const ast = parse('@app:t\n@style(accent:#6366f1)');
    const style = ast.app.blocks[0] as AirStyleBlock;
    expect(style.properties.accent).toBe('#6366f1');
  });

  it('should parse compound values', () => {
    const ast = parse('@app:t\n@style(font:mono+sans)');
    const style = ast.app.blocks[0] as AirStyleBlock;
    expect(style.properties.font).toBe('mono+sans');
  });

  it('should parse multiple hex colors', () => {
    const ast = parse('@app:t\n@style(green:#10b981,red:#ef4444)');
    const style = ast.app.blocks[0] as AirStyleBlock;
    expect(style.properties.green).toBe('#10b981');
    expect(style.properties.red).toBe('#ef4444');
  });
});

// ---- @ui ----

describe('@ui block', () => {
  it('should parse simple elements', () => {
    const ast = parse('@app:t\n@ui(\nheader\nfooter\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    expect(ui.kind).toBe('ui');
    expect(ui.children).toHaveLength(2);
  });

  it('should parse text literals', () => {
    const ast = parse('@app:t\n@ui(\nh1>"Hello World"\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    expect(ui.children).toHaveLength(1);
    expect(ui.children[0].kind).toBe('binary');
  });

  it('should parse compose operator', () => {
    const ast = parse('@app:t\n@ui(\na+b+c\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    expect(ui.children[0].kind).toBe('binary');
    if (ui.children[0].kind === 'binary') {
      expect(ui.children[0].operator).toBe('+');
    }
  });

  it('should parse flow operator', () => {
    const ast = parse('@app:t\n@ui(\nbtn>!save\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    const node = ui.children[0];
    expect(node.kind).toBe('binary');
    if (node.kind === 'binary') {
      expect(node.operator).toBe('>');
    }
  });

  it('should parse pipe operator', () => {
    const ast = parse('@app:t\n@ui(\nitems|filter\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    const node = ui.children[0];
    expect(node.kind).toBe('binary');
    if (node.kind === 'binary') {
      expect(node.operator).toBe('|');
    }
  });

  it('should parse prefix operators', () => {
    const ast = parse('@app:t\n@ui(\n*item\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    expect(ui.children[0].kind).toBe('unary');
    if (ui.children[0].kind === 'unary') {
      expect(ui.children[0].operator).toBe('*');
    }
  });

  it('should parse ref prefix', () => {
    const ast = parse('@app:t\n@ui(\n#count\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    expect(ui.children[0].kind).toBe('unary');
    if (ui.children[0].kind === 'unary') {
      expect(ui.children[0].operator).toBe('#');
    }
  });

  it('should parse parenthesized children', () => {
    const ast = parse('@app:t\n@ui(\ncard(title+body)\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    const card = ui.children[0];
    expect(card.kind).toBe('element');
    if (card.kind === 'element') {
      expect(card.element).toBe('card');
      expect(card.children).toBeDefined();
    }
  });

  it('should parse comma-separated children', () => {
    const ast = parse('@app:t\n@ui(\nnav(overview,users,settings)\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    const nav = ui.children[0];
    expect(nav.kind).toBe('element');
    if (nav.kind === 'element') {
      expect(nav.children).toHaveLength(3);
    }
  });

  it('should parse @section scoped blocks', () => {
    const ast = parse('@app:t\n@ui(\n@section:hero(\nh1>"Title"\n)\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    expect(ui.children[0].kind).toBe('scoped');
    if (ui.children[0].kind === 'scoped') {
      expect(ui.children[0].scope).toBe('section');
      expect(ui.children[0].name).toBe('hero');
    }
  });

  it('should parse @page scoped blocks', () => {
    const ast = parse('@app:t\n@ui(\n@page:login(\nform+btn\n)\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    expect(ui.children[0].kind).toBe('scoped');
    if (ui.children[0].kind === 'scoped') {
      expect(ui.children[0].scope).toBe('page');
      expect(ui.children[0].name).toBe('login');
    }
  });

  it('should handle deep nesting', () => {
    const ast = parse('@app:t\n@ui(\nmain(\nsidebar(\nnav(\nitem(label)\n)\n)\n)\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    expect(ui.children[0].kind).toBe('element');
  });

  it('should parse dot-chained identifiers', () => {
    const ast = parse('@app:t\n@ui(\nfilter.set(all,active)\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    const node = ui.children[0];
    expect(node.kind).toBe('element');
    if (node.kind === 'element') {
      expect(node.element).toBe('filter.set');
    }
  });

  it('should parse inline objects', () => {
    const ast = parse('@app:t\n@ui(\n!add({text:#val})\n)');
    const ui = ast.app.blocks[0] as AirUIBlock;
    expect(ui.children).toHaveLength(1);
  });
});

// ---- @api ----

describe('@api block', () => {
  it('should parse routes with methods', () => {
    const ast = parse('@app:t\n@api(\nGET:/users>~users.list\n)');
    const api = ast.app.blocks[0] as AirAPIBlock;
    expect(api.routes).toHaveLength(1);
    expect(api.routes[0].method).toBe('GET');
    expect(api.routes[0].path).toBe('/users');
  });

  it('should parse path parameters', () => {
    const ast = parse('@app:t\n@api(\nDELETE:/users/:id>~users.remove\n)');
    const api = ast.app.blocks[0] as AirAPIBlock;
    expect(api.routes[0].path).toBe('/users/:id');
  });

  it('should parse query params', () => {
    const ast = parse('@app:t\n@api(\nGET:/stats(?period)>~stats.set\n)');
    const api = ast.app.blocks[0] as AirAPIBlock;
    expect(api.routes[0].params).toBeDefined();
    expect(api.routes[0].params![0].name).toBe('?period');
  });

  it('should parse body params with types', () => {
    const ast = parse('@app:t\n@api(\nPOST:/login(email:str,pass:str)>~auth.login\n)');
    const api = ast.app.blocks[0] as AirAPIBlock;
    expect(api.routes[0].params).toHaveLength(2);
    expect(api.routes[0].params![0].type).toEqual({ kind: 'str' });
  });

  it('should parse multiple routes', () => {
    const src = `@app:t
@api(
  GET:/users>~users.list
  POST:/users>~users.create
  DELETE:/users/:id>~users.remove
)`;
    const ast = parse(src);
    const api = ast.app.blocks[0] as AirAPIBlock;
    expect(api.routes).toHaveLength(3);
  });
});

// ---- @auth ----

describe('@auth block', () => {
  it('should parse required flag', () => {
    const ast = parse('@app:t\n@auth(required)');
    const auth = ast.app.blocks[0] as AirAuthBlock;
    expect(auth.required).toBe(true);
  });

  it('should parse role:admin as string', () => {
    const ast = parse('@app:t\n@auth(required,role:admin)');
    const auth = ast.app.blocks[0] as AirAuthBlock;
    expect(auth.required).toBe(true);
    expect(auth.role).toBe('admin');
  });

  it('should parse role:enum(...)', () => {
    const ast = parse('@app:t\n@auth(required,role:enum(admin,user))');
    const auth = ast.app.blocks[0] as AirAuthBlock;
    expect(auth.role).toEqual({ kind: 'enum', values: ['admin', 'user'] });
  });
});

// ---- @nav ----

describe('@nav block', () => {
  it('should parse conditional routing', () => {
    const src = '@app:t\n@nav(\n/>?user>dashboard:login\n)';
    const ast = parse(src);
    const nav = ast.app.blocks[0] as AirNavBlock;
    expect(nav.routes).toHaveLength(1);
    expect(nav.routes[0].path).toBe('/');
    expect(nav.routes[0].condition).toBe('user');
    expect(nav.routes[0].target).toBe('dashboard');
    expect(nav.routes[0].fallback).toBe('login');
  });

  it('should parse shorthand anchor paths', () => {
    const src = '@app:t\n@nav(/#hero,/#features,/#pricing)';
    const ast = parse(src);
    const nav = ast.app.blocks[0] as AirNavBlock;
    expect(nav.routes).toHaveLength(3);
    expect(nav.routes[0].path).toBe('/#hero');
    expect(nav.routes[1].path).toBe('/#features');
  });
});

// ---- @persist ----

describe('@persist block', () => {
  it('should parse localStorage', () => {
    const ast = parse('@app:t\n@persist:localStorage(items)');
    const persist = ast.app.blocks[0] as AirPersistBlock;
    expect(persist.method).toBe('localStorage');
    expect(persist.keys).toEqual(['items']);
  });

  it('should parse multiple keys', () => {
    const ast = parse('@app:t\n@persist:localStorage(expenses,budget)');
    const persist = ast.app.blocks[0] as AirPersistBlock;
    expect(persist.keys).toEqual(['expenses', 'budget']);
  });

  it('should parse cookie with flags', () => {
    const ast = parse('@app:t\n@persist:cookie(user.token,httpOnly,7d)');
    const persist = ast.app.blocks[0] as AirPersistBlock;
    expect(persist.method).toBe('cookie');
    expect(persist.keys).toEqual(['user.token']);
    expect(persist.options).toBeDefined();
    expect(persist.options!['httpOnly']).toBe(true);
    expect(persist.options!['7d']).toBe(true);
  });
});

// ---- @hook ----

describe('@hook block', () => {
  it('should parse hook with multiple actions', () => {
    const ast = parse('@app:t\n@hook(onMount>~api.stats+~api.users)');
    const hook = ast.app.blocks[0] as AirHookBlock;
    expect(hook.hooks).toHaveLength(1);
    expect(hook.hooks[0].trigger).toBe('onMount');
    expect(hook.hooks[0].actions).toEqual(['~api.stats', '~api.users']);
  });

  it('should parse onChange trigger', () => {
    const src = '@app:t\n@hook(onChange:search>~api.users)';
    const ast = parse(src);
    const hook = ast.app.blocks[0] as AirHookBlock;
    expect(hook.hooks[0].trigger).toBe('onChange:search');
  });
});

// ---- @db ----

describe('@db block', () => {
  it('should parse models', () => {
    const src = '@app:t\n@db{\nUser{id:int,name:str,email:str}\n}';
    const ast = parse(src);
    const db = ast.app.blocks[0] as AirDbBlock;
    expect(db.models).toHaveLength(1);
    expect(db.models[0].name).toBe('User');
    expect(db.models[0].fields).toHaveLength(3);
  });

  it('should parse index with unique', () => {
    const src = '@app:t\n@db{\nUser{id:int,email:str}\n@index(User.email:unique)\n}';
    const ast = parse(src);
    const db = ast.app.blocks[0] as AirDbBlock;
    expect(db.indexes).toHaveLength(1);
    expect(db.indexes[0].unique).toBe(true);
    expect(db.indexes[0].fields).toEqual(['User.email']);
  });

  it('should parse relations', () => {
    const src = '@app:t\n@db{\nUser{id:int}\nPost{id:int}\n@relation(User.posts<>Post.author)\n}';
    const ast = parse(src);
    const db = ast.app.blocks[0] as AirDbBlock;
    expect(db.relations).toHaveLength(1);
    expect(db.relations[0].from).toBe('User.posts');
    expect(db.relations[0].to).toBe('Post.author');
  });

  it('should parse composite index', () => {
    const src = '@app:t\n@db{\nPost{id:int}\n@index(Post.author+Post.published)\n}';
    const ast = parse(src);
    const db = ast.app.blocks[0] as AirDbBlock;
    expect(db.indexes[0].fields).toEqual(['Post.author', 'Post.published']);
    expect(db.indexes[0].unique).toBe(false);
  });
});

// ---- @cron ----

describe('@cron block', () => {
  it('should parse cron jobs', () => {
    const src = '@app:t\n@cron(\ncleanup>"0 0 * * *">!db.sessions.deleteExpired\n)';
    const ast = parse(src);
    const cron = ast.app.blocks[0] as AirCronBlock;
    expect(cron.jobs).toHaveLength(1);
    expect(cron.jobs[0].name).toBe('cleanup');
    expect(cron.jobs[0].schedule).toBe('0 0 * * *');
    expect(cron.jobs[0].handler).toBe('!db.sessions.deleteExpired');
  });
});

// ---- @webhook ----

describe('@webhook block', () => {
  it('should parse webhook routes', () => {
    const src = '@app:t\n@webhook(\nPOST:/hooks/stripe>!payments.process\n)';
    const ast = parse(src);
    const wh = ast.app.blocks[0] as AirWebhookBlock;
    expect(wh.routes).toHaveLength(1);
    expect(wh.routes[0].method).toBe('POST');
    expect(wh.routes[0].path).toBe('/hooks/stripe');
    expect(wh.routes[0].handler).toBe('!payments.process');
  });
});

// ---- @queue ----

describe('@queue block', () => {
  it('should parse queue jobs with params', () => {
    const src = '@app:t\n@queue(\nemails(to:str,subject:str)>~email.send\n)';
    const ast = parse(src);
    const queue = ast.app.blocks[0] as AirQueueBlock;
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0].name).toBe('emails');
    expect(queue.jobs[0].params).toHaveLength(2);
    expect(queue.jobs[0].handler).toBe('~email.send');
  });
});

// ---- @email ----

describe('@email block', () => {
  it('should parse email templates', () => {
    const src = '@app:t\n@email(\nwelcome(user:#User)>"Welcome, {{#user.name}}"\n)';
    const ast = parse(src);
    const email = ast.app.blocks[0] as AirEmailBlock;
    expect(email.templates).toHaveLength(1);
    expect(email.templates[0].name).toBe('welcome');
    expect(email.templates[0].subject).toBe('Welcome, {{#user.name}}');
  });
});

// ---- @env ----

describe('@env block', () => {
  it('should parse env vars', () => {
    const src = '@app:t\n@env(\nDATABASE_URL:str:required\nPORT:int:3000\n)';
    const ast = parse(src);
    const env = ast.app.blocks[0] as AirEnvBlock;
    expect(env.vars).toHaveLength(2);
    expect(env.vars[0].name).toBe('DATABASE_URL');
    expect(env.vars[0].required).toBe(true);
    expect(env.vars[1].name).toBe('PORT');
    expect(env.vars[1].default).toBe(3000);
  });
});

// ---- @deploy ----

describe('@deploy block', () => {
  it('should parse deploy properties', () => {
    const src = '@app:t\n@deploy(target:docker,port:3000,env:production)';
    const ast = parse(src);
    const deploy = ast.app.blocks[0] as AirDeployBlock;
    expect(deploy.properties.target).toBe('docker');
    expect(deploy.properties.port).toBe(3000);
    expect(deploy.properties.env).toBe('production');
  });
});

// ---- Error handling ----

describe('error handling', () => {
  it('should throw on missing @app', () => {
    expect(() => parse('')).toThrow();
  });

  it('should throw on unknown block type', () => {
    expect(() => parse('@app:t\n@unknown(foo)')).toThrow('Unknown block type');
  });

  it('should include line/col in error', () => {
    try {
      parse('@app:t\n@unknown(foo)');
    } catch (e: any) {
      expect(e.line).toBeDefined();
      expect(e.col).toBeDefined();
    }
  });
});

// ---- Integration tests: full example files ----

describe('integration: example files', () => {
  it('should parse todo.air', () => {
    const ast = parse(readExample('todo'));
    expect(ast.app.name).toBe('todo');
    expect(ast.app.blocks).toHaveLength(4);

    const state = ast.app.blocks.find(b => b.kind === 'state') as AirStateBlock;
    expect(state.fields.map(f => f.name)).toEqual(['items', 'filter']);
    expect(state.fields[0].type.kind).toBe('array');

    const style = ast.app.blocks.find(b => b.kind === 'style') as AirStyleBlock;
    expect(style.properties.theme).toBe('dark');
    expect(style.properties.accent).toBe('#6366f1');

    const ui = ast.app.blocks.find(b => b.kind === 'ui') as AirUIBlock;
    expect(ui.children.length).toBeGreaterThan(0);

    const persist = ast.app.blocks.find(b => b.kind === 'persist') as AirPersistBlock;
    expect(persist.method).toBe('localStorage');
    expect(persist.keys).toEqual(['items']);
  });

  it('should parse expense-tracker.air', () => {
    const ast = parse(readExample('expense-tracker'));
    expect(ast.app.name).toBe('expense-tracker');
    expect(ast.app.blocks).toHaveLength(4);

    const state = ast.app.blocks.find(b => b.kind === 'state') as AirStateBlock;
    expect(state.fields.map(f => f.name)).toEqual(['expenses', 'budget', 'filter', 'sort', 'input']);
    // budget has default
    const budgetField = state.fields.find(f => f.name === 'budget')!;
    expect(budgetField.type).toEqual({ kind: 'float', default: 2000 });

    const persist = ast.app.blocks.find(b => b.kind === 'persist') as AirPersistBlock;
    expect(persist.keys).toEqual(['expenses', 'budget']);
  });

  it('should parse auth.air', () => {
    const ast = parse(readExample('auth'));
    expect(ast.app.name).toBe('auth');
    expect(ast.app.blocks).toHaveLength(5);

    const api = ast.app.blocks.find(b => b.kind === 'api') as AirAPIBlock;
    expect(api.routes.map(r => r.method)).toEqual(['POST', 'POST', 'POST']);
    expect(api.routes[0].path).toBe('/login');
    expect(api.routes[0].params).toHaveLength(2);

    const nav = ast.app.blocks.find(b => b.kind === 'nav') as AirNavBlock;
    expect(nav.routes[0].path).toBe('/');
    expect(nav.routes[0].condition).toBe('user');
    expect(nav.routes[0].target).toBe('dashboard');
    expect(nav.routes[0].fallback).toBe('login');

    const persist = ast.app.blocks.find(b => b.kind === 'persist') as AirPersistBlock;
    expect(persist.method).toBe('cookie');
    expect(persist.keys).toContain('user.token');
    expect(persist.options!['httpOnly']).toBe(true);
    expect(persist.options!['7d']).toBe(true);

    // UI should have @page scoped blocks
    const ui = ast.app.blocks.find(b => b.kind === 'ui') as AirUIBlock;
    const pages = ui.children.filter(n => n.kind === 'scoped');
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });

  it('should parse dashboard.air', () => {
    const ast = parse(readExample('dashboard'));
    expect(ast.app.name).toBe('dashboard');
    expect(ast.app.blocks).toHaveLength(6);

    const auth = ast.app.blocks.find(b => b.kind === 'auth') as AirAuthBlock;
    expect(auth.required).toBe(true);
    expect(auth.role).toBe('admin');

    const hook = ast.app.blocks.find(b => b.kind === 'hook') as AirHookBlock;
    expect(hook.hooks).toHaveLength(1);
    expect(hook.hooks[0].trigger).toBe('onMount');
    expect(hook.hooks[0].actions).toEqual(['~api.stats', '~api.users']);

    const api = ast.app.blocks.find(b => b.kind === 'api') as AirAPIBlock;
    expect(api.routes).toHaveLength(4);
    expect(api.routes.find(r => r.method === 'PUT')!.path).toBe('/users/:id');
  });

  it('should parse landing.air', () => {
    const ast = parse(readExample('landing'));
    expect(ast.app.name).toBe('landing');
    expect(ast.app.blocks).toHaveLength(3);

    const style = ast.app.blocks.find(b => b.kind === 'style') as AirStyleBlock;
    expect(style.properties.font).toBe('display+sans');
    expect(style.properties.maxWidth).toBe(1200);

    const nav = ast.app.blocks.find(b => b.kind === 'nav') as AirNavBlock;
    expect(nav.routes).toHaveLength(4);
    expect(nav.routes.map(r => r.path)).toEqual(['/#hero', '/#features', '/#pricing', '/#cta']);

    // UI should have @section scoped blocks
    const ui = ast.app.blocks.find(b => b.kind === 'ui') as AirUIBlock;
    const sections = ui.children.filter(n => n.kind === 'scoped');
    expect(sections.length).toBe(4);
  });
});
