/**
 * build-gallery.ts — Template Gallery & Live Preview Builder
 *
 * Extracts metadata from all 108 .air templates, pre-transpiles each to a
 * client-only React app, builds them with Vite, and generates a polished
 * gallery React app as the index page.
 *
 * Usage: npm run build:gallery
 * Phases: A) Extract metadata → B) Generate gallery scaffold via .air
 *         → C) Pre-transpile → D) Replace App.jsx with hand-crafted gallery
 *         → E) Vite build all
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, symlinkSync, rmSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec as execCb } from 'child_process';
import { promisify } from 'util';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';

const exec = promisify(execCb);
const __dirname = dirname(fileURLToPath(import.meta.url));

const EXAMPLES_DIR = join(__dirname, '..', 'examples');
const GALLERY_DIR = join(__dirname, '..', 'gallery');
const BATCH_SIZE = 10;

// ── Category Scheme ──────────────────────────────────────────────────────────

interface CategoryRule {
  name: string;
  keywords: string[];
}

const CATEGORIES: CategoryRule[] = [
  { name: 'Starter', keywords: ['todo', 'expense', 'landing', 'portfolio', 'auth', 'dashboard', 'airengine-site'] },
  { name: 'Business', keywords: ['crm', 'ecommerce', 'invoice', 'finance', 'hr', 'procurement', 'restaurant', 'catering', 'print', 'food-truck', 'garage', 'job-board', 'booking', 'event', 'construction', 'fundraiser', 'coworking', 'moving'] },
  { name: 'SaaS', keywords: ['projectflow', 'kanban', 'helpdesk', 'bug-tracker', 'feature-flag', 'code-review', 'timesheet', 'survey', 'analytics', 'ad-campaign'] },
  { name: 'Healthcare', keywords: ['clinic', 'pharmacy', 'hospital', 'blood', 'mental-health', 'veterinary', 'nutrition', 'lab'] },
  { name: 'Education', keywords: ['lms', 'gradebook', 'school', 'course', 'tutoring', 'scholarship', 'quiz', 'student', 'alumni', 'library'] },
  { name: 'Logistics', keywords: ['fleet', 'shipping', 'supply-chain', 'warehouse', 'dispatch', 'cold-chain', 'route', 'customs', 'parking', 'package'] },
  { name: 'Real Estate', keywords: ['property', 'tenant', 'lease', 'vacation-rental', 'interior-design', 'coworking', 'student-housing'] },
  { name: 'Lifestyle', keywords: ['recipe', 'coffee', 'fitness', 'wedding', 'wine', 'plant', 'pet', 'book-club', 'escape-room', 'brewery', 'travel', 'meal-prep', 'food-delivery', 'sports', 'neighborhood'] },
  { name: 'Content', keywords: ['blog', 'wiki', 'newsroom', 'podcast', 'photo', 'video', 'music', 'social', 'chat', 'film', 'art', 'design-studio'] },
  { name: 'Operations', keywords: ['monitoring', 'ci-dashboard', 'compliance', 'incident', 'api-gateway', 'license', 'asset', 'inventory', 'returns', 'volunteer'] },
];

function categorize(slug: string, title: string, description: string): string {
  const haystack = `${slug} ${title} ${description}`.toLowerCase();
  for (const rule of CATEGORIES) {
    if (rule.keywords.some(kw => haystack.includes(kw))) return rule.name;
  }
  return 'Other';
}

// ── Metadata Types ───────────────────────────────────────────────────────────

interface TemplateMeta {
  slug: string;
  appName: string;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  accent: string;
  lines: number;
  hasBackend: boolean;
  hasAuth: boolean;
  pageCount: number;
  modelCount: number;
  blocks: string[];
}

interface Catalog {
  generated: string;
  version: string;
  count: number;
  templates: TemplateMeta[];
}

// ── Fallback Descriptions ────────────────────────────────────────────────────

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  'airengine-site': 'The AirEngine marketing site — built with AirEngine itself. Dark theme, stats, code examples, and block showcase.',
  'art-auction': 'Artworks, artists, auctions, and bidding. Browse collections, place bids, and track auction results.',
  'auth': 'JWT login, signup, and protected routes. Demonstrates auth flow with email/password forms.',
  'cold-chain': 'Temperature-sensitive shipments, sensors, and alerts. Monitor cold chain logistics in real-time.',
  'customs': 'Customs declarations, inspections, tariffs, and clearance workflows for import/export operations.',
  'dashboard': 'Admin dashboard with stats, charts, and user management. Role-based access with compact data views.',
  'dispatch': 'Dispatch coordination for drivers, routes, and deliveries. Real-time tracking and assignment workflows.',
  'escape-room': 'Escape room bookings, puzzles, teams, and leaderboards. Manage rooms, schedule sessions, track scores.',
  'expense-tracker': 'Track expenses with budgets, charts, and category filters. Visual spending breakdown and persistence.',
  'fullstack-todo': 'Todo app with Express API and Prisma database. Full CRUD with server-side persistence.',
  'garage-sale': 'Garage sale listings, categories, and buyer inquiries. Post items, manage prices, track sales.',
  'incident-mgmt': 'Incident tracking, severity levels, assignments, and resolution timelines for ops teams.',
  'landing': 'Marketing landing page with hero, features grid, pricing tiers, and call-to-action sections.',
  'license-mgmt': 'Software license keys, activations, expiration tracking, and compliance management.',
  'package-locker': 'Smart locker management for package delivery, pickup codes, and resident notifications.',
  'parking-mgmt': 'Parking spots, reservations, permits, and violation tracking for parking facilities.',
  'pet-grooming': 'Pet grooming appointments, services, pet profiles, and groomer scheduling.',
  'plant-care': 'Plant collection, watering schedules, care guides, and growth tracking for plant enthusiasts.',
  'returns': 'Product returns, refund processing, return labels, and customer communication workflows.',
  'route-planner': 'Route optimization, waypoints, distance calculations, and delivery scheduling.',
  'shipping': 'Shipments, carriers, tracking numbers, and delivery status updates for logistics.',
  'supply-chain': 'Suppliers, purchase orders, inventory levels, and supply chain visibility dashboards.',
  'todo': 'Classic todo app with filters and local persistence. Add, complete, and delete tasks.',
  'travel-planner': 'Trip itineraries, destinations, bookings, and travel checklists for vacation planning.',
  'wedding-planner': 'Wedding events, guest lists, vendors, seating charts, and budget tracking.',
};

// ── Phase A: Extract Metadata ────────────────────────────────────────────────

function humanize(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function autoDescription(meta: { slug: string; hasBackend: boolean; hasAuth: boolean; pageCount: number; modelCount: number; blocks: string[] }): string {
  // Generate a meaningful description from metadata
  const parts: string[] = [];
  if (meta.hasBackend && meta.hasAuth) {
    parts.push(`Full-stack app with ${meta.pageCount} pages, ${meta.modelCount} models, and JWT authentication.`);
  } else if (meta.hasBackend) {
    parts.push(`Full-stack app with ${meta.pageCount} pages and ${meta.modelCount} database models.`);
  } else if (meta.pageCount > 0) {
    parts.push(`Frontend app with ${meta.pageCount} pages.`);
  } else {
    parts.push('Single-page frontend application.');
  }
  const extras: string[] = [];
  if (meta.blocks.includes('cron')) extras.push('scheduled jobs');
  if (meta.blocks.includes('webhook')) extras.push('webhooks');
  if (meta.blocks.includes('queue')) extras.push('background workers');
  if (meta.blocks.includes('email')) extras.push('email templates');
  if (extras.length > 0) parts.push(`Includes ${extras.join(', ')}.`);
  return parts.join(' ');
}

function extractMetadata(filePath: string): TemplateMeta {
  const source = readFileSync(filePath, 'utf-8');
  const lines = source.split('\n');
  const slug = basename(filePath, '.air');

  // App name
  const appMatch = source.match(/@app:(\S+)/);
  const appName = appMatch ? appMatch[1] : slug;

  // Header extraction — three formats:
  // 1. Block header: # === / # Title — Subtitle / # === / # Description / # ===
  // 2. Simple header: # Title — Subtitle / # Description
  // 3. No header: fallback to humanized filename
  let title = '';
  let subtitle = '';
  let description = '';

  const commentLines = lines.filter(l => l.startsWith('#'));

  if (commentLines.length >= 5 && commentLines[0].includes('====')) {
    // Block header format
    const titleLine = commentLines[1]?.replace(/^#\s*/, '') ?? '';
    const dashIdx = titleLine.indexOf('—');
    if (dashIdx !== -1) {
      title = titleLine.slice(0, dashIdx).trim();
      subtitle = titleLine.slice(dashIdx + 1).trim();
    } else {
      title = titleLine.trim();
    }
    // Description lines are between the 2nd and last separator
    const descLines: string[] = [];
    for (let i = 3; i < commentLines.length; i++) {
      if (commentLines[i].includes('====')) break;
      descLines.push(commentLines[i].replace(/^#\s*/, '').trim());
    }
    description = descLines.join(' ');
  } else if (commentLines.length >= 2 && !commentLines[0].includes('====')) {
    // Simple header
    const titleLine = commentLines[0]?.replace(/^#\s*/, '') ?? '';
    const dashIdx = titleLine.indexOf('—');
    if (dashIdx !== -1) {
      title = titleLine.slice(0, dashIdx).trim();
      subtitle = titleLine.slice(dashIdx + 1).trim();
    } else {
      title = titleLine.trim();
    }
    description = commentLines.slice(1).map(l => l.replace(/^#\s*/, '').trim()).join(' ');
  } else {
    // No header — fallback
    title = humanize(slug);
    subtitle = '';
    description = '';
  }

  // Accent color
  const accentMatch = source.match(/accent:(#[0-9a-fA-F]{6})/);
  const accent = accentMatch ? accentMatch[1] : '#6366f1';

  // Block detection
  const blockNames = ['state', 'style', 'ui', 'api', 'auth', 'nav', 'persist', 'hook',
    'db', 'cron', 'webhook', 'queue', 'email', 'env', 'deploy'];
  const blocks = blockNames.filter(b => source.includes(`@${b}`));

  const hasBackend = blocks.includes('db') || blocks.includes('api');
  const hasAuth = blocks.includes('auth');

  // Page count
  const pageCount = (source.match(/@page:/g) || []).length;

  // Model count — models are inside @db{...} as Name{...} patterns
  const dbMatch = source.match(/@db\s*\{([\s\S]*?)\}/);
  let modelCount = 0;
  if (dbMatch) {
    const dbBody = dbMatch[1];
    const modelMatches = dbBody.match(/^\s*[A-Z][a-zA-Z]*\s*\{/gm);
    modelCount = modelMatches ? modelMatches.length : 0;
  }

  const meta = {
    slug, appName, title, subtitle, hasBackend, hasAuth, pageCount, modelCount, blocks,
    accent, lines: lines.length,
    description: '',
    category: '',
  };

  // Fill description: prefer parsed header, then manual fallback, then auto-generated
  if (description) {
    meta.description = description;
  } else if (FALLBACK_DESCRIPTIONS[slug]) {
    meta.description = FALLBACK_DESCRIPTIONS[slug];
  } else {
    meta.description = autoDescription(meta);
  }

  meta.category = categorize(slug, title, meta.description);

  return meta;
}

// ── Phase B: Generate minimal gallery.air (scaffold only) ────────────────────

function generateGalleryAir(): string {
  // Minimal .air file — only used to generate scaffold files (package.json, vite.config, etc.)
  // The actual App.jsx is replaced in Phase D with a hand-crafted React component
  return `@app:airengine-gallery
  @style(theme:dark,accent:#7c5cfc,radius:12,font:sans,maxWidth:1200)
  @ui(
    h1>"AirEngine Templates"
  )
`;
}

// ── Phase B2: Generate hand-crafted App.jsx ──────────────────────────────────

function generateGalleryAppJsx(templates: TemplateMeta[]): string {
  // Group templates by category
  const grouped = new Map<string, TemplateMeta[]>();
  for (const t of templates) {
    const list = grouped.get(t.category) || [];
    list.push(t);
    grouped.set(t.category, list);
  }

  const categories = ['All', ...CATEGORIES.map(c => c.name).filter(c => grouped.has(c)), ...(grouped.has('Other') ? ['Other'] : [])];

  // Escape for JSX string literals
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

  // Build the templates array as a JS literal
  const templateEntries = templates.map(t => {
    return `    { slug: '${esc(t.slug)}', title: '${esc(t.title)}', subtitle: '${esc(t.subtitle)}', description: '${esc(t.description)}', category: '${esc(t.category)}', accent: '${t.accent}', lines: ${t.lines}, hasBackend: ${t.hasBackend}, hasAuth: ${t.hasAuth}, pageCount: ${t.pageCount} }`;
  }).join(',\n');

  return `import { useState, useMemo } from 'react';

const TEMPLATES = [
${templateEntries}
];

const CATEGORIES = ${JSON.stringify(categories)};

export default function App() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = TEMPLATES;
    if (activeCategory !== 'All') {
      list = list.filter(t => t.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }
    return list;
  }, [activeCategory, search]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>

        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 0', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>AirEngine Templates</h1>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}>
              {TEMPLATES.length} templates
            </span>
          </div>
          <a href="https://github.com/hkprodduturi/AirEngine" target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 14, color: 'var(--muted)', textDecoration: 'none' }}>
            GitHub
          </a>
        </header>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', maxWidth: 400, padding: '10px 16px',
              borderRadius: 'var(--radius)', border: '1px solid var(--border)',
              background: 'var(--surface)', color: 'var(--fg)', fontSize: 14,
              outline: 'none',
            }}
          />
        </div>

        {/* Category Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 28 }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '7px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: activeCategory === cat ? 'var(--accent)' : 'transparent',
                color: activeCategory === cat ? '#fff' : 'var(--muted)',
              }}
            >
              {cat}
              {cat !== 'All' && (
                <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 11 }}>
                  {TEMPLATES.filter(t => t.category === cat).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Subtitle */}
        <p style={{ color: 'var(--muted)', fontSize: 15, marginBottom: 16, lineHeight: 1.6 }}>
          {activeCategory === 'All' ? 'All' : activeCategory} templates
          {search && <> matching "<strong style={{ color: 'var(--fg)' }}>{search}</strong>"</>}
          {' '}&mdash; click <strong style={{ color: 'var(--accent)' }}>Live Preview</strong> to open in a new tab.
          {' '}<span style={{ opacity: 0.6 }}>Showing {filtered.length} of {TEMPLATES.length}.</span>
        </p>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 24, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)', borderLeft: '3px solid var(--accent)', lineHeight: 1.7 }}>
          <strong>Note:</strong> Full-stack apps open directly to the dashboard (login is bypassed for previews). Data and API calls require a running backend &mdash; to try the full app, transpile locally: <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>air transpile {'<template>'}.air -o ./my-app</code>
          <br/>Default seed credentials: <strong style={{ color: 'var(--fg)' }}>admin@example.com</strong> / <strong style={{ color: 'var(--fg)' }}>password123</strong>
        </p>

        {/* Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 20,
          paddingBottom: 64,
        }}>
          {filtered.map(t => (
            <div key={t.slug} style={{
              display: 'flex', flexDirection: 'column',
              borderRadius: 'var(--radius)', border: '1px solid var(--border)',
              background: 'var(--surface)', padding: 24,
              boxShadow: 'var(--card-shadow)',
              transition: 'border-color 0.2s, transform 0.2s',
              minHeight: 240,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--border) 40%, var(--accent))';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            >
              {/* Title row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{t.title}</h3>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                  background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                  color: 'var(--accent)', whiteSpace: 'nowrap', flexShrink: 0,
                }}>{t.category}</span>
              </div>

              {/* Subtitle */}
              {t.subtitle && (
                <p style={{ fontSize: 13, color: 'var(--accent)', margin: '0 0 6px', fontWeight: 500, opacity: 0.85 }}>
                  {t.subtitle}
                </p>
              )}

              {/* Description */}
              <p style={{
                fontSize: 13, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.5, flex: 1,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {t.description}
              </p>

              {/* Tags */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                <span style={tagStyle}>{t.lines} lines</span>
                {t.pageCount > 0 && <span style={tagStyle}>{t.pageCount} pages</span>}
                <span style={{
                  ...tagStyle,
                  background: t.hasBackend
                    ? 'color-mix(in srgb, #10b981 18%, transparent)'
                    : 'color-mix(in srgb, #6366f1 18%, transparent)',
                  color: t.hasBackend ? '#10b981' : '#6366f1',
                }}>
                  {t.hasBackend ? 'Full-Stack' : 'Frontend'}
                </span>
                {t.hasAuth && (
                  <span style={{ ...tagStyle, background: 'color-mix(in srgb, #f59e0b 18%, transparent)', color: '#f59e0b' }}>
                    Auth
                  </span>
                )}
              </div>

              {/* Button */}
              <a
                href={\`./previews/\${t.slug}/\`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', textAlign: 'center',
                  padding: '10px 20px', borderRadius: 'var(--radius)',
                  background: 'var(--accent)', color: '#fff',
                  fontWeight: 600, fontSize: 14,
                  textDecoration: 'none', transition: 'filter 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.15)'; }}
                onMouseLeave={e => { e.currentTarget.style.filter = 'brightness(1)'; }}
              >
                Live Preview
              </a>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--muted)' }}>
            <p style={{ fontSize: 18, marginBottom: 8 }}>No templates found</p>
            <p style={{ fontSize: 14 }}>Try a different search or category.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const tagStyle = {
  fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 99,
  background: 'color-mix(in srgb, var(--fg) 8%, transparent)',
  color: 'var(--muted)',
};
`;
}

// ── Vite base path fix ───────────────────────────────────────────────────────

/** Patch vite.config.js to use relative base paths so assets resolve correctly */
function patchViteConfig(dir: string): void {
  const configPath = join(dir, 'vite.config.js');
  if (!existsSync(configPath)) return;
  let content = readFileSync(configPath, 'utf-8');
  if (content.includes("base:")) return; // already patched
  content = content.replace(
    'plugins: [react()],',
    "plugins: [react()],\n  base: './',",
  );
  writeFileSync(configPath, content, 'utf-8');
}

// ── Phase C: Pre-transpile All Templates ─────────────────────────────────────

interface TranspileStats {
  success: number;
  failed: number;
  failures: string[];
}

/** For auth-gated preview apps, inject a demo user so the app bypasses the login page */
function patchAuthForPreview(appJsxPath: string): void {
  if (!existsSync(appJsxPath)) return;
  let content = readFileSync(appJsxPath, 'utf-8');

  // Replace user state: null → demo user
  content = content.replace(
    "const [user, setUser] = useState(null);",
    "const [user, setUser] = useState({ id: 1, name: 'Demo User', email: 'admin@example.com', role: 'admin' });"
  );

  // Replace initial page: 'login' → first non-login page
  const pageMatch = content.match(/currentPage === '(\w+)' && \(\s*<div>/g);
  const pages = pageMatch
    ? pageMatch.map(m => m.match(/currentPage === '(\w+)'/)?.[1]).filter(p => p && p !== 'login' && p !== 'register')
    : [];
  const defaultPage = pages[0] || 'dashboard';
  content = content.replace(
    "const [currentPage, setCurrentPage] = useState('login');",
    `const [currentPage, setCurrentPage] = useState('${defaultPage}');`
  );

  writeFileSync(appJsxPath, content, 'utf-8');
}

function pretranspileTemplate(meta: TemplateMeta): boolean {
  const filePath = join(EXAMPLES_DIR, `${meta.slug}.air`);
  const outDir = join(GALLERY_DIR, 'previews', meta.slug);
  mkdirSync(outDir, { recursive: true });

  try {
    const source = readFileSync(filePath, 'utf-8');
    const ast = parse(source);
    const result = transpile(ast, {
      sourceLines: source.split('\n').length,
      target: 'client',
    });

    for (const file of result.files) {
      // Skip manifest
      if (file.path === '_airengine_manifest.json') continue;

      // Strip client/ prefix for fullstack apps so all previews have flat structure
      const relativePath = file.path.startsWith('client/') ? file.path.slice(7) : file.path;
      const fullPath = join(outDir, relativePath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, file.content, 'utf-8');
    }

    patchViteConfig(outDir);

    // Bypass auth for preview — inject demo user so apps open to dashboard
    if (meta.hasAuth) {
      patchAuthForPreview(join(outDir, 'src', 'App.jsx'));
    }

    return true;
  } catch (err) {
    console.warn(`  ⚠ Failed to transpile ${meta.slug}: ${(err as Error).message}`);
    return false;
  }
}

// ── Phase D: Transpile Gallery Scaffold + Replace App.jsx ────────────────────

function transpileGalleryScaffold(): boolean {
  try {
    const source = readFileSync(join(GALLERY_DIR, 'gallery.air'), 'utf-8');
    const ast = parse(source);
    const result = transpile(ast, { sourceLines: source.split('\n').length });

    for (const file of result.files) {
      if (file.path === '_airengine_manifest.json') continue;
      const fullPath = join(GALLERY_DIR, file.path);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, file.content, 'utf-8');
    }
    patchViteConfig(GALLERY_DIR);
    return true;
  } catch (err) {
    console.error(`  ✗ Failed to transpile gallery.air: ${(err as Error).message}`);
    return false;
  }
}

// ── Phase E: Vite Build All ──────────────────────────────────────────────────

async function viteBuildAll(dirs: string[]): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Shared node_modules optimization: install once, symlink to rest
  const firstDir = dirs[0];
  if (!firstDir) return { success: 0, failed: 0 };

  console.log('  Installing dependencies (once)...');
  try {
    execSync('npm install --silent 2>/dev/null', { cwd: firstDir, stdio: 'pipe' });
  } catch {
    console.error('  ✗ npm install failed in', firstDir);
    return { success: 0, failed: dirs.length };
  }

  const firstNodeModules = join(firstDir, 'node_modules');

  for (const dir of dirs.slice(1)) {
    const targetModules = join(dir, 'node_modules');
    try {
      if (existsSync(targetModules)) rmSync(targetModules, { recursive: true, force: true });
      symlinkSync(firstNodeModules, targetModules, 'junction');
    } catch {
      // Fallback: install individually
      try {
        execSync('npm install --silent 2>/dev/null', { cwd: dir, stdio: 'pipe' });
      } catch {
        console.warn(`  ⚠ npm install failed in ${basename(dir)}`);
      }
    }
  }

  // Batch vite builds
  console.log(`  Building ${dirs.length} apps (batches of ${BATCH_SIZE})...`);
  for (let i = 0; i < dirs.length; i += BATCH_SIZE) {
    const batch = dirs.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(dirs.length / BATCH_SIZE);
    process.stdout.write(`  Batch ${batchNum}/${totalBatches}...`);

    const results = await Promise.allSettled(
      batch.map(dir =>
        exec(`npx vite build`, { cwd: dir, env: { ...process.env, NODE_ENV: 'production' } })
      )
    );

    let batchSuccess = 0;
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        batchSuccess++;
        success++;
      } else {
        failed++;
        console.warn(`\n    ⚠ Vite build failed: ${basename(batch[j])}`);
      }
    }
    console.log(` ${batchSuccess}/${batch.length} ok`);
  }

  return { success, failed };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = performance.now();
  console.log('🔨 AirEngine Gallery Builder\n');

  // Clean previous build
  if (existsSync(GALLERY_DIR)) {
    rmSync(GALLERY_DIR, { recursive: true, force: true });
  }
  mkdirSync(GALLERY_DIR, { recursive: true });

  // Phase A: Extract metadata
  console.log('Phase A: Extracting metadata from .air files...');
  const airFiles = readdirSync(EXAMPLES_DIR)
    .filter(f => f.endsWith('.air'))
    .sort();

  const templates: TemplateMeta[] = airFiles.map(f => extractMetadata(join(EXAMPLES_DIR, f)));
  const catalog: Catalog = {
    generated: new Date().toISOString(),
    version: '0.1.8',
    count: templates.length,
    templates,
  };

  writeFileSync(join(GALLERY_DIR, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`  ✓ ${templates.length} templates cataloged (all with descriptions)\n`);

  // Phase B: Generate gallery.air (minimal — scaffold only)
  console.log('Phase B: Generating gallery scaffold...');
  const galleryAir = generateGalleryAir();
  writeFileSync(join(GALLERY_DIR, 'gallery.air'), galleryAir, 'utf-8');

  // Phase C: Pre-transpile all templates
  console.log('Phase C: Pre-transpiling templates...');
  const stats: TranspileStats = { success: 0, failed: 0, failures: [] };
  for (const meta of templates) {
    if (pretranspileTemplate(meta)) {
      stats.success++;
    } else {
      stats.failed++;
      stats.failures.push(meta.slug);
    }
  }
  console.log(`  ✓ ${stats.success} transpiled, ${stats.failed} failed`);
  if (stats.failures.length > 0) {
    console.log(`  ⚠ Failures: ${stats.failures.join(', ')}`);
  }
  console.log();

  // Phase D: Transpile gallery scaffold + replace App.jsx
  console.log('Phase D: Building gallery page...');
  if (transpileGalleryScaffold()) {
    // Replace the transpiler-generated App.jsx with our hand-crafted version
    const appJsx = generateGalleryAppJsx(templates);
    writeFileSync(join(GALLERY_DIR, 'src', 'App.jsx'), appJsx, 'utf-8');
    console.log('  ✓ Gallery scaffold + custom App.jsx written\n');
  } else {
    console.error('  ✗ Gallery scaffold failed — aborting\n');
    return;
  }

  // Phase E: Vite build
  console.log('Phase E: Vite building all apps...');
  const previewDirs = readdirSync(join(GALLERY_DIR, 'previews'))
    .filter(d => existsSync(join(GALLERY_DIR, 'previews', d, 'package.json')))
    .map(d => join(GALLERY_DIR, 'previews', d));

  // Include the gallery itself
  const allBuildDirs = [GALLERY_DIR, ...previewDirs];
  const buildStats = await viteBuildAll(allBuildDirs);

  // Copy each preview's dist/ into gallery/dist/previews/{slug}/ for zero-config serving
  console.log('  Copying preview builds into gallery dist...');
  const distPreviewsDir = join(GALLERY_DIR, 'dist', 'previews');
  mkdirSync(distPreviewsDir, { recursive: true });
  for (const dir of previewDirs) {
    const slug = basename(dir);
    const srcDist = join(dir, 'dist');
    const destDir = join(distPreviewsDir, slug);
    if (existsSync(srcDist)) {
      execSync(`cp -r "${srcDist}" "${destDir}"`, { stdio: 'pipe' });
    }
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Gallery build complete in ${elapsed}s`);
  console.log(`   ${buildStats.success} built, ${buildStats.failed} failed`);
  console.log(`   Serve: npx serve gallery/dist`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
