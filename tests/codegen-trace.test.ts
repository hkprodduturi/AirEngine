/**
 * SH9 Codegen Trace Tests
 *
 * Tests for root cause mapping: trace rules detect known bad patterns
 * in generated output and map them to transpiler source locations.
 */
import { describe, it, expect } from 'vitest';
import {
  CODEGEN_TRACE_REGISTRY,
  getTraceById,
  traceToTranspiler,
  runAllTraces,
} from '../src/self-heal/codegen-trace.js';

describe('Codegen Trace Registry', () => {
  it('has 4 initial trace rules', () => {
    expect(CODEGEN_TRACE_REGISTRY.length).toBe(4);
  });

  it('all entries have required fields', () => {
    for (const entry of CODEGEN_TRACE_REGISTRY) {
      expect(entry.id).toMatch(/^SH9-\d{3}$/);
      expect(entry.name).toBeTruthy();
      expect(entry.classification_ids.length).toBeGreaterThan(0);
      expect(entry.output_file_patterns.length).toBeGreaterThan(0);
      expect(entry.transpiler_file).toBeTruthy();
      expect(entry.transpiler_function).toBeTruthy();
      expect(entry.fix.strategy).toBeTruthy();
      expect(entry.fix.target_file).toBeTruthy();
      expect(entry.fix.description).toBeTruthy();
      expect(typeof entry.fix.apply).toBe('function');
      expect(typeof entry.detect).toBe('function');
    }
  });

  it('getTraceById returns correct entry', () => {
    const trace = getTraceById('SH9-001');
    expect(trace).toBeDefined();
    expect(trace!.name).toBe('CSS element selector specificity fight');
  });

  it('getTraceById returns undefined for unknown id', () => {
    expect(getTraceById('SH9-999')).toBeUndefined();
  });
});

