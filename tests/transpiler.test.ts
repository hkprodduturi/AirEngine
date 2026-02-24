import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';
import { extractContext } from '../src/transpiler/context.js';
import { resolveBindChain, analyzeUI, extractMutations } from '../src/transpiler/normalize-ui.js';
import { mapElement } from '../src/transpiler/element-map.js';
import { expandCrud } from '../src/transpiler/route-utils.js';
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
  const appFile = result.files.find(f => f.path === 'src/App.jsx' || f.path === 'client/src/App.jsx');
  return appFile?.content ?? '';
}

/** Returns App.jsx + all page component files concatenated. Use for content checks that span pages. */
function getAllJsx(name: string): string {
  const result = transpileFile(name);
  const appFile = result.files.find(f => f.path === 'src/App.jsx' || f.path === 'client/src/App.jsx');
  const pageFiles = result.files.filter(f => f.path.includes('/pages/') && f.path.endsWith('.jsx'));
  return [appFile?.content ?? '', ...pageFiles.map(f => f.content)].join('\n');
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

  it('wraps content in default 900px container', () => {
    expect(jsx).toContain('max-w-[900px]');
    expect(jsx).toContain('mx-auto');
    expect(jsx).toContain('px-6 py-8');
  });

  it('generates segmented tab control', () => {
    expect(jsx).toContain('bg-[var(--surface)]');
    expect(jsx).toContain('rounded-[calc(var(--radius)-4px)]');
    expect(jsx).toContain("text-[var(--muted)] hover:text-[var(--fg)]");
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

  it('generates stat cards with structured layout', () => {
    expect(jsx).toContain('Total');
    expect(jsx).toContain('Average');
    expect(jsx).toContain('bg-[var(--surface)]');
    expect(jsx).toContain('uppercase tracking-wide');
    expect(jsx).toContain('text-2xl font-bold');
  });

  it('generates expense card iteration', () => {
    expect(jsx).toContain('.map((expense)');
  });
});

// ---- Integration: auth.air ----

describe('transpile: auth.air', () => {
  const jsx = getAppJsx('auth');
  const allJsx = getAllJsx('auth');

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
    expect(allJsx).toContain('<form');
  });

  it('generates input elements', () => {
    expect(allJsx).toMatch(/type="(email|password)"/);
  });

  it('generates cookie persistence', () => {
    expect(jsx).toContain('document.cookie');
  });

  it('generates input placeholders', () => {
    expect(allJsx).toContain('placeholder="Email..."');
    expect(allJsx).toContain('placeholder="Password..."');
  });

  it('generates page navigation link', () => {
    expect(jsx).toContain('setCurrentPage');
    expect(allJsx).toContain('Create account');
  });

  it('generates login and logout mutations', () => {
    expect(jsx).toContain('const login');
    expect(jsx).toContain('const logout');
  });
});

// ---- Integration: dashboard.air ----

