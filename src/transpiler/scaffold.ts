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
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent)',
        surface: 'var(--surface)',
        border: 'var(--border)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
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
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
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
    '  --bg-secondary: rgba(255,255,255,0.06);',
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
  --accent-hover: color-mix(in srgb, var(--accent) 85%, ${isDark ? 'white' : 'black'});
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
}

/* ---- Base ---- */
body {
  margin: 0;
  font-family: ${getFontFamily(ctx)};
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
  min-height: 100vh;
}
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse 80% 60% at 50% -20%, rgba(var(--accent-rgb), 0.12), transparent 70%);
  pointer-events: none;
  z-index: 0;
}
#root { position: relative; z-index: 1; }

*, *::before, *::after {
  box-sizing: border-box;
}

/* ---- Scrollbar ---- */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }

/* ---- Typography ---- */
h1 { font-size: 2.25rem; font-weight: 800; letter-spacing: -0.035em; line-height: 1.15; }
h2 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.3; }
h3 { font-size: 1.125rem; font-weight: 600; line-height: 1.4; }

/* ---- Tables ---- */
table { width: 100%; border-collapse: collapse; }
th {
  text-align: left; font-weight: 600; padding: 12px 16px;
  border-bottom: 2px solid var(--border); font-size: 0.75rem;
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted);
}
td { padding: 12px 16px; border-bottom: 1px solid var(--border); }
tbody tr { transition: background 0.1s; }
tbody tr:hover { background: var(--hover); }

/* ---- Forms ---- */
.form-group {
  display: flex; flex-direction: column; gap: 6px;
}
.form-group label {
  font-size: 0.8125rem; font-weight: 500; color: var(--muted);
}

input:not([type="checkbox"]):not([type="radio"]), select, textarea {
  width: 100%;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  padding: 10px 14px;
  background: transparent;
  color: var(--fg);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.15);
}
input::placeholder, textarea::placeholder {
  color: var(--muted);
  opacity: 0.7;
}
input:focus-visible, select:focus-visible, button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
input[type="checkbox"], input[type="radio"] {
  width: auto;
  cursor: pointer;
  accent-color: var(--accent);
}

/* ---- Buttons ---- */
button {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 20px; border-radius: var(--radius); font-size: 0.875rem;
  font-weight: 600; cursor: pointer; transition: all 0.2s ease; border: none;
  color: inherit; background: transparent;
}
button:hover { opacity: 0.9; transform: translateY(-1px); }
button:active { transform: scale(0.98) translateY(0); }
button:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }

/* ---- Cards ---- */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 24px;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  box-shadow: 0 8px 32px rgba(var(--accent-rgb), 0.08), var(--card-shadow);
}

/* ---- Empty state ---- */
.empty-state {
  text-align: center; padding: 48px 24px; color: var(--muted);
  font-size: 0.875rem;
}

/* ---- Code blocks ---- */
code { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; }
pre {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; margin: 0;
  background: rgba(var(--accent-rgb), 0.04); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px 24px; overflow-x: auto;
  text-align: left;
}
pre code { background: none; padding: 0; font-size: inherit; }
hr { border: none; }

/* ---- Links ---- */
a { transition: all 0.2s ease; }

/* ---- Sidebar base ---- */
aside { background: var(--surface); }

/* ---- Utility animations ---- */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
@keyframes spin { to { transform: rotate(360deg); } }

.animate-fade-in { animation: fadeIn 0.2s ease-out; }
.animate-slide-up { animation: slideUp 0.25s ease-out; }
.animate-slide-in { animation: slideIn 0.2s ease-out; }

/* ---- Delete/Confirm Modal ---- */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 50; animation: fadeIn 0.15s ease-out;
}
.modal-panel {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 24px;
  max-width: 400px; width: 90%; animation: slideUp 0.2s ease-out;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

/* ---- Selection ---- */
::selection {
  background: rgba(var(--accent-rgb), 0.3);
  color: inherit;
}
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
      case 'mono': families.push("-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "'Inter'", "system-ui", "sans-serif"); break;
      case 'display': families.push("'Inter'", 'system-ui', 'sans-serif'); break;
      case 'serif': families.push('Georgia', 'serif'); break;
      default: families.push(p.trim());
    }
  }
  return families.join(', ');
}
