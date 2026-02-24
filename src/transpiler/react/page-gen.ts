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
  lines.push(`// Generated by AirEngine — ${pageName} page component`);

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
    lines.push('    <div className="flex items-center justify-center min-h-screen p-4">');
    lines.push('      <div className="w-full max-w-md space-y-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-8">');
    lines.push(`        <h2 className="text-2xl font-bold text-center">${capitalize(page.name)}</h2>`);
    const childJsx = page.children.map(c => generateJSX(c, ctx, analysis, ROOT_SCOPE, 8)).filter(Boolean).join('\n');
    lines.push(childJsx);
    lines.push('      </div>');
    lines.push('    </div>');
  } else if (isDeepForm && !hasSidebar) {
    lines.push('    <div className="flex items-center justify-center min-h-screen p-4">');
    const childJsx = page.children.map(c => generateJSX(c, ctx, analysis, ROOT_SCOPE, 6)).filter(Boolean).join('\n');
    lines.push(childJsx);
    lines.push('    </div>');
  } else if (hasSidebar) {
    lines.push('    <div className="flex min-h-screen">');
    const sidebarScope: Scope = { ...ROOT_SCOPE, insideSidebarPage: true };
    const childJsx = page.children.map(c => generateJSX(c, ctx, analysis, sidebarScope, 6)).filter(Boolean).join('\n');
    lines.push(childJsx);
    lines.push('    </div>');
  } else {
    lines.push('    <div>');
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
  lines.push(`// Generated by AirEngine — ${pageName} page component`);
  lines.push("import { useState, useEffect } from 'react';");
  lines.push("import * as api from '../api.js';");
  lines.push("import Layout from '../Layout.jsx';");
  lines.push('');
  lines.push(`export default function ${pageName}Page({ user, logout, currentPage, setCurrentPage }) {`);

  // State for each data source
  const declaredVars = new Set<string>(['user', 'logout', 'currentPage', 'setCurrentPage']);
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
  for (const ds of binding.dataSources) {
    lines.push(`    api.${ds.getFnName}().then(set${capitalize(ds.stateVar)}).catch(console.error);`);
  }
  lines.push('  }, []);');
  lines.push('');

  // Render with Layout wrapping — sidebar filtered since Layout provides it
  lines.push('  return (');
  lines.push('    <Layout user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}>');

  if (childJsx.trim()) {
    lines.push('      <div className="space-y-6">');
    lines.push(childJsx);
    lines.push('      </div>');
  }

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

  // Derive API function names
  const getFnName = binding.getRoute ? routeToFunctionName('GET', binding.getRoute.path) : null;
  const postFnName = binding.postRoute ? routeToFunctionName('POST', binding.postRoute.path) : null;
  const putFnName = binding.putRoute ? routeToFunctionName('PUT', binding.putRoute.path) : null;
  const deleteFnName = binding.deleteRoute ? routeToFunctionName('DELETE', binding.deleteRoute.path) : null;

  lines.push(`// Generated by AirEngine — ${pageName} page component`);
  lines.push("import { useState, useEffect } from 'react';");
  lines.push("import * as api from '../api.js';");
  lines.push("import Layout from '../Layout.jsx';");
  lines.push('');
  lines.push(`export default function ${pageName}Page({ user, logout, currentPage, setCurrentPage }) {`);

  // Local state
  const declaredVars = new Set<string>(['user', 'logout', 'currentPage', 'setCurrentPage']);
  lines.push(`  const [${modelPlural}, set${capitalize(modelPlural)}] = useState([]);`);
  declaredVars.add(modelPlural);
  declaredVars.add('set' + capitalize(modelPlural));
  if (postFnName) {
    lines.push('  const [showForm, setShowForm] = useState(false);');
    declaredVars.add('showForm'); declaredVars.add('setShowForm');
  }
  if (putFnName) {
    lines.push('  const [editId, setEditId] = useState(null);');
    declaredVars.add('editId'); declaredVars.add('setEditId');
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
    lines.push(`  const load = () => api.${getFnName}().then(set${capitalize(modelPlural)}).catch(console.error);`);
    lines.push('');
    lines.push('  useEffect(() => { load(); }, []);');
    lines.push('');
  }

  // Create handler
  if (postFnName && getFnName) {
    lines.push('  const handleCreate = async (e) => {');
    lines.push('    e.preventDefault();');
    lines.push('    const fd = Object.fromEntries(new FormData(e.target));');
    // Convert numeric fields
    for (const f of binding.formFields) {
      if (f.type === 'number') {
        lines.push(`    if (fd.${f.name}) fd.${f.name} = Number(fd.${f.name});`);
      }
    }
    lines.push(`    await api.${postFnName}(fd);`);
    lines.push('    e.target.reset();');
    lines.push('    setShowForm(false);');
    lines.push('    load();');
    lines.push('  };');
    lines.push('');
  }

  // Update handler
  if (putFnName && getFnName) {
    lines.push('  const handleUpdate = async (e) => {');
    lines.push('    e.preventDefault();');
    lines.push('    const fd = Object.fromEntries(new FormData(e.target));');
    for (const f of binding.formFields) {
      if (f.type === 'number') {
        lines.push(`    if (fd.${f.name}) fd.${f.name} = Number(fd.${f.name});`);
      }
    }
    lines.push(`    await api.${putFnName}(editId, fd);`);
    lines.push('    setEditId(null);');
    lines.push('    load();');
    lines.push('  };');
    lines.push('');
  }

  // Delete handler
  if (deleteFnName && getFnName) {
    lines.push('  const handleDelete = async (id) => {');
    lines.push(`    if (!window.confirm('Delete this ${modelSingular.toLowerCase()}?')) return;`);
    lines.push(`    await api.${deleteFnName}(id);`);
    lines.push('    load();');
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
    lines.push('      <div className="space-y-6">');
    // Inject create form toggle when POST route exists but custom UI doesn't include one
    if (postFnName && !hasFormInJsx) {
      lines.push(`        <div className="flex items-center justify-between">`);
      lines.push(`          <h1 className="text-2xl font-bold">${capitalize(modelPlural)}</h1>`);
      lines.push(`          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-[var(--radius)]">`);
      lines.push(`            {showForm ? 'Cancel' : 'Add ${modelSingular}'}`);
      lines.push(`          </button>`);
      lines.push(`        </div>`);
      if (binding.formFields.length > 0) {
        lines.push(`        {showForm && (`);
        lines.push(`          <form onSubmit={handleCreate} className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)] space-y-3">`);
        for (const field of binding.formFields) {
          lines.push(renderFormField(field, 12));
        }
        lines.push(`            <button type="submit" className="px-4 py-2 bg-[var(--accent)] text-white rounded-[var(--radius)]">Create</button>`);
        lines.push(`          </form>`);
        lines.push(`        )}`);
      }
    }
    lines.push(childJsx);
    lines.push('      </div>');
  } else {
    // If no UI tree content, generate a default CRUD view
    lines.push(`      <div className="space-y-6">`);
    lines.push(`        <div className="flex items-center justify-between">`);
    lines.push(`          <h1 className="text-2xl font-bold">${capitalize(modelPlural)}</h1>`);
    if (postFnName) {
      lines.push(`          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-[var(--radius)]">`);
      lines.push(`            {showForm ? 'Cancel' : 'Add ${modelSingular}'}`);
      lines.push(`          </button>`);
    }
    lines.push(`        </div>`);

    // Inline form
    if (postFnName && binding.formFields.length > 0) {
      lines.push(`        {showForm && (`);
      lines.push(`          <form onSubmit={handleCreate} className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)] space-y-3">`);
      for (const field of binding.formFields) {
        lines.push(renderFormField(field, 12));
      }
      lines.push(`            <button type="submit" className="px-4 py-2 bg-[var(--accent)] text-white rounded-[var(--radius)]">Create</button>`);
      lines.push(`          </form>`);
      lines.push(`        )}`);
    }

    // Data list
    lines.push(`        <div className="space-y-2">`);
    lines.push(`          {${modelPlural}.map(item => (`);
    lines.push(`            <div key={item.id} className="flex items-center justify-between p-3 border border-[var(--border)] rounded-[var(--radius)]">`);
    // Show first few fields
    const displayFields = binding.formFields.slice(0, 3);
    if (displayFields.length > 0) {
      lines.push(`              <div>`);
      for (const f of displayFields) {
        if (f === displayFields[0]) {
          lines.push(`                <div className="font-medium">{item.${f.name}}</div>`);
        } else {
          lines.push(`                <div className="text-sm text-[var(--muted)]">{item.${f.name}}</div>`);
        }
      }
      lines.push(`              </div>`);
    } else {
      lines.push(`              <div className="font-medium">{item.id}</div>`);
    }
    lines.push(`              <div className="flex gap-2">`);
    if (putFnName) {
      lines.push(`                <button onClick={() => setEditId(item.id)} className="text-sm text-[var(--accent)]">Edit</button>`);
    }
    if (deleteFnName) {
      lines.push(`                <button onClick={() => handleDelete(item.id)} className="text-sm text-red-400">Delete</button>`);
    }
    lines.push(`              </div>`);
    lines.push(`            </div>`);
    lines.push(`          ))}`);
    lines.push(`        </div>`);
    lines.push(`      </div>`);
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

  if (field.type === 'select' && field.enumValues) {
    return `${pad}<label className="block text-sm font-medium">${label}\n`
      + `${pad}  <select name="${field.name}" className="mt-1 block w-full border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent">\n`
      + field.enumValues.map(v => `${pad}    <option value="${v}">${capitalize(v)}</option>`).join('\n') + '\n'
      + `${pad}  </select>\n`
      + `${pad}</label>`;
  }
  if (field.type === 'checkbox') {
    return `${pad}<label className="flex items-center gap-2 text-sm">\n`
      + `${pad}  <input type="checkbox" name="${field.name}" />\n`
      + `${pad}  ${label}\n`
      + `${pad}</label>`;
  }
  if (field.type === 'textarea') {
    return `${pad}<label className="block text-sm font-medium">${label}\n`
      + `${pad}  <textarea name="${field.name}" rows="3" className="mt-1 block w-full border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent" />\n`
      + `${pad}</label>`;
  }

  return `${pad}<label className="block text-sm font-medium">${label}\n`
    + `${pad}  <input type="${field.type}" name="${field.name}" className="mt-1 block w-full border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent" />\n`
    + `${pad}</label>`;
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
