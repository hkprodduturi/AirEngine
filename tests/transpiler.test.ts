import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';
import { extractContext } from '../src/transpiler/context.js';
import { resolveBindChain, analyzeUI, extractMutations } from '../src/transpiler/normalize-ui.js';
import { mapElement } from '../src/transpiler/element-map.js';
import type { AirUINode, AirUIBinaryNode } from '../src/parser/types.js';

// ---- Helpers ----

function parseFile(name: string) {
  const source = readFileSync(`examples/${name}.air`, 'utf-8');
  return parse(source);
}

function transpileFile(name: string) {
  const ast = parseFile(name);
  return transpile(ast);
}

function getAppJsx(name: string): string {
  const result = transpileFile(name);
  const appFile = result.files.find(f => f.path === 'src/App.jsx');
  return appFile?.content ?? '';
}

// ---- Unit: extractContext ----

describe('extractContext', () => {
  it('extracts state fields from todo.air', () => {
    const ast = parseFile('todo');
    const ctx = extractContext(ast);
    expect(ctx.appName).toBe('todo');
    expect(ctx.state).toHaveLength(2);
    expect(ctx.state[0].name).toBe('items');
    expect(ctx.state[1].name).toBe('filter');
  });

  it('extracts style props from todo.air', () => {
    const ast = parseFile('todo');
    const ctx = extractContext(ast);
    expect(ctx.style.theme).toBe('dark');
    expect(ctx.style.accent).toBe('#6366f1');
    expect(ctx.style.radius).toBe(12);
  });

  it('extracts persist from todo.air', () => {
    const ast = parseFile('todo');
    const ctx = extractContext(ast);
    expect(ctx.persistMethod).toBe('localStorage');
    expect(ctx.persistKeys).toContain('items');
  });

  it('extracts persist cookie from auth.air', () => {
    const ast = parseFile('auth');
    const ctx = extractContext(ast);
    expect(ctx.persistMethod).toBe('cookie');
  });

  it('extracts hooks from dashboard.air', () => {
    const ast = parseFile('dashboard');
    const ctx = extractContext(ast);
    expect(ctx.hooks).toHaveLength(1);
    expect(ctx.hooks[0].trigger).toBe('onMount');
  });

  it('extracts auth from dashboard.air', () => {
    const ast = parseFile('dashboard');
    const ctx = extractContext(ast);
    expect(ctx.auth).not.toBeNull();
    expect(ctx.auth!.required).toBe(true);
  });

  it('extracts api routes from auth.air', () => {
    const ast = parseFile('auth');
    const ctx = extractContext(ast);
    expect(ctx.apiRoutes.length).toBeGreaterThan(0);
  });

  it('extracts nav routes from landing.air', () => {
    const ast = parseFile('landing');
    const ctx = extractContext(ast);
    expect(ctx.navRoutes.length).toBeGreaterThan(0);
  });
});

// ---- Unit: mapElement ----

describe('mapElement', () => {
  it('maps header to <header>', () => {
    const m = mapElement('header', []);
    expect(m.tag).toBe('header');
    expect(m.className).toContain('flex');
  });

  it('maps btn:primary to styled button', () => {
    const m = mapElement('btn', ['primary']);
    expect(m.tag).toBe('button');
    expect(m.className).toContain('bg-[var(--accent)]');
  });

  it('maps input:text to text input', () => {
    const m = mapElement('input', ['text']);
    expect(m.tag).toBe('input');
    expect(m.inputType).toBe('text');
    expect(m.selfClosing).toBe(true);
  });

  it('maps input:email to email input', () => {
    const m = mapElement('input', ['email']);
    expect(m.inputType).toBe('email');
  });

  it('maps input:password to password input', () => {
    const m = mapElement('input', ['password']);
    expect(m.inputType).toBe('password');
  });

  it('maps list to <ul>', () => {
    const m = mapElement('list', []);
    expect(m.tag).toBe('ul');
  });

  it('maps grid:3 to 3-column grid', () => {
    const m = mapElement('grid', ['3']);
    expect(m.className).toContain('grid-cols-3');
  });

  it('maps unknown element to div', () => {
    const m = mapElement('xyzabc', []);
    expect(m.tag).toBe('div');
  });
});

