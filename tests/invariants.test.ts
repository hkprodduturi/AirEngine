/**
 * Invariant-specific tests (SH2)
 *
 * Focused positive/negative tests for each invariant using representative generated snippets.
 */
import { describe, it, expect } from 'vitest';
import { runInvariants, INVARIANTS, type InvariantResult } from '../src/self-heal/invariants.js';

function checkInvariant(id: string, files: Map<string, string>): InvariantResult {
  const inv = INVARIANTS.find(i => i.id === id);
  if (!inv) throw new Error(`Invariant ${id} not found`);
  return inv.check(files);
}

describe('Invariants', () => {
  describe('INV-001: Paginated list unwrapping', () => {
    it('positive: res?.data ?? res pattern', () => {
      const r = checkInvariant('INV-001', new Map([
        ['pages/Dashboard.jsx', 'api.getProjects().then(res => setProjects(res?.data ?? res))'],
      ]));
      expect(r.passed).toBe(true);
    });

    it('positive: r.data ?? r pattern', () => {
      const r = checkInvariant('INV-001', new Map([
        ['pages/Home.jsx', 'api.getPublicProjects().then(r => setProjects(r.data ?? r))'],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: direct assignment', () => {
      const r = checkInvariant('INV-001', new Map([
        ['pages/Dashboard.jsx', 'api.getProjects().then(r => setProjects(r))'],
      ]));
      expect(r.passed).toBe(false);
    });

    it('positive: no fetch calls → passes', () => {
      const r = checkInvariant('INV-001', new Map([
        ['pages/About.jsx', '<h1>About</h1>'],
      ]));
      expect(r.passed).toBe(true);
    });
  });

  describe('INV-002: Auth wrapper composition', () => {
    it('positive: login page standalone', () => {
      const r = checkInvariant('INV-002', new Map([
        ['App.jsx', '{currentPage === "login" && <LoginPage setCurrentPage={setCurrentPage} />}'],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: login inside Layout', () => {
      const r = checkInvariant('INV-002', new Map([
        ['App.jsx', `{currentPage === "login" && (
            <Layout user={user}>
              <LoginPage />
            </Layout>
          )}`],
      ]));
      expect(r.passed).toBe(false);
    });

    it('positive: no App.jsx → skipped', () => {
      const r = checkInvariant('INV-002', new Map([
        ['server.ts', 'app.listen(3000)'],
      ]));
      expect(r.passed).toBe(true);
    });
  });

  describe('INV-003: Global auth submit width', () => {
    it('positive: scoped rule', () => {
      const r = checkInvariant('INV-003', new Map([
        ['index.css', '.auth-card button[type="submit"] { width: 100%; }'],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: global button rule', () => {
      const r = checkInvariant('INV-003', new Map([
        ['index.css', 'button[type="submit"] { width: 100%; }'],
      ]));
      expect(r.passed).toBe(false);
    });

    it('positive: no CSS files', () => {
      const r = checkInvariant('INV-003', new Map([
        ['app.jsx', '<div />'],
      ]));
      expect(r.passed).toBe(true);
    });
  });

  describe('INV-004: Public route auth exemption', () => {
    it('positive: exempted', () => {
      const r = checkInvariant('INV-004', new Map([
        ['server.ts', "if (req.path.startsWith('/public/')) return next();"],
        ['api.ts', "router.get('/public/projects', handler);"],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: not exempted', () => {
      const r = checkInvariant('INV-004', new Map([
        ['server.ts', "if (req.path.startsWith('/auth/')) return next();"],
        ['api.ts', "router.get('/public/projects', handler);"],
      ]));
      expect(r.passed).toBe(false);
    });
  });

  describe('INV-005: Public API auth-header', () => {
    it('positive: public function without auth', () => {
      const r = checkInvariant('INV-005', new Map([
        ['api.js', `export async function getPublicProjects() {
  const res = await fetch(url);
  return handleResponse(res);
}`],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: public function with authHeaders', () => {
      const r = checkInvariant('INV-005', new Map([
        ['api.js', `export async function getPublicProjects() {
  const res = await fetch(url, { headers: authHeaders() });
  return handleResponse(res);
}`],
      ]));
      expect(r.passed).toBe(false);
    });
  });

  describe('INV-006: Slug route support', () => {
    it('positive: findFirst with slug', () => {
      const r = checkInvariant('INV-006', new Map([
        ['api.ts', `router.get('/public/projects/:slug', async (req, res) => {
          const p = await prisma.project.findFirst({ where: { slug: req.params.slug } });
          res.json(p);
        });`],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: findMany instead of findFirst', () => {
      const r = checkInvariant('INV-006', new Map([
        ['api.ts', `router.get('/public/projects/:slug', async (req, res) => {
          const p = await prisma.project.findMany();
          res.json(p);
        });`],
      ]));
      expect(r.passed).toBe(false);
    });
  });

  // ---- SH9 Invariants ----

  describe('INV-007: CSS element selector specificity', () => {
    it('positive: all selectors wrapped in :where()', () => {
      const r = checkInvariant('INV-007', new Map([
        ['index.css', ':where(h1) { font-size: 2rem; }\n:where(button) { padding: 10px; }'],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: bare h1 selector', () => {
      const r = checkInvariant('INV-007', new Map([
        ['index.css', 'h1 { font-size: 2rem; }'],
      ]));
      expect(r.passed).toBe(false);
      expect(r.details).toContain('h1');
    });

    it('positive: class selectors are fine', () => {
      const r = checkInvariant('INV-007', new Map([
        ['index.css', '.card { padding: 24px; }\n#root { z-index: 1; }'],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: bare button selector', () => {
      const r = checkInvariant('INV-007', new Map([
        ['index.css', 'button { border: none; }'],
      ]));
      expect(r.passed).toBe(false);
    });
  });

  describe('INV-008: Page import completeness', () => {
    it('positive: all pages imported', () => {
      const r = checkInvariant('INV-008', new Map([
        ['App.jsx', 'const ShopPage = lazy(() => import("./pages/ShopPage.jsx"));\nconst CartPage = lazy(() => import("./pages/CartPage.jsx"));'],
        ['pages/ShopPage.jsx', 'export default function ShopPage() {}'],
        ['pages/CartPage.jsx', 'export default function CartPage() {}'],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: missing page import', () => {
      const r = checkInvariant('INV-008', new Map([
        ['App.jsx', 'const ShopPage = lazy(() => import("./pages/ShopPage.jsx"));'],
        ['pages/ShopPage.jsx', 'export default function ShopPage() {}'],
        ['pages/ContactPage.jsx', 'export default function ContactPage() {}'],
      ]));
      expect(r.passed).toBe(false);
      expect(r.details).toContain('ContactPage');
    });
  });

  describe('INV-009: No double Layout wrapping', () => {
    it('positive: pages do not import Layout', () => {
      const r = checkInvariant('INV-009', new Map([
        ['App.jsx', '<Layout><ShopPage /></Layout>'],
        ['pages/ShopPage.jsx', 'export default function ShopPage() { return <div>Shop</div>; }'],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: page imports Layout', () => {
      const r = checkInvariant('INV-009', new Map([
        ['App.jsx', '<Layout><ShopPage /></Layout>'],
        ['pages/ShopPage.jsx', "import Layout from '../Layout.jsx';\nexport default function ShopPage() { return <Layout><div>Shop</div></Layout>; }"],
      ]));
      expect(r.passed).toBe(false);
    });

    it('positive: skipped when App has no Layout', () => {
      const r = checkInvariant('INV-009', new Map([
        ['App.jsx', '<div><ShopPage /></div>'],
        ['pages/ShopPage.jsx', "import Layout from '../Layout.jsx';"],
      ]));
      expect(r.passed).toBe(true);
    });
  });

  describe('INV-010: Sidebar padding consistency', () => {
    it('positive: consistent padding', () => {
      const r = checkInvariant('INV-010', new Map([
        ['ShopPage.jsx', '<aside>\n  <h3 className="px-3 font-bold">Dept</h3>\n  <button className="px-3 text-sm">All</button>\n</aside>'],
      ]));
      expect(r.passed).toBe(true);
    });

    it('negative: mismatched padding', () => {
      const r = checkInvariant('INV-010', new Map([
        ['ShopPage.jsx', '<aside>\n  <h3 className="px-4 font-bold">Dept</h3>\n  <button className="px-2 text-sm">All</button>\n</aside>'],
      ]));
      expect(r.passed).toBe(false);
    });
  });
});
