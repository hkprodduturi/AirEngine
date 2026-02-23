/**
 * Project Scaffold Generator
 *
 * Generates all non-App files for a working Vite + React + Tailwind project:
 *   package.json, vite.config.js, tailwind.config.cjs, postcss.config.cjs,
 *   index.html, src/main.jsx, src/index.css
 */

import type { TranspileContext } from './context.js';
import type { OutputFile } from './index.js';

export function generateScaffold(ctx: TranspileContext): OutputFile[] {
  return [
    { path: 'package.json', content: generatePackageJson(ctx.appName) },
    { path: 'vite.config.js', content: generateViteConfig() },
    { path: 'tailwind.config.cjs', content: generateTailwindConfig() },
    { path: 'postcss.config.cjs', content: generatePostcssConfig() },
    { path: 'index.html', content: generateIndexHtml(ctx.appName) },
    { path: 'src/main.jsx', content: generateMain() },
    { path: 'src/index.css', content: generateIndexCss(ctx) },
  ];
}

function generatePackageJson(appName: string): string {
  return JSON.stringify({
    name: appName,
    private: true,
    version: '0.0.1',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies: {
      'react': '^18.2.0',
      'react-dom': '^18.2.0',
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.2.0',
      'autoprefixer': '^10.4.17',
      'postcss': '^8.4.35',
      'tailwindcss': '^3.4.1',
      'vite': '^5.2.0',
    },
  }, null, 2) + '\n';
}

function generateViteConfig(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;
}

function generateTailwindConfig(): string {
  return `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {} },
  plugins: [],
};
`;
}

function generatePostcssConfig(): string {
  return `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
}

function generateIndexHtml(title: string): string {
  const displayTitle = title
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${displayTitle}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
`;
}

function generateMain(): string {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function generateIndexCss(ctx: TranspileContext): string {
  const accent = typeof ctx.style.accent === 'string' ? ctx.style.accent : '#6366f1';
  const radius = typeof ctx.style.radius === 'number' ? ctx.style.radius : 12;
  const isDark = ctx.style.theme === 'dark' || ctx.style.theme === undefined;

  // Collect extra color variables from style
  const extraVars: string[] = [];
  for (const [key, val] of Object.entries(ctx.style)) {
    if (key !== 'theme' && key !== 'accent' && key !== 'radius' && key !== 'font'
        && key !== 'density' && key !== 'maxWidth'
        && typeof val === 'string' && val.startsWith('#')) {
      extraVars.push(`  --${key}: ${val};`);
    }
  }

  // Theme-aware surface, border, and text palette
  const themeVars = isDark ? [
    '  --bg: #030712;',
    '  --bg-secondary: rgba(255,255,255,0.03);',
    '  --fg: #f3f4f6;',
    '  --muted: rgba(255,255,255,0.5);',
    '  --border: rgba(255,255,255,0.1);',
    '  --border-input: rgba(255,255,255,0.2);',
    '  --hover: rgba(255,255,255,0.08);',
    '  --card-shadow: 0 1px 3px rgba(0,0,0,0.4);',
  ] : [
    '  --bg: #ffffff;',
    '  --bg-secondary: #f9fafb;',
    '  --fg: #111827;',
    '  --muted: rgba(0,0,0,0.5);',
    '  --border: #e5e7eb;',
    '  --border-input: #d1d5db;',
    '  --hover: rgba(0,0,0,0.05);',
    '  --card-shadow: 0 1px 3px rgba(0,0,0,0.1);',
  ];

  const vars = [
    `  --accent: ${accent};`,
    `  --accent-rgb: ${hexToRgb(accent)};`,
    `  --radius: ${radius}px;`,
    ...themeVars,
    `  --surface: var(--bg-secondary);`,
    ...extraVars,
  ].join('\n');

  return `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
${vars}
}

body {
  margin: 0;
  font-family: ${getFontFamily(ctx)};
  -webkit-font-smoothing: antialiased;
  background: var(--bg);
  color: var(--fg);
}

* {
  box-sizing: border-box;
}

/* Tables */
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 600; padding: 12px 16px; border-bottom: 2px solid var(--border); font-size: 0.875rem; }
td { padding: 12px 16px; border-bottom: 1px solid var(--border); }
tbody tr:hover { background: var(--hover); }

/* Forms */
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 0.875rem; font-weight: 500; color: var(--muted); }

/* Global input/select/textarea */
input:not([type="checkbox"]):not([type="radio"]), select, textarea {
  width: 100%; border: 1px solid var(--border-input) !important; border-radius: var(--radius);
  padding: 10px 14px; background: transparent; color: var(--fg);
  font-size: 0.875rem; outline: none; transition: border-color 0.2s;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.15);
}
input::placeholder, textarea::placeholder { color: var(--muted); }
input:focus-visible, select:focus-visible, button:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
/* Checkbox/radio */
input[type="checkbox"], input[type="radio"] {
  width: auto; cursor: pointer; accent-color: var(--accent);
}

/* Buttons */
button {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 20px; border-radius: var(--radius); font-size: 0.875rem;
  font-weight: 500; cursor: pointer; transition: all 0.15s; border: none;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }

/* Cards */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 24px;
}

/* Empty state */
.empty-state { text-align: center; padding: 48px 24px; color: var(--muted); font-size: 0.875rem; }

/* Typography */
h1 { font-size: 1.875rem; font-weight: 700; letter-spacing: -0.025em; }
h2 { font-size: 1.25rem; font-weight: 600; }

/* Sidebar base */
aside { background: var(--surface); }
`;
}

function getFontFamily(ctx: TranspileContext): string {
  const font = ctx.style.font;
  if (!font || typeof font !== 'string') return 'system-ui, -apple-system, sans-serif';

  const parts = String(font).split('+');
  const families: string[] = [];
  for (const p of parts) {
    switch (p.trim()) {
      case 'sans': families.push('system-ui', '-apple-system', 'sans-serif'); break;
      case 'mono': families.push("'SF Mono'", "'Fira Code'", 'monospace'); break;
      case 'display': families.push("'Inter'", 'system-ui', 'sans-serif'); break;
      case 'serif': families.push('Georgia', 'serif'); break;
      default: families.push(p.trim());
    }
  }
  return families.join(', ');
}
