/**
 * SH9 Codegen Trace — Root Cause Mapping
 *
 * Maps runtime incident classifications to transpiler source locations.
 * Each trace entry identifies the transpiler file/function responsible
 * for a detected issue and provides a deterministic fix strategy.
 *
 * Pure functions — no file I/O, no side effects.
 */

// ---- Types ----

export interface CodegenTraceEntry {
  id: string;
  name: string;
  classification_ids: string[];
  output_file_patterns: RegExp[];
  transpiler_file: string;
  transpiler_function: string;
  detect: (files: Map<string, string>) => CodegenTraceResult;
  fix: CodegenFix;
}

export interface CodegenTraceResult {
  detected: boolean;
  severity: 'p0' | 'p1' | 'p2' | 'p3';
  details: string;
  affected_files: string[];
  affected_lines: Array<{ file: string; line: number; snippet: string }>;
}

export interface CodegenFix {
  strategy: 'wrap-selector' | 'add-import-route' | 'remove-wrapper' | 'add-class' | 'normalize-token' | 'add-target';
  target_file: string;
  target_function: string;
  description: string;
  apply: (currentSource: string, context?: CodegenTraceResult) => string;
}

// ---- Helpers ----

function findLines(content: string, pattern: RegExp): Array<{ line: number; snippet: string }> {
  const lines = content.split('\n');
  const results: Array<{ line: number; snippet: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      results.push({ line: i + 1, snippet: lines[i].trim() });
    }
  }
  return results;
}

function getFilesByPattern(files: Map<string, string>, pattern: RegExp): [string, string][] {
  const results: [string, string][] = [];
  for (const [path, content] of files) {
    if (pattern.test(path)) results.push([path, content]);
  }
  return results;
}

// ---- Trace Rules ----

/**
 * SH9-001: CSS Specificity Fight
 *
 * Bare element selectors (h1 {}, button {}, p {}) in generated CSS
 * override Tailwind utility classes due to higher specificity.
 * Fix: wrap bare element selectors in :where() for specificity 0.
 */
