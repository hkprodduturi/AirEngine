/**
 * React code generator — thin orchestrator shell.
 *
 * Re-exports generateApp, generateLayout, generatePageComponents.
 */

import type { TranspileContext } from '../context.js';
import type { UIAnalysis } from '../normalize-ui.js';
import { detectPatterns } from '../component-gen.js';
import { capitalize, indent, hasAuthRoutes, isAuthPageName, AUTH_MUTATION_NAMES } from './helpers.js';
import { generateStateDecls } from './state-gen.js';
import { generatePersistLoad, generatePersistSave } from './persist-gen.js';
import { generateMutations } from './mutation-gen.js';
import { getPostLoginPage } from './mutation-gen.js';
import { generateHookEffects } from './hook-gen.js';
import { generateRootJSX } from './jsx-gen.js';
import { detectDetailPageModels } from './page-gen.js';

// Re-exports
export { generateLayout, generatePublicLayout, generateEcommerceLayout } from './layout-gen.js';
export { generatePageComponents, detectDetailPageModels } from './page-gen.js';

// ---- Main entry ----

export function generateApp(ctx: TranspileContext, analysis: UIAnalysis): string {
  const lines: string[] = [];

  const hasAuthMutations = hasAuthRoutes(ctx);
  const hasLoginPage = analysis.pages.some(p => isAuthPageName(p.name));
  const hasAuthGating = hasAuthMutations && ctx.hasBackend && analysis.hasPages && hasLoginPage;

  // Determine if Layout component is generated (same condition as layout-gen.ts)
  const hasSidebarNode = ctx.uiNodes.some(n => n.kind === 'element' && n.element === 'sidebar');
  const hasLayout = analysis.hasPages && (hasSidebarNode || analysis.pages.length >= 3);

  const useLazy = ctx.hasBackend && analysis.hasPages && analysis.pages.length >= 3;
  if (useLazy) {
    lines.push("import { useState, useEffect, lazy, Suspense } from 'react';");
  } else {
    lines.push("import { useState, useEffect } from 'react';");
  }
  if (ctx.hasBackend && ctx.apiRoutes.length > 0) {
    lines.push("import * as api from './api.js';");
  }
  // Import page components for fullstack apps with pages
  const detailPages = ctx.db && hasAuthGating ? detectDetailPageModels(ctx) : [];
  if (ctx.hasBackend && analysis.hasPages) {
    if (useLazy) {
      for (const page of analysis.pages) {
        const pageName = capitalize(page.name);
        lines.push(`const ${pageName}Page = lazy(() => import('./pages/${pageName}Page.jsx'));`);
      }
      // C1/G3: Import detail page components
      for (const detail of detailPages) {
        lines.push(`const ${detail.modelName}DetailPage = lazy(() => import('./pages/${detail.modelName}DetailPage.jsx'));`);
      }
    } else {
      for (const page of analysis.pages) {
        const pageName = capitalize(page.name);
        lines.push(`import ${pageName}Page from './pages/${pageName}Page.jsx';`);
      }
      // C1/G3: Import detail page components
      for (const detail of detailPages) {
        lines.push(`import ${detail.modelName}DetailPage from './pages/${detail.modelName}DetailPage.jsx';`);
      }
    }
  }
  // Ecommerce: import AccountPage (not in analysis.pages, generated separately)
  if (ctx.isEcommerce && ctx.hasBackend) {
    if (useLazy) {
      lines.push("const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));");
    } else {
      lines.push("import AccountPage from './pages/AccountPage.jsx';");
    }
  }
  // Import Layout for ecommerce or non-auth apps that have a generated Layout component
  if (ctx.isEcommerce && ctx.hasBackend) {
    lines.push("import Layout from './Layout.jsx';");
  } else if (!hasAuthGating && hasLayout && ctx.hasBackend) {
    lines.push("import Layout from './Layout.jsx';");
  }
  // Import PublicLayout when public pages exist
  if (ctx.publicPageNames.length > 0 && ctx.hasBackend) {
    lines.push("import PublicLayout from './PublicLayout.jsx';");
  }
  // Import reusable components when patterns detected (skip when auth-gated — pages import their own)
  // Also skip when Layout handles navigation — components are used in page files, not App.jsx
  if (ctx.hasBackend && !hasAuthGating && !hasLayout) {
    const flags = detectPatterns(ctx.uiNodes);
    const hasAnyComponent = flags.hasTable || flags.hasIteration || flags.hasStat;
    if (flags.hasTable) lines.push("import DataTable from './components/DataTable.jsx';");
    if (flags.hasIteration) lines.push("import EmptyState from './components/EmptyState.jsx';");
    if (flags.hasStat) lines.push("import StatCard from './components/StatCard.jsx';");
    if (hasAnyComponent) lines.push("import ConfirmModal from './components/ConfirmModal.jsx';");
  }
  lines.push('');
  lines.push('export default function App() {');

  if (hasAuthGating) {
    // ---- Slim App: only auth state ----
    const postLoginPage = getPostLoginPage(analysis);
    const defaultPage = ctx.isEcommerce ? 'shop' : (ctx.publicPageNames.length > 0 ? ctx.publicPageNames[0] : 'login');
    lines.push('  const [user, setUser] = useState(null);');
    lines.push('  const [authError, setAuthError] = useState(null);');
    lines.push(`  const [currentPage, setCurrentPage] = useState('${defaultPage}');`);
    // Include loading/error state if declared (used by auth mutations)
    const hasLoading = ctx.state.some(f => f.name === 'loading');
    const hasError = ctx.state.some(f => f.name === 'error');
    if (hasLoading) lines.push('  const [loading, setLoading] = useState(false);');
    if (hasError) lines.push('  const [error, setError] = useState(null);');
    // C1/G3: Detail page state for models with nested child routes
    for (const detail of detailPages) {
      const singular = detail.modelName.charAt(0).toLowerCase() + detail.modelName.slice(1);
      lines.push(`  const [selected${detail.modelName}Id, setSelected${detail.modelName}Id] = useState(null);`);
    }

    // Ecommerce: cart, search, category filter, login modal at App level
    if (ctx.isEcommerce) {
      lines.push('  const [cart, setCart] = useState([]);');
      lines.push('  const [search, setSearch] = useState(\'\');');
      lines.push('  const [catFilter, setCatFilter] = useState(\'all\');');
      lines.push('  const [showLoginModal, setShowLoginModal] = useState(false);');
    }
    lines.push('');

    // Restore BOTH token AND user from localStorage
    lines.push('  // Restore auth session from localStorage on mount');
    lines.push('  useEffect(() => {');
    lines.push("    const savedToken = localStorage.getItem('auth_token');");
    lines.push(`    const savedUser = localStorage.getItem('${ctx.appName}_user');`);
    lines.push('    if (savedToken) api.setToken(savedToken);');
    lines.push('    if (savedUser) {');
    lines.push('      try {');
    lines.push('        setUser(JSON.parse(savedUser));');
    if (!ctx.isEcommerce) {
      lines.push(`        setCurrentPage('${postLoginPage}');`);
    }
    lines.push('      } catch (_) {}');
    lines.push('    }');
    if (ctx.isEcommerce) {
      lines.push("    try { const c = localStorage.getItem('ecommerce_cart'); if (c) setCart(JSON.parse(c)); } catch (_) {}");
    }
    lines.push('  }, []);');
    lines.push('');

    // Only auth mutations (login + register — not logout, we generate that explicitly)
    const authOnlyMutations = analysis.mutations.filter(m =>
      AUTH_MUTATION_NAMES.has(m.name) && m.name !== 'logout'
    );
    if (authOnlyMutations.length > 0) {
      const authAnalysis = { ...analysis, mutations: authOnlyMutations };
      const mutCode = generateMutations(ctx, authAnalysis);
      if (mutCode.length) {
        lines.push(...indent(mutCode, 2));
        lines.push('');
      }
    }

    // Always generate logout when auth-gated (Layout and pages need it)
    lines.push('  const logout = () => {');
    if (ctx.hasBackend && ctx.apiRoutes.length > 0) {
      lines.push('    api.clearToken();');
    }
    lines.push('    setUser(null);');
    lines.push(`    localStorage.removeItem('${ctx.appName}_user');`);
    lines.push(`    localStorage.removeItem('auth_token');`);
    lines.push(`    setCurrentPage('${defaultPage}');`);
    lines.push('  };');
    lines.push('');

    // Auth-gated apps handle persistence via localStorage in login/logout —
    // skip cookie/storage persistence to avoid referencing undeclared state vars.

    // isAuthed gate
    lines.push('  const isAuthed = !!user;');
    lines.push('');

    // Ecommerce: cart helpers
    if (ctx.isEcommerce) {
      lines.push("  useEffect(() => { localStorage.setItem('ecommerce_cart', JSON.stringify(cart)); }, [cart]);");
      lines.push('');
      lines.push('  const addToCart = (product) => {');
      lines.push('    setCart(prev => {');
      lines.push('      const existing = prev.find(i => i.productId === product.id);');
      lines.push('      if (existing) return prev.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i);');
      lines.push('      return [...prev, { productId: product.id, name: product.name, price: product.price, image_url: product.image_url, quantity: 1 }];');
      lines.push('    });');
      lines.push('  };');
      lines.push('  const removeFromCart = (pid) => setCart(prev => prev.filter(i => i.productId !== pid));');
      lines.push('  const updateCartQty = (pid, delta) => setCart(prev => prev.map(i => i.productId !== pid ? i : { ...i, quantity: Math.max(1, i.quantity + delta) }));');
      lines.push('  const clearCart = () => setCart([]);');
      lines.push('');
    }

    // Skip: data-fetching hooks, component imports (pages handle all that)

  } else {
    // ---- Original full App behavior ----

    // State declarations
    lines.push(...indent(generateStateDecls(ctx), 2));
    lines.push('');

    // Auth error state for login/register feedback
    if (hasAuthMutations) {
      lines.push('  const [authError, setAuthError] = useState(null);');
      lines.push('');
    }

    // Page navigation state (if pages exist)
    if (analysis.hasPages) {
      const defaultPage = analysis.pages[0]?.name ?? 'home';
      lines.push(`  const [currentPage, setCurrentPage] = useState('${defaultPage}');`);
      lines.push('');
    }

    // Restore auth token on mount
    if (hasAuthMutations && ctx.hasBackend && ctx.apiRoutes.length > 0) {
      lines.push('  // Restore auth token from localStorage on mount');
      lines.push('  useEffect(() => {');
      lines.push("    const saved = localStorage.getItem('auth_token');");
      lines.push('    if (saved) api.setToken(saved);');
      lines.push('  }, []);');
      lines.push('');
    }

    // Persist: load on mount
    const loadCode = generatePersistLoad(ctx);
    if (loadCode.length) {
      lines.push(...indent(loadCode, 2));
      lines.push('');
    }

    // Persist: save on change
    const saveCode = generatePersistSave(ctx);
    if (saveCode.length) {
      lines.push(...indent(saveCode, 2));
      lines.push('');
    }

    // Mutation functions
    const mutCode = generateMutations(ctx, analysis);
    if (mutCode.length) {
      lines.push(...indent(mutCode, 2));
      lines.push('');
    }

    // Hook effects
    const hookCode = generateHookEffects(ctx);
    if (hookCode.length) {
      lines.push(...indent(hookCode, 2));
      lines.push('');
    }
  }

  // JSX return
  lines.push('  return (');
  lines.push(...indent(generateRootJSX(ctx, analysis, useLazy, hasAuthGating, hasLayout), 4));
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