describe('SH9-001: CSS Specificity Fight', () => {
  const trace = getTraceById('SH9-001')!;

  it('detects bare element selectors in CSS', () => {
    const files = new Map([
      ['client/src/index.css', 'h1 { font-size: 2rem; }\nbutton { padding: 10px; }'],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(true);
    expect(result.severity).toBe('p2');
    expect(result.affected_lines.length).toBeGreaterThanOrEqual(2);
  });

  it('passes when selectors are wrapped in :where()', () => {
    const files = new Map([
      ['client/src/index.css', ':where(h1) { font-size: 2rem; }\n:where(button) { padding: 10px; }'],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(false);
  });

  it('passes when no CSS files present', () => {
    const files = new Map([
      ['client/src/App.jsx', 'export default function App() {}'],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(false);
  });

  it('detects mixed bare and wrapped selectors', () => {
    const files = new Map([
      ['client/src/index.css', ':where(h1) { font-size: 2rem; }\np { line-height: 1.6; }'],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(true);
    expect(result.affected_lines.length).toBe(1);
    expect(result.affected_lines[0].snippet).toContain('p');
  });
});

describe('SH9-002: Page Unreachable', () => {
  const trace = getTraceById('SH9-002')!;

  it('detects page file not imported in App.jsx', () => {
    const files = new Map([
      ['client/src/App.jsx', 'import ShopPage from "./pages/ShopPage.jsx";\nexport default function App() {}'],
      ['client/src/pages/ShopPage.jsx', 'export default function ShopPage() {}'],
      ['client/src/pages/ContactPage.jsx', 'export default function ContactPage() {}'],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(true);
    expect(result.details).toContain('Contact');
  });

  it('passes when all pages are imported', () => {
    const files = new Map([
      ['client/src/App.jsx', 'import ShopPage from "./pages/ShopPage.jsx";\nimport ContactPage from "./pages/ContactPage.jsx";'],
      ['client/src/pages/ShopPage.jsx', 'export default function ShopPage() {}'],
      ['client/src/pages/ContactPage.jsx', 'export default function ContactPage() {}'],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(false);
  });

  it('passes when no App.jsx', () => {
    const files = new Map([
      ['client/src/pages/ShopPage.jsx', 'export default function ShopPage() {}'],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(false);
  });
});

describe('SH9-003: Double Layout Wrapping', () => {
  const trace = getTraceById('SH9-003')!;

  it('detects page importing Layout when App already uses it', () => {
    const files = new Map([
      ['client/src/App.jsx', '<Layout currentPage={currentPage}><ShopPage /></Layout>'],
      ['client/src/pages/ShopPage.jsx', "import Layout from '../Layout.jsx';\nexport default function ShopPage() { return <Layout><div>Shop</div></Layout>; }"],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(true);
    expect(result.affected_files).toContain('client/src/pages/ShopPage.jsx');
  });

  it('passes when pages do not import Layout', () => {
    const files = new Map([
      ['client/src/App.jsx', '<Layout currentPage={currentPage}><ShopPage /></Layout>'],
      ['client/src/pages/ShopPage.jsx', 'export default function ShopPage() { return <div>Shop</div>; }'],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(false);
  });

  it('passes when App does not use Layout', () => {
    const files = new Map([
      ['client/src/App.jsx', '<div><ShopPage /></div>'],
      ['client/src/pages/ShopPage.jsx', "import Layout from '../Layout.jsx';\nexport default function ShopPage() {}"],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(false);
  });
});

describe('SH9-004: Sidebar Alignment', () => {
  const trace = getTraceById('SH9-004')!;

  it('detects mismatched heading vs button padding', () => {
    const files = new Map([
      ['client/src/pages/ShopPage.jsx', `
<aside>
  <h3 className="px-4 font-bold">Department</h3>
  <button className="px-2 text-sm">All Products</button>
</aside>`],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(true);
    expect(result.details).toContain('px-4');
    expect(result.details).toContain('px-2');
  });

  it('passes when padding is consistent', () => {
    const files = new Map([
      ['client/src/pages/ShopPage.jsx', `
<aside>
  <h3 className="px-3 font-bold">Department</h3>
  <button className="px-3 text-sm">All Products</button>
</aside>`],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(false);
  });

  it('passes when no ShopPage', () => {
    const files = new Map([
      ['client/src/App.jsx', 'export default function App() {}'],
    ]);
    const result = trace.detect(files);
    expect(result.detected).toBe(false);
  });
});

describe('traceToTranspiler', () => {
  it('maps classification to trace when detected', () => {
    const files = new Map([
      ['client/src/index.css', 'h1 { font-size: 2rem; }'],
    ]);
    const result = traceToTranspiler('style-specificity-conflict', files);
    expect(result).not.toBeNull();
    expect(result!.trace.id).toBe('SH9-001');
    expect(result!.result.detected).toBe(true);
  });

  it('returns null for unmatched classification', () => {
    const files = new Map([['test.txt', 'hello']]);
    const result = traceToTranspiler('unknown-classification', files);
    expect(result).toBeNull();
  });

  it('returns null when classification matches but detection fails', () => {
    const files = new Map([
      ['client/src/index.css', ':where(h1) { font-size: 2rem; }'],
    ]);
    const result = traceToTranspiler('style-specificity-conflict', files);
    expect(result).toBeNull();
  });
});

describe('runAllTraces', () => {
  it('returns all detected issues', () => {
    const files = new Map([
      ['client/src/index.css', 'h1 { font-size: 2rem; }'],
      ['client/src/App.jsx', 'import ShopPage from "./pages/ShopPage.jsx";'],
      ['client/src/pages/ShopPage.jsx', 'export default function ShopPage() {}'],
      ['client/src/pages/HiddenPage.jsx', 'export default function HiddenPage() {}'],
    ]);
    const results = runAllTraces(files);
    expect(results.length).toBeGreaterThanOrEqual(2); // CSS + page unreachable
  });
});

describe('fix.apply (non-noop)', () => {
  it('SH9-001 wraps bare selectors in :where()', () => {
    const trace = getTraceById('SH9-001')!;
    const source = 'h1 { color: red; }\nbutton { padding: 8px; }\n:where(p) { margin: 0; }';
    const result = trace.fix.apply(source);
    expect(result).toContain(':where(h1) {');
    expect(result).toContain(':where(button) {');
    // Already wrapped — should not double-wrap
    expect(result).toContain(':where(p) { margin: 0; }');
    expect(result).not.toContain(':where(:where(');
  });

  it('SH9-002 adds missing page imports to transpiler source', () => {
    const trace = getTraceById('SH9-002')!;
    // Create detection context with a missing page
    const context = {
      detected: true,
      severity: 'p1' as const,
      details: '1 page(s) unreachable: Contact',
      affected_files: ['client/src/App.jsx', 'pages/ContactPage.jsx'],
      affected_lines: [{ file: 'pages/ContactPage.jsx', line: 1, snippet: 'ContactPage not imported or routed in App.jsx' }],
    };
    // Source with the marker that the fix targets
    const source = '  // some code\n  // Ecommerce: import AccountPage\n  lines.push("done");';
    const result = trace.fix.apply(source, context);
    expect(result).toContain('ContactPage');
    expect(result).toContain('SH9-002 fix');
    expect(result).not.toBe(source);
  });

  it('SH9-002 returns source unchanged when no missing pages in context', () => {
    const trace = getTraceById('SH9-002')!;
    const source = '  // Ecommerce: import AccountPage\n  lines.push("done");';
    const result = trace.fix.apply(source);
    expect(result).toBe(source);
  });

  it('SH9-003 removes Layout import and wrapping', () => {
    const trace = getTraceById('SH9-003')!;
    const source = `import Layout from '../Layout.jsx';\nexport default function ShopPage() {\n  return <Layout><div>content</div></Layout>;\n}`;
    const result = trace.fix.apply(source);
    expect(result).not.toContain("import Layout");
    expect(result).not.toContain('<Layout');
    expect(result).not.toContain('</Layout>');
    expect(result).toContain('content');
  });

  it('SH9-004 normalizes sidebar padding classes', () => {
    const trace = getTraceById('SH9-004')!;
    // Source with mismatched padding (h3 uses px-4, buttons use px-2)
    const source = `<h3 className="text-sm font-bold px-4 Department">\n<button className="w-full text-left justify-start px-2 py-2 rounded-lg text-sm">`;
    const result = trace.fix.apply(source);
    // Both should be normalized to px-3
    expect(result).toContain('px-3');
    expect(result).not.toContain('px-4');
    expect(result).not.toContain('px-2');
  });
});