const cssSpecificityFight: CodegenTraceEntry = {
  id: 'SH9-001',
  name: 'CSS element selector specificity fight',
  classification_ids: ['style-specificity-conflict', 'style-global-selector-leak', 'css-specificity-fight'],
  output_file_patterns: [/index\.css$/],
  transpiler_file: 'src/transpiler/scaffold.ts',
  transpiler_function: 'generateIndexCss',
  detect: (files) => {
    const cssFiles = getFilesByPattern(files, /index\.css$/);
    // Note: code, pre, hr, a are low-risk reset rules — exclude from detection
    const bareSelectors = /^(h[1-6]|p|button|table|th|td|tbody|input|select|textarea|aside)\s*\{/;
    const affectedFiles: string[] = [];
    const affectedLines: Array<{ file: string; line: number; snippet: string }> = [];

    for (const [path, content] of cssFiles) {
      const matches = findLines(content, bareSelectors);
      if (matches.length > 0) {
        affectedFiles.push(path);
        for (const m of matches) {
          affectedLines.push({ file: path, ...m });
        }
      }
    }

    return {
      detected: affectedLines.length > 0,
      severity: 'p2',
      details: affectedLines.length > 0
        ? `Found ${affectedLines.length} bare element selector(s) without :where() wrapper`
        : 'All element selectors properly wrapped in :where()',
      affected_files: affectedFiles,
      affected_lines: affectedLines,
    };
  },
  fix: {
    strategy: 'wrap-selector',
    target_file: 'src/transpiler/scaffold.ts',
    target_function: 'generateIndexCss',
    description: 'Wrap bare element selectors in :where() to reduce specificity to 0, allowing Tailwind utilities to win.',
    apply: (source) => {
      // In the generateIndexCss function output, wrap bare element selectors in :where()
      // This operates on the transpiler source, not the generated CSS
      // The fix ensures the template strings emit :where(h1) instead of h1
      const bareElements = ['h1', 'h2', 'h3', 'p', 'table', 'th', 'td', 'tbody tr', 'button', 'input', 'select', 'textarea', 'a', 'aside', 'pre', 'code', 'hr'];
      let result = source;
      for (const el of bareElements) {
        // Match patterns like: h1 { or h1, h2 { (at line start in template strings)
        const pattern = new RegExp(`^(${el.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*\\{`, 'gm');
        // Don't double-wrap already wrapped selectors
        result = result.replace(pattern, (match) => {
          if (match.includes(':where(')) return match;
          return `:where(${el}) {`;
        });
      }
      return result;
    },
  },
};

/**
 * SH9-002: Page Exists But Unreachable
 *
 * A *Page.jsx file is generated but has no corresponding import or
 * route in App.jsx. The page exists but users can never navigate to it.
 * Fix: add missing lazy import + currentPage conditional.
 */
const pageUnreachable: CodegenTraceEntry = {
  id: 'SH9-002',
  name: 'Page exists but unreachable in App.jsx',
  classification_ids: ['codegen-route-navigation-bug', 'runtime-navigation-failure', 'dead-cta', 'element-not-found'],
  output_file_patterns: [/App\.jsx$/, /pages\/.*Page\.jsx$/],
  transpiler_file: 'src/transpiler/react/index.ts',
  transpiler_function: 'generateApp',
  detect: (files) => {
    const appJsx = [...files.entries()].find(([p]) => p.endsWith('App.jsx'));
    if (!appJsx) {
      return { detected: false, severity: 'p1', details: 'No App.jsx found', affected_files: [], affected_lines: [] };
    }

    const [appPath, appContent] = appJsx;
    const pageFiles = getFilesByPattern(files, /pages\/(\w+)Page\.jsx$/);
    const missingPages: string[] = [];
    const affectedLines: Array<{ file: string; line: number; snippet: string }> = [];

    for (const [pagePath] of pageFiles) {
      const match = pagePath.match(/pages\/(\w+)Page\.jsx$/);
      if (!match) continue;
      const pageName = match[1];
      // Check if App.jsx references this page
      if (!appContent.includes(`${pageName}Page`)) {
        missingPages.push(pageName);
        affectedLines.push({ file: pagePath, line: 1, snippet: `${pageName}Page not imported or routed in App.jsx` });
      }
    }

    return {
      detected: missingPages.length > 0,
      severity: 'p1',
      details: missingPages.length > 0
        ? `${missingPages.length} page(s) unreachable: ${missingPages.join(', ')}`
        : 'All pages have imports and routes in App.jsx',
      affected_files: missingPages.length > 0 ? [appPath, ...missingPages.map(p => `pages/${p}Page.jsx`)] : [],
      affected_lines: affectedLines,
    };
  },
  fix: {
    strategy: 'add-import-route',
    target_file: 'src/transpiler/react/index.ts',
    target_function: 'generateApp',
    description: 'Add missing lazy import and currentPage conditional for unreachable pages.',
    apply: (source, context) => {
      // Modify the transpiler source to add a catch-all page enumeration.
      // The generateApp function iterates analysis.pages — inject a post-loop guard
      // that ensures all *Page.jsx files in the output have corresponding imports.
      if (!context || context.affected_lines.length === 0) return source;

      // Extract missing page names from detection context
      const missingPages: string[] = [];
      for (const line of context.affected_lines) {
        const match = line.snippet.match(/(\w+)Page not imported/);
        if (match) missingPages.push(match[1]);
      }
      if (missingPages.length === 0) return source;

      // Find the page import section in generateApp and add missing pages
      // Look for the pattern: "for (const page of analysis.pages)" block
      // and add explicit imports after it
      const marker = "// Ecommerce: import AccountPage";
      if (!source.includes(marker)) return source;

      const additions = missingPages.map(name =>
        `    // SH9-002 fix: ensure ${name}Page is imported\n` +
        `    if (useLazy) {\n` +
        `      lines.push(\`const ${name}Page = lazy(() => import('./pages/${name}Page.jsx'));\`);\n` +
        `    } else {\n` +
        `      lines.push(\`import ${name}Page from './pages/${name}Page.jsx';\`);\n` +
        `    }`
      ).join('\n');

      return source.replace(marker, additions + '\n  ' + marker);
    },
  },
};

/**
 * SH9-003: Double Layout Wrapping
 *
 * A page component imports and wraps content in <Layout> while
 * App.jsx already wraps pages in <Layout>. This causes double
 * navigation sidebars and broken styling.
 * Fix: remove Layout import/wrapping from page components.
 */
const doubleLayoutWrapping: CodegenTraceEntry = {
  id: 'SH9-003',
  name: 'Double Layout wrapping in page components',
  classification_ids: ['layout-auth-wrapper-composition', 'element-not-found'],
  output_file_patterns: [/pages\/.*Page\.jsx$/],
  transpiler_file: 'src/transpiler/react/page-gen.ts',
  transpiler_function: 'generatePageComponents',
  detect: (files) => {
    const appJsx = [...files.entries()].find(([p]) => p.endsWith('App.jsx'));
    if (!appJsx) {
      return { detected: false, severity: 'p1', details: 'No App.jsx found', affected_files: [], affected_lines: [] };
    }

    const [, appContent] = appJsx;
    const appHasLayout = appContent.includes('<Layout');
    if (!appHasLayout) {
      return { detected: false, severity: 'p1', details: 'App.jsx does not use Layout', affected_files: [], affected_lines: [] };
    }

    const pageFiles = getFilesByPattern(files, /pages\/\w+Page\.jsx$/);
    const doubleWrapped: string[] = [];
    const affectedLines: Array<{ file: string; line: number; snippet: string }> = [];

    for (const [path, content] of pageFiles) {
      if (content.includes("import Layout") || content.includes("from './Layout") || content.includes("from '../Layout")) {
        doubleWrapped.push(path);
        const lines = findLines(content, /import.*Layout/);
        for (const l of lines) {
          affectedLines.push({ file: path, ...l });
        }
      }
    }

    return {
      detected: doubleWrapped.length > 0,
      severity: 'p1',
      details: doubleWrapped.length > 0
        ? `${doubleWrapped.length} page(s) import Layout while App.jsx already wraps in Layout`
        : 'No double Layout wrapping detected',
      affected_files: doubleWrapped,
      affected_lines: affectedLines,
    };
  },
  fix: {
    strategy: 'remove-wrapper',
    target_file: 'src/transpiler/react/page-gen.ts',
    target_function: 'generatePageComponents',
    description: 'Remove Layout import and wrapping from page components that are already inside Layout in App.jsx.',
    apply: (source) => {
      // Remove Layout import lines from generated page content
      let result = source;
      // Remove: import Layout from '../Layout.jsx';
      result = result.replace(/import Layout from ['"]\.\.\/Layout\.jsx['"];\n?/g, '');
      // Remove <Layout> and </Layout> wrappers (keep inner content)
      result = result.replace(/<Layout[^>]*>\n?/g, '');
      result = result.replace(/<\/Layout>\n?/g, '');
      return result;
    },
  },
};

/**
 * SH9-004: Sidebar Alignment Mismatch
 *
 * Sidebar category buttons and headings have inconsistent padding,
 * causing visual misalignment between "Department" heading and
 * filter buttons below it.
 * Fix: ensure heading and button siblings share the same padding class.
 */
const sidebarAlignment: CodegenTraceEntry = {
  id: 'SH9-004',
  name: 'Sidebar heading/button padding mismatch',
  classification_ids: ['layout-alignment-regression'],
  output_file_patterns: [/pages\/ShopPage\.jsx$/, /Layout\.jsx$/],
  transpiler_file: 'src/transpiler/index.ts',
  transpiler_function: 'generateEcommercePages',
  detect: (files) => {
    const shopPage = [...files.entries()].find(([p]) => p.includes('ShopPage.jsx'));
    if (!shopPage) {
      return { detected: false, severity: 'p2', details: 'No ShopPage found', affected_files: [], affected_lines: [] };
    }

    const [path, content] = shopPage;
    const affectedLines: Array<{ file: string; line: number; snippet: string }> = [];

    // Check heading vs button padding classes
    const headingPadding = content.match(/h3[^>]*className="[^"]*px-(\d+)/);
    const buttonPadding = content.match(/button[^>]*className[^>]*px-(\d+)/);

    if (headingPadding && buttonPadding) {
      const hPad = headingPadding[1];
      const bPad = buttonPadding[1];
      if (hPad !== bPad) {
        const lines = findLines(content, /className="[^"]*px-\d+/);
        for (const l of lines.slice(0, 2)) {
          affectedLines.push({ file: path, ...l });
        }
        return {
          detected: true,
          severity: 'p2',
          details: `Sidebar heading uses px-${hPad} but buttons use px-${bPad}`,
          affected_files: [path],
          affected_lines: affectedLines,
        };
      }
    }

    return {
      detected: false,
      severity: 'p2',
      details: 'Sidebar padding is consistent',
      affected_files: [],
      affected_lines: [],
    };
  },
  fix: {
    strategy: 'add-class',
    target_file: 'src/transpiler/index.ts',
    target_function: 'generateEcommercePages',
    description: 'Align sidebar heading and button horizontal padding to the same value (px-3).',
    apply: (source, context) => {
      // Normalize sidebar heading and button padding in the ShopPage template.
      // The transpiler source has template strings with px-N classes.
      // Find the sidebar section and ensure heading h3 and buttons both use px-3.
      let result = source;

      // Normalize the h3 "Department" heading padding
      // Match: className="...(px-N)..." on the h3 Department line
      result = result.replace(
        /(h3\s+className="[^"]*?)px-\d+([^"]*Department)/g,
        '$1px-3$2',
      );

      // Normalize the sidebar button padding
      // Match: className={`...px-N py-2 rounded-lg text-sm...`} in sidebar buttons
      result = result.replace(
        /(w-full text-left justify-start\s+)px-\d+(\s+py-2 rounded-lg text-sm)/g,
        '$1px-3$2',
      );

      return result;
    },
  },
};

/**
 * SH9-005: Unresolved Handler Stub
 *
 * A mutation action in @ui generates a `console.log('name', ...args)` stub
 * instead of a real API call. This means the button is dead on arrival —
 * it logs to console but never calls the server.
 * Fix: Add @handler contract for the mutation name to .air source.
 */
const unresolvedHandlerStub: CodegenTraceEntry = {
  id: 'SH9-005',
  name: 'Unresolved handler stub (dead CTA)',
  classification_ids: ['dead-cta', 'unresolved-handler-stub'],
  output_file_patterns: [/App\.jsx$/, /pages\/.*Page\.jsx$/],
  transpiler_file: 'src/transpiler/react/mutation-gen.ts',
  transpiler_function: 'generateMutations',
  detect: (files) => {
    const stubPattern = /console\.log\('(\w+)',\s*\.\.\.args\)/g;
    const affectedFiles: string[] = [];
    const affectedLines: Array<{ file: string; line: number; snippet: string }> = [];

    for (const [path, content] of files) {
      if (!path.endsWith('.jsx')) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = stubPattern.exec(lines[i]);
        if (match) {
          if (!affectedFiles.includes(path)) affectedFiles.push(path);
          affectedLines.push({ file: path, line: i + 1, snippet: lines[i].trim() });
        }
      }
      stubPattern.lastIndex = 0;
    }

    return {
      detected: affectedLines.length > 0,
      severity: 'p1',
      details: affectedLines.length > 0
        ? `Found ${affectedLines.length} unresolved handler stub(s): ${affectedLines.map(l => {
            const m = l.snippet.match(/console\.log\('(\w+)'/);
            return m ? m[1] : 'unknown';
          }).join(', ')}`
        : 'No unresolved handler stubs detected',
      affected_files: affectedFiles,
      affected_lines: affectedLines,
    };
  },
  fix: {
    strategy: 'normalize-token',
    target_file: 'src/transpiler/react/mutation-gen.ts',
    target_function: 'generateMutations',
    description: "Add @handler contract for the unresolved mutation name to .air source, eliminating the console.log stub.",
    apply: (source) => {
      // This fix operates at the .air source level, not the transpiler source.
      // The fix suggestion is to add @handler contracts — the transpiler code itself is correct.
      return source;
    },
  },
};

/**
 * SH9-006: Handler Scaffold (Non-Executable)
 *
 * A @handler contract exists in the .air source but has no executable target,
 * so the server endpoint returns a scaffold JSON response instead of
 * performing real business logic. The route exists and responds 200,
 * but does nothing meaningful at runtime.
 * Fix: Add executable target to the handler contract (e.g. > ~db.Order.create).
 */
const handlerScaffoldOnly: CodegenTraceEntry = {
  id: 'SH9-006',
  name: 'Handler contract scaffold (no executable target)',
  classification_ids: ['handler-scaffold-only', 'handler-runtime-execution-failure'],
  output_file_patterns: [/api\.ts$/],
  transpiler_file: 'src/transpiler/express/api-router-gen.ts',
  transpiler_function: 'generateHandlerContractEndpoint',
  detect: (files) => {
    // Detect scaffold endpoints: res.json({ success: true, handler: '...', received: { ... } })
    const scaffoldPattern = /res\.json\(\{\s*success:\s*true,\s*handler:\s*'(\w+)',\s*received:/g;
    const affectedFiles: string[] = [];
    const affectedLines: Array<{ file: string; line: number; snippet: string }> = [];

    for (const [path, content] of files) {
      if (!path.endsWith('api.ts') && !path.endsWith('.ts')) continue;
      const contentLines = content.split('\n');
      for (let i = 0; i < contentLines.length; i++) {
        const match = scaffoldPattern.exec(contentLines[i]);
        if (match) {
          if (!affectedFiles.includes(path)) affectedFiles.push(path);
          affectedLines.push({ file: path, line: i + 1, snippet: contentLines[i].trim() });
        }
      }
      scaffoldPattern.lastIndex = 0;
    }

    return {
      detected: affectedLines.length > 0,
      severity: 'p2',
      details: affectedLines.length > 0
        ? `Found ${affectedLines.length} scaffold-only handler endpoint(s): ${affectedLines.map(l => {
            const m = l.snippet.match(/handler:\s*'(\w+)'/);
            return m ? m[1] : 'unknown';
          }).join(', ')}`
        : 'All handler contracts have executable targets',
      affected_files: affectedFiles,
      affected_lines: affectedLines,
    };
  },
  fix: {
    strategy: 'add-target',
    target_file: 'src/transpiler/express/api-router-gen.ts',
    target_function: 'generateHandlerContractEndpoint',
    description: "Add executable target to @handler contract (e.g. checkout(cartId:str) > ~db.Order.create) to generate real server logic.",
    apply: (source) => {
      return source;
    },
  },
};

// ---- Registry ----

export const CODEGEN_TRACE_REGISTRY: CodegenTraceEntry[] = [
  cssSpecificityFight,
  pageUnreachable,
  doubleLayoutWrapping,
  sidebarAlignment,
  unresolvedHandlerStub,
  handlerScaffoldOnly,
];

// ---- Lookup Functions ----

export function getTraceById(id: string): CodegenTraceEntry | undefined {
  return CODEGEN_TRACE_REGISTRY.find(t => t.id === id);
}

export function traceToTranspiler(
  classificationId: string,
  files: Map<string, string>,
): { trace: CodegenTraceEntry; result: CodegenTraceResult } | null {
  for (const entry of CODEGEN_TRACE_REGISTRY) {
    if (entry.classification_ids.includes(classificationId)) {
      const result = entry.detect(files);
      if (result.detected) {
        return { trace: entry, result };
      }
    }
  }
  return null;
}

/**
 * Run all trace rules against a set of generated files.
 * Returns all detected issues.
 */
export function runAllTraces(files: Map<string, string>): Array<{
  trace: CodegenTraceEntry;
  result: CodegenTraceResult;
}> {
  const results: Array<{ trace: CodegenTraceEntry; result: CodegenTraceResult }> = [];
  for (const entry of CODEGEN_TRACE_REGISTRY) {
    const result = entry.detect(files);
    if (result.detected) {
      results.push({ trace: entry, result });
    }
  }
  return results;
}
