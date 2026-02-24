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
import { resolveBindChain } from '../normalize-ui.js';
import { routeToFunctionName } from '../route-utils.js';
import {
  capitalize, pluralize, toCamelCase, camelToLabel, ROOT_SCOPE,
  analyzePageDependencies, getHookableStateProps,
  tryResolveElement, isAuthPageName, hasAuthRoutes,
  inferModelFieldsFromDataSource,
  Scope,
} from './helpers.js';
import { generateJSX } from './jsx-gen.js';

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
    .map(f => fieldTypeToInputType(f))
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

  for (const page of analysis.pages) {
    const pageName = capitalize(page.name);
    const deps = analyzePageDependencies(page.children, ctx, analysis);
    const binding = hasAuthGating ? detectPageResource(page.name, ctx, analysis, deps) : null;

    if (hasAuthGating && binding && !binding.isAuthPage) {
      // ---- Self-contained page (auth-gated mode) ----
      files.push({
        path: `src/pages/${pageName}Page.jsx`,
        content: binding.isDashboard
          ? generateDashboardPage(pageName, page, ctx, analysis, binding)
          : generateCrudPage(pageName, page, ctx, analysis, binding),
      });
    } else {
      // ---- Original behavior (auth pages or non-auth-gated apps) ----
      files.push({
        path: `src/pages/${pageName}Page.jsx`,
        content: generateOriginalPage(pageName, page, ctx, analysis, deps, hookMap, hasAuth),
      });
    }
  }

  return files;
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
    // Auth-style centered form page
    lines.push('    <div className="flex items-center justify-center min-h-screen p-4 bg-[var(--bg)]">');
    lines.push('      <div className="w-full max-w-md animate-fade-in">');
    lines.push('        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-lg space-y-6">');
    const childJsx = page.children.map(c => generateJSX(c, ctx, analysis, ROOT_SCOPE, 10)).filter(Boolean).join('\n');
    lines.push(childJsx);
    lines.push('        </div>');
    lines.push('      </div>');
    lines.push('    </div>');
  } else if (isDeepForm && !hasSidebar) {
    lines.push('    <div className="flex items-center justify-center min-h-screen p-4 bg-[var(--bg)]">');
    lines.push('      <div className="w-full max-w-md animate-fade-in">');
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
): string {
  const lines: string[] = [];
  // Note: provenance header is prepended by transpiler orchestrator
  lines.push("import { useState, useEffect } from 'react';");
  lines.push("import * as api from '../api.js';");
  lines.push("import Layout from '../Layout.jsx';");
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
  const childJsx = mainChildren.map(c =>
    generateJSX(c, ctx, analysis, ROOT_SCOPE, 6)
  ).filter(Boolean).join('\n');

  // Scan JSX for undeclared state variables and add them
  const extraState = detectUndeclaredStateVars(childJsx, declaredVars, ctx);
  for (const { name, defaultVal } of extraState) {
    lines.push(`  const [${name}, set${capitalize(name)}] = useState(${defaultVal});`);
    declaredVars.add(name);
  }
  lines.push('');

  // Parallel fetch on mount
  lines.push('  useEffect(() => {');
  lines.push('    Promise.all([');
  for (const ds of binding.dataSources) {
    lines.push(`      api.${ds.getFnName}().then(set${capitalize(ds.stateVar)}),`);
  }
  lines.push('    ])');
  lines.push('      .catch(console.error)');
  lines.push('      .finally(() => setLoading(false));');
  lines.push('  }, []);');
  lines.push('');

  // Render with Layout wrapping — sidebar filtered since Layout provides it
  lines.push('  return (');
  lines.push('    <Layout user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}>');

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
  lines.push('    </Layout>');
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

  // Note: provenance header is prepended by transpiler orchestrator
  lines.push("import { useState, useEffect } from 'react';");
  lines.push("import * as api from '../api.js';");
  lines.push("import Layout from '../Layout.jsx';");
  lines.push('');
  lines.push(`export default function ${pageName}Page({ user, logout, currentPage, setCurrentPage }) {`);

  // Local state
  const declaredVars = new Set<string>(['user', 'logout', 'currentPage', 'setCurrentPage']);
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
  // Mark handler names as known
  if (postFnName) declaredVars.add('handleCreate');
  if (putFnName) declaredVars.add('handleUpdate');
  if (deleteFnName) declaredVars.add('handleDelete');

  // Pre-scan child JSX for undeclared state vars
  const preChildren = page.children.filter(c => !hasSidebarNode(c));
  const preMain = extractMainContent(page.children) || preChildren;
  const preJsx = preMain.map(c =>
    generateJSX(c, ctx, analysis, ROOT_SCOPE, 6)
  ).filter(Boolean).join('\n');
  const extraState = detectUndeclaredStateVars(preJsx, declaredVars, ctx);
  for (const { name, defaultVal } of extraState) {
    lines.push(`  const [${name}, set${capitalize(name)}] = useState(${defaultVal});`);
    declaredVars.add(name);
  }

  // Alias mutation names from JSX to generated handlers
  if (deleteFnName) {
    lines.push('  const del = handleDelete;');
  }
  lines.push('');

  // Load function
  if (getFnName) {
    lines.push(`  const load = async () => {`);
    lines.push('    try {');
    lines.push(`      const data = await api.${getFnName}();`);
    lines.push(`      set${capitalize(modelPlural)}(data);`);
    lines.push('    } catch (err) {');
    lines.push('      console.error(err);');
    lines.push('    } finally {');
    lines.push('      setLoading(false);');
    lines.push('    }');
    lines.push('  };');
    lines.push('');
    lines.push('  useEffect(() => { load(); }, []);');
    lines.push('');
  }

  // Create handler
  if (postFnName && getFnName) {
    lines.push('  const handleCreate = async (e) => {');
    lines.push('    e.preventDefault();');
    lines.push('    setSubmitting(true);');
    lines.push('    try {');
    lines.push('      const fd = Object.fromEntries(new FormData(e.target));');
    // Convert numeric fields
    for (const f of binding.formFields) {
      if (f.type === 'number') {
        lines.push(`      if (fd.${f.name}) fd.${f.name} = Number(fd.${f.name});`);
      }
    }
    lines.push(`      await api.${postFnName}(fd);`);
    lines.push('      e.target.reset();');
    lines.push('      setShowForm(false);');
    lines.push('      load();');
    lines.push('    } catch (err) {');
    lines.push('      console.error(err);');
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
    lines.push('    try {');
    lines.push('      const fd = Object.fromEntries(new FormData(e.target));');
    for (const f of binding.formFields) {
      if (f.type === 'number') {
        lines.push(`      if (fd.${f.name}) fd.${f.name} = Number(fd.${f.name});`);
      }
    }
    lines.push(`      await api.${putFnName}(editId, fd);`);
    lines.push('      setEditId(null);');
    lines.push('      load();');
    lines.push('    } catch (err) {');
    lines.push('      console.error(err);');
    lines.push('    }');
    lines.push('  };');
    lines.push('');
  }

  // Delete handler — uses modal instead of window.confirm
  if (deleteFnName && getFnName) {
    lines.push('  const handleDelete = async (id) => {');
    lines.push('    try {');
    lines.push(`      await api.${deleteFnName}(id);`);
    lines.push('      setDeleteId(null);');
    lines.push('      load();');
    lines.push('    } catch (err) {');
    lines.push('      console.error(err);');
    lines.push('    }');
    lines.push('  };');
    lines.push('');
  }

  // Render
  lines.push('  return (');
  lines.push('    <Layout user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}>');

  // Filter out sidebar/main wrappers since Layout provides them
  const filteredChildren = page.children.filter(c => !hasSidebarNode(c));
  const mainChildren = extractMainContent(page.children) || filteredChildren;
  const childJsx = mainChildren.map(c =>
    generateJSX(c, ctx, analysis, ROOT_SCOPE, 6)
  ).filter(Boolean).join('\n');

  if (childJsx.trim()) {
    // Check if custom UI already has a form element or references showForm toggle
    const hasFormInJsx = childJsx.includes('onSubmit') || childJsx.includes('<form');
    lines.push('      <div className="space-y-6 animate-fade-in">');
    // Inject create form toggle when POST route exists but custom UI doesn't include one
    if (postFnName && !hasFormInJsx) {
      lines.push(`        <div className="flex items-center justify-between">`);
      lines.push(`          <div>`);
      lines.push(`            <h1 className="text-2xl font-bold tracking-tight">${modelLabel}</h1>`);
      lines.push(`            <p className="text-sm text-[var(--muted)] mt-1">{${modelPlural}.length} ${modelPlural} total</p>`);
      lines.push(`          </div>`);
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
      lines.push(`        </div>`);
      if (binding.formFields.length > 0) {
        lines.push(`        {showForm && (`);
        lines.push(`          <form onSubmit={handleCreate} className="p-6 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)] space-y-4 animate-slide-up">`);
        lines.push(`            <h3 className="text-lg font-semibold mb-2">New ${singularLabel}</h3>`);
        for (const field of binding.formFields) {
          lines.push(renderFormField(field, 12));
        }
        lines.push(`            <div className="flex justify-end gap-3 pt-2">`);
        lines.push(`              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-[var(--radius)] border border-[var(--border)] hover:bg-[var(--hover)] text-sm font-medium transition-colors">Cancel</button>`);
        lines.push(`              <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-[var(--accent)] text-white rounded-[var(--radius)] text-sm font-medium hover:opacity-90 transition-colors disabled:opacity-50">{submitting ? 'Creating...' : 'Create ${singularLabel}'}</button>`);
        lines.push(`            </div>`);
        lines.push(`          </form>`);
        lines.push(`        )}`);
      }
    }
    lines.push(childJsx);
    lines.push('      </div>');
  } else {
    // If no UI tree content, generate a default CRUD view
    lines.push(`      <div className="space-y-6 animate-fade-in">`);
    lines.push(`        <div className="flex items-center justify-between">`);
    lines.push(`          <div>`);
    lines.push(`            <h1 className="text-2xl font-bold tracking-tight">${modelLabel}</h1>`);
    lines.push(`            <p className="text-sm text-[var(--muted)] mt-1">{loading ? 'Loading...' : \`\${${modelPlural}.length} ${modelPlural} total\`}</p>`);
    lines.push(`          </div>`);
    if (postFnName) {
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
    lines.push(`        </div>`);

    // Inline form with animation
    if (postFnName && binding.formFields.length > 0) {
      lines.push(`        {showForm && (`);
      lines.push(`          <form onSubmit={handleCreate} className="p-6 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)] space-y-4 animate-slide-up">`);
      lines.push(`            <h3 className="text-lg font-semibold mb-2">New ${singularLabel}</h3>`);
      for (const field of binding.formFields) {
        lines.push(renderFormField(field, 12));
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
      lines.push(`                      <button onClick={() => setDeleteId(item.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 transition-colors" title="Delete">`);
      lines.push(`                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>`);
      lines.push(`                      </button>`);
    }
    lines.push(`                    </div>`);
    lines.push(`                  </div>`);
    lines.push(`                ))}`);
    lines.push(`              </div>`);
    lines.push(`            )}`);
    lines.push(`          </div>`);
    lines.push('        )}');
    lines.push(`      </div>`);
  }

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

  lines.push('    </Layout>');
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/** Render a single form field with smart type mapping */
function renderFormField(field: FormFieldInfo, indent: number): string {
  const pad = ' '.repeat(indent);
  const label = field.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const placeholder = `Enter ${label.toLowerCase()}...`;

  if (field.type === 'select' && field.enumValues) {
    return `${pad}<div>\n`
      + `${pad}  <label className="block text-sm font-medium mb-1.5">${label}</label>\n`
      + `${pad}  <select name="${field.name}" className="w-full border border-[var(--border-input)] rounded-[var(--radius)] px-3.5 py-2.5 bg-transparent text-sm">\n`
      + field.enumValues.map(v => `${pad}    <option value="${v}">${capitalize(v)}</option>`).join('\n') + '\n'
      + `${pad}  </select>\n`
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
      + `${pad}  <textarea name="${field.name}" rows="3" placeholder="${placeholder}" className="w-full border border-[var(--border-input)] rounded-[var(--radius)] px-3.5 py-2.5 bg-transparent text-sm resize-y" />\n`
      + `${pad}</div>`;
  }

  return `${pad}<div>\n`
    + `${pad}  <label className="block text-sm font-medium mb-1.5">${label}</label>\n`
    + `${pad}  <input type="${field.type}" name="${field.name}" placeholder="${placeholder}" className="w-full border border-[var(--border-input)] rounded-[var(--radius)] px-3.5 py-2.5 bg-transparent text-sm" />\n`
    + `${pad}</div>`;
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

/** Extract main content children when page has sidebar+main layout. */
function extractMainContent(children: AirUINode[]): AirUINode[] | null {
  for (const child of children) {
    if (child.kind === 'binary' && child.operator === '+') {
      if (hasSidebarNode(child.left)) {
        const mainNode = child.right;
        const resolved = tryResolveElement(mainNode);
        if (resolved && resolved.element === 'main' && mainNode.kind === 'binary' && mainNode.operator === '>') {
          return [mainNode.right];
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

  // Find {varName.filter(} or {varName.map(} patterns (array state)
  const arrayPattern = /\{(\w+)\.(?:filter|map|length|sort|slice|find|reduce)\b/g;
  while ((m = arrayPattern.exec(jsx)) !== null) {
    const name = m[1];
    if (!['api', 'Math', 'JSON', 'console', 'e', 'Object', 'Array', 'String'].includes(name)) {
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
      } else if (varName.endsWith('s') && varName.length > 2) {
        defaultVal = '[]';
      }
    }

    result.push({ name: varName, defaultVal });
  }

  return result;
}
