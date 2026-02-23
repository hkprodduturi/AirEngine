/**
 * Shared route utilities for Express + API client generators.
 *
 * expandCrud — expands CRUD shorthand into individual routes.
 * routeToFunctionName — derives JS function name from HTTP method + path.
 */

import type { AirRoute } from '../parser/types.js';

/** Expand CRUD shortcut into GET, POST, PUT, DELETE */
export function expandCrud(routes: AirRoute[]): AirRoute[] {
  const result: AirRoute[] = [];
  for (const route of routes) {
    if (route.method === 'CRUD') {
      const handlerBase = route.handler.replace(/\.\w+$/, '');
      result.push({ method: 'GET', path: route.path, handler: `${handlerBase}.findMany` });
      result.push({ method: 'POST', path: route.path, handler: `${handlerBase}.create`, params: route.params });
      result.push({ method: 'PUT', path: `${route.path}/:id`, handler: `${handlerBase}.update`, params: route.params });
      result.push({ method: 'DELETE', path: `${route.path}/:id`, handler: `${handlerBase}.delete` });
    } else {
      result.push(route);
    }
  }
  return result;
}

/**
 * Derive a JS function name from HTTP method + path.
 *
 * GET /todos        → getTodos
 * POST /todos       → createTodo  (singularized)
 * PUT /todos/:id    → updateTodo
 * DELETE /todos/:id → deleteTodo
 * GET /stats        → getStats
 * POST /auth/login  → authLogin
 * GET /tasks/:id/comments → getTaskComments(taskId)
 */
export function routeToFunctionName(method: string, path: string): string {
  // Strip leading slash and remove :param segments
  const segments = path
    .replace(/^\//, '')
    .split('/')
    .filter(s => !s.startsWith(':'));

  if (segments.length === 0) return method.toLowerCase();

  const methodLower = method.toLowerCase();

  // Map HTTP methods to verb prefixes
  const verbMap: Record<string, string> = {
    get: 'get',
    post: 'create',
    put: 'update',
    delete: 'delete',
  };

  if (segments.length === 1) {
    const resource = segments[0];
    const verb = verbMap[methodLower] ?? methodLower;

    if (methodLower === 'get') {
      // GET /todos → getTodos (keep plural)
      return `${verb}${capitalize(resource)}`;
    }
    // POST/PUT/DELETE → singularize
    return `${verb}${capitalize(singularize(resource))}`;
  }

  // Multi-segment: e.g., /auth/login, /tasks/:id/comments
  if (methodLower === 'post' && !hasDbHandler(segments)) {
    // POST /auth/login → authLogin (non-db multi-segment)
    return segments.map((s, i) => i === 0 ? s : capitalize(s)).join('');
  }

  // GET /tasks/:id/comments → getTaskComments
  const verb = verbMap[methodLower] ?? methodLower;
  const parts = segments.map((s, i) => {
    if (i === 0) return singularize(s);
    return capitalize(s);
  });
  return `${verb}${capitalize(parts.join(''))}`;
}

/**
 * Extract path parameter names from a route path.
 * /todos/:id → ['id']
 * /tasks/:taskId/comments/:commentId → ['taskId', 'commentId']
 */
export function extractPathParams(path: string): string[] {
  return path
    .split('/')
    .filter(s => s.startsWith(':'))
    .map(s => s.slice(1));
}

// ---- Helpers ----

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function singularize(s: string): string {
  if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
  if (s.endsWith('ses') || s.endsWith('xes') || s.endsWith('zes')) return s.slice(0, -2);
  if (s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us')) return s.slice(0, -1);
  return s;
}

/** Heuristic: check if segments look like a non-db route (e.g., /auth/login) */
function hasDbHandler(segments: string[]): boolean {
  // Multi-segment POST with resource-like last segment → probably db
  // /tasks/:id/comments → last is "comments" → db-like
  // /auth/login → last is "login" → not db-like
  const last = segments[segments.length - 1];
  // Action-like last segments (verbs)
  const actions = ['login', 'logout', 'register', 'signup', 'verify', 'reset', 'send', 'invite'];
  return !actions.includes(last);
}
