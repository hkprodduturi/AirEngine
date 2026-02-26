/**
 * Layout component generator — sidebar + nav for apps with 3+ pages.
 *
 * Generates a polished sidebar with:
 * - SVG icons per nav item (auto-mapped from page name)
 * - Active/hover states with accent color
 * - Responsive collapse on mobile
 * - User profile section with avatar
 * - Smooth transitions
 */

import type { TranspileContext } from '../context.js';
import type { UIAnalysis } from '../normalize-ui.js';
import { capitalize, camelToLabel, hasAuthRoutes, isAuthPageName } from './helpers.js';

// ---- Icon SVG Mapping ----
// Maps page names to Heroicons-style SVG path data (24x24 viewBox)
const NAV_ICONS: Record<string, string> = {
  dashboard:  'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4',
  overview:   'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4',
  home:       'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4',
  projects:   'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  tasks:      'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  settings:   'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  users:      'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m3 5.197v-1',
  contacts:   'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  analytics:  'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  reports:    'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  orders:     'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  products:   'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  messages:   'M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  calendar:   'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  billing:    'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  payments:   'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  team:       'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  profile:    'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  inventory:  'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
  customers:  'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  courses:    'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  notifications: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  tickets:    'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z',
  agents:     'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  support:    'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z',
  departments: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  files:      'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
  documents:  'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  help:       'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  knowledge:  'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  articles:   'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z',
  categories: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  tags:       'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  expenses:   'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  todos:      'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  gallery:    'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  packages:   'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  studio:     'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  booking:    'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  faq:        'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  portfolio:  'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  services:   'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M3.75 18.75h16.5',
  about:      'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  inquiries:  'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  testimonials: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
};

// Fallback icon for pages without a specific mapping
const DEFAULT_ICON = 'M4 6h16M4 12h16M4 18h16';

function getNavIcon(pageName: string): string {
  const key = pageName.toLowerCase();
  return NAV_ICONS[key] || DEFAULT_ICON;
}

// ---- Layout Component ----

