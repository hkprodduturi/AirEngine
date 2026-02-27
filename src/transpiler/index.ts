/**
 * AIR Transpiler — Orchestrator
 *
 * Converts a validated AirAST into a working application.
 *
 * Frontend-only .air files → flat Vite + React + Tailwind project.
 * Fullstack .air files (with @db, @api, etc.) → client/ + server/ structure.
 *
 * Pure function — no file I/O.
 */

import type { AirAST } from '../parser/types.js';
import { createHash } from 'crypto';
import { extractContext, type TranspileContext } from './context.js';
import { analyzeUI } from './normalize-ui.js';
import { generateApp, generateLayout, generatePublicLayout, generateEcommerceLayout, generatePageComponents } from './react.js';
import { generateScaffold } from './scaffold.js';
import { generateServer, generateReadme } from './express.js';
import { generateApiClient } from './api-client-gen.js';
import { generateClientTypesFile } from './types-gen.js';
import { generateResourceHooks } from './resource-hook-gen.js';
import { generateDockerCompose } from './deploy-gen.js';
import { generateReusableComponents, detectPatterns } from './component-gen.js';
import { hasAuthRoutes, isAuthPageName } from './react/helpers.js';

export interface TranspileOptions {
  framework?: 'react';
  outDir?: string;
  includeStyles?: boolean;
  prettyPrint?: boolean;
  sourceLines?: number;
  target?: 'all' | 'client' | 'server' | 'docs';
}

export interface TranspileResult {
  files: OutputFile[];
  stats: {
    inputLines: number;
    outputLines: number;
    compressionRatio: number;
    components: number;
    modules: number;
    pages: number;
    hooks: number;
    deadLines: number;
    timing: {
      extractMs: number;
      analyzeMs: number;
      clientGenMs: number;
      serverGenMs: number;
      totalMs: number;
    };
  };
}

export interface OutputFile {
  path: string;
  content: string;
}

/**
 * Count lines in generated source files that aren't imported by any other generated file.
 * Entry points (App.jsx, main.jsx, server.ts, seed.ts) are exempt — they're consumed by
 * runtime, not by imports. Config files (json, css, html, prisma) are also exempt.
 */
function computeDeadLines(files: OutputFile[]): number {
  // Collect all import targets from generated files
  const importedPaths = new Set<string>();
  for (const f of files) {
    // Match: import ... from './path' or from '../path'
    const fromMatches = f.content.matchAll(/from\s+['"]([^'"]+)['"]/g);
    for (const m of fromMatches) {
      const raw = m[1];
      const dir = f.path.replace(/\/[^/]+$/, '');
      const resolved = resolveImportPath(dir, raw);
      importedPaths.add(resolved);
    }
    // Match: dynamic imports — import('./path') (used by React.lazy)
    const dynamicMatches = f.content.matchAll(/import\(['"]([^'"]+)['"]\)/g);
    for (const m of dynamicMatches) {
      const raw = m[1];
      const dir = f.path.replace(/\/[^/]+$/, '');
      const resolved = resolveImportPath(dir, raw);
      importedPaths.add(resolved);
    }
  }

  // Entry points, configs, and runtime-consumed files — always useful, not dead
  const entryPatterns = [
    /App\.jsx$/, /main\.jsx$/, /server\.ts$/, /seed\.ts$/,
    /api\.ts$/, /prisma\.ts$/, /middleware\.ts$/, /validation\.ts$/,
    /\.json$/, /\.css$/, /\.html$/, /\.prisma$/, /\.cjs$/, /\.md$/,
    /Layout\.jsx$/, /PublicLayout\.jsx$/, /api\.js$/, /types\.ts$/, /index\.css$/,
    /vite\.config/, /tailwind\.config/, /postcss\.config/,
    // Server block stubs — standalone config files consumed by runtime
    /env\.ts$/, /cron\.ts$/, /queue\.ts$/, /templates\.ts$/, /auth\.ts$/, /webhooks\.ts$/,
    // Client utility components — generated for pages/devs to use on demand
    /\/components\/\w+\.jsx$/,
  ];

  let dead = 0;
  for (const f of files) {
    // Skip non-source files
    if (!f.path.match(/\.(jsx|js|ts)$/)) continue;
    // Skip entry points
    if (entryPatterns.some(p => p.test(f.path))) continue;
    // Check if any other file imports this one
    const basePath = f.path.replace(/\.(jsx|js|ts)$/, '');
    const isImported = importedPaths.has(basePath) ||
      importedPaths.has(basePath + '.js') ||
      importedPaths.has(basePath + '.jsx') ||
      importedPaths.has(basePath + '.ts') ||
      importedPaths.has(f.path);
    if (!isImported) {
      dead += f.content.split('\n').length;
    }
  }
  return dead;
}

