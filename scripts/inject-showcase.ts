/**
 * inject-showcase.ts — Patches a transpiled airengine-site App.jsx
 * with the embedded template showcase cards.
 *
 * Usage: npx tsx scripts/inject-showcase.ts <site-dir> <catalog-json>
 * Example: npx tsx scripts/inject-showcase.ts ./site gallery/catalog.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const siteDir = process.argv[2] || './site';
const catalogPath = process.argv[3] || 'gallery/catalog.json';

const appJsxPath = join(siteDir, 'src', 'App.jsx');
let content = readFileSync(appJsxPath, 'utf-8');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));

// Pick 9 diverse showcase templates
const pickSlugs = ['todo', 'crm', 'projectflow', 'ecommerce', 'blog', 'kanban', 'lms', 'clinic', 'brewery'];
const picks = pickSlugs
  .map(s => catalog.templates.find((t: any) => t.slug === s))
  .filter(Boolean)
  .map((t: any) => ({
    slug: t.slug,
    title: t.title,
    subtitle: t.subtitle || '',
    description: t.description,
    category: t.category,
    accent: t.accent,
    lines: t.lines,
    hasBackend: t.hasBackend,
    hasAuth: t.hasAuth,
    pageCount: t.pageCount,
  }));

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/`/g, '\\`').replace(/\$/g, '\\$');

const templateEntries = picks.map(t =>
  `  { slug: '${esc(t.slug)}', title: '${esc(t.title)}', subtitle: '${esc(t.subtitle)}', description: '${esc(t.description)}', category: '${esc(t.category)}', accent: '${t.accent}', lines: ${t.lines}, hasBackend: ${t.hasBackend}, hasAuth: ${t.hasAuth}, pageCount: ${t.pageCount} }`
).join(',\n');

// Add useMemo import if not present
if (!content.includes('useMemo')) {
  content = content.replace(
    "import { useState, useEffect } from 'react';",
    "import { useState, useEffect, useMemo } from 'react';"
  );
}

// Replace the templates section with <TemplatesShowcase />
content = content.replace(
  /<section id="templates"[^]*?<\/section>/,
  '<TemplatesShowcase />'
);

// Append the TemplatesShowcase component after the closing of App
const showcaseComponent = `
const SHOWCASE_TEMPLATES = [
${templateEntries}
];

const tagStyle = {
  fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 99,
  background: 'color-mix(in srgb, var(--fg) 8%, transparent)',
  color: 'var(--muted)',
};

function TemplatesShowcase() {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? SHOWCASE_TEMPLATES : SHOWCASE_TEMPLATES.slice(0, 6);

  return (
    <section id="templates" className="py-20 px-6 space-y-8 text-center">
      <h1 className="text-3xl font-bold">${catalog.templates.length} Ready-to-Use Templates</h1>
      <p className="text-lg text-[var(--muted)] leading-relaxed max-w-2xl mx-auto">
        From todo apps to full-stack SaaS platforms — every template is a complete, working application.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 16,
        textAlign: 'left',
      }}>
        {visible.map(t => (
          <a
            key={t.slug}
            href={\`./gallery/previews/\${t.slug}/\`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', flexDirection: 'column', textDecoration: 'none', color: 'inherit',
              borderRadius: 'var(--radius)', border: '1px solid var(--border)',
              background: 'var(--surface)', padding: 20,
              backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
              transition: 'transform 0.2s, border-color 0.2s, box-shadow 0.2s',
              minHeight: 200,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.borderColor = \`color-mix(in srgb, \${t.accent} 50%, var(--border))\`;
              e.currentTarget.style.boxShadow = \`0 8px 32px \${t.accent}18\`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{t.title}</h3>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                background: \`color-mix(in srgb, \${t.accent} 15%, transparent)\`,
                color: t.accent, whiteSpace: 'nowrap',
              }}>{t.category}</span>
            </div>
            {t.subtitle && (
              <p style={{ fontSize: 12, color: t.accent, margin: '0 0 4px', fontWeight: 500, opacity: 0.85 }}>
                {t.subtitle}
              </p>
            )}
            <p style={{
              fontSize: 13, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5, flex: 1,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {t.description}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
          </a>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {!showAll && (
          <button
            onClick={() => setShowAll(true)}
            style={{
              padding: '10px 24px', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--fg)', fontWeight: 600, fontSize: 14,
              cursor: 'pointer', transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--fg)'; }}
          >
            Show More
          </button>
        )}
        <a
          href="./gallery/index.html"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-[var(--accent)] text-white px-6 py-3 rounded-[var(--radius)] font-semibold hover:brightness-110 hover:shadow-lg hover:shadow-[var(--accent)]/20 cursor-pointer transition-all duration-200 inline-flex items-center justify-center no-underline"
        >
          Browse All ${catalog.templates.length} Templates →
        </a>
      </div>
    </section>
  );
}
`;

// Insert before the last line (which should be empty or end of file)
// Find the last closing brace of the App component and append after it
const lastExportEnd = content.lastIndexOf('\n}');
if (lastExportEnd !== -1) {
  content = content.slice(0, lastExportEnd + 2) + showcaseComponent;
}

writeFileSync(appJsxPath, content, 'utf-8');
console.log(`  ✓ Injected template showcase (${picks.length} cards) into ${appJsxPath}`);
