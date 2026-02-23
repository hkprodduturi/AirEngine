/**
 * API Client Generator
 *
 * Generates client/src/api.js — a fetch wrapper per expanded API route
 * with a configurable base URL via VITE_API_BASE_URL.
 */

import type { TranspileContext } from './context.js';
import { expandCrud, routeToFunctionName, extractPathParams } from './route-utils.js';

export function generateApiClient(ctx: TranspileContext): string {
  const routes = expandCrud(ctx.apiRoutes);
  const lines: string[] = [];

  lines.push("const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';");
  lines.push('');

  for (const route of routes) {
    const method = route.method;
    const fnName = routeToFunctionName(method, route.path);
    const pathParams = extractPathParams(route.path);
    const hasBody = (method === 'POST' || method === 'PUT') && route.params && route.params.length > 0;

    // Build function signature
    const args: string[] = [];
    for (const p of pathParams) args.push(p);
    if (hasBody) args.push('data');
    const sig = args.join(', ');

    // Build URL expression
    const urlPath = route.path.replace(/:(\w+)/g, (_m, name) => `\${${name}}`);
    const urlExpr = pathParams.length > 0
      ? `\`\${API_BASE}${urlPath}\``
      : `\`\${API_BASE}${route.path}\``;

    lines.push(`export async function ${fnName}(${sig}) {`);

    if (method === 'GET' || method === 'DELETE') {
      const fetchOpts = method === 'DELETE' ? `, { method: 'DELETE' }` : '';
      lines.push(`  const res = await fetch(${urlExpr}${fetchOpts});`);
    } else {
      lines.push(`  const res = await fetch(${urlExpr}, {`);
      lines.push(`    method: '${method}',`);
      lines.push(`    headers: { 'Content-Type': 'application/json' },`);
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
