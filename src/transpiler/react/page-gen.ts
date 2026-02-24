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
  capitalize, pluralize, ROOT_SCOPE,
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
        const resource = r.path.replace(/^\//, '').split('/').pop() || '';
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

  // Build prop names: exclude hook-covered state vars + their setters
  const propNames: string[] = [];
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

  // Add authError props for login/register pages
  const isAuth = isAuthPageName(page.name);
  if (isAuth && ctxHasAuth) {
    if (!propNames.includes('authError')) propNames.push('authError');
    if (!propNames.includes('setAuthError')) propNames.push('setAuthError');
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
  for (const ds of binding.dataSources) {
    lines.push(`  const [${ds.stateVar}, set${capitalize(ds.stateVar)}] = useState([]);`);
  }
  lines.push('');

  // Parallel fetch on mount
  lines.push('  useEffect(() => {');
  for (const ds of binding.dataSources) {
    lines.push(`    api.${ds.getFnName}().then(set${capitalize(ds.stateVar)}).catch(console.error);`);
  }
  lines.push('  }, []);');
  lines.push('');

  // Render with Layout wrapping
  lines.push('  return (');
  lines.push('    <Layout user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}>');

  // Render original UI tree content inside Layout
  const childJsx = page.children.map(c =>
    generateJSX(c, ctx, analysis, ROOT_SCOPE, 6)
  ).filter(Boolean).join('\n');
  lines.push(childJsx);

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
  lines.push(`  const [${modelPlural}, set${capitalize(modelPlural)}] = useState([]);`);
  if (postFnName) {
    lines.push('  const [showForm, setShowForm] = useState(false);');
  }
  if (putFnName) {
    lines.push('  const [editId, setEditId] = useState(null);');
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
    lines.push(`    if (!confirm('Delete this ${modelSingular.toLowerCase()}?')) return;`);
    lines.push(`    await api.${deleteFnName}(id);`);
    lines.push('    load();');
    lines.push('  };');
    lines.push('');
  }

  // Render
  lines.push('  return (');
  lines.push('    <Layout user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}>');

  // Render original UI tree content inside Layout
  const childJsx = page.children.map(c =>
    generateJSX(c, ctx, analysis, ROOT_SCOPE, 6)
  ).filter(Boolean).join('\n');

  if (childJsx.trim()) {
    lines.push(childJsx);
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
