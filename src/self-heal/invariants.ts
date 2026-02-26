/**
 * Self-Heal Invariants (SH2)
 *
 * Deterministic checks for known bad patterns in generated output.
 * Run against transpiled file maps before browser/runtime QA.
 *
 * Each invariant is a pure function: (files: Map<string, string>) => InvariantResult
 */

// ---- Types ----

export interface InvariantResult {
  id: string;
  name: string;
  passed: boolean;
  severity: 'p0' | 'p1' | 'p2' | 'p3';
  details: string;
  file_path: string | null;
  line_hint: number | null;
}

export interface InvariantDef {
  id: string;
  name: string;
  severity: 'p0' | 'p1' | 'p2' | 'p3';
  check: (files: Map<string, string>) => InvariantResult;
}

export interface InvariantSummary {
  total: number;
  passed: number;
  failed: number;
  results: InvariantResult[];
}

// ---- Helpers ----

function getFile(files: Map<string, string>, pattern: string): [string, string] | null {
  for (const [path, content] of files) {
    if (path.includes(pattern)) return [path, content];
  }
  return null;
}

function getFiles(files: Map<string, string>, pattern: string): [string, string][] {
  const results: [string, string][] = [];
  for (const [path, content] of files) {
    if (path.includes(pattern)) results.push([path, content]);
  }
  return results;
}

function findLineNumber(content: string, searchStr: string): number | null {
  const idx = content.indexOf(searchStr);
  if (idx === -1) return null;
  return content.slice(0, idx).split('\n').length;
}

// ---- Invariant Definitions ----

/**
 * INV-001: Paginated list fetch unwrapping
 *
 * Generated pages that call list API endpoints (api.getX()) should unwrap
 * paginated responses using `res.data ?? res` or `r.data ?? r` pattern.
 * Direct assignment like `.then(r => setItems(r))` without unwrapping causes
 * `.map is not a function` when the response is { data: [], meta: {} }.
 */
const paginatedListUnwrapping: InvariantDef = {
  id: 'INV-001',
  name: 'Paginated list fetch unwrapping',
  severity: 'p1',
  check: (files) => {
    const pageFiles = getFiles(files, 'pages/');
    const violations: string[] = [];

    for (const [path, content] of pageFiles) {
      // Find api.getXxx().then() calls that assign directly without .data unwrapping
      // Good: api.getProjects().then(r => setProjects(r.data ?? r))
      // Bad:  api.getProjects().then(r => setProjects(r))
      const fetchPattern = /api\.get\w+\(\)\.then\(\s*(?:r|res|result)\s*=>\s*set\w+\((?:r|res|result)\s*\)\s*\)/g;
      let match: RegExpExecArray | null;
      while ((match = fetchPattern.exec(content)) !== null) {
        // Check if this is NOT using .data unwrapping
        if (!match[0].includes('.data')) {
          violations.push(`${path}: ${match[0].slice(0, 60)}...`);
        }
      }
    }

    return {
      id: 'INV-001',
      name: 'Paginated list fetch unwrapping',
      passed: violations.length === 0,
      severity: 'p1',
      details: violations.length === 0
        ? 'All list fetches properly unwrap paginated responses.'
        : `Found ${violations.length} fetch(es) without .data unwrapping:\n${violations.join('\n')}`,
      file_path: violations.length > 0 ? violations[0].split(':')[0] : null,
      line_hint: null,
    };
  },
};

/**
 * INV-002: Auth wrapper composition
 *
 * Auth pages (login, signup, register) should NOT be wrapped in <Layout> component.
 * Wrapping auth pages in Layout causes nested constrained wrappers that break
 * the login page width and visual composition.
 */
const authWrapperComposition: InvariantDef = {
  id: 'INV-002',
  name: 'Auth wrapper composition',
  severity: 'p1',
  check: (files) => {
    const appJsx = getFile(files, 'App.jsx');
    if (!appJsx) {
      return {
        id: 'INV-002', name: 'Auth wrapper composition', passed: true,
        severity: 'p1', details: 'No App.jsx found — skipped.', file_path: null, line_hint: null,
      };
    }

    const [path, content] = appJsx;
    const violations: string[] = [];

    // Check for auth pages wrapped in Layout
    // Bad: <Layout ...><LoginPage /></Layout>
    // Good: <LoginPage /> (without Layout wrapper)
    const authPageNames = ['LoginPage', 'SignupPage', 'RegisterPage'];
    for (const pageName of authPageNames) {
      if (!content.includes(pageName)) continue;
      // Find the line with this page and check if it's inside a Layout block
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`<${pageName}`)) {
          // Look backward for Layout wrapper
          let depth = 0;
          for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
            if (lines[j].includes('<Layout')) {
              violations.push(`${path}:${i + 1}: ${pageName} wrapped in <Layout>`);
              break;
            }
          }
        }
      }
    }

    return {
      id: 'INV-002',
      name: 'Auth wrapper composition',
      passed: violations.length === 0,
      severity: 'p1',
      details: violations.length === 0
        ? 'Auth pages are not wrapped in Layout.'
        : `Auth pages incorrectly wrapped:\n${violations.join('\n')}`,
      file_path: violations.length > 0 ? path : null,
      line_hint: null,
    };
  },
};

