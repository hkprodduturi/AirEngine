/**
 * API Client Generator
 *
 * Generates client/src/api.js — a fetch wrapper per expanded API route
 * with a configurable base URL via VITE_API_BASE_URL.
 * Includes JSDoc type annotations and pagination support for list routes.
 */

import type { TranspileContext } from './context.js';
import { routeToFunctionName, extractPathParams } from './route-utils.js';

export function generateApiClient(ctx: TranspileContext): string {
  const routes = ctx.expandedRoutes;
  const lines: string[] = [];
  const hasAuth = routes.some(r => r.path.includes('/auth/'));

  lines.push("const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';");
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
    const isAuthEndpoint = route.path.includes('/auth/');

    // JSDoc
    const modelName = extractModelFromHandler(route.handler);
    if (modelName) {
      if (method === 'GET' && pathParams.length === 0) {
        lines.push(`/** @returns {Promise<import('./types').${modelName}[]>} */`);
      } else if (method === 'DELETE') {
        lines.push(`/** @returns {Promise<import('./types').${modelName}>} */`);
      } else {
        lines.push(`/** @returns {Promise<import('./types').${modelName}>} */`);
      }
    }

    // Build function signature
    const args: string[] = [];
    for (const p of pathParams) args.push(p);
    if (hasBody) args.push('data');
    if (isList) args.push('{ page, limit } = {}');
    const sig = args.join(', ');

    // Build URL expression
    const urlPath = route.path.replace(/:(\w+)/g, (_m, name) => `\${${name}}`);
    const urlExpr = pathParams.length > 0
      ? `\`\${API_BASE}${urlPath}\``
      : `\`\${API_BASE}${route.path}\``;

    lines.push(`export async function ${fnName}(${sig}) {`);

    // For list routes, build query string with pagination params
    if (isList) {
      lines.push('  const params = new URLSearchParams();');
      lines.push('  if (page !== undefined) params.set(\'page\', String(page));');
      lines.push('  if (limit !== undefined) params.set(\'limit\', String(limit));');
      lines.push(`  const qs = params.toString();`);
      lines.push(`  const url = qs ? ${urlExpr} + '?' + qs : ${urlExpr};`);
    }

    // Use authHeaders() for non-auth endpoints, plain headers for auth endpoints
    const headersExpr = hasAuth && !isAuthEndpoint ? 'authHeaders()' : "{ 'Content-Type': 'application/json' }";

    if (method === 'GET' || method === 'DELETE') {
      const fetchUrl = isList ? 'url' : urlExpr;
      if (hasAuth && !isAuthEndpoint) {
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

    lines.push(`  if (!res.ok) throw new Error(\`${method} ${route.path} failed: \${res.status}\`);`);
    lines.push('  return res.json();');
    lines.push('}');
    lines.push('');
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