// ---- Unit: resolveBindChain ----

describe('resolveBindChain', () => {
  it('resolves btn:primary', () => {
    const node: AirUIBinaryNode = {
      kind: 'binary', operator: ':',
      left: { kind: 'element', element: 'btn' },
      right: { kind: 'element', element: 'primary' },
    };
    const r = resolveBindChain(node);
    expect(r).not.toBeNull();
    expect(r!.element).toBe('btn');
    expect(r!.modifiers).toEqual(['primary']);
  });

  it('resolves input:text', () => {
    const node: AirUIBinaryNode = {
      kind: 'binary', operator: ':',
      left: { kind: 'element', element: 'input' },
      right: { kind: 'element', element: 'text' },
    };
    const r = resolveBindChain(node);
    expect(r!.element).toBe('input');
    expect(r!.modifiers).toEqual(['text']);
  });

  it('resolves badge with # binding', () => {
    const node: AirUIBinaryNode = {
      kind: 'binary', operator: ':',
      left: { kind: 'element', element: 'badge' },
      right: { kind: 'unary', operator: '#', operand: { kind: 'element', element: 'count' } },
    };
    const r = resolveBindChain(node);
    expect(r!.element).toBe('badge');
    expect(r!.modifiers).toEqual([]);
    expect(r!.binding).toBeDefined();
  });

  it('resolves btn with ! action', () => {
    const node: AirUIBinaryNode = {
      kind: 'binary', operator: ':',
      left: { kind: 'element', element: 'btn' },
      right: { kind: 'unary', operator: '!', operand: { kind: 'element', element: 'del' } },
    };
    const r = resolveBindChain(node);
    expect(r!.element).toBe('btn');
    expect(r!.action).toBeDefined();
  });

  it('resolves stat with text label', () => {
    const node: AirUIBinaryNode = {
      kind: 'binary', operator: ':',
      left: { kind: 'element', element: 'stat' },
      right: { kind: 'text', text: 'Total' },
    };
    const r = resolveBindChain(node);
    expect(r!.element).toBe('stat');
    expect(r!.label).toBe('Total');
  });

  it('resolves nested bind: btn:icon:!del', () => {
    const node: AirUIBinaryNode = {
      kind: 'binary', operator: ':',
      left: {
        kind: 'binary', operator: ':',
        left: { kind: 'element', element: 'btn' },
        right: { kind: 'element', element: 'icon' },
      },
      right: { kind: 'unary', operator: '!', operand: { kind: 'element', element: 'del' } },
    };
    const r = resolveBindChain(node);
    expect(r!.element).toBe('btn');
    expect(r!.modifiers).toEqual(['icon']);
    expect(r!.action).toBeDefined();
  });

  it('returns null for non-bind node', () => {
    const node: AirUINode = { kind: 'element', element: 'div' };
    expect(resolveBindChain(node)).toBeNull();
  });
});

// ---- Unit: analyzeUI ----

describe('analyzeUI', () => {
  it('detects pages in auth.air', () => {
    const ast = parseFile('auth');
    const ctx = extractContext(ast);
    const analysis = analyzeUI(ctx.uiNodes);
    expect(analysis.hasPages).toBe(true);
    expect(analysis.pages.length).toBeGreaterThanOrEqual(2);
    expect(analysis.pages.map(p => p.name)).toContain('login');
    expect(analysis.pages.map(p => p.name)).toContain('dashboard');
  });

  it('detects sections in landing.air', () => {
    const ast = parseFile('landing');
    const ctx = extractContext(ast);
    const analysis = analyzeUI(ctx.uiNodes);
    expect(analysis.sections.length).toBeGreaterThanOrEqual(4);
    expect(analysis.sections.map(s => s.name)).toContain('hero');
    expect(analysis.sections.map(s => s.name)).toContain('features');
  });

  it('extracts mutations from todo.air', () => {
    const ast = parseFile('todo');
    const ctx = extractContext(ast);
    const mutations = extractMutations(ctx.uiNodes);
    const names = mutations.map(m => m.name);
    expect(names).toContain('add');
    expect(names).toContain('del');
  });
});

