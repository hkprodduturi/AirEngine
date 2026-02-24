/**
 * Layout component generator — sidebar + nav for apps with 3+ pages.
 */

import type { TranspileContext } from '../context.js';
import type { UIAnalysis } from '../normalize-ui.js';
import { capitalize, hasAuthRoutes, isAuthPageName } from './helpers.js';

// ---- Layout Component ----

export function generateLayout(ctx: TranspileContext, analysis: UIAnalysis): string | null {
  const hasSidebar = ctx.uiNodes.some(n =>
    n.kind === 'element' && n.element === 'sidebar'
  );
  if (!analysis.hasPages || (!hasSidebar && analysis.pages.length < 3)) return null;

  const withAuth = hasAuthRoutes(ctx);

  const lines: string[] = [];
  lines.push("import { useState } from 'react';");
  lines.push('');

  if (withAuth) {
    lines.push('export default function Layout({ children, user, logout, currentPage, setCurrentPage }) {');
  } else {
    lines.push('export default function Layout({ children, currentPage, setCurrentPage }) {');
  }

  // Filter out auth pages from nav items
  lines.push('  const navItems = [');
  for (const page of analysis.pages) {
    if (isAuthPageName(page.name)) continue;
    const label = capitalize(page.name);
    lines.push(`    { key: '${page.name}', label: '${label}' },`);
  }
  lines.push('  ];');
  lines.push('');
  lines.push('  return (');
  lines.push('    <div className="flex min-h-screen">');
  lines.push('      <aside className="w-64 bg-[var(--surface)] border-r border-[var(--border)] p-4 flex flex-col">');
  lines.push(`        <div className="text-xl font-bold mb-6">${capitalize(ctx.appName)}</div>`);
  lines.push('        <nav className="space-y-1 flex-1">');
  lines.push('          {navItems.map((item) => (');
  lines.push('            <button');
  lines.push('              key={item.key}');
  lines.push('              onClick={() => setCurrentPage(item.key)}');
  lines.push("              className={`w-full text-left px-3 py-2 rounded-[var(--radius)] transition-colors ${");
  lines.push("                currentPage === item.key");
  lines.push("                  ? 'bg-[var(--accent)] text-white'");
  lines.push("                  : 'hover:bg-[var(--border)]'");
  lines.push("              }`}");
  lines.push('            >');
  lines.push('              {item.label}');
  lines.push('            </button>');
  lines.push('          ))}');
  lines.push('        </nav>');

  if (withAuth) {
    lines.push('        <div className="border-t border-[var(--border)] pt-4 mt-4">');
    lines.push('          {user && (');
    lines.push('            <div className="mb-2 text-sm">');
    lines.push('              <div className="font-medium">{user.name || user.email}</div>');
    lines.push("              {user.role && <div className=\"text-[var(--muted)]\">{user.role}</div>}");
    lines.push('            </div>');
    lines.push('          )}');
    lines.push('          <button');
    lines.push('            onClick={logout}');
    lines.push("            className=\"w-full text-left px-3 py-2 rounded-[var(--radius)] text-red-400 hover:bg-red-400/10 transition-colors\"");
    lines.push('          >');
    lines.push('            Logout');
    lines.push('          </button>');
    lines.push('        </div>');
  }

  lines.push('      </aside>');
  lines.push('      <main className="flex-1 p-8">');
  lines.push('        {children}');
  lines.push('      </main>');
  lines.push('    </div>');
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
