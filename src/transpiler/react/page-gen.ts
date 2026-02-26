/**
 * Page component extraction — generates separate *.jsx files for each @page scope.
 *
 * When hasAuthGating is true, pages are self-contained:
 * - Auth pages (login/register): Keep current behavior, no Layout wrap
 * - Dashboard pages: Import api + Layout, multiple data fetches, no CRUD forms
 * - CRUD pages: Self-contained with local state, fetch, handlers, forms, Layout wrap
 */

import type { AirUINode, AirDbModel, AirDbField, AirRoute, AirType } from '../../parser/types.js';
import type { TranspileContext } from '../context.js';
import type { UIAnalysis } from '../normalize-ui.js';
import type { OutputFile } from '../index.js';
import { resolveBindChain, extractMutations } from '../normalize-ui.js';
import { routeToFunctionName } from '../route-utils.js';
import {
  capitalize, pluralize, toCamelCase, camelToLabel, ROOT_SCOPE,
  analyzePageDependencies, getHookableStateProps,
  tryResolveElement, isAuthPageName, hasAuthRoutes,
  inferModelFieldsFromDataSource,
  Scope,
} from './helpers.js';
import { generateJSX } from './jsx-gen.js';
import { findGenericRouteMatch } from './mutation-gen.js';

// ---- Badge Color Helper (injected into generated components) ----

const BADGE_COLOR_FN = "  const _bc = (v) => { const s = String(v ?? '').toLowerCase(); const m = { open: 'bg-blue-500/15 text-blue-400', active: 'bg-blue-500/15 text-blue-400', new: 'bg-blue-500/15 text-blue-400', in_progress: 'bg-yellow-500/15 text-yellow-400', pending: 'bg-yellow-500/15 text-yellow-400', processing: 'bg-yellow-500/15 text-yellow-400', resolved: 'bg-green-500/15 text-green-400', done: 'bg-green-500/15 text-green-400', completed: 'bg-green-500/15 text-green-400', approved: 'bg-green-500/15 text-green-400', closed: 'bg-zinc-500/15 text-zinc-400', archived: 'bg-zinc-500/15 text-zinc-400', cancelled: 'bg-zinc-500/15 text-zinc-400', rejected: 'bg-zinc-500/15 text-zinc-400', waiting: 'bg-orange-500/15 text-orange-400', on_hold: 'bg-orange-500/15 text-orange-400', review: 'bg-orange-500/15 text-orange-400', urgent: 'bg-red-500/15 text-red-400', critical: 'bg-red-500/15 text-red-400', high: 'bg-orange-500/15 text-orange-400', medium: 'bg-yellow-500/15 text-yellow-400', low: 'bg-emerald-500/15 text-emerald-400' }; return m[s] || 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)]'; };";

const BADGE_STATIC_MARKER = 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)]';

/** Post-process JSX: replace static accent-colored badges with semantic _bc() calls */
function applyBadgeColors(jsx: string): string {
  return jsx.replace(
    /className="inline-flex items-center rounded-full px-2\.5 py-0\.5 text-xs font-medium bg-\[color-mix\(in_srgb,var\(--accent\)_20%,transparent\)\] text-\[var\(--accent\)\]">\{(\w+(?:\.\w+)*)\}/g,
    (_, expr) => `className={\`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium \${_bc(${expr})}\`}>{${expr}}`
  );
}

// ---- Page Resource Binding ----

interface PageResourceBinding {
  model: AirDbModel | null;
  modelPlural: string;          // e.g. 'contacts'
  getRoute: AirRoute | null;
  postRoute: AirRoute | null;
  putRoute: AirRoute | null;
  deleteRoute: AirRoute | null;
  formFields: FormFieldInfo[];
  isDashboard: boolean;
  isAuthPage: boolean;
  /** Multiple data sources for dashboard pages */
  dataSources: { stateVar: string; getFnName: string }[];
}

interface FormFieldInfo {
  name: string;
  type: 'text' | 'number' | 'email' | 'date' | 'select' | 'checkbox' | 'textarea';
  enumValues?: string[];
  required?: boolean;  // T1.3: derived from @db :required modifier
}

/**
 * Detect which model/routes a page binds to based on page name + route heuristics.
 */