/**
 * INV-003: Global auth submit width
 *
 * Generated CSS should not have overly broad rules that force all form submit
 * buttons to full width. Such rules break non-auth form buttons (e.g., inline
 * save buttons, card action buttons).
 */
const globalAuthSubmitWidth: InvariantDef = {
  id: 'INV-003',
  name: 'Global auth submit width',
  severity: 'p2',
  check: (files) => {
    const cssFiles = getFiles(files, '.css');
    const violations: string[] = [];

    for (const [path, content] of cssFiles) {
      // Detect overly broad submit/button width rules
      // Bad: button[type="submit"] { width: 100% }  (global)
      // Bad: form button { width: 100% }  (global)
      // OK:  .auth-form button { width: 100% }  (scoped)
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Check for unscoped button width rules
        if (/^button\s*\[type=["']submit["']\]\s*\{/.test(line) || /^button\s*\{/.test(line)) {
          // Look ahead for width: 100%
          for (let j = i; j < Math.min(lines.length, i + 5); j++) {
            if (lines[j].includes('width') && lines[j].includes('100%')) {
              violations.push(`${path}:${j + 1}: Unscoped button width: 100% rule`);
            }
          }
        }
        // Also check inline: button[type="submit"] { ... width: 100% ... }
        if (/^(?:button|input)\s*(?:\[type=["']submit["']\])?\s*\{[^}]*width:\s*100%/i.test(line)) {
          violations.push(`${path}:${i + 1}: Unscoped button/submit width: 100% rule`);
        }
      }
    }

    return {
      id: 'INV-003',
      name: 'Global auth submit width',
      passed: violations.length === 0,
      severity: 'p2',
      details: violations.length === 0
        ? 'No unscoped button width: 100% rules found.'
        : `Found ${violations.length} unscoped submit width rule(s):\n${violations.join('\n')}`,
      file_path: violations.length > 0 ? violations[0].split(':')[0] : null,
      line_hint: null,
    };
  },
};

/**
 * INV-004: Public route auth exemption
 *
 * If the generated server has /public/ routes, the auth middleware must exempt
 * /public/ paths. Also, protected non-public routes must remain guarded.
 */
const publicRouteAuthExemption: InvariantDef = {
  id: 'INV-004',
  name: 'Public route auth exemption',
  severity: 'p0',
  check: (files) => {
    const serverFile = getFile(files, 'server.ts') || getFile(files, 'server.js');
    const apiFile = getFile(files, 'api.ts') || getFile(files, 'api.js');

    // Only check if public routes exist
    const hasPublicRoutes = [...files.values()].some(c => c.includes('/public/'));
    if (!hasPublicRoutes) {
      return {
        id: 'INV-004', name: 'Public route auth exemption', passed: true,
        severity: 'p0', details: 'No /public/ routes found — skipped.', file_path: null, line_hint: null,
      };
    }

    const violations: string[] = [];

    // Check server entry exempts /public/ from auth middleware
    if (serverFile) {
      const [path, content] = serverFile;
      const hasPublicExemption = content.includes("/public/") && content.includes('next()');
      if (!hasPublicExemption) {
        violations.push(`${path}: Auth middleware does not exempt /public/ paths`);
      }
    }

    // Check protected routes still have requireAuth
    if (apiFile) {
      const [path, content] = apiFile;
      // Find non-public routes and ensure they have requireAuth
      const routeLines = content.split('\n').filter(l =>
        (l.includes('router.get') || l.includes('router.post') || l.includes('router.put') || l.includes('router.delete'))
        && !l.includes('/public/')
        && !l.includes('/auth/')
        && !l.includes('/health')
      );
      for (const line of routeLines) {
        if (!line.includes('requireAuth')) {
          // Not every route line needs requireAuth inline (it could be global middleware)
          // But if we see route registration without it AND no global middleware, flag it
          if (serverFile && !serverFile[1].includes('requireAuth')) {
            violations.push(`${path}: Non-public route may lack auth guard: ${line.trim().slice(0, 80)}`);
          }
        }
      }
    }

    return {
      id: 'INV-004',
      name: 'Public route auth exemption',
      passed: violations.length === 0,
      severity: 'p0',
      details: violations.length === 0
        ? 'Public routes exempted from auth; protected routes guarded.'
        : `Auth guard issues:\n${violations.join('\n')}`,
      file_path: violations.length > 0 ? violations[0].split(':')[0] : null,
      line_hint: null,
    };
  },
};

/**
 * INV-005: Public API auth-header
 *
 * Generated API client functions for /public/* endpoints should not send
 * an Authorization header. Only authenticated endpoints need auth headers.
 */
const publicApiAuthHeader: InvariantDef = {
  id: 'INV-005',
  name: 'Public API auth-header',
  severity: 'p1',
  check: (files) => {
    const apiClient = getFile(files, 'api.js') || getFile(files, 'api.ts');
    if (!apiClient) {
      return {
        id: 'INV-005', name: 'Public API auth-header', passed: true,
        severity: 'p1', details: 'No api.js/api.ts found — skipped.', file_path: null, line_hint: null,
      };
    }

    const [path, content] = apiClient;
    const violations: string[] = [];

    // Find public API functions and check they don't use authHeaders()
    // Pattern: function getPublicXxx(...) { ... fetch(url, { headers: authHeaders() }) ... }
    // Split by function boundaries
    const funcPattern = /export\s+async\s+function\s+(getPublic\w+|createPublic\w+|submitPublic\w+)\s*\([^)]*\)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = funcPattern.exec(content)) !== null) {
      const fnName = match[1];
      const fnStart = match.index;
      // Find the closing brace (simplified: next function or end)
      const nextFn = content.indexOf('\nexport ', fnStart + 1);
      const fnBody = content.slice(fnStart, nextFn === -1 ? undefined : nextFn);

      if (fnBody.includes('authHeaders()') || fnBody.includes('Authorization')) {
        const line = findLineNumber(content, match[0]);
        violations.push(`${path}:${line || '?'}: ${fnName}() sends auth headers on public endpoint`);
      }
    }

    return {
      id: 'INV-005',
      name: 'Public API auth-header',
      passed: violations.length === 0,
      severity: 'p1',
      details: violations.length === 0
        ? 'Public API functions do not send Authorization headers.'
        : `Public functions with auth headers:\n${violations.join('\n')}`,
      file_path: violations.length > 0 ? path : null,
      line_hint: null,
    };
  },
};

/**
 * INV-006: Slug route support
 *
 * If the .air file declares a GET:/public/projects/:slug route, the generated
 * server must handle slug-based lookups using findFirst({ where: { slug } })
 * or equivalent.
 */
const slugRouteSupport: InvariantDef = {
  id: 'INV-006',
  name: 'Slug route support',
  severity: 'p1',
  check: (files) => {
    // Check if server has a :slug route
    const serverFiles = [...getFiles(files, 'server.ts'), ...getFiles(files, 'api.ts'),
                         ...getFiles(files, 'server.js'), ...getFiles(files, 'api.js')];
    const hasSlugRoute = serverFiles.some(([_, content]) =>
      content.includes(':slug') || content.includes('req.params.slug')
    );

    if (!hasSlugRoute) {
      return {
        id: 'INV-006', name: 'Slug route support', passed: true,
        severity: 'p1', details: 'No :slug routes found — skipped.', file_path: null, line_hint: null,
      };
    }

    const violations: string[] = [];

    // Check that slug routes use findFirst/findUnique with slug
    for (const [path, content] of serverFiles) {
      if (content.includes(':slug') || content.includes('req.params.slug')) {
        const hasSlugLookup = content.includes('findFirst') || content.includes('findUnique');
        const hasWhereSlug = content.includes('slug') && (content.includes('where') || content.includes('req.params'));
        if (!hasSlugLookup || !hasWhereSlug) {
          violations.push(`${path}: :slug route does not use findFirst/findUnique with slug where clause`);
        }
      }
    }

    return {
      id: 'INV-006',
      name: 'Slug route support',
      passed: violations.length === 0,
      severity: 'p1',
      details: violations.length === 0
        ? 'Slug routes properly use findFirst/findUnique with slug lookup.'
        : `Slug route issues:\n${violations.join('\n')}`,
      file_path: violations.length > 0 ? violations[0].split(':')[0] : null,
      line_hint: null,
    };
  },
};

// ---- Registry ----

export const INVARIANTS: InvariantDef[] = [
  paginatedListUnwrapping,
  authWrapperComposition,
  globalAuthSubmitWidth,
  publicRouteAuthExemption,
  publicApiAuthHeader,
  slugRouteSupport,
];

// ---- Runner ----

export function runInvariants(files: Map<string, string>): InvariantSummary {
  const results = INVARIANTS.map(inv => inv.check(files));
  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
  };
}