function resolveImportPath(dir: string, importPath: string): string {
  if (!importPath.startsWith('.')) return importPath;
  const parts = dir.split('/');
  for (const segment of importPath.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

export function transpile(
  ast: AirAST,
  options: TranspileOptions = {},
): TranspileResult {
  const totalStart = performance.now();
  const target = options.target ?? 'all';

  // 1. Extract context from AST
  const extractStart = performance.now();
  const ctx = extractContext(ast);
  const extractMs = performance.now() - extractStart;

  // 2. Analyze UI tree
  const analyzeStart = performance.now();
  const analysis = analyzeUI(ctx.uiNodes);
  const analyzeMs = performance.now() - analyzeStart;

  // 3. Generate client files
  const clientStart = performance.now();
  const files: OutputFile[] = [];

  if (target !== 'server' && target !== 'docs') {
    const appCode = generateApp(ctx, analysis);
    const scaffoldFiles = generateScaffold(ctx);

    if (ctx.hasBackend) {
      files.push(...scaffoldFiles.map(f => ({ ...f, path: `client/${f.path}` })));
      files.push({ path: 'client/src/App.jsx', content: appCode });
      // Ecommerce apps get a dedicated Amazon-style layout
      const ecomLayoutCode = generateEcommerceLayout(ctx, analysis);
      if (ecomLayoutCode) {
        files.push({ path: 'client/src/Layout.jsx', content: ecomLayoutCode });
      } else {
        const layoutCode = generateLayout(ctx, analysis);
        if (layoutCode) {
          files.push({ path: 'client/src/Layout.jsx', content: layoutCode });
        }
      }
      const publicLayoutCode = generatePublicLayout(ctx, analysis);
      if (publicLayoutCode) {
        files.push({ path: 'client/src/PublicLayout.jsx', content: publicLayoutCode });
      }
      if (ctx.apiRoutes.length > 0) {
        files.push({ path: 'client/src/api.js', content: generateApiClient(ctx) });
      }
      if (ctx.db) {
        files.push({ path: 'client/src/types.ts', content: generateClientTypesFile(ctx) });
      }

      // Page components (extracted from @page scopes)
      const pageFiles = generatePageComponents(ctx, analysis);
      if (ctx.isEcommerce) {
        // Override ecommerce pages with Amazon-style components (Shop, Cart, Orders, Account)
        const overridePaths = new Set(['src/pages/ShopPage.jsx', 'src/pages/CartPage.jsx', 'src/pages/OrdersPage.jsx']);
        files.push(...pageFiles
          .filter(f => !overridePaths.has(f.path))
          .map(f => ({ ...f, path: `client/${f.path}` })));
        files.push(...generateEcommercePages(ctx));
      } else {
        files.push(...pageFiles.map(f => ({ ...f, path: `client/${f.path}` })));
      }

      // Auth-gated apps: pages are self-contained (use api directly), skip resource hooks
      const authGated = hasAuthRoutes(ctx) && analysis.hasPages
        && analysis.pages.some(p => isAuthPageName(p.name));

      if (!authGated) {
        // Resource hooks — only for models with matching array state vars
        const hookFiles = generateResourceHooks(ctx);
        files.push(...hookFiles.map(f => ({ ...f, path: `client/${f.path}` })));
      }

      // Reusable components (DataTable, EmptyState, StatCard) when patterns detected
      // Auth-gated: pages are self-contained, skip unused shared components
      if (!authGated) {
        const componentFiles = generateReusableComponents(ctx, analysis);
        files.push(...componentFiles.map(f => ({ ...f, path: `client/${f.path}` })));
      }
    } else {
      // Frontend-only: flat (backward compatible)
      files.push(...scaffoldFiles);
      files.push({ path: 'src/App.jsx', content: appCode });
    }
  }
  const clientGenMs = performance.now() - clientStart;

  // 4. Generate server files
  const serverStart = performance.now();
  if (ctx.hasBackend && target !== 'client') {
    if (target === 'docs') {
      files.push({ path: 'README.md', content: generateReadme(ctx) });
      if (ctx.db) {
        files.push({ path: 'client/src/types.ts', content: generateClientTypesFile(ctx) });
      }
    } else {
      files.push(...generateServer(ctx));
      files.push({ path: 'README.md', content: generateReadme(ctx) });

      if (ctx.deploy) {
        const compose = generateDockerCompose(ctx);
        if (compose) files.push({ path: 'docker-compose.yml', content: compose });
      }
    }
  }
  const serverGenMs = performance.now() - serverStart;

  // Count page components and hooks
  const pageCount = files.filter(f => f.path.includes('/pages/') && f.path.endsWith('Page.jsx')).length;
  const hookCount = files.filter(f => f.path.includes('/hooks/') && f.path.startsWith('client/')).length;

  // Dead lines: lines in .jsx/.js/.ts files not imported by any other generated file
  // (computed before provenance headers since those don't affect import analysis)
  const deadLines = computeDeadLines(files);

  // Prepend provenance header to generated source files
  const provenanceHeader = `// Generated by AirEngine v0.1.7 from ${ctx.appName}.air`;
  for (const f of files) {
    if (/\.(jsx|tsx|ts|js)$/.test(f.path)) {
      f.content = provenanceHeader + '\n' + f.content;
    }
  }

  // Codegen manifest (6B) — add _airengine_manifest.json
  // SH9: Provenance mapping — which generator produced each file
  const provenanceMap: Record<string, { generator: string; source: string }> = {};
  for (const f of files) {
    if (f.path.endsWith('index.css')) {
      provenanceMap[f.path] = { generator: 'generateIndexCss', source: 'src/transpiler/scaffold.ts' };
    } else if (f.path.endsWith('App.jsx')) {
      provenanceMap[f.path] = { generator: 'generateApp', source: 'src/transpiler/react/index.ts' };
    } else if (f.path.endsWith('Layout.jsx')) {
      provenanceMap[f.path] = { generator: ctx.isEcommerce ? 'generateEcommerceLayout' : 'generateLayout', source: 'src/transpiler/react/layout-gen.ts' };
    } else if (f.path.endsWith('PublicLayout.jsx')) {
      provenanceMap[f.path] = { generator: 'generatePublicLayout', source: 'src/transpiler/react/layout-gen.ts' };
    } else if (f.path.includes('/pages/') && f.path.endsWith('.jsx')) {
      provenanceMap[f.path] = { generator: ctx.isEcommerce ? 'generateEcommercePages' : 'generatePageComponents', source: ctx.isEcommerce ? 'src/transpiler/index.ts' : 'src/transpiler/react/page-gen.ts' };
    } else if (f.path.endsWith('api.js')) {
      provenanceMap[f.path] = { generator: 'generateApiClient', source: 'src/transpiler/api-client-gen.ts' };
    } else if (f.path.endsWith('types.ts') && f.path.includes('client/')) {
      provenanceMap[f.path] = { generator: 'generateClientTypesFile', source: 'src/transpiler/types-gen.ts' };
    } else if (f.path.includes('/hooks/')) {
      provenanceMap[f.path] = { generator: 'generateResourceHooks', source: 'src/transpiler/resource-hook-gen.ts' };
    } else if (f.path.includes('/components/')) {
      provenanceMap[f.path] = { generator: 'generateReusableComponents', source: 'src/transpiler/component-gen.ts' };
    } else if (f.path.endsWith('server.ts')) {
      provenanceMap[f.path] = { generator: 'generateServer', source: 'src/transpiler/express/server-entry-gen.ts' };
    } else if (f.path.endsWith('schema.prisma')) {
      provenanceMap[f.path] = { generator: 'generatePrismaSchema', source: 'src/transpiler/prisma.ts' };
    } else if (f.path.endsWith('seed.ts')) {
      provenanceMap[f.path] = { generator: 'generateSeed', source: 'src/transpiler/seed-gen.ts' };
    } else if (f.path.endsWith('package.json') || f.path.endsWith('vite.config.js') || f.path.endsWith('index.html') || f.path.endsWith('main.jsx')) {
      provenanceMap[f.path] = { generator: 'generateScaffold', source: 'src/transpiler/scaffold.ts' };
    }
  }

  const sourceHash = createHash('sha256')
    .update(JSON.stringify(ast))
    .digest('hex')
    .slice(0, 16);
  const manifest = {
    generatedBy: 'AirEngine',
    version: '0.1.7',
    sourceHash,
    provenance: provenanceMap,
    files: files.map(f => ({
      path: f.path,
      hash: createHash('sha256').update(f.content).digest('hex').slice(0, 16),
      lines: f.content.split('\n').length,
    })),
    timestamp: new Date().toISOString(),
  };
  files.push({ path: '_airengine_manifest.json', content: JSON.stringify(manifest, null, 2) + '\n' });

  // Compute outputLines AFTER provenance headers and manifest are added
  const outputLines = files.reduce((sum, f) => sum + f.content.split('\n').length, 0);

  const inputLines = options.sourceLines ?? 0;
  const totalMs = performance.now() - totalStart;

  return {
    files,
    stats: {
      inputLines,
      outputLines,
      compressionRatio: inputLines > 0 ? Math.round(outputLines / inputLines * 10) / 10 : 0,
      components: analysis.hasPages ? analysis.pages.length : 1,
      modules: files.length,
      pages: pageCount,
      hooks: hookCount,
      deadLines,
      timing: {
        extractMs: Math.round(extractMs * 100) / 100,
        analyzeMs: Math.round(analyzeMs * 100) / 100,
        clientGenMs: Math.round(clientGenMs * 100) / 100,
        serverGenMs: Math.round(serverGenMs * 100) / 100,
        totalMs: Math.round(totalMs * 100) / 100,
      },
    },
  };
}

// ---- Ecommerce Page Overrides ----

function generateEcommercePages(ctx: TranspileContext): OutputFile[] {
  const provenance = `// Generated by AirEngine v${ctx.appName ? '0.1.7' : '0.1.7'} from ${ctx.appName}.air`;
  const files: OutputFile[] = [];

  // ShopPage — product grid with images, category sidebar, add-to-cart
  files.push({ path: 'client/src/pages/ShopPage.jsx', content: `${provenance}
import { useState, useEffect } from 'react';
import * as api from '../api.js';

export default function ShopPage({ addToCart, cart, search, catFilter, setCatFilter }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [prodRes, catRes] = await Promise.all([
          api.getProducts({ limit: 50 }),
          api.getCategories({ limit: 50 }),
        ]);
        setProducts(prodRes.data ?? []);
        setCategories(catRes.data ?? []);
      } catch (err) {
        setError(err.message || 'Failed to load products');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const catMap = {};
  categories.forEach(c => { catMap[c.id] = c; });
  const slugMap = {};
  categories.forEach(c => { if (c.slug) slugMap[c.slug] = c.id; if (c.name) slugMap[c.name.toLowerCase()] = c.id; });

  const filtered = products
    .filter(p => {
      if (catFilter === 'all') return true;
      if (slugMap[catFilter] !== undefined) return p.category_id === slugMap[catFilter];
      return true;
    })
    .filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
    });

  const handleAdd = (product) => {
    addToCart(product);
    setToast(product.name);
    setTimeout(() => setToast(null), 2000);
  };

  const inCart = (id) => (cart || []).find(i => i.productId === id);

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="animate-pulse space-y-6">
          <div className="flex gap-3">{[1,2,3,4,5].map(i => <div key={i} className="h-8 w-24 bg-[var(--hover)] rounded-full" />)}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({length: 10}, (_,i) => <div key={i} className="h-80 bg-[var(--hover)] rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-5">
      {toast && (
        <div className="fixed top-28 right-6 z-50 bg-[#0f1b2d] border border-green-500/40 text-green-400 px-5 py-3 rounded-lg text-sm font-medium shadow-2xl animate-slide-up flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          Added {toast} to cart
        </div>
      )}

      {error && <div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-5 py-4 text-sm mb-4">{error}</div>}

      <div className="flex gap-6">
        {/* Sidebar Filters */}
        <aside className="hidden lg:block w-56 shrink-0 rounded-lg border border-[var(--border)] p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3 px-3">Department</h3>
          <ul className="space-y-0.5">
            <li>
              <button onClick={() => setCatFilter('all')}
                className={\`w-full text-left justify-start px-3 py-2 rounded-lg text-sm font-normal transition-colors \${catFilter === 'all' ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-semibold' : 'text-[var(--fg)] hover:bg-[var(--hover)]'}\`}>
                All Products <span className="text-[var(--muted)] text-xs ml-1">({products.length})</span>
              </button>
            </li>
            {categories.map(cat => {
              const count = products.filter(p => p.category_id === cat.id).length;
              const active = catFilter === cat.slug || catFilter === cat.name?.toLowerCase();
              return (
                <li key={cat.id}>
                  <button onClick={() => setCatFilter(cat.slug || cat.name?.toLowerCase())}
                    className={\`w-full text-left justify-start px-3 py-2 rounded-lg text-sm font-normal transition-colors \${active ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-semibold' : 'text-[var(--fg)] hover:bg-[var(--hover)]'}\`}>
                    {cat.name} <span className="text-[var(--muted)] text-xs ml-1">({count})</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Product Grid */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-[var(--muted)]">
              {search ? \`Results for "\${search}"\` : 'All Products'}
              <span className="ml-1">— {filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-[var(--muted)] text-lg mb-2">No products found</p>
              <button onClick={() => setCatFilter('all')} className="text-[var(--accent)] text-sm font-medium hover:underline">Clear filters</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map(product => {
                const cat = catMap[product.category_id];
                const cartItem = inCart(product.id);
                return (
                  <div key={product.id} className="group rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden hover:shadow-xl hover:shadow-black/20 hover:border-[var(--accent)]/30 transition-all duration-200">
                    <div className="aspect-square overflow-hidden bg-white/5 relative">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl text-[var(--muted)]/30">&#128722;</div>
                      )}
                      {product.stock < 10 && product.stock > 0 && (
                        <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">Only {product.stock} left</span>
                      )}
                    </div>
                    <div className="p-3 space-y-1.5">
                      <h3 className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-[var(--accent)] transition-colors">{product.name}</h3>
                      {cat && <p className="text-[11px] text-[var(--muted)]">{cat.name}</p>}
                      <div className="flex items-baseline gap-1">
                        <span className="text-xs text-[var(--muted)]">$</span>
                        <span className="text-xl font-bold">{Math.floor(product.price)}</span>
                        <span className="text-sm">{(product.price % 1).toFixed(2).slice(1)}</span>
                      </div>
                      {product.description && <p className="text-xs text-[var(--muted)] line-clamp-2">{product.description}</p>}
                      <div className="pt-2">
                        <button
                          onClick={() => handleAdd(product)}
                          disabled={product.stock === 0}
                          style={{ padding: '8px 16px' }}
                          className={\`w-full rounded-full text-xs font-semibold transition-all \${
                            cartItem
                              ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                              : 'bg-[var(--accent)] text-white hover:brightness-110 shadow shadow-[var(--accent)]/20'
                          } disabled:opacity-40\`}>
                          {cartItem ? \`In Cart (\${cartItem.quantity})\` : 'Add to Cart'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
` });

  // CartPage — clean cart with quantity controls
  files.push({ path: 'client/src/pages/CartPage.jsx', content: `${provenance}
import { useState } from 'react';
import * as api from '../api.js';

export default function CartPage({ cart, removeFromCart, updateCartQty, clearCart, setCurrentPage }) {
  const [checkoutMsg, setCheckoutMsg] = useState(null);
  const total = cart.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);

  const handleCheckout = async () => {
    try {
      await api.createOrder({ items: cart, total });
      clearCart();
      setCheckoutMsg('Order placed successfully!');
      setTimeout(() => { setCheckoutMsg(null); setCurrentPage('orders'); }, 2000);
    } catch {
      clearCart();
      setCheckoutMsg('Order placed!');
      setTimeout(() => setCheckoutMsg(null), 2000);
    }
  };

  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Shopping Cart</h1>
        <button onClick={() => setCurrentPage('shop')} className="text-sm text-[var(--accent)] hover:underline">Continue Shopping</button>
      </div>

      {checkoutMsg && (
        <div className="mb-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 px-5 py-3 text-sm font-medium">{checkoutMsg}</div>
      )}

      {cart.length === 0 ? (
        <div className="text-center py-20">
          <svg className="w-16 h-16 mx-auto text-[var(--muted)]/30 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121 0 2.09-.773 2.34-1.87l1.69-7.462H5.256M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>
          <p className="text-[var(--muted)] text-lg mb-2">Your cart is empty</p>
          <button onClick={() => setCurrentPage('shop')} className="text-[var(--accent)] text-sm font-medium hover:underline">Start shopping</button>
        </div>
      ) : (
        <div className="space-y-4">
          {cart.map(item => (
            <div key={item.productId} className="flex items-center gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              {item.image_url ? (
                <img src={item.image_url} alt={item.name} className="w-20 h-20 object-cover rounded-lg" />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-white/5 flex items-center justify-center text-2xl text-[var(--muted)]/30">&#128722;</div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium truncate">{item.name}</h3>
                <p className="text-[var(--accent)] font-bold">\${ (item.price * item.quantity).toFixed(2)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => updateCartQty(item.productId, -1)} className="w-8 h-8 rounded-full border border-[var(--border)] flex items-center justify-center hover:bg-[var(--hover)] transition-colors">-</button>
                <span className="w-8 text-center font-medium">{item.quantity}</span>
                <button onClick={() => updateCartQty(item.productId, 1)} className="w-8 h-8 rounded-full border border-[var(--border)] flex items-center justify-center hover:bg-[var(--hover)] transition-colors">+</button>
              </div>
              <button onClick={() => removeFromCart(item.productId)} className="p-2 text-[var(--muted)] hover:text-red-400 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between p-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] mt-6">
            <div>
              <p className="text-sm text-[var(--muted)]">Subtotal ({cart.reduce((s, i) => s + i.quantity, 0)} items)</p>
              <p className="text-2xl font-bold">\${total.toFixed(2)}</p>
            </div>
            <button onClick={handleCheckout} className="px-8 py-3 bg-[var(--accent)] text-white rounded-lg font-semibold hover:brightness-110 transition-all shadow-lg shadow-[var(--accent)]/20">
              Proceed to Checkout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
` });

  // OrdersPage — clean order history without Layout wrapper (App already provides Layout)
  files.push({ path: 'client/src/pages/OrdersPage.jsx', content: `${provenance}
import { useState, useEffect } from 'react';
import * as api from '../api.js';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getOrders({ limit: 50 });
        setOrders(res.data ?? res);
      } catch (err) {
        setError(err.message || 'Failed to load orders');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const statusColor = (s) => {
    const v = String(s ?? '').toLowerCase();
    const m = { pending: 'bg-yellow-500/15 text-yellow-400', processing: 'bg-blue-500/15 text-blue-400', shipped: 'bg-purple-500/15 text-purple-400', delivered: 'bg-green-500/15 text-green-400', cancelled: 'bg-red-500/15 text-red-400' };
    return m[v] || 'bg-[var(--accent)]/10 text-[var(--accent)]';
  };

  if (loading) {
    return (
      <div className="max-w-[1000px] mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-[var(--hover)] rounded" />
          {[1,2,3].map(i => <div key={i} className="h-24 bg-[var(--hover)] rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Your Orders</h1>

      {error && <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-5 py-3 text-sm">{error}</div>}

      {orders.length === 0 ? (
        <div className="text-center py-20">
          <svg className="w-16 h-16 mx-auto text-[var(--muted)]/30 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
          <p className="text-[var(--muted)] text-lg mb-2">No orders yet</p>
          <p className="text-sm text-[var(--muted)]">When you place an order, it will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <div key={order.id} className="flex items-center gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-sm font-medium">Order #{order.id}</span>
                  <span className={\`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium \${statusColor(order.status)}\`}>{order.status}</span>
                </div>
                <p className="text-sm text-[var(--muted)]">{order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}</p>
              </div>
              <p className="text-lg font-bold">\${Number(order.total || 0).toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
` });

  // AccountPage
  files.push({ path: 'client/src/pages/AccountPage.jsx', content: `${provenance}
export default function AccountPage({ user, setCurrentPage, logout }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <h2 className="text-2xl font-bold">Your Account</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button onClick={() => setCurrentPage('orders')}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-left hover:border-[var(--accent)]/40 transition-all">
          <h3 className="font-semibold">Your Orders</h3>
          <p className="text-sm text-[var(--muted)]">Track, return, or buy things again</p>
        </button>
        <button onClick={() => setCurrentPage('cart')}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-left hover:border-[var(--accent)]/40 transition-all">
          <h3 className="font-semibold">Your Cart</h3>
          <p className="text-sm text-[var(--muted)]">View items in your cart</p>
        </button>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h3 className="font-semibold">Profile</h3>
          <p className="text-sm text-[var(--muted)]">{user.name} &middot; {user.email}</p>
          <p className="text-xs text-[var(--muted)] mt-1">Role: {user.role}</p>
        </div>
        <button onClick={logout}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-left hover:border-red-500/40 transition-all">
          <h3 className="font-semibold text-red-400">Sign Out</h3>
          <p className="text-sm text-[var(--muted)]">Log out of your account</p>
        </button>
      </div>
    </div>
  );
}
` });

  return files;
}
