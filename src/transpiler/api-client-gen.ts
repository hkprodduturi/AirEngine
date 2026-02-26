/**
 * API Client Generator
 *
 * Generates client/src/api.js — a fetch wrapper per expanded API route
 * with a configurable base URL via VITE_API_BASE_URL.
 * Includes JSDoc type annotations, pagination support, search params,
 * proper error handling, and 204 (No Content) awareness.
 */

import type { TranspileContext } from './context.js';
import { routeToFunctionName, extractPathParams } from './route-utils.js';

export function generateApiClient(ctx: TranspileContext): string {
  const routes = ctx.expandedRoutes;
  const lines: string[] = [];
  const hasAuth = routes.some(r => r.path.includes('/auth/'));

  lines.push("const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';");
  lines.push('');

  // Custom error class for API errors
  lines.push('/** API error with status code and parsed body */');
  lines.push('export class ApiError extends Error {');
  lines.push('  constructor(status, body) {');
  lines.push("    super(body?.error || body?.message || `Request failed with status ${status}`);");
  lines.push('    this.status = status;');
  lines.push('    this.body = body;');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // Shared response handler
  lines.push('/** Parse response — handles JSON, 204 No Content, and errors */');
  lines.push('async function handleResponse(res) {');
  lines.push('  if (!res.ok) {');
  lines.push("    let body = {};");
  lines.push('    try { body = await res.json(); } catch { /* empty body */ }');
  lines.push('    throw new ApiError(res.status, body);');
  lines.push('  }');
  lines.push('  if (res.status === 204) return null;');
  lines.push("  const text = await res.text();");
  lines.push("  return text ? JSON.parse(text) : null;");
  lines.push('}');
  lines.push('');

  // Token management for authenticated apps
  if (hasAuth) {
    lines.push("let _token = localStorage.getItem('auth_token') || '';");
    lines.push('');
    lines.push("export function setToken(t) { _token = t; localStorage.setItem('auth_token', t); }");
    lines.push("export function getToken() { return _token; }");
    lines.push("export function clearToken() { _token = ''; localStorage.removeItem('auth_token'); }");
    lines.push('');
    lines.push('function authHeaders() {');
    lines.push("  const headers = { 'Content-Type': 'application/json' };");
    lines.push("  if (_token) headers['Authorization'] = `Bearer ${_token}`;");
    lines.push('  return headers;');
    lines.push('}');
    lines.push('');
  }

  const usedFnNames = new Set<string>();

  for (const route of routes) {
    const method = route.method;
    let fnName = routeToFunctionName(method, route.path);
    // Deduplicate function names (e.g., two routes mapping to same name)
    if (usedFnNames.has(fnName)) {
      let suffix = 2;
      while (usedFnNames.has(`${fnName}${suffix}`)) suffix++;
      fnName = `${fnName}${suffix}`;
    }
    usedFnNames.add(fnName);
    const pathParams = extractPathParams(route.path);
    const hasBody = (method === 'POST' || method === 'PUT') && route.params && route.params.length > 0;
    const isList = method === 'GET' && pathParams.length === 0 && isListHandler(route.handler);
    const isDelete = method === 'DELETE';
    const isAuthEndpoint = route.path.includes('/auth/');
    const isPublicEndpoint = route.path.startsWith('/public/');

    // JSDoc
    const modelName = extractModelFromHandler(route.handler);
    const isNestedList = method === 'GET' && isListHandler(route.handler) && pathParams.length > 0;
    const isAggregate = route.handler.endsWith('.aggregate');
    if (isAggregate) {
      lines.push(`/** @returns {Promise<Record<string, number>>} */`);
    } else if (modelName) {
      if (isList || isNestedList) {
        lines.push(`/** @returns {Promise<{ data: import('./types').${modelName}[], meta: { page: number, limit: number, total: number, totalPages: number } }>} */`);
      } else if (isDelete) {
        lines.push(`/** @returns {Promise<null>} */`);
      } else {
        lines.push(`/** @returns {Promise<import('./types').${modelName}>} */`);
      }
    }

    // Build function signature
    const wantsPagination = isList || isNestedList;
    const args: string[] = [];
    for (const p of pathParams) args.push(p);
    if (hasBody) args.push('data');
    if (wantsPagination) args.push('{ page, limit, search, sort, ...filters } = {}');
    const sig = args.join(', ');

    // Build URL expression
    const urlPath = route.path.replace(/:(\w+)/g, (_m, name) => `\${${name}}`);
    const urlExpr = pathParams.length > 0
      ? `\`\${API_BASE}${urlPath}\``
      : `\`\${API_BASE}${route.path}\``;

    lines.push(`export async function ${fnName}(${sig}) {`);

    // For list routes (including nested), build query string with pagination and search params
    if (wantsPagination) {
      lines.push('  const params = new URLSearchParams();');
      lines.push("  if (page !== undefined) params.set('page', String(page));");
      lines.push("  if (limit !== undefined) params.set('limit', String(limit));");
      lines.push("  if (search) params.set('search', search);");
      lines.push("  if (sort) params.set('sort', sort);");
      // C2/G4: Forward additional filter params (status, priority, etc.)
      lines.push("  Object.entries(filters || {}).forEach(([k, v]) => {");
      lines.push("    if (v !== undefined && v !== null && v !== '' && v !== 'all') params.set(k, String(v));");
      lines.push("  });");
      lines.push(`  const qs = params.toString();`);
      lines.push(`  const url = qs ? ${urlExpr} + '?' + qs : ${urlExpr};`);
    }

    // Use authHeaders() for non-auth, non-public endpoints; plain headers for auth/public endpoints
    const needsAuth = hasAuth && !isAuthEndpoint && !isPublicEndpoint;
    const headersExpr = needsAuth ? 'authHeaders()' : "{ 'Content-Type': 'application/json' }";

    if (method === 'GET' || method === 'DELETE') {
      const fetchUrl = wantsPagination ? 'url' : urlExpr;
      if (needsAuth) {
        const opts = method === 'DELETE'
          ? `{ method: 'DELETE', headers: authHeaders() }`
          : '{ headers: authHeaders() }';
        lines.push(`  const res = await fetch(${fetchUrl}, ${opts});`);
      } else {
        const fetchOpts = method === 'DELETE' ? `, { method: 'DELETE' }` : '';
        lines.push(`  const res = await fetch(${fetchUrl}${fetchOpts});`);
      }
    } else {
      lines.push(`  const res = await fetch(${urlExpr}, {`);
      lines.push(`    method: '${method}',`);
      lines.push(`    headers: ${headersExpr},`);
      if (hasBody) {
        lines.push(`    body: JSON.stringify(data),`);
      }
      lines.push('  });');
    }

    lines.push('  return handleResponse(res);');
    lines.push('}');
    lines.push('');
  }

  // C1/G3: Auto-generate singular fetch functions for models with nested child routes
  // E.g., GET /tickets/:id/replies exists → generate getTicket(id)
  if (ctx.db) {
    const nestedParents = new Set<string>();
    for (const route of routes) {
      const nestedMatch = route.path.match(/^\/(\w+)\/:id\/(\w+)$/);
      if (nestedMatch && route.method === 'GET') {
        nestedParents.add(nestedMatch[1]);
      }
    }
    for (const parentPlural of nestedParents) {
      const parentSingular = parentPlural.endsWith('s') ? parentPlural.slice(0, -1) : parentPlural;
      const fnName = `get${parentSingular.charAt(0).toUpperCase() + parentSingular.slice(1)}`;
      if (usedFnNames.has(fnName)) continue;
      usedFnNames.add(fnName);

      // Find the model for JSDoc
      const model = ctx.db.models.find(m => m.name.toLowerCase() === parentSingular.toLowerCase());
      if (model) {
        lines.push(`/** @returns {Promise<import('./types').${model.name}>} */`);
      }
      const headersExpr = hasAuth ? 'authHeaders()' : "{ 'Content-Type': 'application/json' }";
      lines.push(`export async function ${fnName}(id) {`);
      if (hasAuth) {
        lines.push(`  const res = await fetch(\`\${API_BASE}/${parentPlural}/\${id}\`, { headers: ${headersExpr} });`);
      } else {
        lines.push(`  const res = await fetch(\`\${API_BASE}/${parentPlural}/\${id}\`);`);
      }
      lines.push('  return handleResponse(res);');
      lines.push('}');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Extract the model name from a ~db.Model.operation handler */
function extractModelFromHandler(handler: string): string | null {
  const match = handler.match(/^~db\.(\w+)\.\w+$/);
  return match ? match[1] : null;
}

/** Check if the handler is a findMany (list) operation */
function isListHandler(handler: string): boolean {
  return handler.endsWith('.findMany');
}