export function generateLayout(ctx: TranspileContext, analysis: UIAnalysis): string | null {
  const hasSidebar = ctx.uiNodes.some(n =>
    n.kind === 'element' && n.element === 'sidebar'
  );
  if (!analysis.hasPages || (!hasSidebar && analysis.pages.length < 3)) return null;

  const withAuth = hasAuthRoutes(ctx);
  const appTitle = capitalize(ctx.appName).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const lines: string[] = [];
  lines.push("import { useState } from 'react';");
  lines.push('');

  if (withAuth) {
    lines.push('export default function Layout({ children, user, logout, currentPage, setCurrentPage }) {');
  } else {
    lines.push('export default function Layout({ children, currentPage, setCurrentPage }) {');
  }

  lines.push('  const [sidebarOpen, setSidebarOpen] = useState(false);');
  lines.push('');

  // Nav items with icons
  lines.push('  const navItems = [');
  for (const page of analysis.pages) {
    if (isAuthPageName(page.name)) continue;
    const label = camelToLabel(page.name);
    const icon = getNavIcon(page.name);
    lines.push(`    { key: '${page.name}', label: '${label}', icon: '${icon}' },`);
  }
  lines.push('  ];');
  lines.push('');

  lines.push('  return (');
  lines.push('    <div className="flex min-h-screen bg-[var(--bg)]">');

  // ---- Mobile overlay ----
  lines.push('      {/* Mobile overlay */}');
  lines.push('      {sidebarOpen && (');
  lines.push('        <div');
  lines.push('          className="fixed inset-0 bg-black/50 z-40 lg:hidden"');
  lines.push('          onClick={() => setSidebarOpen(false)}');
  lines.push('        />');
  lines.push('      )}');
  lines.push('');

  // ---- Sidebar ----
  lines.push('      {/* Sidebar */}');
  lines.push('      <aside className={`');
  lines.push('        fixed lg:sticky top-0 left-0 z-50 h-screen w-64');
  lines.push('        bg-[var(--surface)] border-r border-[var(--border)]');
  lines.push('        shadow-[1px_0_8px_rgba(0,0,0,0.08)]');
  lines.push('        flex flex-col transition-transform duration-200 ease-in-out');
  lines.push("        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}");
  lines.push('      `}>');

  // Brand
  lines.push('        <div className="flex items-center gap-3 px-5 h-16 border-b border-[var(--border)] shrink-0">');
  lines.push(`          <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white font-bold text-sm">${appTitle.charAt(0)}</div>`);
  lines.push(`          <span className="font-semibold text-lg tracking-tight">${appTitle}</span>`);
  lines.push('        </div>');
  lines.push('');

  // Nav
  lines.push('        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">');
  lines.push('          {navItems.map((item) => {');
  lines.push('            const isActive = currentPage === item.key;');
  lines.push('            return (');
  lines.push('              <button');
  lines.push('                key={item.key}');
  lines.push('                onClick={() => { setCurrentPage(item.key); setSidebarOpen(false); }}');
  lines.push('                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${');
  lines.push('                  isActive');
  lines.push("                    ? 'bg-[var(--accent)] text-white shadow-sm shadow-[var(--accent)]/20'");
  lines.push("                    : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'");
  lines.push('                }`}');
  lines.push('              >');
  lines.push('                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isActive ? 2 : 1.5}>');
  lines.push('                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />');
  lines.push('                </svg>');
  lines.push('                {item.label}');
  lines.push('              </button>');
  lines.push('            );');
  lines.push('          })}');
  lines.push('        </nav>');
  lines.push('');

  // User section
  if (withAuth) {
    lines.push('        {/* User section */}');
    lines.push('        <div className="border-t border-[var(--border)] p-4 shrink-0">');
    lines.push('          {user && (');
    lines.push('            <div className="flex items-center gap-3 mb-3">');
    lines.push('              <div className="w-9 h-9 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)] font-semibold text-sm">');
    lines.push("                {(user.name || user.email || '?').charAt(0).toUpperCase()}");
    lines.push('              </div>');
    lines.push('              <div className="flex-1 min-w-0">');
    lines.push('                <div className="text-sm font-medium truncate">{user.name || user.email}</div>');
    lines.push('                {user.role && <div className="text-xs text-[var(--muted)] truncate">{user.role}</div>}');
    lines.push('              </div>');
    lines.push('            </div>');
    lines.push('          )}');
    lines.push('          <button');
    lines.push('            onClick={logout}');
    lines.push('            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[var(--muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"');
    lines.push('          >');
    lines.push("            <svg className=\"w-5 h-5\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\" strokeWidth={1.5}>");
    lines.push('              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />');
    lines.push('            </svg>');
    lines.push('            Sign out');
    lines.push('          </button>');
    lines.push('        </div>');
  }

  lines.push('      </aside>');
  lines.push('');

  // ---- Main content ----
  lines.push('      {/* Main content */}');
  lines.push('      <div className="flex-1 flex flex-col min-h-screen">');

  // Mobile header
  lines.push('        {/* Mobile header */}');
  lines.push('        <header className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-30">');
  lines.push('          <button');
  lines.push('            onClick={() => setSidebarOpen(true)}');
  lines.push('            className="p-2 -ml-2 rounded-lg hover:bg-[var(--hover)] transition-colors"');
  lines.push("            aria-label=\"Open sidebar\"");
  lines.push('          >');
  lines.push("            <svg className=\"w-5 h-5\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\" strokeWidth={1.5}>");
  lines.push('              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />');
  lines.push('            </svg>');
  lines.push('          </button>');
  lines.push(`          <span className="font-semibold">${appTitle}</span>`);
  lines.push('        </header>');
  lines.push('');

  // Content area
  lines.push('        <main className="flex-1 p-6 lg:p-8 animate-fade-in">');
  lines.push('          {children}');
  lines.push('        </main>');
  lines.push('      </div>');

  lines.push('    </div>');
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ---- Public Layout Component ----

/**
 * Generate a PublicLayout component for public-facing pages (no auth required).
 * Top navbar with logo, nav links, CTA button, mobile hamburger, and footer.
 * Returns null if there are no public pages.
 */
export function generatePublicLayout(ctx: TranspileContext, analysis: UIAnalysis): string | null {
  if (ctx.publicPageNames.length === 0) return null;

  const appTitle = capitalize(ctx.appName).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const lastPublicPage = ctx.publicPageNames[ctx.publicPageNames.length - 1];
  const ctaLabel = lastPublicPage === 'booking' ? 'Book a Session'
    : lastPublicPage === 'faq' ? 'Get in Touch'
    : `${camelToLabel(lastPublicPage)}`;
  const ctaPage = lastPublicPage;
  const withAuth = hasAuthRoutes(ctx);

  const lines: string[] = [];
  lines.push("import { useState } from 'react';");
  lines.push('');
  lines.push('export default function PublicLayout({ children, currentPage, setCurrentPage }) {');
  lines.push('  const [menuOpen, setMenuOpen] = useState(false);');
  lines.push('');

  // Nav items
  lines.push('  const navItems = [');
  for (const name of ctx.publicPageNames) {
    const label = camelToLabel(name);
    lines.push(`    { key: '${name}', label: '${label}' },`);
  }
  lines.push('  ];');
  lines.push('');

  lines.push('  return (');
  lines.push('    <div className="min-h-screen flex flex-col">');

  // ---- Top navbar ----
  lines.push('      {/* Public navbar */}');
  lines.push('      <nav className="public-nav sticky top-0 z-40 backdrop-blur-md bg-[var(--bg)]/80 border-b border-[var(--border)]">');
  lines.push('        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">');
  // Logo
  lines.push('          <button onClick={() => setCurrentPage(navItems[0]?.key)} className="flex items-center gap-2 p-0 bg-transparent">');
  lines.push(`            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white font-bold text-sm">${appTitle.charAt(0)}</div>`);
  lines.push(`            <span className="font-semibold text-lg tracking-tight">${appTitle}</span>`);
  lines.push('          </button>');
  // Desktop nav links
  lines.push('          <div className="hidden md:flex items-center gap-1">');
  lines.push('            {navItems.map((item) => (');
  lines.push('              <button');
  lines.push('                key={item.key}');
  lines.push('                onClick={() => setCurrentPage(item.key)}');
  lines.push('                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${');
  lines.push("                  currentPage === item.key ? 'text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--fg)]'");
  lines.push('                }`}');
  lines.push('              >');
  lines.push('                {item.label}');
  lines.push('              </button>');
  lines.push('            ))}');
  lines.push(`            <button onClick={() => setCurrentPage('${ctaPage}')} className="ml-2 px-4 py-2 bg-[var(--accent)] text-white rounded-[var(--radius)] text-sm font-semibold hover:opacity-90 transition-opacity">${ctaLabel}</button>`);
  if (withAuth) {
    lines.push("            <button onClick={() => setCurrentPage('login')} className=\"ml-1 px-3 py-2 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)] transition-colors\">");
    lines.push("              <svg className=\"w-5 h-5\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\" strokeWidth={1.5}>");
    lines.push('                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />');
    lines.push('              </svg>');
    lines.push('            </button>');
  }
  lines.push('          </div>');
  // Mobile hamburger
  lines.push('          <button');
  lines.push('            className="md:hidden p-2 rounded-lg hover:bg-[var(--hover)] transition-colors"');
  lines.push('            onClick={() => setMenuOpen(!menuOpen)}');
  lines.push('            aria-label="Toggle menu"');
  lines.push('          >');
  lines.push("            <svg className=\"w-5 h-5\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\" strokeWidth={1.5}>");
  lines.push('              {menuOpen');
  lines.push('                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />');
  lines.push('                : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />');
  lines.push('              }');
  lines.push('            </svg>');
  lines.push('          </button>');
  lines.push('        </div>');
  // Mobile menu overlay
  lines.push('        {menuOpen && (');
  lines.push('          <div className="md:hidden border-t border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur-md px-6 py-4 space-y-1">');
  lines.push('            {navItems.map((item) => (');
  lines.push('              <button');
  lines.push('                key={item.key}');
  lines.push('                onClick={() => { setCurrentPage(item.key); setMenuOpen(false); }}');
  lines.push('                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${');
  lines.push("                  currentPage === item.key ? 'text-[var(--accent)] bg-[var(--hover)]' : 'text-[var(--muted)] hover:text-[var(--fg)]'");
  lines.push('                }`}');
  lines.push('              >');
  lines.push('                {item.label}');
  lines.push('              </button>');
  lines.push('            ))}');
  lines.push(`            <button onClick={() => { setCurrentPage('${ctaPage}'); setMenuOpen(false); }} className="w-full mt-2 px-4 py-2 bg-[var(--accent)] text-white rounded-[var(--radius)] text-sm font-semibold hover:opacity-90">${ctaLabel}</button>`);
  if (withAuth) {
    lines.push("            <button onClick={() => { setCurrentPage('login'); setMenuOpen(false); }} className=\"w-full mt-1 px-3 py-2 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)] text-left transition-colors\">Admin Login</button>");
  }
  lines.push('          </div>');
  lines.push('        )}');
  lines.push('      </nav>');
  lines.push('');

  // ---- Main content ----
  lines.push('      {/* Page content */}');
  lines.push('      <main className="flex-1 animate-fade-in">');
  lines.push('        {children}');
  lines.push('      </main>');
  lines.push('');

  // ---- Footer ----
  lines.push('      {/* Footer */}');
  lines.push('      <footer className="public-footer border-t border-[var(--border)] py-12 px-6">');
  lines.push('        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">');
  // Column 1: Brand
  lines.push('          <div className="space-y-3">');
  lines.push(`            <h3 className="font-semibold">${appTitle}</h3>`);
  lines.push(`            <p className="text-sm text-[var(--muted)]">Professional photography and visual storytelling.</p>`);
  lines.push('          </div>');
  // Column 2: Quick links
  lines.push('          <div className="space-y-3">');
  lines.push('            <h3 className="font-semibold text-sm uppercase tracking-wider text-[var(--muted)]">Quick Links</h3>');
  lines.push('            <div className="flex flex-col gap-2">');
  lines.push('              {navItems.map((item) => (');
  lines.push('                <button key={item.key} onClick={() => setCurrentPage(item.key)} className="text-sm text-[var(--muted)] hover:text-[var(--fg)] text-left p-0 bg-transparent transition-colors">{item.label}</button>');
  lines.push('              ))}');
  lines.push('            </div>');
  lines.push('          </div>');
  // Column 3: Contact
  lines.push('          <div className="space-y-3">');
  lines.push('            <h3 className="font-semibold text-sm uppercase tracking-wider text-[var(--muted)]">Contact</h3>');
  lines.push(`            <p className="text-sm text-[var(--muted)]">hello@${ctx.appName.toLowerCase()}.com</p>`);
  lines.push('          </div>');
  lines.push('        </div>');
  lines.push(`        <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-[var(--border)] text-center text-xs text-[var(--muted)]">&copy; ${new Date().getFullYear()} ${appTitle}. All rights reserved.</div>`);
  lines.push('      </footer>');

  lines.push('    </div>');
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
