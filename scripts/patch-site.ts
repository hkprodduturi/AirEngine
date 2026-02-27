/**
 * patch-site.ts — Minimal post-processing for the airengine-site.
 *
 * Wires external URLs and adds logo SVG to the transpiler-generated nav bar.
 *
 * Usage: npx tsx scripts/patch-site.ts <site-dir>
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const siteDir = process.argv[2] || './output';
const appJsxPath = join(siteDir, 'src', 'App.jsx');

if (!existsSync(appJsxPath)) {
  console.error(`  ERROR: ${appJsxPath} not found. Transpile first.`);
  process.exit(1);
}

let content = readFileSync(appJsxPath, 'utf-8');
const patches: string[] = [];

// --- 1. "View on GitHub" button → external GitHub link ---
const viewOnGitHubAnchor = content.match(/<a href="#[^"]*"[^>]*>View on GitHub<\/a>/);
if (viewOnGitHubAnchor) {
  content = content.replace(
    viewOnGitHubAnchor[0],
    '<a href="https://github.com/hkprodduturi/AirEngine" target="_blank" rel="noopener noreferrer" className="border border-[var(--accent)] text-[var(--accent)] px-5 py-2.5 rounded-[var(--radius)] font-medium cursor-pointer hover:opacity-90 transition-colors inline-flex items-center justify-center no-underline">View on GitHub</a>'
  );
  patches.push('View on GitHub → external repo URL');
}

// --- 2. Footer plain-text links → external URLs ---
const footerLinks: [string, string][] = [
  ['GitHub', 'https://github.com/hkprodduturi/AirEngine'],
  ['Docs', 'https://github.com/hkprodduturi/AirEngine/blob/main/docs/quickstart-local.md'],
  ['Spec', 'https://github.com/hkprodduturi/AirEngine/blob/main/SPEC.md'],
  ['npm', 'https://www.npmjs.com/package/airengine'],
];
for (const [label, url] of footerLinks) {
  content = content.replace(
    `<a href="#" className="text-[var(--accent)] hover:underline cursor-pointer block text-center text-sm">${label}</a>`,
    `<a href="${url}" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline cursor-pointer text-sm">${label}</a>`
  );
}
patches.push('Footer links → external URLs');

// --- 3. Add logo SVG to transpiler-generated nav bar ---
content = content.replace(
  /(<a href="#[^"]*" className="font-bold text-lg text-\[var\(--fg\)\] no-underline hover:text-\[var\(--accent\)\] transition-colors">)(Airengine Site)(<\/a>)/,
  '$1<svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight:8,display:\'inline-block\',verticalAlign:\'middle\'}}><rect width="32" height="32" rx="8" fill="var(--accent)" /><path d="M18 4L8 18h6l-2 10 10-14h-6l2-10z" fill="white" /></svg>AirEngine$3'
);
patches.push('Logo SVG added to nav');

// --- 4. Add smooth scroll CSS ---
const indexCssPath = join(siteDir, 'src', 'index.css');
if (existsSync(indexCssPath)) {
  let css = readFileSync(indexCssPath, 'utf-8');
  if (!css.includes('scroll-behavior')) {
    css += '\nhtml { scroll-behavior: smooth; }\n';
    writeFileSync(indexCssPath, css, 'utf-8');
    patches.push('Smooth scroll CSS');
  }
}

writeFileSync(appJsxPath, content, 'utf-8');

console.log(`  Patched ${appJsxPath}:`);
for (const p of patches) console.log(`    - ${p}`);
console.log(`  ${patches.length} patches applied.`);