// ---- Integration: todo.air ----

describe('transpile: todo.air', () => {
  const jsx = getAppJsx('todo');

  it('generates useState for items and filter', () => {
    expect(jsx).toContain('useState');
    expect(jsx).toContain('setItems');
    expect(jsx).toContain('setFilter');
  });

  it('generates add mutation', () => {
    expect(jsx).toContain('const add');
    expect(jsx).toMatch(/setItems\(prev => \[\.\.\.prev/);
  });

  it('generates del mutation', () => {
    expect(jsx).toContain('const del');
    expect(jsx).toMatch(/prev\.filter/);
  });

  it('generates .map() for iteration', () => {
    expect(jsx).toContain('.map(');
  });

  it('generates localStorage persistence', () => {
    expect(jsx).toContain('localStorage');
    expect(jsx).toContain('getItem');
    expect(jsx).toContain('setItem');
  });

  it('generates themed root div with CSS variables', () => {
    expect(jsx).toContain('bg-[var(--bg)]');
    expect(jsx).toContain('text-[var(--fg)]');
  });

  it('generates filter tabs', () => {
    expect(jsx).toContain('"all"');
    expect(jsx).toContain('"active"');
    expect(jsx).toContain('"done"');
    expect(jsx).toContain('setFilter');
  });

  it('generates footer with interpolated text', () => {
    expect(jsx).toContain('items left');
  });
});

// ---- Integration: expense-tracker.air ----

describe('transpile: expense-tracker.air', () => {
  const jsx = getAppJsx('expense-tracker');

  it('generates useState with default budget 2000', () => {
    expect(jsx).toContain('useState(2000)');
  });

  it('generates .reduce() for sum', () => {
    expect(jsx).toContain('.reduce(');
  });

  it('generates grid layout', () => {
    expect(jsx).toContain('grid');
  });

  it('generates progress bar with CSS variable styling', () => {
    expect(jsx).toContain('overflow-hidden');
    expect(jsx).toContain('width:');
    expect(jsx).toContain('bg-[var(--accent)]');
  });

  it('generates stat cards', () => {
    expect(jsx).toContain('Total');
    expect(jsx).toContain('Average');
  });

  it('generates expense card iteration', () => {
    expect(jsx).toContain('.map((expense)');
  });
});

// ---- Integration: auth.air ----

describe('transpile: auth.air', () => {
  const jsx = getAppJsx('auth');

  it('generates page navigation state', () => {
    expect(jsx).toContain('currentPage');
    expect(jsx).toContain('setCurrentPage');
  });

  it('generates login page', () => {
    expect(jsx).toContain("currentPage === 'login'");
  });

  it('generates dashboard page', () => {
    expect(jsx).toContain("currentPage === 'dashboard'");
  });

  it('generates form element', () => {
    expect(jsx).toContain('<form');
  });

  it('generates input elements', () => {
    expect(jsx).toMatch(/type="(email|password)"/);
  });

  it('generates cookie persistence', () => {
    expect(jsx).toContain('document.cookie');
  });

  it('generates input placeholders', () => {
    expect(jsx).toContain('placeholder="Email..."');
    expect(jsx).toContain('placeholder="Password..."');
  });

  it('generates page navigation link', () => {
    expect(jsx).toContain('setCurrentPage');
    expect(jsx).toContain('Create account');
  });

  it('generates login and logout mutations', () => {
    expect(jsx).toContain('const login');
    expect(jsx).toContain('const logout');
  });
});

// ---- Integration: dashboard.air ----

describe('transpile: dashboard.air', () => {
  const jsx = getAppJsx('dashboard');

  it('generates sidebar layout', () => {
    expect(jsx).toContain('<aside');
  });

  it('generates main content', () => {
    expect(jsx).toContain('<main');
  });

  it('generates stat cards', () => {
    expect(jsx).toContain('Total Users');
  });

  it('generates useEffect for hooks', () => {
    expect(jsx).toContain('useEffect');
  });

  it('generates page navigation', () => {
    expect(jsx).toContain('currentPage');
  });
});

// ---- Integration: landing.air ----

describe('transpile: landing.air', () => {
  const jsx = getAppJsx('landing');

  it('generates section elements', () => {
    expect(jsx).toContain('id="hero"');
    expect(jsx).toContain('id="features"');
    expect(jsx).toContain('id="pricing"');
    expect(jsx).toContain('id="cta"');
  });

  it('generates grid for features', () => {
    expect(jsx).toContain('grid-cols-3');
  });

  it('generates themed root div with CSS variables', () => {
    expect(jsx).toContain('bg-[var(--bg)]');
    expect(jsx).toContain('text-[var(--fg)]');
  });

  it('generates hero text', () => {
    expect(jsx).toContain('Build Software Without Code');
  });

  it('generates primary button', () => {
    expect(jsx).toContain('Get Started');
  });
});

// ---- Golden output: todo.air codegen shape ----

describe('golden: todo.air codegen shape', () => {
  const result = transpileFile('todo');
  const jsx = result.files.find(f => f.path === 'src/App.jsx')!.content;
  const lines = jsx.split('\n');

  it('produces exactly 8 scaffold files', () => {
    const paths = result.files.map(f => f.path).sort();
    expect(paths).toEqual([
      'index.html',
      'package.json',
      'postcss.config.cjs',
      'src/App.jsx',
      'src/index.css',
      'src/main.jsx',
      'tailwind.config.cjs',
      'vite.config.js',
    ]);
  });

  it('App.jsx starts with React import and function declaration', () => {
    expect(lines[0]).toBe("import { useState, useEffect } from 'react';");
    expect(jsx).toContain('export default function App()');
  });

  it('declares state in order: items then filter', () => {
    const itemsIdx = lines.findIndex(l => l.includes('useState') && l.includes('items'));
    const filterIdx = lines.findIndex(l => l.includes('useState') && l.includes('filter'));
    expect(itemsIdx).toBeGreaterThan(0);
    expect(filterIdx).toBeGreaterThan(itemsIdx);
  });

  it('persist load comes before persist save', () => {
    const loadIdx = lines.findIndex(l => l.includes('localStorage.getItem'));
    const saveIdx = lines.findIndex(l => l.includes('localStorage.setItem'));
    expect(loadIdx).toBeGreaterThan(0);
    expect(saveIdx).toBeGreaterThan(loadIdx);
  });

  it('mutations come after persist, before return', () => {
    const saveIdx = lines.findIndex(l => l.includes('setItem'));
    const addIdx = lines.findIndex(l => l.includes('const add'));
    const delIdx = lines.findIndex(l => l.includes('const del'));
    const returnIdx = lines.findIndex(l => l.trimStart().startsWith('return ('));
    expect(addIdx).toBeGreaterThan(saveIdx);
    expect(delIdx).toBeGreaterThan(addIdx);
    expect(returnIdx).toBeGreaterThan(delIdx);
  });

  it('JSX has expected structural markers in order', () => {
    const markers = [
      'min-h-screen',
      '<header',
      'items.length',
      'onKeyDown',
      '<ul',
      '.map(',
      'checkbox',
      'item.text',
      'del(',
      '"all"',
      '"active"',
      '"done"',
      '<footer',
      'items left',
    ];
    let lastIdx = -1;
    for (const marker of markers) {
      const idx = jsx.indexOf(marker, lastIdx + 1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });
});

// ---- Semantics matrix: supported vs stubbed ----

describe('semantics: supported features', () => {
  // Frontend features — fully implemented
  it('@state → useState declarations', () => {
    expect(getAppJsx('todo')).toContain('useState');
  });

  it('@style → theme-aware CSS variables (dark/light palette)', () => {
    const todoCss = transpileFile('todo').files.find(f => f.path === 'src/index.css')!.content;
    expect(todoCss).toContain('--accent: #6366f1');
    expect(todoCss).toContain('--bg: #030712');  // dark theme
    expect(todoCss).toContain('--fg: #f3f4f6');
    expect(todoCss).toContain('--border:');
    expect(todoCss).toContain('--hover:');
    const landingCss = transpileFile('landing').files.find(f => f.path === 'src/index.css')!.content;
    expect(landingCss).toContain('--bg: #ffffff');  // light theme
    expect(landingCss).toContain('--fg: #111827');
    expect(getAppJsx('todo')).toContain('bg-[var(--bg)]');
    expect(getAppJsx('landing')).toContain('bg-[var(--bg)]');
  });

  it('@persist:localStorage → useEffect load/save', () => {
    expect(getAppJsx('todo')).toContain('localStorage.getItem');
    expect(getAppJsx('todo')).toContain('localStorage.setItem');
  });

  it('@persist:cookie → document.cookie (client-side only, httpOnly ignored)', () => {
    const jsx = getAppJsx('auth');
    expect(jsx).toContain('document.cookie');
    // Limitation: httpOnly flag from @persist:cookie(...,httpOnly) is ignored
    // because document.cookie cannot set httpOnly — that requires a Set-Cookie
    // header from a server response. Real httpOnly cookies need a backend target.
  });

  it('@hook:onMount → useEffect(fn, [])', () => {
    expect(getAppJsx('dashboard')).toContain('useEffect');
  });

  it('mutations (!add, !del) → handler functions', () => {
    const jsx = getAppJsx('todo');
    expect(jsx).toContain('const add');
    expect(jsx).toContain('const del');
  });

  it('iteration (*items) → .map()', () => {
    expect(getAppJsx('todo')).toContain('.map(');
  });

  it('pages (@page) → conditional rendering', () => {
    expect(getAppJsx('auth')).toContain("currentPage === 'login'");
  });

  it('sections (@section) → <section id=...>', () => {
    expect(getAppJsx('landing')).toContain('id="hero"');
  });

  it('|filter → .filter(), |sum → .reduce(), |sort → .sort()', () => {
    const jsx = getAppJsx('expense-tracker');
    expect(jsx).toContain('.reduce(');  // |sum(amount) → .reduce((s,x) => s + x.amount, 0)
    expect(jsx).toContain('.sort(');    // |sort → .sort() with comparator
    expect(jsx).toContain('.filter(');  // |filter → .filter() by category
  });

  it('forms (form, input:email, input:password) → HTML form elements', () => {
    expect(getAppJsx('auth')).toContain('<form');
    expect(getAppJsx('auth')).toMatch(/type="(email|password)"/);
  });

  it('layout (sidebar+main, grid:responsive) → structural HTML', () => {
    expect(getAppJsx('dashboard')).toContain('<aside');
    expect(getAppJsx('dashboard')).toContain('<main');
    expect(getAppJsx('expense-tracker')).toContain('grid-cols');
  });
});

describe('semantics: stubbed/unsupported for React target', () => {
  // Backend blocks — parsed but NOT implemented in React output
  it('@api routes are NOT emitted as fetch calls (server-side)', () => {
    const ast = parseFile('auth');
    const ctx = extractContext(ast);
    expect(ctx.apiRoutes.length).toBeGreaterThan(0);
    // API routes are extracted from AST but not wired into App.jsx
    // (would need a backend target or API mocking layer)
  });

  it('@auth is extracted but auth guard is a stub', () => {
    const ast = parseFile('dashboard');
    const ctx = extractContext(ast);
    expect(ctx.auth).not.toBeNull();
    // Auth is extracted; pages render conditionally, but real auth
    // flow (token validation, redirects) is not implemented
  });

  it('@nav routes are extracted but no client-side router', () => {
    const ast = parseFile('landing');
    const ctx = extractContext(ast);
    expect(ctx.navRoutes.length).toBeGreaterThan(0);
    // Nav routes are available in context, but no react-router
    // integration — pages use simple state-based switching
  });

  // Operators that soft-fail
  it('~ (async) operator renders as placeholder', () => {
    // ~fetch, ~api calls → comments or console.log stubs
    // Not wired to real network calls
  });

  it('^ (emit) operator renders as placeholder', () => {
    // ^event → comments, no real event system
  });

  // Blocks not yet supported in any target
  // @db, @cron, @webhook, @queue, @email, @env, @deploy
  // These parse correctly but have no transpiler output
});

// ---- Smoke: output structure ----

describe('transpile: output structure', () => {
  it('generates valid package.json', () => {
    const result = transpileFile('todo');
    const pkgFile = result.files.find(f => f.path === 'package.json');
    expect(pkgFile).toBeDefined();
    const pkg = JSON.parse(pkgFile!.content);
    expect(pkg.name).toBe('todo');
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.devDependencies.vite).toBeDefined();
    expect(pkg.devDependencies.tailwindcss).toBeDefined();
  });

  it('generates App.jsx with export default', () => {
    const result = transpileFile('todo');
    const app = result.files.find(f => f.path === 'src/App.jsx');
    expect(app).toBeDefined();
    expect(app!.content).toContain('export default function App');
  });

  it('generates all expected scaffold files', () => {
    const result = transpileFile('todo');
    const paths = result.files.map(f => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('vite.config.js');
    expect(paths).toContain('tailwind.config.cjs');
    expect(paths).toContain('postcss.config.cjs');
    expect(paths).toContain('index.html');
    expect(paths).toContain('src/main.jsx');
    expect(paths).toContain('src/index.css');
    expect(paths).toContain('src/App.jsx');
  });

  it('generates index.css with full theme token palette', () => {
    const result = transpileFile('todo');
    const css = result.files.find(f => f.path === 'src/index.css')!.content;
    expect(css).toContain('--accent: #6366f1');
    expect(css).toContain('--radius: 12px');
    expect(css).toContain('--bg:');
    expect(css).toContain('--fg:');
    expect(css).toContain('--muted:');
    expect(css).toContain('--border:');
    expect(css).toContain('--border-input:');
    expect(css).toContain('--hover:');
    expect(css).toContain('--card-shadow:');
    expect(css).toContain('background: var(--bg)');
    expect(css).toContain('color: var(--fg)');
    expect(css).toContain('@tailwind');
  });

  it('App.jsx uses CSS variables for component styling', () => {
    const jsx = getAppJsx('todo');
    expect(jsx).toContain('var(--bg)');
    expect(jsx).toContain('var(--fg)');
    expect(jsx).toContain('var(--accent)');
    expect(jsx).toContain('var(--radius)');
    expect(jsx).toContain('var(--border)');
    // No hardcoded theme colors
    expect(jsx).not.toContain('bg-gray-950');
    expect(jsx).not.toContain('bg-white text-gray-900');
  });

  it('reports stats', () => {
    const result = transpileFile('todo');
    expect(result.stats.outputLines).toBeGreaterThan(50);
    expect(result.stats.components).toBeGreaterThanOrEqual(1);
  });
});