describe('transpile: dashboard.air', () => {
  const jsx = getAppJsx('dashboard');
  const allJsx = getAllJsx('dashboard');

  it('generates sidebar layout', () => {
    expect(jsx).toContain('<aside');
  });

  it('generates main content', () => {
    expect(jsx).toContain('<main');
  });

  it('generates stat cards', () => {
    expect(allJsx).toContain('Total Users');
  });

  it('generates useEffect for hooks', () => {
    expect(jsx).toContain('useEffect');
  });

  it('generates page navigation', () => {
    expect(jsx).toContain('currentPage');
  });

  it('generates nav buttons with active state', () => {
    expect(jsx).toContain("setCurrentPage('overview')");
    expect(jsx).toContain("setCurrentPage('users')");
    expect(jsx).toContain("setCurrentPage('settings')");
    expect(jsx).toContain("bg-[var(--accent)] text-white");
  });

  it('generates revenue stat with currency formatting', () => {
    expect(allJsx).toContain('Revenue');
    expect(allJsx).toContain("'$' + (stats.revenue).toFixed(2)");
  });

  it('generates table with column headers', () => {
    expect(allJsx).toContain('<table');
    expect(allJsx).toContain('<thead');
    expect(allJsx).toContain('<tbody');
    expect(allJsx).toContain('>Name</th>');
    expect(allJsx).toContain('>Email</th>');
    expect(allJsx).toContain('>Role</th>');
    expect(allJsx).toContain('>Active</th>');
  });

  it('generates table row mapping with data fields', () => {
    expect(allJsx).toContain('.map((row)');
    expect(allJsx).toContain('row.name');
    expect(allJsx).toContain('row.email');
    expect(allJsx).toContain('row.role');
  });

  it('generates search filter for table', () => {
    expect(allJsx).toContain('.filter(');
    expect(allJsx).toContain('search.toLowerCase()');
  });

  it('generates period select dropdown', () => {
    expect(allJsx).toContain('<select');
    expect(allJsx).toContain('setPeriod');
    expect(allJsx).toContain('value="7d"');
    expect(allJsx).toContain('value="30d"');
    expect(allJsx).toContain('value="90d"');
    expect(allJsx).toContain('value="1y"');
  });

  it('generates chart placeholder', () => {
    expect(allJsx).toContain('chart');
  });

  it('generates pagination', () => {
    expect(allJsx).toContain('Prev');
    expect(allJsx).toContain('Next');
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

  it('generates icon emojis', () => {
    expect(jsx).toContain('&#9889;');   // zap
    expect(jsx).toContain('&#128737;'); // shield
    expect(jsx).toContain('&#128101;'); // users
  });

  it('generates pricing cards with structured content', () => {
    expect(jsx).toContain('$29/mo');
    expect(jsx).toContain('Custom');
    expect(jsx).toContain('font-semibold');
  });

  it('generates feature lists from plan elements', () => {
    expect(jsx).toContain('<ul');
    expect(jsx).toContain('5 apps');
    expect(jsx).toContain('community');
    expect(jsx).toContain('unlimited');
    expect(jsx).toContain('&#10004;');
  });

  it('generates pricing buttons', () => {
    expect(jsx).toContain('Start Free');
    expect(jsx).toContain('Go Pro');
    expect(jsx).toContain('Contact');
  });

  it('generates Popular badge', () => {
    expect(jsx).toContain('Popular');
    expect(jsx).toContain('rounded-full');
  });

  it('generates CTA with email input and waitlist button', () => {
    expect(jsx).toContain('type="email"');
    expect(jsx).toContain('Join Waitlist');
  });

  it('generates hero image', () => {
    expect(jsx).toContain('<img');
    expect(jsx).toContain('/assets/hero.png');
  });

  it('wraps grid compose children in containers', () => {
    expect(jsx).toContain('flex flex-col gap-4');
  });
});

// ---- Golden output: todo.air codegen shape ----

describe('golden: todo.air codegen shape', () => {
  const result = transpileFile('todo');
  const jsx = result.files.find(f => f.path === 'src/App.jsx')!.content;
  const lines = jsx.split('\n');

  it('produces exactly 9 scaffold files (including manifest)', () => {
    const paths = result.files.map(f => f.path).sort();
    expect(paths).toEqual([
      '_airengine_manifest.json',
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

  it('App.jsx starts with provenance header and React import', () => {
    expect(lines[0]).toMatch(/^\/\/ Generated by AirEngine/);
    expect(lines[1]).toBe("import { useState, useEffect } from 'react';");
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

// ---- Golden output: dashboard.air codegen shape ----

describe('golden: dashboard.air codegen shape', () => {
  const result = transpileFile('dashboard');
  const jsx = result.files.find(f => f.path === 'src/App.jsx' || f.path === 'client/src/App.jsx')!.content;
  const allJsx = getAllJsx('dashboard');
  const lines = jsx.split('\n');

  it('App.jsx starts with provenance header and React import', () => {
    expect(lines[0]).toMatch(/^\/\/ Generated by AirEngine/);
    expect(lines[1]).toBe("import { useState, useEffect } from 'react';");
  });

  it('declares state in order: users, stats, search, period', () => {
    const usersIdx = lines.findIndex(l => l.includes('useState') && l.includes('users'));
    const statsIdx = lines.findIndex(l => l.includes('useState') && l.includes('stats'));
    const searchIdx = lines.findIndex(l => l.includes('useState') && l.includes('search'));
    const periodIdx = lines.findIndex(l => l.includes('useState') && l.includes('period'));
    expect(usersIdx).toBeGreaterThan(0);
    expect(statsIdx).toBeGreaterThan(usersIdx);
    expect(searchIdx).toBeGreaterThan(statsIdx);
    expect(periodIdx).toBeGreaterThan(searchIdx);
  });

  it('currentPage state comes after domain state', () => {
    const periodIdx = lines.findIndex(l => l.includes('period'));
    const pageIdx = lines.findIndex(l => l.includes('currentPage'));
    expect(pageIdx).toBeGreaterThan(periodIdx);
  });

  it('useEffect hook call is before return', () => {
    const effectIdx = lines.findIndex(l => l.includes('useEffect('));
    const returnIdx = lines.findIndex(l => l.trimStart().startsWith('return ('));
    expect(effectIdx).toBeGreaterThan(0);
    expect(returnIdx).toBeGreaterThan(effectIdx);
  });

  it('JSX has expected structural markers in order', () => {
    // App.jsx structural markers (component refs, not inline content)
    const appMarkers = [
      'min-h-screen',    // root wrapper
      '<aside',          // sidebar
      'Dashboard',       // app title
      '<nav',            // navigation
      'setCurrentPage',  // page switching
      '<main',           // main content area
      'OverviewPage',    // page component ref
      'UsersPage',       // page component ref
    ];
    let lastIdx = -1;
    for (const marker of appMarkers) {
      const idx = jsx.indexOf(marker, lastIdx + 1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }

    // Page content markers exist across page component files
    const contentMarkers = [
      'Total Users',     // stat card
      'Revenue',         // revenue stat
      'toFixed(2)',      // currency formatting
      'chart',             // chart stub (SVG icon + label)
      '<table',          // data table
      '<thead',          // table header
      'Name',            // column header
      '<tbody',          // table body
      '.filter(',        // search filter
      '.map(',           // row iteration
      'row.name',        // data field access
      'Prev',            // pagination
      'Next',            // pagination
    ];
    for (const marker of contentMarkers) {
      expect(allJsx).toContain(marker);
    }
  });
});

// ---- Golden output: landing.air codegen shape ----

describe('golden: landing.air codegen shape', () => {
  const result = transpileFile('landing');
  const jsx = result.files.find(f => f.path === 'src/App.jsx')!.content;
  const css = result.files.find(f => f.path === 'src/index.css')!.content;

  it('is a stateless component (no useState calls)', () => {
    expect(jsx).not.toMatch(/const \[.+, set.+\] = useState/);
  });

  it('uses light theme CSS variables', () => {
    expect(css).toContain('--bg: #ffffff');
    expect(css).toContain('--fg: #111827');
    expect(css).toContain('--accent: #7c3aed');
  });

  it('respects maxWidth from @style', () => {
    expect(jsx).toContain('max-w-[1200px]');
  });

  it('JSX has expected structural markers in order', () => {
    const markers = [
      'min-h-screen',          // root wrapper
      'id="hero"',             // hero section
      'Build Software',        // hero heading
      'Get Started',           // primary CTA
      'Watch Demo',            // secondary CTA
      '/assets/hero.png',      // hero image
      'id="features"',         // features section
      'Why AirEngine',         // features heading
      'grid-cols-3',           // 3-column grid
      '&#9889;',               // zap icon
      'Fast',                  // feature card 1
      '&#128737;',             // shield icon
      'Reliable',              // feature card 2
      '&#128101;',             // users icon
      'Collaborative',         // feature card 3
      'id="pricing"',          // pricing section
      'Simple Pricing',        // pricing heading
      'Free',                  // free tier
      '5 apps',                // free features
      '$29/mo',                // pro price
      'unlimited',             // pro features
      'Go Pro',                // pro CTA
      'Popular',               // popular badge
      'Enterprise',            // enterprise tier
      'Custom',                // custom pricing
      'Contact',               // enterprise CTA
      'id="cta"',              // CTA section
      'Ready to build',        // CTA heading
      'type="email"',          // email input
      'Join Waitlist',         // waitlist button
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
    expect(getAllJsx('auth')).toContain('<form');
    expect(getAllJsx('auth')).toMatch(/type="(email|password)"/);
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
    expect(css).toContain('--accent-rgb:');
    expect(css).toContain('--radius: 12px');
    expect(css).toContain('--bg:');
    expect(css).toContain('--fg:');
    expect(css).toContain('--muted:');
    expect(css).toContain('--border:');
    expect(css).toContain('--border-input:');
    expect(css).toContain('--hover:');
    expect(css).toContain('--card-shadow:');
    expect(css).toContain('--surface:');
    expect(css).toContain('background: var(--bg)');
    expect(css).toContain('color: var(--fg)');
    expect(css).toContain('@tailwind');
  });

  it('generates component CSS primitives in index.css', () => {
    const result = transpileFile('todo');
    const css = result.files.find(f => f.path === 'src/index.css')!.content;
    expect(css).toContain('.form-group');
    expect(css).toContain('.empty-state');
    expect(css).toContain('.card');
    expect(css).toContain('border-collapse');
    expect(css).toContain('button:disabled');
    expect(css).toContain('rgba(var(--accent-rgb)');
    expect(css).toContain('aside { background: var(--surface)');
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

// ---- D1: Visual Semantics ----

describe('D1: visual semantics', () => {
  it('input > !add renders both input and visible button (todo.air)', () => {
    const jsx = getAppJsx('todo');
    expect(jsx).toContain('<input');
    expect(jsx).toContain('<button');
    expect(jsx).toContain('previousElementSibling');
  });

  it('button label matches action name', () => {
    const jsx = getAppJsx('todo');
    expect(jsx).toContain('>Add</button>');
  });

  it('binding-only inputs do NOT get extra buttons', () => {
    // input:text>#search should NOT produce a sibling button
    const ast = parse('@app:t\n@state{search:str}\n@ui(\ninput:text>#search\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'src/App.jsx')!;
    expect(app.content).toContain('<input');
    expect(app.content).not.toContain('previousElementSibling');
  });

  it('list iteration includes empty state check (todo.air)', () => {
    const jsx = getAppJsx('todo');
    expect(jsx).toContain('length === 0');
    expect(jsx).toContain('empty-state');
    expect(jsx).toContain('No items yet');
  });

  it('content wrapper has space-y-6 (todo.air)', () => {
    const jsx = getAppJsx('todo');
    expect(jsx).toContain('space-y-6');
  });

  it('main element has space-y-6 (dashboard.air)', () => {
    const jsx = getAppJsx('dashboard');
    expect(jsx).toContain('space-y-6');
  });

  it('auth login form has card container (auth.air)', () => {
    const jsx = getAllJsx('auth');
    expect(jsx).toContain('bg-[var(--surface)]');
    expect(jsx).toContain('border border-[var(--border)]');
    expect(jsx).toContain('rounded-[var(--radius)]');
    expect(jsx).toContain('p-8');
  });
});

// ---- New elements & modifiers ----

describe('element-map: new elements', () => {
  it('code maps to <code> with mono styling', () => {
    const m = mapElement('code', []);
    expect(m.tag).toBe('code');
    expect(m.className).toContain('font-mono');
  });

  it('code:block maps to <pre>', () => {
    const m = mapElement('code', ['block']);
    expect(m.tag).toBe('pre');
    expect(m.className).toContain('whitespace-pre');
    expect(m.className).toContain('overflow-x-auto');
  });

  it('pre maps to <pre>', () => {
    const m = mapElement('pre', []);
    expect(m.tag).toBe('pre');
    expect(m.className).toContain('font-mono');
  });

  it('divider maps to self-closing <hr>', () => {
    const m = mapElement('divider', []);
    expect(m.tag).toBe('hr');
    expect(m.selfClosing).toBe(true);
    expect(m.className).toContain('border-t');
  });
});

describe('element-map: p modifiers', () => {
  it('p:muted has muted color', () => {
    const m = mapElement('p', ['muted']);
    expect(m.className).toContain('text-[var(--muted)]');
  });

  it('p:center has text-center', () => {
    const m = mapElement('p', ['center']);
    expect(m.className).toContain('text-center');
  });

  it('p:small has text-sm and muted', () => {
    const m = mapElement('p', ['small']);
    expect(m.className).toContain('text-sm');
    expect(m.className).toContain('text-[var(--muted)]');
  });

  it('p:lead has text-lg and max-w-2xl', () => {
    const m = mapElement('p', ['lead']);
    expect(m.className).toContain('text-lg');
    expect(m.className).toContain('max-w-2xl');
  });
});

describe('element-map: h1 modifiers', () => {
  it('h1:hero has extra-large bold text', () => {
    const m = mapElement('h1', ['hero']);
    expect(m.className).toContain('text-5xl');
    expect(m.className).toContain('font-extrabold');
  });

  it('h1:display has large bold text', () => {
    const m = mapElement('h1', ['display']);
    expect(m.className).toContain('text-4xl');
    expect(m.className).toContain('font-bold');
  });
});

// ---- Section-aware styling ----

describe('section-name-aware styling', () => {
  it('hero section gets centered + larger padding', () => {
    const jsx = getAppJsx('landing');
    expect(jsx).toContain('id="hero"');
    expect(jsx).toMatch(/id="hero"[^>]*py-24/);
    expect(jsx).toMatch(/id="hero"[^>]*text-center/);
  });

  it('cta section gets centered styling', () => {
    const jsx = getAppJsx('landing');
    expect(jsx).toContain('id="cta"');
    expect(jsx).toMatch(/id="cta"[^>]*py-20/);
    expect(jsx).toMatch(/id="cta"[^>]*text-center/);
  });

  it('regular sections keep default styling', () => {
    const jsx = getAppJsx('landing');
    expect(jsx).toMatch(/id="features"[^>]*py-16/);
  });
});

// ---- Pre child text rendering ----

describe('pre/code:block text rendering', () => {
  it('code:block with children renders joined text in template literal', () => {
    const ast = parse('@app:t\n@ui(\ncode:block("line 1","line 2","line 3")\n)');
    const result = transpile(ast);
    const app = result.files.find(f => f.path === 'src/App.jsx')!;
    expect(app.content).toContain('<pre');
    expect(app.content).toContain('line 1');
    expect(app.content).toContain('line 2');
    expect(app.content).toContain('line 3');
  });
});

// ---- Base CSS ----

describe('scaffold: code/pre/hr CSS', () => {
  it('index.css includes code/pre font-family', () => {
    const result = transpileFile('todo');
    const css = result.files.find(f => f.path === 'src/index.css')!.content;
    expect(css).toContain("code { font-family: 'SF Mono'");
    expect(css).toContain("pre { font-family: 'SF Mono'");
    expect(css).toContain('hr { border: none; }');
  });
});

// ---- airengine-site.air integration ----

describe('airengine-site.air integration', () => {
  const result = transpileFile('airengine-site');
  const appFile = result.files.find(f => f.path === 'src/App.jsx');
  const jsx = appFile?.content ?? '';
  const css = result.files.find(f => f.path === 'src/index.css')!.content;

  it('transpiles successfully', () => {
    expect(result.files.length).toBeGreaterThan(0);
    expect(appFile).toBeDefined();
  });

  it('uses 1100px container', () => {
    expect(jsx).toContain('max-w-[1100px]');
  });

  it('hero section has centered styling', () => {
    expect(jsx).toMatch(/id="hero"[^>]*text-center/);
  });

  it('h1:hero modifier produces large heading', () => {
    expect(jsx).toContain('text-5xl');
    expect(jsx).toContain('font-extrabold');
  });

  it('p:lead modifier produces lead text', () => {
    expect(jsx).toContain('text-lg');
    expect(jsx).toContain('max-w-2xl');
  });

  it('p:muted modifier produces muted text', () => {
    expect(jsx).toContain('text-[var(--muted)]');
  });

  it('code:block renders as <pre> with code content', () => {
    expect(jsx).toContain('<pre');
    expect(jsx).toContain('@app:todo');
  });

  it('has all expected sections', () => {
    const sections = ['hero', 'stats', 'code', 'how', 'features', 'blocks', 'start', 'cta', 'footer'];
    for (const s of sections) {
      expect(jsx).toContain(`id="${s}"`);
    }
  });

  it('footer section has compact styling', () => {
    expect(jsx).toMatch(/id="footer"[^>]*py-8/);
    expect(jsx).toMatch(/id="footer"[^>]*border-t/);
  });

  it('p:small modifier produces small muted text', () => {
    expect(jsx).toContain('text-sm');
  });

  it('CSS uses dark theme and accent', () => {
    expect(css).toContain('--accent: #7c5cfc');
    expect(css).toContain('--bg: #030712');
  });
});

// ---- Batch 1: Transpiler Foundation Tests ----

describe('Batch 1: memoization, timing, provenance', () => {
  const ast = parseFile('fullstack-todo');
  const ctx = extractContext(ast);
  const source = readFileSync('examples/fullstack-todo.air', 'utf-8');
  const result = transpile(ast, { sourceLines: source.split('\n').length });

  it('expandedRoutes matches expandCrud(apiRoutes)', () => {
    const expected = expandCrud(ctx.apiRoutes);
    expect(ctx.expandedRoutes).toEqual(expected);
  });

  it('expandedRoutes is populated for fullstack app', () => {
    expect(ctx.expandedRoutes.length).toBeGreaterThan(0);
    expect(ctx.expandedRoutes.some(r => r.method === 'GET')).toBe(true);
    expect(ctx.expandedRoutes.some(r => r.method === 'POST')).toBe(true);
  });

  it('timing fields exist and are non-negative', () => {
    const t = result.stats.timing;
    expect(t.extractMs).toBeGreaterThanOrEqual(0);
    expect(t.analyzeMs).toBeGreaterThanOrEqual(0);
    expect(t.clientGenMs).toBeGreaterThanOrEqual(0);
    expect(t.serverGenMs).toBeGreaterThanOrEqual(0);
    expect(t.totalMs).toBeGreaterThanOrEqual(0);
    expect(t.totalMs).toBeGreaterThanOrEqual(t.extractMs);
  });

  it('inputLines equals source line count when sourceLines provided', () => {
    expect(result.stats.inputLines).toBe(source.split('\n').length);
    expect(result.stats.inputLines).toBeGreaterThan(0);
  });

  it('compressionRatio is computed when sourceLines provided', () => {
    expect(result.stats.compressionRatio).toBeGreaterThan(0);
  });

  it('provenance header present on .jsx/.ts/.js files', () => {
    const jsxFiles = result.files.filter(f => /\.(jsx|ts|js)$/.test(f.path));
    expect(jsxFiles.length).toBeGreaterThan(0);
    for (const f of jsxFiles) {
      expect(f.content).toMatch(/^\/\/ Generated by AirEngine/);
    }
  });

  it('provenance header NOT added to non-source files', () => {
    const nonSource = result.files.filter(f => /\.(json|css|html|prisma|cjs|md)$/.test(f.path));
    for (const f of nonSource) {
      expect(f.content).not.toMatch(/^\/\/ Generated by AirEngine/);
    }
  });

  it('frontend-only app has zero expandedRoutes', () => {
    const todoCtx = extractContext(parseFile('todo'));
    expect(todoCtx.expandedRoutes).toEqual([]);
  });
});
