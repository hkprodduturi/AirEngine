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
    `  --radius: ${radius}px;`,
    ...themeVars,
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
