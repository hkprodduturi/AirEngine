/**
 * Self-Heal Foundation Tests (SH0 + SH1 + SH2)
 *
 * Tests schema conformance, incident capture, classification, and invariants.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateJsonSchema } from './schema-validator.js';
import {
  parseArgs,
  buildIncident,
  computeFileHash,
  inferSeverity,
  type CaptureArgs,
} from '../scripts/capture-incident.js';
import {
  classifyIncident,
  PATTERN_REGISTRY,
  type TriageResult,
} from '../scripts/classify-incident.js';
import {
  runInvariants,
  INVARIANTS,
  type InvariantSummary,
} from '../src/self-heal/invariants.js';

// ---- Helpers ----

const SCHEMAS_DIR = join(__dirname, '..', 'docs');

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf-8'));
}

function makeMinimalArgs(overrides: Partial<CaptureArgs> = {}): CaptureArgs {
  return {
    source: 'manual',
    summary: 'Test incident',
    message: 'Something broke',
    stage: 'runtime-ui',
    screenshots: [],
    tags: [],
    ...overrides,
  };
}

function makeIncident(overrides: Partial<CaptureArgs> = {}) {
  return buildIncident(makeMinimalArgs(overrides));
}

function makeIncidentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const inc = makeIncident();
  return { ...inc, ...overrides } as Record<string, unknown>;
}

// ---- SH0: Schema Conformance ----

describe('SH0: Schema conformance', () => {
  it('self-heal-incident.schema.json is valid JSON Schema', () => {
    const schema = loadSchema('self-heal-incident.schema.json');
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.properties).toBeDefined();
    expect((schema as any).required).toContain('schema_version');
    expect((schema as any).required).toContain('incident_id');
    expect((schema as any).required).toContain('error');
    expect((schema as any).required).toContain('evidence');
  });

  it('self-heal-patch-result.schema.json is valid JSON Schema', () => {
    const schema = loadSchema('self-heal-patch-result.schema.json');
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect((schema as any).required).toContain('patch_id');
    expect((schema as any).required).toContain('incident_id');
    expect((schema as any).required).toContain('diffs');
  });

  it('self-heal-verify.schema.json is valid JSON Schema', () => {
    const schema = loadSchema('self-heal-verify.schema.json');
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect((schema as any).required).toContain('verify_id');
    expect((schema as any).required).toContain('steps');
    expect((schema as any).required).toContain('verdict');
  });

  it('self-heal-knowledge.schema.json is valid JSON Schema', () => {
    const schema = loadSchema('self-heal-knowledge.schema.json');
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect((schema as any).required).toContain('knowledge_id');
    expect((schema as any).required).toContain('classification');
    expect((schema as any).required).toContain('recurrence_tags');
  });

  it('minimal incident validates against schema', () => {
    const schema = loadSchema('self-heal-incident.schema.json');
    const incident = makeIncident();
    const errors = validateJsonSchema(incident, schema, schema);
    expect(errors).toHaveLength(0);
  });

  it('rich incident with all optional fields validates against schema', () => {
    const schema = loadSchema('self-heal-incident.schema.json');
    const incident = makeIncident({
      severity: 'p0',
      command: 'npm run helpdesk-golden',
      airFile: join(__dirname, '..', 'examples', 'todo.air'),
      pageName: 'DashboardPage',
      routePath: '/api/projects',
      tags: ['visual', 'regression'],
      errorCode: 'ERR_MAP_NOT_FUNCTION',
      httpStatus: 500,
    });
    const errors = validateJsonSchema(incident, schema, schema);
    expect(errors).toHaveLength(0);
  });

  it('triaged incident validates against schema', () => {
    const schema = loadSchema('self-heal-incident.schema.json');
    const incident = makeIncident({ message: '.map is not a function on dashboard' });
    const triage = classifyIncident(incident as unknown as Record<string, unknown>);
    (incident as any).classification = triage.classification;
    (incident as any).suspected_subsystem = triage.suspected_subsystem;
    (incident as any).status = 'triaged';
    (incident as any).triage = triage;
    const errors = validateJsonSchema(incident, schema, schema);
    expect(errors).toHaveLength(0);
  });
});

// ---- SH1: Incident Capture ----

describe('SH1: Incident capture', () => {
  it('parseArgs extracts all CLI flags', () => {
    const args = parseArgs([
      '--source', 'manual',
      '--summary', 'Layout broken',
      '--message', 'Auth wrapper nested',
      '--stage', 'qa-visual',
      '--severity', 'p1',
      '--command', 'npm run preview',
      '--air-file', 'examples/auth.air',
      '--page-name', 'LoginPage',
      '--tag', 'visual',
      '--tag', 'auth',
      '--screenshot', '/tmp/ss1.png',
      '--screenshot', '/tmp/ss2.png',
    ]);
    expect(args.source).toBe('manual');
    expect(args.summary).toBe('Layout broken');
    expect(args.stage).toBe('qa-visual');
    expect(args.severity).toBe('p1');
    expect(args.command).toBe('npm run preview');
    expect(args.airFile).toBe('examples/auth.air');
    expect(args.pageName).toBe('LoginPage');
    expect(args.tags).toEqual(['visual', 'auth']);
    expect(args.screenshots).toEqual(['/tmp/ss1.png', '/tmp/ss2.png']);
  });

  it('buildIncident produces valid structure', () => {
    const incident = makeIncident();
    expect(incident.schema_version).toBe('1.0');
    expect(incident.incident_id).toMatch(/^SH-\d{8}-\d{6}-[a-z0-9]{6}$/);
    expect(incident.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(incident.source).toBe('manual');
    expect(incident.status).toBe('open');
    expect(incident.classification).toBeNull();
    expect(incident.triage).toBeNull();
  });

  it('buildIncident with evidence', () => {
    const incident = makeIncident({ screenshots: ['/tmp/s1.png', '/tmp/s2.png'] });
    expect(incident.evidence).toHaveLength(2);
    expect(incident.evidence[0].kind).toBe('screenshot_path');
    expect(incident.evidence[1].content).toBe('/tmp/s2.png');
  });

  it('computeFileHash returns consistent hash', () => {
    const testFile = join(__dirname, '..', 'examples', 'todo.air');
    const hash1 = computeFileHash(testFile);
    const hash2 = computeFileHash(testFile);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
  });

  it('computeFileHash returns null for missing file', () => {
    expect(computeFileHash('/nonexistent/file.txt')).toBeNull();
  });

  it('inferSeverity assigns P0 for build failures', () => {
    expect(inferSeverity('build', 'Build failed')).toBe('p0');
    expect(inferSeverity('seed', 'Seed error')).toBe('p0');
  });

  it('inferSeverity assigns P1 for runtime crashes', () => {
    expect(inferSeverity('runtime-ui', '.map is not a function')).toBe('p1');
    expect(inferSeverity('runtime-ui', 'X is not defined')).toBe('p1');
    expect(inferSeverity('runtime-server', 'Server error')).toBe('p1');
  });

  it('inferSeverity assigns P2 for visual issues', () => {
    expect(inferSeverity('qa-visual', 'Spacing off')).toBe('p2');
    expect(inferSeverity('qa-visual', 'Bad alignment')).toBe('p2');
  });

  it('inferSeverity assigns P3 for docs/config', () => {
    expect(inferSeverity('other', 'Stale docs')).toBe('p3');
  });

  it('generates unique incident IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(makeIncident().incident_id);
    }
    expect(ids.size).toBe(20);
  });

  it('inputs includes file hash when file exists', () => {
    const incident = makeIncident({ airFile: join(__dirname, '..', 'examples', 'todo.air') });
    expect(incident.inputs.air_file).not.toBeNull();
    expect(incident.inputs.air_file!.hash).toHaveLength(16);
  });
});

// ---- SH1: Classifier ----

describe('SH1: Classifier', () => {
  it('pattern registry has at least 20 patterns', () => {
    expect(PATTERN_REGISTRY.length).toBeGreaterThanOrEqual(20);
  });

  it('all patterns have required fields including codegen_trace_id', () => {
    for (const p of PATTERN_REGISTRY) {
      expect(p.id).toBeTruthy();
      expect(p.subsystem).toBeTruthy();
      expect(['high', 'medium', 'low']).toContain(p.confidence);
      expect(typeof p.match).toBe('function');
      expect(p.notes).toBeTruthy();
      expect(p.next_step).toBeTruthy();
      // SH9: codegen_trace_id must be present (can be null or string)
      expect('codegen_trace_id' in p).toBe(true);
    }
  });

  // ---- Known pattern matches ----

  it('classifies .map is not a function → codegen-paginated-shape-mismatch', () => {
    const result = classifyIncident(makeIncidentRecord({
      summary: 'Dashboard crashes on load',
      error: { message: '.map is not a function', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('codegen-paginated-shape-mismatch');
    expect(result.suspected_subsystem).toBe('page-gen');
    expect(result.confidence).toBe('high');
  });

  it('classifies undefined variable → codegen-state-ordering-or-missing-binding', () => {
    const result = classifyIncident(makeIncidentRecord({
      error: { message: 'ReferenceError: projects is not defined', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('codegen-state-ordering-or-missing-binding');
  });

  it('classifies duplicate declaration → codegen-duplicate-declaration', () => {
    const result = classifyIncident(makeIncidentRecord({
      error: { message: "Identifier 'projects' has already been declared", stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('codegen-duplicate-declaration');
  });

  it('classifies dead button → codegen-unwired-action-handler', () => {
    const result = classifyIncident(makeIncidentRecord({
      summary: 'Dead button on inquiry page',
      error: { message: 'handleSubmit is not a function', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('codegen-unwired-action-handler');
  });

  it('classifies auth wrapper layout → layout-auth-wrapper-composition', () => {
    const result = classifyIncident(makeIncidentRecord({
      stage: 'qa-visual',
      summary: 'Login page auth wrapper width broken, nested composition conflict',
      error: { message: 'Login page has wrong width', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('layout-auth-wrapper-composition');
  });

  it('classifies global submit width → style-global-cta-width-regression', () => {
    const result = classifyIncident(makeIncidentRecord({
      stage: 'qa-visual',
      summary: 'All buttons forced to full width by global CSS submit rule',
      error: { message: 'Buttons stretched', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('style-global-cta-width-regression');
  });

  it('classifies public route auth → backend-route-guard-misclassification', () => {
    const result = classifyIncident(makeIncidentRecord({
      summary: 'Public projects endpoint returns 401 — protected when it should be public',
      error: { message: '401 Unauthorized', stack: null, raw_output: null, error_code: null, http_status: 401 },
      inputs: { air_file: null, generated_file: null, output_dir: null, page_name: null, route_path: '/public/projects', seed_file: null, example_id: null },
    }));
    expect(result.classification).toBe('backend-route-guard-misclassification');
    expect(result.suspected_subsystem).toBe('server-entry-gen');
  });

  it('classifies missing env → runtime-missing-provider-env', () => {
    const result = classifyIncident(makeIncidentRecord({
      summary: 'Server fails to start — missing DATABASE_URL env var',
      error: { message: 'Environment variable DATABASE_URL is missing', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('runtime-missing-provider-env');
  });

  it('classifies parse error → air-input-parse', () => {
    const result = classifyIncident(makeIncidentRecord({
      stage: 'validate',
      summary: 'File fails to parse',
      error: { message: 'Parse error: unexpected token at line 5', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('air-input-parse');
  });

  it('classifies validation error → air-input-validation', () => {
    const result = classifyIncident(makeIncidentRecord({
      stage: 'validate',
      summary: 'File fails validation',
      error: { message: 'Validation error AIR-E001: missing @app', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('air-input-validation');
  });

  it('classifies port mismatch → config-port-mismatch', () => {
    const result = classifyIncident(makeIncidentRecord({
      summary: 'Port mismatch between client and server CORS config',
      error: { message: 'EADDRINUSE: port 3001', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('config-port-mismatch');
  });

  it('classifies snapshot drift → transpiler-snapshot-drift', () => {
    const result = classifyIncident(makeIncidentRecord({
      summary: 'Snapshot hash drift after page-gen change',
      error: { message: 'Hash mismatch', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('transpiler-snapshot-drift');
  });

  // ---- SH9 pattern matches ----

  it('classifies CSS specificity conflict → style-specificity-conflict with trace SH9-001', () => {
    const result = classifyIncident(makeIncidentRecord({
      summary: 'CSS specificity fight between Tailwind and bare selectors — h1 conflict',
    }));
    expect(result.classification).toBe('style-specificity-conflict');
    expect(result.codegen_trace_id).toBe('SH9-001');
  });

  it('classifies alignment regression → layout-alignment-regression with trace SH9-004', () => {
    const result = classifyIncident(makeIncidentRecord({
      stage: 'qa-visual',
      summary: 'Sidebar alignment padding mismatch between heading and button elements',
    }));
    expect(result.classification).toBe('layout-alignment-regression');
    expect(result.codegen_trace_id).toBe('SH9-004');
  });

  it('classifies layout-auth-wrapper with trace SH9-003', () => {
    const result = classifyIncident(makeIncidentRecord({
      stage: 'qa-visual',
      summary: 'Login page auth wrapper width broken, nested composition conflict',
    }));
    expect(result.classification).toBe('layout-auth-wrapper-composition');
    expect(result.codegen_trace_id).toBe('SH9-003');
  });

  it('classifies navigation bug with trace SH9-002', () => {
    const result = classifyIncident(makeIncidentRecord({
      summary: 'Navigation to wrong page — setcurrentpage targets wrong route, redirect failure',
    }));
    expect(result.classification).toBe('codegen-route-navigation-bug');
    expect(result.codegen_trace_id).toBe('SH9-002');
  });

  it('returns unknown for unrecognized patterns', () => {
    const result = classifyIncident(makeIncidentRecord({
      summary: 'Something completely novel happened',
      error: { message: 'Unexpected quantum entanglement', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBe('unknown');
    expect(result.confidence).toBe('low');
  });

  it('triage result has all required fields', () => {
    const result = classifyIncident(makeIncidentRecord({
      error: { message: '.map is not a function', stack: null, raw_output: null, error_code: null, http_status: null },
    }));
    expect(result.classification).toBeTruthy();
    expect(result.suspected_subsystem).toBeTruthy();
    expect(result.confidence).toBeTruthy();
    expect(result.triage_notes).toBeTruthy();
    expect(result.recommended_next_step).toBeTruthy();
    expect(result.suggested_tests).toBeInstanceOf(Array);
    // SH9: codegen_trace_id field exists (may be null)
    expect('codegen_trace_id' in result).toBe(true);
  });

  it('deterministic: same input → same output', () => {
    const inc = makeIncidentRecord({
      error: { message: '.map is not a function', stack: null, raw_output: null, error_code: null, http_status: null },
    });
    const r1 = classifyIncident(inc);
    const r2 = classifyIncident(inc);
    expect(r1).toEqual(r2);
  });
});

// ---- SH2: Invariants ----

describe('SH2: Invariants', () => {
  it('registry has 10 invariants', () => {
    expect(INVARIANTS).toHaveLength(10);
  });

  it('all invariants have required fields', () => {
    for (const inv of INVARIANTS) {
      expect(inv.id).toMatch(/^INV-\d{3}$/);
      expect(inv.name).toBeTruthy();
      expect(['p0', 'p1', 'p2', 'p3']).toContain(inv.severity);
      expect(typeof inv.check).toBe('function');
    }
  });

  // ---- INV-001: Paginated list unwrapping ----

  describe('INV-001: Paginated list unwrapping', () => {
    it('passes when fetches use .data unwrapping', () => {
      const files = new Map([
        ['src/pages/DashboardPage.jsx', `
          api.getProjects().then(r => setProjects(r.data ?? r)).catch(() => {});
          api.getServices().then(res => setServices(res.data ?? res)).catch(() => {});
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-001')!;
      expect(inv.passed).toBe(true);
    });

    it('fails when fetches skip .data unwrapping', () => {
      const files = new Map([
        ['src/pages/DashboardPage.jsx', `
          api.getProjects().then(r => setProjects(r)).catch(() => {});
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-001')!;
      expect(inv.passed).toBe(false);
      expect(inv.details).toContain('without .data unwrapping');
    });
  });

  // ---- INV-002: Auth wrapper composition ----

  describe('INV-002: Auth wrapper composition', () => {
    it('passes when auth pages are not in Layout', () => {
      const files = new Map([
        ['src/App.jsx', `
          {currentPage === 'login' && <LoginPage />}
          {isAuthed && currentPage === 'dashboard' && <Layout><DashboardPage /></Layout>}
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-002')!;
      expect(inv.passed).toBe(true);
    });

    it('fails when auth pages are wrapped in Layout', () => {
      const files = new Map([
        ['src/App.jsx', `
          {currentPage === 'login' && (
            <Layout user={user}>
              <LoginPage />
            </Layout>
          )}
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-002')!;
      expect(inv.passed).toBe(false);
      expect(inv.details).toContain('LoginPage wrapped in <Layout>');
    });
  });

  // ---- INV-003: Global auth submit width ----

  describe('INV-003: Global auth submit width', () => {
    it('passes with scoped submit width rules', () => {
      const files = new Map([
        ['src/index.css', `
          .auth-form button[type="submit"] { width: 100%; }
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-003')!;
      expect(inv.passed).toBe(true);
    });

    it('fails with unscoped button width: 100% rule', () => {
      const files = new Map([
        ['src/index.css', `
button[type="submit"] { width: 100%; padding: 0.5rem; }
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-003')!;
      expect(inv.passed).toBe(false);
    });
  });

  // ---- INV-004: Public route auth exemption ----

  describe('INV-004: Public route auth exemption', () => {
    it('passes when /public/ is exempted from auth', () => {
      const files = new Map([
        ['server/server.ts', `
          if (req.path.startsWith('/auth/') || req.path.startsWith('/public/')) return next();
          const token = req.headers.authorization;
        `],
        ['server/api.ts', `
          router.get('/public/projects', async (req, res) => {});
          router.get('/projects', requireAuth, async (req, res) => {});
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-004')!;
      expect(inv.passed).toBe(true);
    });

    it('fails when /public/ is not exempted', () => {
      const files = new Map([
        ['server/server.ts', `
          if (req.path.startsWith('/auth/')) return next();
          const token = req.headers.authorization;
        `],
        ['server/api.ts', `
          router.get('/public/projects', async (req, res) => {});
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-004')!;
      expect(inv.passed).toBe(false);
    });

    it('skips when no /public/ routes exist', () => {
      const files = new Map([
        ['server/server.ts', 'app.listen(3000);'],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-004')!;
      expect(inv.passed).toBe(true);
      expect(inv.details).toContain('skipped');
    });
  });

  // ---- INV-005: Public API auth-header ----

  describe('INV-005: Public API auth-header', () => {
    it('passes when public functions skip auth headers', () => {
      const files = new Map([
        ['client/src/api.js', `
export async function getPublicProjects(params = {}) {
  const res = await fetch(url);
  return handleResponse(res);
}
export async function getProjects(params = {}) {
  const res = await fetch(url, { headers: authHeaders() });
  return handleResponse(res);
}
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-005')!;
      expect(inv.passed).toBe(true);
    });

    it('fails when public functions send auth headers', () => {
      const files = new Map([
        ['client/src/api.js', `
export async function getPublicProjects(params = {}) {
  const res = await fetch(url, { headers: authHeaders() });
  return handleResponse(res);
}
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-005')!;
      expect(inv.passed).toBe(false);
      expect(inv.details).toContain('getPublicProjects');
    });
  });

  // ---- INV-006: Slug route support ----

  describe('INV-006: Slug route support', () => {
    it('passes when slug route uses findFirst', () => {
      const files = new Map([
        ['server/api.ts', `
          router.get('/public/projects/:slug', async (req, res) => {
            const project = await prisma.project.findFirst({ where: { slug: req.params.slug } });
            res.json(project);
          });
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-006')!;
      expect(inv.passed).toBe(true);
    });

    it('fails when slug route lacks findFirst', () => {
      const files = new Map([
        ['server/api.ts', `
          router.get('/public/projects/:slug', async (req, res) => {
            const project = await prisma.project.findMany();
            res.json(project);
          });
        `],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-006')!;
      expect(inv.passed).toBe(false);
    });

    it('skips when no slug routes exist', () => {
      const files = new Map([
        ['server/api.ts', 'router.get("/projects", handler);'],
      ]);
      const summary = runInvariants(files);
      const inv = summary.results.find(r => r.id === 'INV-006')!;
      expect(inv.passed).toBe(true);
      expect(inv.details).toContain('skipped');
    });
  });

  // ---- Runner ----

  describe('runInvariants', () => {
    it('returns summary with correct counts', () => {
      const files = new Map([
        ['src/pages/DashboardPage.jsx', `
          api.getProjects().then(r => setProjects(r.data ?? r));
        `],
        ['src/App.jsx', `
          {currentPage === 'login' && <LoginPage />}
        `],
      ]);
      const summary = runInvariants(files);
      expect(summary.total).toBe(10);
      expect(summary.passed + summary.failed).toBe(10);
      expect(summary.results).toHaveLength(10);
    });

    it('all pass on well-formed output', () => {
      const files = new Map([
        ['src/pages/DashboardPage.jsx', `
          api.getProjects().then(r => setProjects(r.data ?? r));
        `],
        ['src/App.jsx', `
          {currentPage === 'login' && <LoginPage />}
          {isAuthed && <Layout><DashboardPage /></Layout>}
        `],
        ['src/index.css', '.auth-form button { width: 100% }'],
        ['server/server.ts', `
          if (req.path.startsWith('/public/')) return next();
        `],
        ['server/api.ts', `
          router.get('/public/projects', handler);
          router.get('/public/projects/:slug', async (req, res) => {
            const p = await prisma.project.findFirst({ where: { slug: req.params.slug } });
            res.json(p);
          });
          router.get('/projects', requireAuth, handler);
        `],
        ['client/src/api.js', [
          'export async function getPublicProjects() { return fetch(url); }',
          '',
          'export async function getProjects() { return fetch(url, { headers: authHeaders() }); }',
        ].join('\n')],
      ]);
      const summary = runInvariants(files);
      for (const r of summary.results) {
        if (!r.passed) console.log(`FAIL: ${r.id} ${r.name}: ${r.details}`);
      }
      expect(summary.failed).toBe(0);
    });
  });

  // ---- Integration: real transpiled output ----

  describe('integration: photography-studio transpiled output', () => {
    it('passes all invariants on photography output', async () => {
      // Parse then transpile
      const { parse } = await import('../src/parser/index.js');
      const { transpile } = await import('../src/transpiler/index.js');
      const source = readFileSync(join(__dirname, '..', 'examples', 'photography-studio-premium.air'), 'utf-8');
      const ast = parse(source);
      const result = transpile(ast, { sourceLines: source.split('\n').length });

      const fileMap = new Map<string, string>();
      for (const f of result.files) {
        fileMap.set(f.path, f.content);
      }

      const summary = runInvariants(fileMap);
      for (const r of summary.results) {
        if (!r.passed) {
          console.log(`FAIL: ${r.id} ${r.name}: ${r.details}`);
        }
      }
      expect(summary.failed).toBe(0);
    });
  });
});
