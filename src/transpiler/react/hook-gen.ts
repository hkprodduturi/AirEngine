/**
 * Hook effect generator — wires onMount / onChange hooks to API calls or console stubs.
 */

import type { AirRoute } from '../../parser/types.js';
import type { TranspileContext } from '../context.js';
import { expandCrud, routeToFunctionName } from '../route-utils.js';

// ---- Hook Effects ----

export function generateHookEffects(ctx: TranspileContext): string[] {
  if (ctx.hooks.length === 0) return [];

  const canWireApi = ctx.hasBackend && ctx.apiRoutes.length > 0;
  // Pre-expand routes for matching
  const expandedRoutes = canWireApi ? expandCrud(ctx.apiRoutes) : [];

  const lines: string[] = [];
  for (const hook of ctx.hooks) {
    if (hook.trigger === 'onMount') {
      lines.push('useEffect(() => {');
      for (const action of hook.actions) {
        const apiCall = canWireApi ? matchHookToApiCall(action, expandedRoutes, ctx) : null;
        if (apiCall) {
          lines.push(`  ${apiCall}`);
        } else {
          lines.push(`  console.log('${action}'); // TODO: ${action}`);
        }
      }
      lines.push('}, []);');
    } else if (hook.trigger.startsWith('onChange:')) {
      const dep = hook.trigger.split(':')[1];
      lines.push(`useEffect(() => {`);
      for (const action of hook.actions) {
        const apiCall = canWireApi ? matchHookToApiCall(action, expandedRoutes, ctx) : null;
        if (apiCall) {
          lines.push(`  ${apiCall}`);
        } else {
          lines.push(`  console.log('${action}', ${dep}); // TODO: ${action}`);
        }
      }
      lines.push(`}, [${dep}]);`);
    }
    lines.push('');
  }
  return lines;
}

/**
 * Match a hook action like `~api.stats` to an API client call.
 * Returns e.g. `api.getStats().then(data => setStats(data)).catch(console.error);`
 * or null if no match found.
 */
export function matchHookToApiCall(
  action: string,
  expandedRoutes: AirRoute[],
  ctx: TranspileContext,
): string | null {
  // Only handle ~api.{resource} pattern
  if (!action.startsWith('~api.')) return null;

  const resource = action.slice(5); // e.g., 'stats', 'projects', 'users'

  // Find matching GET route where path ends with /{resource}
  const getRoute = expandedRoutes.find(r =>
    r.method === 'GET' && r.path.endsWith(`/${resource}`)
  );
  if (!getRoute) return null;

  const fnName = routeToFunctionName('GET', getRoute.path);

  // Find matching state setter — look for state field matching resource name
  const stateField = ctx.state.find(f => f.name === resource);
  if (!stateField) return null;

  const setter = `set${resource.charAt(0).toUpperCase() + resource.slice(1)}`;

  return `api.${fnName}().then(data => ${setter}(data)).catch(console.error);`;
}