function detectPageResource(
  pageName: string,
  ctx: TranspileContext,
  analysis: UIAnalysis,
  deps: ReturnType<typeof analyzePageDependencies>,
): PageResourceBinding {
  const binding: PageResourceBinding = {
    model: null, modelPlural: '', getRoute: null, postRoute: null,
    putRoute: null, deleteRoute: null, formFields: [],
    isDashboard: false, isAuthPage: isAuthPageName(pageName),
    dataSources: [],
  };

  if (binding.isAuthPage || !ctx.db) return binding;

  const routes = ctx.expandedRoutes;

  // Check if this is a dashboard page
  if (pageName === 'dashboard' || pageName === 'overview' || pageName === 'home') {
    // Dashboard: multiple data sources, no single primary model
    const getRoutes = routes.filter(r => r.method === 'GET' && !r.path.includes(':'));
    if (getRoutes.length > 1) {
      binding.isDashboard = true;
      for (const r of getRoutes) {
        // Skip auth routes
        if (r.path.includes('/auth/')) continue;
        const fnName = routeToFunctionName('GET', r.path);
        const resource = toCamelCase(r.path.replace(/^\//, '').split('/').pop() || '');
        binding.dataSources.push({ stateVar: resource, getFnName: fnName });
      }
      return binding;
    }
  }

  // CRUD page: match model by page name
  // e.g., "contacts" page → Contact model, "tasks" page → Task model
  const pageNameLower = pageName.toLowerCase();

  for (const model of ctx.db.models) {
    const modelLower = model.name.toLowerCase();
    const modelPlural = pluralize(modelLower);

    // Match: page name is plural model name, singular model name, or contains model name
    if (pageNameLower === modelPlural || pageNameLower === modelLower ||
        pageNameLower.includes(modelLower)) {
      binding.model = model;
      binding.modelPlural = modelPlural;

      // Find CRUD routes for this model
      binding.getRoute = routes.find(r =>
        r.method === 'GET' && r.handler === `~db.${model.name}.findMany`
      ) || null;
      binding.postRoute = routes.find(r =>
        r.method === 'POST' && r.handler === `~db.${model.name}.create`
      ) || null;
      binding.putRoute = routes.find(r =>
        r.method === 'PUT' && r.handler === `~db.${model.name}.update`
      ) || null;
      binding.deleteRoute = routes.find(r =>
        r.method === 'DELETE' && r.handler === `~db.${model.name}.delete`
      ) || null;

      // Build form fields from model schema
      binding.formFields = buildFormFields(model);
      break;
    }
  }

  // If no model matched by page name, try matching by state props
  if (!binding.model && deps.stateProps.length > 0) {
    for (const stateProp of deps.stateProps) {
      for (const model of ctx.db.models) {
        const modelLower = model.name.toLowerCase();
        const modelPlural = pluralize(modelLower);
        if (stateProp === modelPlural || stateProp === modelLower) {
          binding.model = model;
          binding.modelPlural = modelPlural;
          binding.getRoute = routes.find(r =>
            r.method === 'GET' && r.handler === `~db.${model.name}.findMany`
          ) || null;
          binding.postRoute = routes.find(r =>
            r.method === 'POST' && r.handler === `~db.${model.name}.create`
          ) || null;
          binding.putRoute = routes.find(r =>
            r.method === 'PUT' && r.handler === `~db.${model.name}.update`
          ) || null;
          binding.deleteRoute = routes.find(r =>
            r.method === 'DELETE' && r.handler === `~db.${model.name}.delete`
          ) || null;
          binding.formFields = buildFormFields(model);
          break;
        }
      }
      if (binding.model) break;
    }
  }

  return binding;
}

/** Map a db field type to form input type */
function fieldTypeToInputType(field: AirDbField): FormFieldInfo {
  const baseType = field.type.kind === 'optional'
    ? (field.type as { kind: 'optional'; of: AirType }).of
    : field.type;

  switch (baseType.kind) {
    case 'int':
    case 'float':
      return { name: field.name, type: 'number' };
    case 'bool':
      return { name: field.name, type: 'checkbox' };
    case 'date':
    case 'datetime':
      return { name: field.name, type: 'date' };
    case 'enum':
      return { name: field.name, type: 'select', enumValues: (baseType as { values: string[] }).values };
    case 'str':
      if (field.name === 'email') return { name: field.name, type: 'email' };
      if (field.name === 'description' || field.name === 'notes' || field.name === 'body' || field.name === 'content')
        return { name: field.name, type: 'textarea' };
      return { name: field.name, type: 'text' };
    default:
      return { name: field.name, type: 'text' };
  }
}

/** Build form fields from model, excluding auto PK, auto timestamps, and FK fields */
function buildFormFields(model: AirDbModel): FormFieldInfo[] {
  return model.fields
    .filter(f => !(f.primary && f.auto))  // skip auto PK
    .filter(f => !f.auto)                  // skip auto timestamps
    .filter(f => !f.name.endsWith('_id'))  // skip FK
    .map(f => {
      const info = fieldTypeToInputType(f);
      // T1.3: propagate required flag from @db field modifier
      if (f.required) info.required = true;
      return info;
    })
    .slice(0, 8);
}

// ---- Page Component Generation ----

/**
 * Generate separate page component files for each @page scope.
 * Only runs for fullstack apps with pages.
 */
export function generatePageComponents(
  ctx: TranspileContext,
  analysis: UIAnalysis,
): OutputFile[] {
  if (!ctx.hasBackend || !analysis.hasPages) return [];

  const hasAuth = hasAuthRoutes(ctx);
  const hasLoginPage = analysis.pages.some(p => isAuthPageName(p.name));
  const hasAuthGating = hasAuth && ctx.hasBackend && analysis.hasPages && hasLoginPage;

  const hookMap = getHookableStateProps(ctx);
  const files: OutputFile[] = [];

  // Determine if Layout.jsx will be generated — must match condition in layout-gen.ts
  const hasSidebarInUI = ctx.uiNodes.some(n => n.kind === 'element' && n.element === 'sidebar');
  const hasLayout = analysis.hasPages && (hasSidebarInUI || analysis.pages.length >= 3);

  for (const page of analysis.pages) {
    const pageName = capitalize(page.name);
    const deps = analyzePageDependencies(page.children, ctx, analysis);
    const binding = hasAuthGating ? detectPageResource(page.name, ctx, analysis, deps) : null;

    if (hasAuthGating && binding && !binding.isAuthPage) {
      // ---- Self-contained page (auth-gated mode) ----
      files.push({
        path: `src/pages/${pageName}Page.jsx`,
        content: binding.isDashboard
          ? generateDashboardPage(pageName, page, ctx, analysis, binding, hasLayout)
          : generateCrudPage(pageName, page, ctx, analysis, binding, hasLayout),
      });
    } else {
      // ---- Original behavior (auth pages or non-auth-gated apps) ----
      files.push({
        path: `src/pages/${pageName}Page.jsx`,
        content: generateOriginalPage(pageName, page, ctx, analysis, deps, hookMap, hasAuth),
      });
    }
  }

  // C1/G3: Generate detail pages for models with nested child routes
  if (ctx.db && hasAuthGating) {
    const detailPages = detectDetailPageModels(ctx);
    for (const detail of detailPages) {
      files.push({
        path: `src/pages/${detail.modelName}DetailPage.jsx`,
        content: generateDetailPage(detail, ctx, hasLayout),
      });
    }
  }

  return files;
}

// ---- C1/G3: Detail Page Detection and Generation ----

interface DetailPageInfo {
  modelName: string;         // e.g. 'Ticket'
  modelPlural: string;       // e.g. 'tickets'
  getRoute: AirRoute | null; // GET /tickets (list)
  putRoute: AirRoute | null; // PUT /tickets/:id (update)
  childResources: {
    name: string;            // e.g. 'replies'
    modelName: string;       // e.g. 'TicketReply'
    getRoute: AirRoute;      // GET /tickets/:id/replies
    postRoute: AirRoute | null; // POST /tickets/:id/replies
    formFields: FormFieldInfo[];
  }[];
}

/**
 * Detect models that need detail pages — those with nested child routes.
 * E.g., GET /tickets/:id/replies → Ticket needs a detail page.
 */
export function detectDetailPageModels(ctx: TranspileContext): DetailPageInfo[] {
  if (!ctx.db) return [];
  const routes = ctx.expandedRoutes;
  const details: DetailPageInfo[] = [];
  const seen = new Set<string>();

  for (const route of routes) {
    // Match nested routes: /parent/:id/child
    const nestedMatch = route.path.match(/^\/(\w+)\/:id\/(\w+)$/);
    if (!nestedMatch || route.method !== 'GET') continue;

    const [, parentPlural, childResource] = nestedMatch;
    if (seen.has(parentPlural)) continue;

    // Find parent model
    const parentSingular = parentPlural.endsWith('s') ? parentPlural.slice(0, -1) : parentPlural;
    const parentModel = ctx.db.models.find(m =>
      m.name.toLowerCase() === parentSingular.toLowerCase()
    );
    if (!parentModel) continue;

    seen.add(parentPlural);

    // Find CRUD routes for parent
    const getRoute = routes.find(r =>
      r.method === 'GET' && r.handler === `~db.${parentModel.name}.findMany`
    ) || null;
    const putRoute = routes.find(r =>
      r.method === 'PUT' && r.handler === `~db.${parentModel.name}.update`
    ) || null;

    // Find child routes
    const childGetRoute = routes.find(r =>
      r.method === 'GET' && r.path === `/${parentPlural}/:id/${childResource}`
    );
    const childPostRoute = routes.find(r =>
      r.method === 'POST' && r.path === `/${parentPlural}/:id/${childResource}`
    ) || null;

    if (!childGetRoute) continue;

    // Find child model for form fields
    const childModelMatch = childGetRoute.handler.match(/^~db\.(\w+)\.findMany$/);
    const childModelName = childModelMatch?.[1] || capitalize(childResource);
    const childModel = ctx.db.models.find(m => m.name === childModelName);
    const childFormFields = childModel ? buildFormFields(childModel) : [];

    details.push({
      modelName: parentModel.name,
      modelPlural: parentPlural,
      getRoute,
      putRoute,
      childResources: [{
        name: childResource,
        modelName: childModelName,
        getRoute: childGetRoute,
        postRoute: childPostRoute,
        formFields: childFormFields,
      }],
    });
  }

  return details;
}

/**
 * Generate a detail page component for a model with nested child resources.
 * E.g., TicketDetailPage with reply thread and reply form.
 */
function generateDetailPage(
  detail: DetailPageInfo,
  ctx: TranspileContext,
  hasLayout: boolean,
): string {
  const { modelName, modelPlural } = detail;
  const modelLabel = camelToLabel(modelName);
  const lines: string[] = [];

  lines.push("import { useState, useEffect } from 'react';");
  lines.push("import * as api from '../api.js';");
  if (hasLayout) lines.push("import Layout from '../Layout.jsx';");
  lines.push('');
  lines.push(`export default function ${modelName}DetailPage({ ${modelPlural.slice(0, -1)}Id, onBack, user, logout, currentPage, setCurrentPage }) {`);
  lines.push(`  const [${modelPlural.slice(0, -1)}, set${capitalize(modelPlural.slice(0, -1))}] = useState(null);`);
  lines.push('  const [loading, setLoading] = useState(true);');
  lines.push('  const [error, setError] = useState(null);');

  // Child resource state
  for (const child of detail.childResources) {
    lines.push(`  const [${child.name}, set${capitalize(child.name)}] = useState([]);`);
    if (child.postRoute) {
      lines.push(`  const [replyBody, setReplyBody] = useState('');`);
      lines.push(`  const [submitting, setSubmitting] = useState(false);`);
    }
  }
  lines.push('');

  // Singular fetch — getTicket(id) via the list route filtered client-side,
  // or a direct API call if available
  const singularVar = modelPlural.slice(0, -1);
  const singularFnName = `get${capitalize(singularVar)}`;
  lines.push(`  useEffect(() => {`);
  lines.push(`    const loadDetail = async () => {`);
  lines.push(`      try {`);
  lines.push(`        const data = await api.${singularFnName}(${singularVar}Id);`);
  lines.push(`        set${capitalize(singularVar)}(data);`);

  // Load child resources
  for (const child of detail.childResources) {
    const childFnName = routeToFunctionName('GET', `/${modelPlural}/:id/${child.name}`);
    lines.push(`        const ${child.name}Data = await api.${childFnName}(${singularVar}Id);`);
    lines.push(`        set${capitalize(child.name)}(${child.name}Data.data ?? ${child.name}Data);`);
  }

  lines.push(`      } catch (err) {`);
  lines.push(`        setError(err.message || 'Failed to load ${modelLabel.toLowerCase()}');`);
  lines.push(`      } finally {`);
  lines.push(`        setLoading(false);`);
  lines.push(`      }`);
  lines.push(`    };`);
  lines.push(`    loadDetail();`);
  lines.push(`  }, [${singularVar}Id]);`);
  lines.push('');

  // Reply form handler
  for (const child of detail.childResources) {
    if (!child.postRoute) continue;
    const createFnName = routeToFunctionName('POST', `/${modelPlural}/:id/${child.name}`);
    const refreshFnName = routeToFunctionName('GET', `/${modelPlural}/:id/${child.name}`);
    lines.push(`  const handleReply = async (e) => {`);
    lines.push(`    e.preventDefault();`);
    lines.push(`    if (!replyBody.trim()) return;`);
    lines.push(`    setSubmitting(true);`);
    lines.push(`    try {`);
    lines.push(`      await api.${createFnName}(${singularVar}Id, { body: replyBody });`);
    lines.push(`      setReplyBody('');`);
    lines.push(`      const updated = await api.${refreshFnName}(${singularVar}Id);`);
    lines.push(`      set${capitalize(child.name)}(updated.data ?? updated);`);
    lines.push(`    } catch (err) {`);
    lines.push(`      setError(err.message || 'Failed to add reply');`);
    lines.push(`    } finally {`);
    lines.push(`      setSubmitting(false);`);
    lines.push(`    }`);
    lines.push(`  };`);
    lines.push('');
  }

  // Render
  lines.push('  return (');
  const WrapOpen = hasLayout
    ? '    <Layout user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}>'
    : '    <div className="min-h-screen p-6" style={{ background: "var(--bg)", color: "var(--fg)" }}>';
  const WrapClose = hasLayout ? '    </Layout>' : '    </div>';
  lines.push(WrapOpen);

  // Back button
  lines.push(`      <div className="space-y-6 animate-fade-in">`);
  lines.push(`        <button onClick={onBack} className="text-sm text-[var(--accent)] hover:underline cursor-pointer">&larr; Back to ${modelPlural}</button>`);

  // Error
  lines.push('        {error && <div className="rounded-[var(--radius)] bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 text-sm">{error}</div>}');

  // Loading
  lines.push('        {loading ? (');
  lines.push('          <div className="animate-pulse space-y-4">');
  lines.push('            <div className="h-8 w-64 bg-[var(--hover)] rounded" />');
  lines.push('            <div className="h-32 bg-[var(--hover)] rounded-[var(--radius)]" />');
  lines.push('          </div>');
  lines.push(`        ) : ${singularVar} ? (`);
  lines.push('          <div className="space-y-6">');

  // Detail header
  const model = ctx.db?.models.find(m => m.name === modelName);
  const displayFields = model?.fields
    .filter(f => !(f.primary && f.auto) && !f.auto && !f.name.endsWith('_id'))
    .slice(0, 6) || [];

  lines.push(`            <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)] p-6 space-y-3">`);
  for (const f of displayFields) {
    const label = f.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    lines.push(`              <div><span className="text-sm text-[var(--muted)]">${label}:</span> <span className="font-medium">{${singularVar}.${f.name}}</span></div>`);
  }
  lines.push(`            </div>`);

  // Child resources (reply thread)
  for (const child of detail.childResources) {
    const childLabel = child.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    lines.push('');
    lines.push(`            <div className="space-y-4">`);
    lines.push(`              <h2 className="text-lg font-semibold">${childLabel}</h2>`);
    lines.push(`              {${child.name}.length === 0 ? (`);
    lines.push(`                <p className="text-sm text-[var(--muted)]">No ${child.name} yet.</p>`);
    lines.push(`              ) : (`);
    lines.push(`                <div className="space-y-3">`);
    lines.push(`                  {${child.name}.map(reply => (`);
    lines.push(`                    <div key={reply.id} className="border border-[var(--border)] rounded-[var(--radius)] p-4 bg-[var(--surface)]">`);
    lines.push(`                      <p className="text-sm">{reply.body}</p>`);
    lines.push(`                      <p className="text-xs text-[var(--muted)] mt-2">{reply.created_at || reply.createdAt}</p>`);
    lines.push(`                    </div>`);
    lines.push(`                  ))}`);
    lines.push(`                </div>`);
    lines.push(`              )}`);

    // Reply form
    if (child.postRoute) {
      lines.push(`              <form onSubmit={handleReply} className="flex gap-2">`);
      lines.push(`                <input type="text" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Write a reply..." className="flex-1 border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent text-sm" />`);
      lines.push(`                <button type="submit" disabled={submitting} className="px-4 py-2 bg-[var(--accent)] text-white rounded-[var(--radius)] text-sm font-medium hover:opacity-90 disabled:opacity-50">{submitting ? 'Sending...' : 'Reply'}</button>`);
      lines.push(`              </form>`);
    }
    lines.push(`            </div>`);
  }

  lines.push('          </div>');
  lines.push(`        ) : <p className="text-[var(--muted)]">${modelLabel} not found.</p>}`);
  lines.push('      </div>');
  lines.push(WrapClose);
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ---- Path A: Auth pages + original behavior ----

function generateOriginalPage(
  pageName: string,
  page: { name: string; children: AirUINode[] },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  deps: ReturnType<typeof analyzePageDependencies>,
  hookMap: Map<string, { hookName: string; modelName: string; routePath: string }>,
  ctxHasAuth: boolean,
): string {
  // Determine which state props are served by resource hooks
  const hookedProps = new Set<string>();
  const hookImports: { hookName: string; stateVar: string }[] = [];
  for (const s of deps.stateProps) {
    const mapping = hookMap.get(s);
    if (mapping) {
      hookedProps.add(s);
      hookImports.push({ hookName: mapping.hookName, stateVar: s });
    }
  }

  const isAuth = isAuthPageName(page.name);

  // Build prop names: exclude hook-covered state vars + their setters
  const propNames: string[] = [];
  if (isAuth && ctxHasAuth) {
    // Auth pages in auth-gated mode: minimal props — no user/setUser (form uses FormData)
    for (const m of deps.mutationProps) {
      const safeName = m.replace(/\./g, '_');
      if (!propNames.includes(safeName) && safeName !== 'logout') propNames.push(safeName);
    }
    if (!propNames.includes('authError')) propNames.push('authError');
    if (!propNames.includes('setCurrentPage')) propNames.push('setCurrentPage');
  } else {
    for (const s of deps.stateProps) {
      if (hookedProps.has(s)) continue;
      propNames.push(s);
      propNames.push('set' + capitalize(s));
    }
    for (const s of deps.setterProps) {
      if (hookedProps.has(s)) continue;
      const setName = 'set' + capitalize(s);
      if (!propNames.includes(setName)) propNames.push(setName);
    }
    for (const m of deps.mutationProps) {
      const safeName = m.replace(/\./g, '_');
      if (!propNames.includes(safeName)) propNames.push(safeName);
    }
    if (deps.needsNav) {
      if (!propNames.includes('currentPage')) propNames.push('currentPage');
      if (!propNames.includes('setCurrentPage')) propNames.push('setCurrentPage');
    }
    if (isAuth && ctxHasAuth) {
      if (!propNames.includes('authError')) propNames.push('authError');
      if (!propNames.includes('setAuthError')) propNames.push('setAuthError');
    }
  }

  const lines: string[] = [];
  // Note: provenance header is prepended by transpiler orchestrator

  // Hook imports
  for (const hi of hookImports) {
    lines.push(`import ${hi.hookName} from '../hooks/${hi.hookName}.js';`);
  }
  lines.push('');

  const propsStr = propNames.length > 0 ? `{ ${propNames.join(', ')} }` : '{}';
  lines.push(`export default function ${pageName}Page(${propsStr}) {`);

  // Hook calls
  for (const hi of hookImports) {
    lines.push(`  const { data: ${hi.stateVar}, loading: ${hi.stateVar}Loading, error: ${hi.stateVar}Error } = ${hi.hookName}();`);
  }
  if (hookImports.length > 0) lines.push('');

  // Detect form pages
  const isShallowForm = hasFormShallow(page.children);
  const isDeepForm = !isShallowForm && hasFormDeep(page.children);
  const hasSidebar = page.children.some(c => hasSidebarNode(c));

  lines.push('  return (');
  if (isShallowForm && !hasSidebar) {
    // Auth-style centered form page — no redundant bg (root div handles it)
    lines.push('    <div className="flex items-center justify-center min-h-screen">');
    lines.push('      <div className="w-full max-w-md animate-fade-in">');
    lines.push('        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-xl space-y-5">');
    const childJsx = page.children.map(c => generateJSX(c, ctx, analysis, ROOT_SCOPE, 10)).filter(Boolean).join('\n');
    lines.push(childJsx);
    lines.push('        </div>');
    lines.push('      </div>');
    lines.push('    </div>');
  } else if (isDeepForm && !hasSidebar) {
    // Deep form page (e.g. main>grid:1(card(form(...)))) — no redundant bg
    // Auth pages: add auth-form-wrapper class to flatten redundant main/grid via CSS display:contents
    const isAuth = isAuthPageName(page.name);
    const wrapperCls = isAuth ? 'w-full max-w-md animate-fade-in auth-form-wrapper' : 'w-full max-w-md animate-fade-in';
    lines.push('    <div className="flex items-center justify-center min-h-screen">');
    lines.push(`      <div className="${wrapperCls}">`);
    const childJsx = page.children.map(c => generateJSX(c, ctx, analysis, ROOT_SCOPE, 8)).filter(Boolean).join('\n');
    lines.push(childJsx);
    lines.push('      </div>');
    lines.push('    </div>');
  } else if (hasSidebar) {
    lines.push('    <div className="flex min-h-screen">');
    const sidebarScope: Scope = { ...ROOT_SCOPE, insideSidebarPage: true };
    const childJsx = page.children.map(c => generateJSX(c, ctx, analysis, sidebarScope, 6)).filter(Boolean).join('\n');
    lines.push(childJsx);
    lines.push('    </div>');
  } else {
    lines.push('    <div className="space-y-6 animate-fade-in">');
    const childJsx = page.children.map(c => generateJSX(c, ctx, analysis, ROOT_SCOPE, 6)).filter(Boolean).join('\n');
    lines.push(childJsx);
    lines.push('    </div>');
  }

  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ---- Path B: Dashboard pages ----

function generateDashboardPage(
  pageName: string,
  page: { name: string; children: AirUINode[] },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  binding: PageResourceBinding,
  hasLayout: boolean,
): string {
  const lines: string[] = [];
  // Note: provenance header is prepended by transpiler orchestrator
  lines.push("import { useState, useEffect } from 'react';");
  lines.push("import * as api from '../api.js';");
  if (hasLayout) lines.push("import Layout from '../Layout.jsx';");
  lines.push('');
  lines.push(`export default function ${pageName}Page({ user, logout, currentPage, setCurrentPage }) {`);
  lines.push('  const [loading, setLoading] = useState(true);');

  // State for each data source
  const declaredVars = new Set<string>(['user', 'logout', 'currentPage', 'setCurrentPage', 'loading', 'setLoading']);
  for (const ds of binding.dataSources) {
    lines.push(`  const [${ds.stateVar}, set${capitalize(ds.stateVar)}] = useState([]);`);
    declaredVars.add(ds.stateVar);
    declaredVars.add('set' + capitalize(ds.stateVar));
  }

  // Pre-generate child JSX to scan for undeclared state vars
  const filteredChildren = page.children.filter(c => !hasSidebarNode(c));
  const mainChildren = extractMainContent(page.children) || filteredChildren;
  let childJsx = mainChildren.map(c =>
    generateJSX(c, ctx, analysis, ROOT_SCOPE, 6)
  ).filter(Boolean).join('\n');

  // Apply semantic badge colors to dynamically-bound badges
  const hasBadges = childJsx.includes(BADGE_STATIC_MARKER);
  if (hasBadges) childJsx = applyBadgeColors(childJsx);

  // Scan JSX for undeclared state variables and add them
  const extraState = detectUndeclaredStateVars(childJsx, declaredVars, ctx);
  for (const { name, defaultVal } of extraState) {
    lines.push(`  const [${name}, set${capitalize(name)}] = useState(${defaultVal});`);
    declaredVars.add(name);
  }

  // Badge color helper (semantic status/priority colors)
  if (hasBadges) lines.push(BADGE_COLOR_FN);
  lines.push('');

  // T1.2: Error state for dashboard pages
  lines.push('  const [error, setError] = useState(null);');
  declaredVars.add('error'); declaredVars.add('setError');
  lines.push('');

  // Parallel fetch on mount — unwrap paginated { data, meta } responses for list endpoints
  lines.push('  useEffect(() => {');
  lines.push('    Promise.all([');
  for (const ds of binding.dataSources) {
    lines.push(`      api.${ds.getFnName}().then(res => set${capitalize(ds.stateVar)}(res?.data ?? res)),`);
  }
  lines.push('    ])');
  lines.push("      .catch(err => setError(err.message || 'Failed to load data'))");
  lines.push('      .finally(() => setLoading(false));');
  lines.push('  }, []);');
  lines.push('');

  // Render with Layout wrapping — sidebar filtered since Layout provides it
  lines.push('  return (');
  const WrapOpen = hasLayout
    ? '    <Layout user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}>'
    : '    <div className="min-h-screen p-6" style={{ background: "var(--bg)", color: "var(--fg)" }}>';
  const WrapClose = hasLayout ? '    </Layout>' : '    </div>';
  lines.push(WrapOpen);

  // T1.2: Error alert for dashboard
  lines.push('      {error && <div className="mb-4 rounded-[var(--radius)] bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 text-sm">{error}</div>}');

  // Loading state
  lines.push('      {loading ? (');
  lines.push('        <div className="space-y-6 animate-pulse">');
  lines.push('          <div className="h-8 w-48 bg-[var(--hover)] rounded" />');
  lines.push('          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">');
  lines.push('            {[1,2,3].map(i => (');
  lines.push('              <div key={i} className="h-28 bg-[var(--hover)] rounded-[var(--radius)]" />');
  lines.push('            ))}');
  lines.push('          </div>');
  lines.push('          <div className="h-64 bg-[var(--hover)] rounded-[var(--radius)]" />');
  lines.push('        </div>');
  lines.push('      ) : (');

  if (childJsx.trim()) {
    lines.push('        <div className="space-y-6 animate-fade-in">');
    lines.push(childJsx);
    lines.push('        </div>');
  } else {
    lines.push('        <div className="space-y-6 animate-fade-in" />');
  }

  lines.push('      )}');
  lines.push(WrapClose);
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ---- Path C: CRUD pages ----

function generateCrudPage(
  pageName: string,
  page: { name: string; children: AirUINode[] },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  binding: PageResourceBinding,
  hasLayout: boolean,
): string {
  const lines: string[] = [];
  const modelPlural = binding.modelPlural || page.name.toLowerCase();
  const modelSingular = binding.model?.name || capitalize(modelPlural.replace(/s$/, ''));
  const modelLabel = camelToLabel(modelPlural);
  const singularLabel = camelToLabel(modelSingular.toLowerCase());

  // Derive API function names
  const getFnName = binding.getRoute ? routeToFunctionName('GET', binding.getRoute.path) : null;
  const postFnName = binding.postRoute ? routeToFunctionName('POST', binding.postRoute.path) : null;
  const putFnName = binding.putRoute ? routeToFunctionName('PUT', binding.putRoute.path) : null;
  const deleteFnName = binding.deleteRoute ? routeToFunctionName('DELETE', binding.deleteRoute.path) : null;

  // C2/G5: Detect if this is an admin-only resource in an auth-gated app with roles
  const hasRoleAuth = ctx.auth?.role !== undefined;
  let isAdminResource = false;
  if (hasRoleAuth && binding.model && ctx.db) {
    // Non-primary model heuristic: models with fewer than 3 CRUD routes are admin-level
    const allRoutes = ctx.expandedRoutes;
    const modelRouteCount = allRoutes.filter(r => r.handler.includes(`.${binding.model!.name}.`)).length;
    // Primary model typically has 4+ routes (GET list, POST, PUT, DELETE + nested)
    isAdminResource = modelRouteCount < 3;
  }

  // Note: provenance header is prepended by transpiler orchestrator
  lines.push("import { useState, useEffect } from 'react';");
  lines.push("import * as api from '../api.js';");
  if (hasLayout) lines.push("import Layout from '../Layout.jsx';");
  lines.push('');
  // Detect if this model has a detail page → accept setter prop for navigation
  const detailModels = ctx.db ? detectDetailPageModels(ctx) : [];
  const detailModel = detailModels.find(d => {
    const dp = d.modelName.toLowerCase().endsWith('s') ? d.modelName.toLowerCase() : d.modelName.toLowerCase() + 's';
    return dp === modelPlural || modelPlural.includes(d.modelName.toLowerCase());
  });
  const detailSetterProp = detailModel ? `setSelected${detailModel.modelName}Id` : null;
  const detailSetterParam = detailSetterProp ? `, ${detailSetterProp}` : '';
  lines.push(`export default function ${pageName}Page({ user, logout, currentPage, setCurrentPage${detailSetterParam} }) {`);

  // Local state
  const declaredVars = new Set<string>(['user', 'logout', 'currentPage', 'setCurrentPage']);
  if (detailSetterProp) {
    declaredVars.add(detailSetterProp);
    // Also mark the state variable name so detectUndeclaredStateVars doesn't re-declare it
    const stateVarName = detailSetterProp.replace(/^set/, '');
    declaredVars.add(stateVarName.charAt(0).toLowerCase() + stateVarName.slice(1));
  }
  lines.push(`  const [${modelPlural}, set${capitalize(modelPlural)}] = useState([]);`);
  lines.push('  const [loading, setLoading] = useState(true);');
  declaredVars.add(modelPlural);
  declaredVars.add('set' + capitalize(modelPlural));
  declaredVars.add('loading'); declaredVars.add('setLoading');
  if (postFnName) {
    lines.push('  const [showForm, setShowForm] = useState(false);');
    lines.push('  const [submitting, setSubmitting] = useState(false);');
    declaredVars.add('showForm'); declaredVars.add('setShowForm');
    declaredVars.add('submitting'); declaredVars.add('setSubmitting');
  }
  if (putFnName) {
    lines.push('  const [editId, setEditId] = useState(null);');
    declaredVars.add('editId'); declaredVars.add('setEditId');
  }
  if (deleteFnName) {
    lines.push('  const [deleteId, setDeleteId] = useState(null);');
    declaredVars.add('deleteId'); declaredVars.add('setDeleteId');
  }
  // T1.2: Error and success state for user-visible feedback
  lines.push('  const [error, setError] = useState(null);');
  lines.push('  const [successMsg, setSuccessMsg] = useState(null);');
  declaredVars.add('error'); declaredVars.add('setError');
  declaredVars.add('successMsg'); declaredVars.add('setSuccessMsg');
  // C2/G7: Field-level validation errors for forms
  if (postFnName) {
    lines.push('  const [fieldErrors, setFieldErrors] = useState({});');
    declaredVars.add('fieldErrors'); declaredVars.add('setFieldErrors');
  }
  // C2/G5: Derive admin flag for role-based UI gating
  if (hasRoleAuth) {
    lines.push("  const isAdmin = user?.role === 'admin';");
    declaredVars.add('isAdmin');
  }
  // C3/G9: Pagination state — dedicated pageNum (not nav currentPage)
  if (getFnName) {
    lines.push('  const [pageNum, setPageNum] = useState(1);');
    lines.push('  const [totalPages, setTotalPages] = useState(1);');
    declaredVars.add('pageNum'); declaredVars.add('setPageNum');
    declaredVars.add('totalPages'); declaredVars.add('setTotalPages');
  }
  // Mark handler names as known
  if (postFnName) declaredVars.add('handleCreate');
  if (putFnName) declaredVars.add('handleUpdate');
  if (deleteFnName) declaredVars.add('handleDelete');

  // C1/G1: Detect status enum field for workflow mutations
  const statusField = binding.model?.fields.find(f => {
    const base = f.type.kind === 'optional' ? (f.type as { of: { kind: string } }).of : f.type;
    return f.name === 'status' && base.kind === 'enum';
  });

  // C2/G4: Detect enum filter state variables (e.g., statusFilter → status field, priorityFilter → priority field)
  const filterStateVars: { stateVar: string; fieldName: string }[] = [];
  if (binding.model) {
    for (const sf of ctx.state) {
      if (!sf.name.endsWith('Filter')) continue;
      const fieldName = sf.name.replace(/Filter$/, '');
      const matchField = binding.model.fields.find(f => f.name === fieldName);
      if (matchField) {
        const base = matchField.type.kind === 'optional'
          ? (matchField.type as { of: { kind: string } }).of
          : matchField.type;
        if (base.kind === 'enum') {
          filterStateVars.push({ stateVar: sf.name, fieldName });
        }
      }
    }
  }

  // C2/G4: Declare filter state variables early (before load/useEffect use them)
  for (const fv of filterStateVars) {
    if (!declaredVars.has(fv.stateVar)) {
      lines.push(`  const [${fv.stateVar}, set${capitalize(fv.stateVar)}] = useState('all');`);
      declaredVars.add(fv.stateVar);
      declaredVars.add('set' + capitalize(fv.stateVar));
    }
  }

  // C2/G4: Add sort state when model has enum filters (implying a filterable/sortable list)
  if (filterStateVars.length > 0) {
    lines.push("  const [sortField, setSortField] = useState('created_at');");
    lines.push("  const [sortOrder, setSortOrder] = useState('desc');");
    declaredVars.add('sortField'); declaredVars.add('setSortField');
    declaredVars.add('sortOrder'); declaredVars.add('setSortOrder');
  }

  lines.push('');

  // Load function — if no GET route, immediately clear loading state
  // Also load cart-like arrays from localStorage for cross-page persistence
  if (!getFnName) {
    const cartArrayName = ctx.state.find(f =>
      f.type.kind === 'array' && /^(cart|items|basket|bag)$/i.test(f.name)
    )?.name;
    if (cartArrayName) {
      lines.push(`  useEffect(() => {`);
      lines.push(`    try { const saved = localStorage.getItem('${ctx.appName}_cart'); if (saved) set${capitalize(cartArrayName)}(JSON.parse(saved)); } catch(_) {}`);
      lines.push(`    setLoading(false);`);
      lines.push(`  }, []);`);
    } else {
      lines.push('  useEffect(() => { setLoading(false); }, []);');
    }
    lines.push('');
  }
  if (getFnName) {
    lines.push(`  const load = async () => {`);
    lines.push('    try {');
    if (filterStateVars.length > 0) {
      // C2/G4 + C3/G9: Pass filter, sort, and pagination state to API call
      const filterArgs = filterStateVars.map(fv =>
        `${fv.fieldName}: ${fv.stateVar} !== 'all' ? ${fv.stateVar} : undefined`
      ).join(', ');
      lines.push(`      const res = await api.${getFnName}({ page: pageNum, ${filterArgs}, sort: sortField + ':' + sortOrder });`);
    } else {
      lines.push(`      const res = await api.${getFnName}({ page: pageNum });`);
    }
    // C3/G9: Extract paginated response — server returns { data, meta }
    lines.push(`      set${capitalize(modelPlural)}(res.data ?? res);`);
    lines.push('      if (res.meta) setTotalPages(res.meta.totalPages || 1);');
    lines.push('    } catch (err) {');
    lines.push("      setError(err.message || 'Failed to load data');");
    lines.push('    } finally {');
    lines.push('      setLoading(false);');
    lines.push('    }');
    lines.push('  };');
    lines.push('');
    if (filterStateVars.length > 0) {
      // C2/G4 + C3/G9: Re-fetch when filter/sort/page state changes
      const deps = filterStateVars.map(fv => fv.stateVar).join(', ');
      lines.push(`  useEffect(() => { load(); }, [${deps}, sortField, sortOrder, pageNum]);`);
      // C3/G9: Reset to page 1 when filters change
      lines.push(`  useEffect(() => { setPageNum(1); }, [${deps}]);`);
    } else {
      lines.push('  useEffect(() => { load(); }, [pageNum]);');
    }
    lines.push('');
  }

  // Create handler
  if (postFnName && getFnName) {
    // C2/G7: Collect required fields for validation
    const requiredFields = binding.formFields.filter(f => f.required);

    lines.push('  const handleCreate = async (e) => {');
    lines.push('    e.preventDefault();');
    lines.push('    setSubmitting(true);');
    lines.push('    setError(null);');
    lines.push('    try {');
    lines.push('      const fd = Object.fromEntries(new FormData(e.target));');

    // C2/G7: Inline validation for required fields
    if (requiredFields.length > 0) {
      lines.push('      // Validate required fields');
      lines.push('      const validation = {};');
      for (const f of requiredFields) {
        const label = f.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        lines.push(`      if (!fd.${f.name}) validation.${f.name} = '${label} is required';`);
      }
      lines.push('      if (Object.keys(validation).length > 0) { setFieldErrors(validation); setSubmitting(false); return; }');
      lines.push('      setFieldErrors({});');
    }

    // Convert numeric fields
    for (const f of binding.formFields) {
      if (f.type === 'number') {
        lines.push(`      if (fd.${f.name}) fd.${f.name} = Number(fd.${f.name});`);
      }
    }
    lines.push(`      await api.${postFnName}(fd);`);
    lines.push('      e.target.reset();');
    lines.push('      setShowForm(false);');
    lines.push(`      setSuccessMsg('${singularLabel} created successfully');`);
    lines.push('      setTimeout(() => setSuccessMsg(null), 3000);');
    lines.push('      load();');
    lines.push('    } catch (err) {');
    lines.push("      setError(err.message || 'Failed to create');");
    lines.push('    } finally {');
    lines.push('      setSubmitting(false);');
    lines.push('    }');
    lines.push('  };');
    lines.push('');
  }

  // Update handler
  if (putFnName && getFnName) {
    lines.push('  const handleUpdate = async (e) => {');
    lines.push('    e.preventDefault();');
    lines.push('    setError(null);');
    lines.push('    try {');
    lines.push('      const fd = Object.fromEntries(new FormData(e.target));');
    for (const f of binding.formFields) {
      if (f.type === 'number') {
        lines.push(`      if (fd.${f.name}) fd.${f.name} = Number(fd.${f.name});`);
      }
    }
    lines.push(`      await api.${putFnName}(editId, fd);`);
    lines.push('      setEditId(null);');
    lines.push(`      setSuccessMsg('${singularLabel} updated successfully');`);
    lines.push('      setTimeout(() => setSuccessMsg(null), 3000);');
    lines.push('      load();');
    lines.push('    } catch (err) {');
    lines.push("      setError(err.message || 'Failed to update');");
    lines.push('    }');
    lines.push('  };');
    lines.push('');
  }

  // Delete handler — uses modal instead of window.confirm
  if (deleteFnName && getFnName) {
    lines.push('  const handleDelete = async (id) => {');
    lines.push('    setError(null);');
    lines.push('    try {');
    lines.push(`      await api.${deleteFnName}(id);`);
    lines.push('      setDeleteId(null);');
    lines.push(`      setSuccessMsg('${singularLabel} deleted');`);
    lines.push('      setTimeout(() => setSuccessMsg(null), 3000);');
    lines.push('      load();');
    lines.push('    } catch (err) {');
    lines.push("      setError(err.message || 'Failed to delete');");
    lines.push('    }');
    lines.push('  };');
    lines.push('');
  }

  // C1/G1: Status workflow handler — handleStatusChange(id, newStatus)
  if (statusField && putFnName && getFnName) {
    lines.push(`  const handleStatusChange = async (id, newStatus) => {`);
    lines.push('    try {');
    lines.push(`      await api.${putFnName}(id, { status: newStatus });`);
    lines.push('      load();');
    lines.push('    } catch (err) {');
    lines.push("      setError(err.message || 'Status update failed');");
    lines.push('    }');
    lines.push('  };');
    lines.push('');
    declaredVars.add('handleStatusChange');
  }

  // T1.5/A2c: Generate custom page-level mutations (e.g., resolveTicket, closeTicket)
  // Extract mutations from page children, skip standard CRUD names, wire to API routes
  // Names that are handled by CRUD handlers above, or should skip generic route matching
  // to fall through to the safety net (which uses page-binding putFnName/deleteFnName)
  const skipGenericMatch = new Set(['update', 'save', 'handleCreate', 'handleUpdate', 'handleDelete',
    'del', 'delItem', 'remove', 'add', 'addItem', 'done', 'archive', 'toggle', 'checkout']);
  const pageMuts = extractMutations(page.children);
  const expandedRoutes = ctx.expandedRoutes;
  for (const mut of pageMuts) {
    if (declaredVars.has(mut.name)) continue;
    const genericMatch = skipGenericMatch.has(mut.name) ? null : findGenericRouteMatch(mut.name, expandedRoutes);
    if (genericMatch) {
      declaredVars.add(mut.name);

      // C1/G1: Specialize status-related mutations when model has status enum
      if (mut.name === 'assign' && statusField && genericMatch.method === 'PUT') {
        // assign takes (id, agent_id) — default agent_id to current user when called from a single-arg button
        lines.push(`  const assign = async (id, agent_id) => {`);
        lines.push('    try {');
        lines.push(`      await api.${genericMatch.fnName}(id, { agent_id: agent_id || user?.id });`);
        if (getFnName) lines.push('      load();');
        lines.push('    } catch (err) {');
        lines.push("      setError(err.message || 'assign failed');");
        lines.push('    }');
        lines.push('  };');
        lines.push('');
        continue;
      }
      if (mut.name === 'resolve' && statusField && genericMatch.method === 'PUT') {
        // resolve sets { status: 'resolved' }
        lines.push(`  const resolve = async (id) => {`);
        lines.push('    try {');
        lines.push(`      await api.${genericMatch.fnName}(id, { status: 'resolved' });`);
        if (getFnName) lines.push('      load();');
        lines.push('    } catch (err) {');
        lines.push("      setError(err.message || 'resolve failed');");
        lines.push('    }');
        lines.push('  };');
        lines.push('');
        continue;
      }

      if (genericMatch.method === 'PUT') {
        lines.push(`  const ${mut.name} = async (id, data) => {`);
        lines.push('    try {');
        lines.push(`      await api.${genericMatch.fnName}(id, data || { ${mut.name}: true });`);
        if (getFnName) {
          lines.push(`      load();`);
        }
        lines.push('    } catch (err) {');
        lines.push(`      setError(err.message || '${mut.name} failed');`);
        lines.push('    }');
        lines.push('  };');
      } else {
        lines.push(`  const ${mut.name} = async (data) => {`);
        lines.push('    try {');
        lines.push(`      await api.${genericMatch.fnName}(data);`);
        if (getFnName) {
          lines.push(`      load();`);
        }
        lines.push('    } catch (err) {');
        lines.push(`      setError(err.message || '${mut.name} failed');`);
        lines.push('    }');
        lines.push('  };');
      }
      lines.push('');
    } else if (!declaredVars.has(mut.name)) {
      // Safety net: emit stub for mutations found in UI but not matched to any route
      // Check for cart-like array state — del/checkout work on local state with persistence
      const _cartArray = ctx.state.find(f =>
        f.type.kind === 'array' && /^(cart|items|basket|bag)$/i.test(f.name)
      )?.name;
      if ((mut.name === 'del' || mut.name === 'delItem' || mut.name === 'remove') && _cartArray && !deleteFnName) {
        // Cart-style delete: remove from local array + persist
        lines.push(`  const ${mut.name} = (id) => {`);
        lines.push(`    set${capitalize(_cartArray)}(prev => {`);
        lines.push(`      const next = prev.filter(i => i.id !== id && i.productId !== id);`);
        lines.push(`      try { localStorage.setItem('${ctx.appName}_cart', JSON.stringify(next)); } catch(_) {}`);
        lines.push(`      return next;`);
        lines.push('    });');
        lines.push('  };');
      } else if ((mut.name === 'del' || mut.name === 'delItem' || mut.name === 'remove') && deleteFnName) {
        // Map del/remove to the delete-modal pattern
        lines.push(`  const ${mut.name} = (id) => setDeleteId(id);`);
      } else if ((mut.name === 'add' || mut.name === 'addItem') && postFnName) {
        // If mutation has data arguments (e.g., !add({...})), it's a cart-add style operation
        if (mut.argNodes.length > 0) {
          // Detect a cart/items array state to push into
          const cartArrayName = ctx.state.find(f =>
            f.type.kind === 'array' && /^(cart|items|basket|bag)$/i.test(f.name)
          )?.name;
          if (cartArrayName) {
            lines.push(`  const ${mut.name} = (data) => {`);
            lines.push(`    set${capitalize(cartArrayName)}(prev => {`);
            lines.push(`      const existing = prev.find(i => i.productId === data.productId || i.id === data.id);`);
            lines.push(`      const next = existing ? prev.map(i => (i.productId === data.productId || i.id === data.id) ? { ...i, quantity: (i.quantity || 1) + 1 } : i) : [...prev, { ...data, id: Date.now() }];`);
            lines.push(`      try { localStorage.setItem('${ctx.appName}_cart', JSON.stringify(next)); } catch(_) {}`);
            lines.push(`      return next;`);
            lines.push('    });');
            lines.push('  };');
          } else {
            lines.push(`  const ${mut.name} = () => setShowForm(true);`);
          }
        } else {
          lines.push(`  const ${mut.name} = () => setShowForm(true);`);
        }
      } else if ((mut.name === 'done' || mut.name === 'archive') && putFnName) {
        const payload = mut.name === 'archive' ? "status: 'archived'" : "status: 'done'";
        lines.push(`  const ${mut.name} = async (id) => {`);
        lines.push('    try {');
        lines.push(`      await api.${putFnName}(id, { ${payload} });`);
        if (getFnName) lines.push('      load();');
        lines.push('    } catch (err) {');
        lines.push(`      setError(err.message || '${mut.name} failed');`);
        lines.push('    }');
        lines.push('  };');
      } else if (mut.name === 'toggle' && putFnName) {
        lines.push(`  const toggle = async (id, field) => {`);
        lines.push(`    const current = ${modelPlural}.find(i => i.id === id);`);
        lines.push('    try {');
        lines.push(`      await api.${putFnName}(id, { [field]: !(current?.[field]) });`);
        if (getFnName) lines.push('      load();');
        lines.push('    } catch (err) {');
        lines.push("      setError(err.message || 'toggle failed');");
        lines.push('    }');
        lines.push('  };');
      } else if (mut.name === 'checkout') {
        if (_cartArray) {
          // Cart checkout: create order from cart items, clear cart
          if (postFnName) {
            lines.push(`  const checkout = async () => {`);
            lines.push('    try {');
            lines.push(`      await api.${postFnName}({ items: ${_cartArray} });`);
            lines.push(`      set${capitalize(_cartArray)}([]);`);
            lines.push(`      try { localStorage.removeItem('${ctx.appName}_cart'); } catch(_) {}`);
            lines.push(`      setSuccessMsg('Order placed successfully');`);
            lines.push(`      setTimeout(() => setSuccessMsg(null), 3000);`);
            lines.push('    } catch (err) {');
            lines.push("      setError(err.message || 'checkout failed');");
            lines.push('    }');
            lines.push('  };');
          } else {
            lines.push(`  const checkout = () => {`);
            lines.push(`    set${capitalize(_cartArray)}([]);`);
            lines.push(`    try { localStorage.removeItem('${ctx.appName}_cart'); } catch(_) {}`);
            lines.push(`    setSuccessMsg('Order placed successfully');`);
            lines.push(`    setTimeout(() => setSuccessMsg(null), 3000);`);
            lines.push('  };');
          }
        } else if (postFnName) {
          lines.push(`  const checkout = async () => {`);
          lines.push('    try {');
          lines.push(`      await api.${postFnName}({ items: ${modelPlural} });`);
          if (getFnName) lines.push('      load();');
          lines.push('    } catch (err) {');
          lines.push("      setError(err.message || 'checkout failed');");
          lines.push('    }');
          lines.push('  };');
        } else {
          lines.push(`  const checkout = (...args) => { console.log('checkout', ...args); };`);
        }
      } else {
        lines.push(`  const ${mut.name} = (...args) => { console.log('${mut.name}', ...args); };`);
      }
      declaredVars.add(mut.name);
      lines.push('');
    }
  }

  // Pre-generate child JSX to check if page has substantive .air content
  const filteredChildren = page.children.filter(c => !hasSidebarNode(c));
  const mainChildren = extractMainContent(page.children) || filteredChildren;
  const hasSubstantiveContent = mainChildren.length > 0 && mainChildren.some(c => {
    // Check if children have meaningful content beyond just wrappers or headings
    if (c.kind === 'element' && ['main', 'div', 'section'].includes(c.element) && (!c.children || c.children.length === 0)) return false;
    // Headings alone (h1>"Title") don't count as substantive page content
    if (isHeadingOnly(c)) return false;
    return true;
  });

  // T1.1: If page has substantive .air content, render it via generateJSX()
  // instead of the generic CRUD wrapper. Inject data handlers above the return.
  if (hasSubstantiveContent) {
    let childJsx = mainChildren.map(c =>
      generateJSX(c, ctx, analysis, ROOT_SCOPE, 6)
    ).filter(Boolean).join('\n');

    // Apply semantic badge colors to dynamically-bound badges
    const hasCrudBadges = childJsx.includes(BADGE_STATIC_MARKER);
    if (hasCrudBadges) childJsx = applyBadgeColors(childJsx);

    // Wire list-row clicks to detail page navigation
    if (detailSetterProp) {
      // Find list-row divs inside .map() iteration and add onClick + cursor
      // Pattern: <div key={xxx.id} className="list-row">
      childJsx = childJsx.replace(
        /(<div key=\{(\w+)\.id\} className="list-row")>/g,
        (_, prefix, iterVar) =>
          `${prefix} onClick={() => ${detailSetterProp}(${iterVar}.id)} style={{cursor:'pointer'}}>`
      );
    }

    // Wire "New {Model}" / "Create {Model}" buttons to showForm toggle
    if (postFnName && declaredVars.has('showForm')) {
      const label = singularLabel;
      const patterns = [`New ${label}`, `New ${capitalize(modelPlural)}`, `Create ${label}`, `Add ${label}`];
      for (const pat of patterns) {
        // Match buttons with text but no onClick
        const btnRe = new RegExp(`(<button[^>]*class(?:Name)?="[^"]*")(>\\s*${pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</button>)`);
        childJsx = childJsx.replace(btnRe, `$1 onClick={() => setShowForm(!showForm)}$2`);
      }
    }

    // Scan JSX for undeclared state variables and add them
    const extraState = detectUndeclaredStateVars(childJsx, declaredVars, ctx);
    for (const { name, defaultVal } of extraState) {
      lines.push(`  const [${name}, set${capitalize(name)}] = useState(${defaultVal});`);
      declaredVars.add(name);
    }
    // Badge color helper (semantic status/priority colors)
    if (hasCrudBadges) lines.push(BADGE_COLOR_FN);

    // Auto-compute cart total from cart-like array
    if (declaredVars.has('cartTotal') || childJsx.includes('cartTotal')) {
      const cartArr = ctx.state.find(f =>
        f.type.kind === 'array' && /^(cart|items|basket|bag)$/i.test(f.name)
      )?.name;
      if (cartArr) {
        lines.push(`  useEffect(() => { setCartTotal(${cartArr}.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0)); }, [${cartArr}]);`);
      }
    }
    lines.push('');

    // Render with Layout wrapping
    lines.push('  return (');
    lines.push(hasLayout
      ? '    <Layout user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}>'
      : '    <div className="min-h-screen p-6" style={{ background: "var(--bg)", color: "var(--fg)" }}>');

    // Error/success alerts (T1.2)
    lines.push('      {error && <div className="mb-4 rounded-[var(--radius)] bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 text-sm">{error}</div>}');
    lines.push('      {successMsg && <div className="mb-4 rounded-[var(--radius)] bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 text-sm">{successMsg}</div>}');

    // Loading state
    lines.push('      {loading ? (');
    lines.push('        <div className="space-y-6 animate-pulse">');
    lines.push('          <div className="h-8 w-48 bg-[var(--hover)] rounded" />');
    lines.push('          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">');
    lines.push('            {[1,2,3].map(i => (');
    lines.push('              <div key={i} className="h-28 bg-[var(--hover)] rounded-[var(--radius)]" />');
    lines.push('            ))}');
    lines.push('          </div>');
    lines.push('          <div className="h-64 bg-[var(--hover)] rounded-[var(--radius)]" />');
    lines.push('        </div>');
    lines.push('      ) : (');

    if (childJsx.trim()) {
      lines.push('        <div className="space-y-6 animate-fade-in">');
      lines.push(childJsx);

      // C2/G7: Inject CRUD create form when page has postRoute and form fields
      if (postFnName && binding.formFields.length > 0) {
        const formGateOpen = isAdminResource ? `{user?.role === 'admin' && showForm && (` : '{showForm && (';
        lines.push(`        ${formGateOpen}`);
        lines.push(`          <form onSubmit={handleCreate} className="p-6 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)] space-y-4 animate-slide-up">`);
        lines.push(`            <h3 className="text-lg font-semibold mb-2">New ${singularLabel}</h3>`);
        for (const field of binding.formFields) {
          lines.push(renderFormField(field, binding, 12));
        }
        lines.push(`            <div className="flex justify-end gap-3 pt-2">`);
        lines.push(`              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-[var(--radius)] border border-[var(--border)] hover:bg-[var(--hover)] text-sm font-medium transition-colors">Cancel</button>`);
        lines.push(`              <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-[var(--accent)] text-white rounded-[var(--radius)] text-sm font-medium hover:opacity-90 transition-colors disabled:opacity-50">{submitting ? 'Creating...' : 'Create ${singularLabel}'}</button>`);
        lines.push(`            </div>`);
        lines.push(`          </form>`);
        lines.push('        )}');
      }

      // C3/G9: Pagination controls
      if (getFnName) {
        for (const l of renderPaginationControls(8)) lines.push(l);
      }

      lines.push('        </div>');
    } else {
      lines.push('        <div className="space-y-6 animate-fade-in" />');
    }

    lines.push('      )}');

    // C2/G5: Role-based gating for admin resources in substantive content path
    if (isAdminResource && deleteFnName) {
      // Admin-only delete is handled by the modal gating below
    }

    // Delete confirmation modal (still needed for CRUD pages)
    if (deleteFnName) {
      lines.push('');
      lines.push('      {/* Delete confirmation modal */}');
      lines.push('      {deleteId !== null && (');
      lines.push('        <div className="modal-backdrop" onClick={() => setDeleteId(null)}>');
      lines.push('          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>');
      lines.push(`            <h3 className="text-lg font-semibold mb-2">Delete ${singularLabel}</h3>`);
      lines.push(`            <p className="text-sm text-[var(--muted)] mb-6">Are you sure you want to delete this ${singularLabel.toLowerCase()}? This action cannot be undone.</p>`);
      lines.push('            <div className="flex justify-end gap-3">');
      lines.push('              <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-[var(--radius)] border border-[var(--border)] hover:bg-[var(--hover)] text-sm font-medium transition-colors">Cancel</button>');
      lines.push('              <button onClick={() => handleDelete(deleteId)} className="px-4 py-2 rounded-[var(--radius)] bg-red-500 text-white hover:bg-red-600 text-sm font-medium transition-colors">Delete</button>');
      lines.push('            </div>');
      lines.push('          </div>');
      lines.push('        </div>');
      lines.push('      )}');
    }

    lines.push(hasLayout ? '    </Layout>' : '    </div>');
    lines.push('  );');
    lines.push('}');
    lines.push('');
    return lines.join('\n');
  }

  // ---- Fallback: Generic CRUD wrapper (when page has no substantive .air content) ----

  // Render
  lines.push('  return (');
  lines.push(hasLayout
    ? '    <Layout user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}>'
    : '    <div className="min-h-screen p-6" style={{ background: "var(--bg)", color: "var(--fg)" }}>');

  lines.push(`      <div className="space-y-6 animate-fade-in">`);

  // Error/success alerts (T1.2)
  lines.push('        {error && <div className="mb-4 rounded-[var(--radius)] bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 text-sm">{error}</div>}');
  lines.push('        {successMsg && <div className="mb-4 rounded-[var(--radius)] bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 text-sm">{successMsg}</div>}');

  lines.push(`        <div className="flex items-center justify-between">`);
  lines.push(`          <div>`);
  lines.push(`            <h1 className="text-2xl font-bold tracking-tight">${modelLabel}</h1>`);
  lines.push(`            <p className="text-sm text-[var(--muted)] mt-1">{loading ? 'Loading...' : \`\${${modelPlural}.length} ${modelPlural} total\`}</p>`);
  lines.push(`          </div>`);
  if (postFnName) {
    if (isAdminResource) {
      // C2/G5: Wrap create button in admin role check
      lines.push(`          {user?.role === 'admin' && (`);
      lines.push(`            <button`);
      lines.push(`              onClick={() => setShowForm(!showForm)}`);
      lines.push(`              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--accent)] text-white rounded-[var(--radius)] font-medium hover:opacity-90 transition-all text-sm"`);
      lines.push(`            >`);
      lines.push(`              {showForm ? (`);
      lines.push(`                <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> Cancel</>`);
      lines.push(`              ) : (`);
      lines.push(`                <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg> Add ${singularLabel}</>`);
      lines.push(`              )}`);
      lines.push(`            </button>`);
      lines.push(`          )}`);
    } else {
      lines.push(`          <button`);
      lines.push(`            onClick={() => setShowForm(!showForm)}`);
      lines.push(`            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--accent)] text-white rounded-[var(--radius)] font-medium hover:opacity-90 transition-all text-sm"`);
      lines.push(`          >`);
      lines.push(`            {showForm ? (`);
      lines.push(`              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> Cancel</>`);
      lines.push(`            ) : (`);
      lines.push(`              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg> Add ${singularLabel}</>`);
      lines.push(`            )}`);
      lines.push(`          </button>`);
    }
  }
  lines.push(`        </div>`);

    // Inline form with animation
    if (postFnName && binding.formFields.length > 0) {
      lines.push(`        {showForm && (`);
      lines.push(`          <form onSubmit={handleCreate} className="p-6 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)] space-y-4 animate-slide-up">`);
      lines.push(`            <h3 className="text-lg font-semibold mb-2">New ${singularLabel}</h3>`);
      for (const field of binding.formFields) {
        lines.push(renderFormField(field, binding, 12));
      }
      lines.push(`            <div className="flex justify-end gap-3 pt-2">`);
      lines.push(`              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-[var(--radius)] border border-[var(--border)] hover:bg-[var(--hover)] text-sm font-medium transition-colors">Cancel</button>`);
      lines.push(`              <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-[var(--accent)] text-white rounded-[var(--radius)] text-sm font-medium hover:opacity-90 transition-colors disabled:opacity-50">{submitting ? 'Creating...' : 'Create ${singularLabel}'}</button>`);
      lines.push(`            </div>`);
      lines.push(`          </form>`);
      lines.push(`        )}`);
    }

    // Loading skeleton
    lines.push('        {loading ? (');
    lines.push('          <div className="space-y-3 animate-pulse">');
    lines.push('            {[1,2,3,4,5].map(i => (');
    lines.push(`              <div key={i} className="h-16 bg-[var(--hover)] rounded-[var(--radius)]" />`);
    lines.push('            ))}');
    lines.push('          </div>');
    lines.push('        ) : (');

    // Data list
    lines.push(`          <div className="border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">`);
    lines.push(`            {${modelPlural}.length === 0 ? (`);
    lines.push(`              <div className="flex flex-col items-center justify-center py-16 text-center">`);
    lines.push(`                <div className="w-14 h-14 rounded-full bg-[var(--hover)] flex items-center justify-center mb-4">`);
    lines.push(`                  <svg className="w-7 h-7 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>`);
    lines.push(`                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />`);
    lines.push(`                  </svg>`);
    lines.push(`                </div>`);
    lines.push(`                <p className="text-sm font-medium mb-1">No ${modelPlural} yet</p>`);
    lines.push(`                <p className="text-xs text-[var(--muted)]">Create your first ${singularLabel.toLowerCase()} to get started.</p>`);
    lines.push(`              </div>`);
    lines.push(`            ) : (`);
    lines.push(`              <div className="divide-y divide-[var(--border)]">`);
    lines.push(`                {${modelPlural}.map(item => (`);
    lines.push(`                  <div key={item.id} className="flex items-center justify-between p-4 hover:bg-[var(--hover)] transition-colors">`);
    // Show first few fields
    const displayFields = binding.formFields.slice(0, 3);
    if (displayFields.length > 0) {
      lines.push(`                    <div className="min-w-0 flex-1">`);
      for (const f of displayFields) {
        if (f === displayFields[0]) {
          lines.push(`                      <div className="font-medium truncate">{item.${f.name}}</div>`);
        } else {
          lines.push(`                      <div className="text-sm text-[var(--muted)] truncate">{item.${f.name}}</div>`);
        }
      }
      lines.push(`                    </div>`);
    } else {
      lines.push(`                    <div className="font-medium">{item.id}</div>`);
    }
    lines.push(`                    <div className="flex items-center gap-1 ml-4 shrink-0">`);
    if (putFnName) {
      lines.push(`                      <button onClick={() => setEditId(item.id)} className="p-2 rounded-lg hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors" title="Edit">`);
      lines.push(`                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>`);
      lines.push(`                      </button>`);
    }
    if (deleteFnName) {
      if (isAdminResource) {
        // C2/G5: Wrap delete button in admin role check
        lines.push(`                      {user?.role === 'admin' && (`);
        lines.push(`                        <button onClick={() => setDeleteId(item.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 transition-colors" title="Delete">`);
        lines.push(`                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>`);
        lines.push(`                        </button>`);
        lines.push(`                      )}`);
      } else {
        lines.push(`                      <button onClick={() => setDeleteId(item.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 transition-colors" title="Delete">`);
        lines.push(`                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>`);
        lines.push(`                      </button>`);
      }
    }
    lines.push(`                    </div>`);
    lines.push(`                  </div>`);
    lines.push(`                ))}`);
    lines.push(`              </div>`);
    lines.push(`            )}`);
    lines.push(`          </div>`);
    lines.push('        )}');

    // C3/G9: Pagination controls in generic CRUD path
    if (getFnName) {
      for (const l of renderPaginationControls(8)) lines.push(l);
    }

    lines.push(`      </div>`);

  // Delete confirmation modal
  if (deleteFnName) {
    lines.push('');
    lines.push('      {/* Delete confirmation modal */}');
    lines.push('      {deleteId !== null && (');
    lines.push('        <div className="modal-backdrop" onClick={() => setDeleteId(null)}>');
    lines.push('          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>');
    lines.push(`            <h3 className="text-lg font-semibold mb-2">Delete ${singularLabel}</h3>`);
    lines.push(`            <p className="text-sm text-[var(--muted)] mb-6">Are you sure you want to delete this ${singularLabel.toLowerCase()}? This action cannot be undone.</p>`);
    lines.push('            <div className="flex justify-end gap-3">');
    lines.push('              <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-[var(--radius)] border border-[var(--border)] hover:bg-[var(--hover)] text-sm font-medium transition-colors">Cancel</button>');
    lines.push('              <button onClick={() => handleDelete(deleteId)} className="px-4 py-2 rounded-[var(--radius)] bg-red-500 text-white hover:bg-red-600 text-sm font-medium transition-colors">Delete</button>');
    lines.push('            </div>');
    lines.push('          </div>');
    lines.push('        </div>');
    lines.push('      )}');
  }

  lines.push(hasLayout ? '    </Layout>' : '    </div>');
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/** C3/G9: Generate pagination controls JSX */
function renderPaginationControls(indent: number): string[] {
  const pad = ' '.repeat(indent);
  return [
    `${pad}{/* C3/G9: Pagination controls */}`,
    `${pad}<div className="flex items-center justify-between pt-4">`,
    `${pad}  <p className="text-sm text-[var(--muted)]">Page {pageNum} of {totalPages}</p>`,
    `${pad}  <div className="flex gap-2">`,
    `${pad}    <button onClick={() => setPageNum(p => Math.max(1, p - 1))} disabled={pageNum <= 1} className="px-3 py-1.5 rounded-[var(--radius)] border border-[var(--border)] text-sm hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Prev</button>`,
    `${pad}    <button onClick={() => setPageNum(p => Math.min(totalPages, p + 1))} disabled={pageNum >= totalPages} className="px-3 py-1.5 rounded-[var(--radius)] border border-[var(--border)] text-sm hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>`,
    `${pad}  </div>`,
    `${pad}</div>`,
  ];
}

/** Render a single form field with smart type mapping */
function renderFormField(field: FormFieldInfo, binding: PageResourceBinding, indent: number): string {
  const pad = ' '.repeat(indent);
  const label = field.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const placeholder = `Enter ${label.toLowerCase()}...`;
  // T1.3: Required attribute from @db :required modifier
  const reqAttr = field.required ? ' required' : '';
  // C2/G7: Inline validation error message for required fields
  const errorLine = field.required
    ? `\n${pad}  {fieldErrors.${field.name} && <p className="text-xs text-red-400 mt-1">{fieldErrors.${field.name}}</p>}`
    : '';

  if (field.type === 'select' && field.enumValues) {
    return `${pad}<div>\n`
      + `${pad}  <label className="block text-sm font-medium mb-1.5">${label}</label>\n`
      + `${pad}  <select name="${field.name}"${reqAttr} className="w-full border border-[var(--border-input)] rounded-[var(--radius)] px-3.5 py-2.5 bg-transparent text-sm">\n`
      + field.enumValues.map(v => `${pad}    <option value="${v}">${capitalize(v)}</option>`).join('\n') + '\n'
      + `${pad}  </select>${errorLine}\n`
      + `${pad}</div>`;
  }
  if (field.type === 'checkbox') {
    return `${pad}<label className="flex items-center gap-3 text-sm cursor-pointer">\n`
      + `${pad}  <input type="checkbox" name="${field.name}" className="rounded" />\n`
      + `${pad}  <span className="font-medium">${label}</span>\n`
      + `${pad}</label>`;
  }
  if (field.type === 'textarea') {
    return `${pad}<div>\n`
      + `${pad}  <label className="block text-sm font-medium mb-1.5">${label}</label>\n`
      + `${pad}  <textarea name="${field.name}"${reqAttr} rows="3" placeholder="${placeholder}" className="w-full border border-[var(--border-input)] rounded-[var(--radius)] px-3.5 py-2.5 bg-transparent text-sm resize-y" />${errorLine}\n`
      + `${pad}</div>`;
  }

  return `${pad}<div>\n`
    + `${pad}  <label className="block text-sm font-medium mb-1.5">${label}</label>\n`
    + `${pad}  <input type="${field.type}" name="${field.name}"${reqAttr} placeholder="${placeholder}" className="w-full border border-[var(--border-input)] rounded-[var(--radius)] px-3.5 py-2.5 bg-transparent text-sm" />${errorLine}\n`
    + `${pad}</div>`;
}

/** Check if a node is just a heading (h1-h6 with text content). */
function isHeadingOnly(node: AirUINode): boolean {
  const headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  if (node.kind === 'element' && headings.includes(node.element)) return true;
  // h1>"Title" is binary '>' with left=h1
  if (node.kind === 'binary' && node.operator === '>') {
    const left = node.left;
    if (left.kind === 'element' && headings.includes(left.element)) return true;
    const resolved = tryResolveElement(left);
    if (resolved && headings.includes(resolved.element)) return true;
  }
  return false;
}

// ---- Form / Sidebar Detection Helpers ----

/** Shallow form detection — form is a direct child of the page. */
function hasFormShallow(nodes: AirUINode[]): boolean {
  return nodes.some(c => {
    if (c.kind === 'element' && c.element === 'form') return true;
    if (c.kind === 'binary' && c.operator === '>') {
      const left = c.left;
      if (left.kind === 'element' && left.element === 'form') return true;
      const resolved = tryResolveElement(left);
      if (resolved && resolved.element === 'form') return true;
    }
    return false;
  });
}

/** Recursively check if any node in the tree is a form element. */
function hasFormDeep(nodes: AirUINode[]): boolean {
  for (const node of nodes) {
    const resolved = tryResolveElement(node);
    if (resolved && resolved.element === 'form') return true;
    if (node.kind === 'binary') {
      if (hasFormDeep([node.left]) || hasFormDeep([node.right])) return true;
    }
    if ('children' in node && node.children) return hasFormDeep(node.children as AirUINode[]);
  }
  return false;
}

/** Check if a node contains a sidebar element (direct or inside compose). */
function hasSidebarNode(node: AirUINode): boolean {
  const resolved = tryResolveElement(node);
  if (resolved && resolved.element === 'sidebar') return true;
  if (node.kind === 'binary' && node.operator === '+') {
    return hasSidebarNode(node.left) || hasSidebarNode(node.right);
  }
  if (node.kind === 'binary' && node.operator === '>') {
    return hasSidebarNode(node.left);
  }
  return false;
}

/** Extract main content children when page has sidebar+main layout.
 *  Strips sidebar and main wrapper, returning only the inner content. */
function extractMainContent(children: AirUINode[]): AirUINode[] | null {
  for (const child of children) {
    if (child.kind === 'binary' && child.operator === '+') {
      if (hasSidebarNode(child.left)) {
        const mainNode = child.right;
        const resolved = tryResolveElement(mainNode);
        if (resolved && resolved.element === 'main') {
          // main > children (flow chain): extract the right side
          if (mainNode.kind === 'binary' && mainNode.operator === '>') {
            return [mainNode.right];
          }
          // main(children) (element with child array): extract children directly
          if (mainNode.kind === 'element' && mainNode.children && mainNode.children.length > 0) {
            return mainNode.children;
          }
        }
        return [mainNode];
      }
    }
  }
  return null;
}

/**
 * Scan generated JSX for state variable references that weren't declared.
 * Returns array of { name, defaultVal } for useState declarations needed.
 */
function detectUndeclaredStateVars(
  jsx: string,
  declaredVars: Set<string>,
  ctx: TranspileContext,
): { name: string; defaultVal: string }[] {
  const result: { name: string; defaultVal: string }[] = [];
  const seen = new Set<string>();
  const varRefs = new Set<string>();

  // Find setter calls: setXyz(...) → xyz is a state var
  const setterPattern = /\bset([A-Z]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = setterPattern.exec(jsx)) !== null) {
    const varName = m[1].charAt(0).toLowerCase() + m[1].slice(1);
    varRefs.add(varName);
  }

  // Find value={varName} patterns
  const valuePattern = /value=\{(\w+)(?:[.?]|}\s)/g;
  while ((m = valuePattern.exec(jsx)) !== null) {
    varRefs.add(m[1]);
  }

  // Find {varName.something} patterns (state object access)
  const accessPattern = /\{(\w+)\.\w+/g;
  while ((m = accessPattern.exec(jsx)) !== null) {
    const name = m[1];
    if (!['api', 'Math', 'JSON', 'console', 'window', 'document', 'e', 'item', '_item', 'row', 'prev'].includes(name)) {
      varRefs.add(name);
    }
  }

  // Find {varName === 'x'} patterns (filter/tab state)
  const eqPattern = /\{(\w+)\s*===\s/g;
  while ((m = eqPattern.exec(jsx)) !== null) {
    const name = m[1];
    if (!['currentPage', 'item', '_item', 'row', '_tab'].includes(name)) {
      varRefs.add(name);
    }
  }

  // Find variables in filter callbacks: => varName === 'all' || _item.field === varName
  const filterCallbackPattern = /=>\s+(\w+)\s*===\s*'all'/g;
  while ((m = filterCallbackPattern.exec(jsx)) !== null) {
    const name = m[1];
    if (!['currentPage', 'item', '_item', 'row', '_tab'].includes(name)) {
      varRefs.add(name);
    }
  }

  // Find {varName.filter(} or {varName.map(} patterns (array state)
  const arrayPattern = /\{(\w+)\.(?:filter|map|length|sort|slice|find|reduce)\b/g;
  while ((m = arrayPattern.exec(jsx)) !== null) {
    const name = m[1];
    if (!['api', 'Math', 'JSON', 'console', 'e', 'Object', 'Array', 'String'].includes(name)) {
      varRefs.add(name);
    }
  }

  // Find (varName).method() patterns — e.g., (cartTotal).toFixed(2)
  const parenAccessPattern = /\((\w+)\)\.(?:toFixed|toString|toLocaleString|valueOf)\b/g;
  while ((m = parenAccessPattern.exec(jsx)) !== null) {
    const name = m[1];
    if (!['api', 'Math', 'JSON', 'console', 'e', 'item', '_item', 'row', 'prev'].includes(name)) {
      varRefs.add(name);
    }
  }

  for (const varName of varRefs) {
    if (declaredVars.has(varName) || seen.has(varName)) continue;
    seen.add(varName);

    const stateField = ctx.state.find(f => f.name === varName);
    let defaultVal = "''";

    if (stateField) {
      if (stateField.type.kind === 'array') defaultVal = '[]';
      else if (stateField.type.kind === 'object') defaultVal = '{}';
      else if (stateField.type.kind === 'bool') defaultVal = 'false';
      else if (stateField.type.kind === 'int' || stateField.type.kind === 'float') defaultVal = '0';
      else if (stateField.type.kind === 'optional') defaultVal = 'null';
      else if (stateField.type.kind === 'enum') defaultVal = "'all'";
      else if ('default' in stateField.type && stateField.type.default !== undefined) defaultVal = JSON.stringify(stateField.type.default);
    } else {
      if (varName.toLowerCase().includes('filter') || varName.toLowerCase().includes('status')) {
        defaultVal = "'all'";
      } else if (/(?:total|count|amount|sum|price|quantity|num|avg|min|max)$/i.test(varName)) {
        defaultVal = '0';
      } else if (varName.endsWith('s') && varName.length > 2) {
        defaultVal = '[]';
      }
    }

    result.push({ name: varName, defaultVal });
  }

  return result;
}
