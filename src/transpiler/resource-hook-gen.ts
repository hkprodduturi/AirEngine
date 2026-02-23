/**
 * Resource Hook Generator
 *
 * Generates React custom hooks (use{Model}s()) for each @db model
 * that has a matching findMany GET route. Each hook provides pagination,
 * search, loading/error state, and a refetch callback using direct fetch()
 * to access the X-Total-Count response header.
 */

import type { TranspileContext } from './context.js';
import type { OutputFile } from './index.js';
import { expandCrud } from './route-utils.js';

/**
 * Generate one use{Model}s.js hook file per @db model that has a
 * matching GET route with a ~db.{Model}.findMany handler.
 */
export function generateResourceHooks(ctx: TranspileContext): OutputFile[] {
  if (!ctx.hasBackend || !ctx.db) return [];

  const routes = expandCrud(ctx.apiRoutes);
  const files: OutputFile[] = [];

  for (const model of ctx.db.models) {
    // Find a GET route whose handler matches ~db.{ModelName}.findMany
    const route = routes.find(
      r => r.method === 'GET' && r.handler === `~db.${model.name}.findMany`,
    );
    if (!route) continue;

    const pluralName = pluralize(model.name);
    const stateVarName = pluralName.charAt(0).toLowerCase() + pluralName.slice(1);

    // Only generate hooks that have a matching array state variable.
    // Hooks without consumers are dead code — skip them.
    const stateField = ctx.state.find(f => f.name === stateVarName);
    if (!stateField || stateField.type.kind !== 'array') continue;

    const hookName = `use${capitalize(pluralName)}`;
    const routePath = route.path;

    const code = generateHookFile(model.name, hookName, routePath);
    files.push({
      path: `src/hooks/${hookName}.js`,
      content: code,
    });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Hook code emitter
// ---------------------------------------------------------------------------

function generateHookFile(
  modelName: string,
  hookName: string,
  routePath: string,
): string {
  const lines: string[] = [];

  lines.push("import { useState, useEffect, useCallback } from 'react';");
  lines.push('');
  lines.push(
    "const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';",
  );
  lines.push('');
  lines.push('/**');
  lines.push(` * Fetch and manage ${modelName} records with pagination and search.`);
  lines.push(' * @param {{ page?: number, limit?: number, search?: string }} options');
  lines.push(
    ` * @returns {{ data: import('../types').${modelName}[], loading: boolean, error: Error | null, total: number, refetch: () => void }}`,
  );
  lines.push(' */');
  lines.push(`export default function ${hookName}(options = {}) {`);
  lines.push('  const [data, setData] = useState([]);');
  lines.push('  const [loading, setLoading] = useState(true);');
  lines.push('  const [error, setError] = useState(null);');
  lines.push('  const [total, setTotal] = useState(0);');
  lines.push('');
  lines.push('  const buildQueryString = (opts) => {');
  lines.push('    const params = new URLSearchParams();');
  lines.push("    if (opts.page !== undefined) params.set('page', String(opts.page));");
  lines.push("    if (opts.limit !== undefined) params.set('limit', String(opts.limit));");
  lines.push("    if (opts.search) params.set('search', opts.search);");
  lines.push('    const qs = params.toString();');
  lines.push("    return qs ? '?' + qs : '';");
  lines.push('  };');
  lines.push('');
  lines.push('  const fetchData = useCallback(async () => {');
  lines.push('    setLoading(true);');
  lines.push('    setError(null);');
  lines.push('    try {');
  lines.push('      const qs = buildQueryString(options);');
  lines.push(`      const res = await fetch(\`\${API_BASE}${routePath}\${qs}\`);`);
  lines.push(
    `      if (!res.ok) throw new Error(\`GET ${routePath} failed: \${res.status}\`);`,
  );
  lines.push("      const totalHeader = res.headers.get('X-Total-Count');");
  lines.push('      if (totalHeader) setTotal(parseInt(totalHeader, 10));');
  lines.push('      const json = await res.json();');
  lines.push('      setData(json);');
  lines.push('    } catch (err) {');
  lines.push('      setError(err);');
  lines.push('    } finally {');
  lines.push('      setLoading(false);');
  lines.push('    }');
  lines.push('  }, [options.page, options.limit, options.search]);');
  lines.push('');
  lines.push('  useEffect(() => {');
  lines.push('    fetchData();');
  lines.push('  }, [fetchData]);');
  lines.push('');
  lines.push('  return { data, loading, error, total, refetch: fetchData };');
  lines.push('}');

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Simple English pluralization.
 * Handles common suffixes: y → ies, s/sh/ch/x/z → es, default → s.
 */
function pluralize(s: string): string {
  if (!s) return s;
  if (s.endsWith('y') && !isVowel(s.charAt(s.length - 2))) {
    return s.slice(0, -1) + 'ies';
  }
  if (
    s.endsWith('s') ||
    s.endsWith('sh') ||
    s.endsWith('ch') ||
    s.endsWith('x') ||
    s.endsWith('z')
  ) {
    return s + 'es';
  }
  return s + 's';
}

function isVowel(ch: string): boolean {
  return 'aeiouAEIOU'.includes(ch);
}
