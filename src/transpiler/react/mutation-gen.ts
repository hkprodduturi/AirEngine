/**
 * Mutation function generator — wires !add, !del, !toggle, !login, etc.
 * to local state or API client calls.
 */

import type { AirRoute, AirUINode } from '../../parser/types.js';
import type { TranspileContext } from '../context.js';
import type { UIAnalysis } from '../normalize-ui.js';
import { routeToFunctionName } from '../route-utils.js';
import { capitalize, setter } from './helpers.js';

/**
 * Extract a model hint from mutation argument nodes.
 * e.g. !del(#task.id) → argNode is binary '.' of (unary '#' of 'task') and 'id' → returns 'tasks'
 */
function extractModelHint(argNodes: AirUINode[]): string | null {
  if (argNodes.length === 0) return null;
  let arg = argNodes[0];
  // Unwrap unary '#' ref operator: #(task.id) → task.id
  if (arg.kind === 'unary' && arg.operator === '#') {
    arg = arg.operand;
  }
  // Parser may keep dot in element name: { kind: 'element', element: 'task.id' }
  if (arg.kind === 'element' && arg.element.includes('.')) {
    const varName = arg.element.split('.')[0];
    return varName.endsWith('s') ? varName : varName + 's';
  }
  // Pattern: iterVar.id → binary '.' with left = element
  if (arg.kind === 'binary' && arg.operator === '.') {
    const left = arg.left;
    if (left.kind === 'element') {
      const varName = left.element;
      return varName.endsWith('s') ? varName : varName + 's';
    }
    if (left.kind === 'unary' && left.operator === '#' && left.operand.kind === 'element') {
      const varName = left.operand.element.split('.')[0];
      return varName.endsWith('s') ? varName : varName + 's';
    }
  }
  return null;
}

// ---- Mutation-to-Route Matching ----

export interface MutationRouteMatch {
  fnName: string;        // e.g. 'createTodo'
  method: string;        // e.g. 'POST'
  refetchFnName: string | null;  // e.g. 'getTodos'
  refetchSetter: string | null;  // e.g. 'setItems'
  handler: string;       // e.g. '~db.Item.update'
}

/**
 * Match a mutation name to an API route for fullstack wiring.
 * Returns the API function name, HTTP method, and refetch info, or null if no match.
 */
export function findMatchingRoute(
  mutName: string,
  expandedRoutes: AirRoute[],
  ctx: TranspileContext,
  argNodes?: AirUINode[],
): MutationRouteMatch | null {
  let matchedRoute: AirRoute | undefined;

  if (mutName === 'add' || mutName === 'addItem') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'POST' && /~db\.\w+\.create/.test(r.handler)
    );
  } else if (mutName === 'del' || mutName === 'delItem' || mutName === 'remove') {
    // Use argument context to disambiguate which model to delete
    const modelHint = extractModelHint(argNodes ?? []);
    const deleteRoutes = expandedRoutes.filter(r =>
      r.method === 'DELETE' && /~db\.\w+\.delete/.test(r.handler)
    );
    if (modelHint) {
      // Try matching by model hint first
      matchedRoute = deleteRoutes.find(r => r.path.includes(`/${modelHint}`));
      if (!matchedRoute) {
        // Hint didn't match — only fall back if there's exactly one DELETE route
        matchedRoute = deleteRoutes.length === 1 ? deleteRoutes[0] : undefined;
        if (!matchedRoute) return null;
      }
    } else {
      matchedRoute = deleteRoutes[0];
    }
  } else if (mutName === 'toggle') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'PUT' && /~db\.\w+\.update/.test(r.handler)
    );
  } else if (mutName === 'updateProfile') {
    // Match user-related PUT route
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'PUT' && /\.update$/.test(r.handler) && r.path.includes('/user')
    ) || expandedRoutes.find(r =>
      r.method === 'PUT' && /\.update$/.test(r.handler)
    );
  } else if (mutName === 'updateWorkspace') {
    // Match workspace-related PUT route only — don't fall back to generic PUT
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'PUT' && /\.update$/.test(r.handler) && r.path.includes('/workspace')
    );
  } else if (mutName === 'update' || mutName === 'save') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'PUT' && /\.update$/.test(r.handler)
    );
  } else if (mutName === 'archive') {
    // Match project-related PUT route (archive is for projects/items, not tasks)
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'PUT' && /\.update$/.test(r.handler) && r.path.includes('/project')
    ) || expandedRoutes.find(r =>
      r.method === 'PUT' && /\.update$/.test(r.handler)
    );
  } else if (mutName === 'done') {
    // Match task-related PUT route (done is for tasks)
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'PUT' && /\.update$/.test(r.handler) && r.path.includes('/task')
    ) || expandedRoutes.find(r =>
      r.method === 'PUT' && /\.update$/.test(r.handler)
    );
  } else if (mutName === 'login') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'POST' && r.path.endsWith('/login')
    );
  } else if (mutName === 'signup' || mutName === 'register') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'POST' && (r.path.endsWith('/signup') || r.path.endsWith('/register'))
    );
  } else if (mutName === 'logout') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'POST' && r.path.endsWith('/logout')
    );
  }

  if (!matchedRoute) return null;

  const fnName = routeToFunctionName(matchedRoute.method, matchedRoute.path);

  // Find refetch: GET route on the same base path
  const basePath = matchedRoute.path.replace(/\/:[^/]+$/, '');
  const getRoute = expandedRoutes.find(r =>
    r.method === 'GET' && r.path === basePath
  );
  const refetchFnName = getRoute ? routeToFunctionName('GET', getRoute.path) : null;

  // Resolve state setter for refetch
  let refetchSetter: string | null = null;
  if (refetchFnName) {
    // 1. Direct name match: /todos → state field 'todos' → setTodos
    const resource = basePath.replace(/^\//, '').split('/').pop() || '';
    const directMatch = ctx.state.find(f => f.name === resource);
    if (directMatch) {
      refetchSetter = 'set' + capitalize(directMatch.name);
    } else {
      // 2. Single array fallback
      const arrays = ctx.state.filter(f => f.type.kind === 'array');
      if (arrays.length === 1) {
        refetchSetter = 'set' + capitalize(arrays[0].name);
      }
    }
  }

  return { fnName, method: matchedRoute.method, refetchFnName, refetchSetter, handler: matchedRoute.handler };
}

/**
 * Try to match a generic mutation name to any API route by converting
 * camelCase name to kebab-case path segment.
 * e.g., !processPayment → find POST /.../process-payment
 */
function findGenericRouteMatch(name: string, expandedRoutes: AirRoute[]): string | null {
  // Convert camelCase to kebab-case
  const kebab = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const route = expandedRoutes.find(r =>
    r.method === 'POST' && r.path.endsWith(`/${kebab}`)
  );
  if (route) {
    return routeToFunctionName(route.method, route.path);
  }
  return null;
}

// ---- Mutation Functions ----

/** Determine the best post-login redirect page from analysis */
function getPostLoginPage(analysis: UIAnalysis): string {
  if (analysis.pages.length === 0) return 'home';
  // Prefer: dashboard > home > first non-login/signup/register page > first page
  const preferred = ['dashboard', 'home', 'overview', 'main'];
  for (const name of preferred) {
    if (analysis.pages.some(p => p.name === name)) return name;
  }
  const nonAuth = analysis.pages.find(p =>
    !['login', 'signup', 'register', 'auth'].includes(p.name)
  );
  return nonAuth?.name ?? analysis.pages[0].name;
}

export function generateMutations(ctx: TranspileContext, analysis: UIAnalysis): string[] {
  const lines: string[] = [];
  const arrayField = ctx.state.find(f => f.type.kind === 'array');
  const arrayName = arrayField?.name;

  const canWireApi = ctx.hasBackend && ctx.apiRoutes.length > 0;
  const expandedRoutes = canWireApi ? ctx.expandedRoutes : [];
  const hasLoading = ctx.state.some(f => f.name === 'loading');
  const hasError = ctx.state.some(f => f.name === 'error');
  const hasAuth = ctx.auth !== null || expandedRoutes.some(r => r.path.includes('/auth/') || r.path.endsWith('/login') || r.path.endsWith('/signup') || r.path.endsWith('/register'));
  const postLoginPage = getPostLoginPage(analysis);

  for (const mut of analysis.mutations) {
    const name = mut.name;
    const match = canWireApi ? findMatchingRoute(name, expandedRoutes, ctx, mut.argNodes) : null;

    if (name === 'add' || name === 'addItem') {
      if (match) {
        lines.push(`const ${name} = async (data) => {`);
        lines.push(`  try {`);
        lines.push(`    await api.${match.fnName}(data);`);
        if (match.refetchFnName && match.refetchSetter) {
          lines.push(`    const updated = await api.${match.refetchFnName}();`);
          lines.push(`    ${match.refetchSetter}(updated);`);
        }
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('${name} failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else if (arrayName) {
        lines.push(`const ${name} = (data) => {`);
        lines.push(`  ${setter(arrayName)}(prev => [...prev, { ...data, id: Date.now() }]);`);
        lines.push('};');
      }
    } else if (name === 'del' || name === 'delItem' || name === 'remove') {
      // Check if there are multiple DELETE routes → dispatch by checking arrays
      const deleteRoutes = canWireApi
        ? expandedRoutes.filter(r => r.method === 'DELETE' && /~db\.\w+\.delete/.test(r.handler))
        : [];
      if (deleteRoutes.length > 1) {
        // Multi-resource dispatch: check each state array to find which resource owns the id
        lines.push(`const ${name} = async (id) => {`);
        lines.push(`  try {`);
        let first = true;
        for (const dr of deleteRoutes) {
          const modelMatch = dr.handler.match(/^~db\.(\w+)\.delete$/);
          if (!modelMatch) continue;
          const modelName = modelMatch[1];
          const fnName = routeToFunctionName(dr.method, dr.path);
          // Find matching state array for this model
          const plural = modelName.charAt(0).toLowerCase() + modelName.slice(1) + 's';
          const stateArr = ctx.state.find(f => f.name === plural && f.type.kind === 'array');
          if (stateArr) {
            const cond = first ? 'if' : '} else if';
            lines.push(`    ${cond} (${plural}.find(i => i.id === id)) {`);
            lines.push(`      await api.${fnName}(id);`);
            // Refetch
            const basePath = dr.path.replace(/\/:[^/]+$/, '');
            const getRoute = expandedRoutes.find(r => r.method === 'GET' && r.path === basePath);
            if (getRoute) {
              const getFn = routeToFunctionName('GET', getRoute.path);
              lines.push(`      ${setter(plural)}(await api.${getFn}());`);
            }
            first = false;
          }
        }
        if (!first) lines.push('    }');
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('${name} failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else if (match) {
        lines.push(`const ${name} = async (id) => {`);
        lines.push(`  try {`);
        lines.push(`    await api.${match.fnName}(id);`);
        if (match.refetchFnName && match.refetchSetter) {
          lines.push(`    const updated = await api.${match.refetchFnName}();`);
          lines.push(`    ${match.refetchSetter}(updated);`);
        }
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('${name} failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else {
        // Use model hint from args to target the right array (e.g., !remove(#member.id) → members)
        const modelHint = extractModelHint(mut.argNodes);
        const targetArray = modelHint
          ? ctx.state.find(f => f.name === modelHint && f.type.kind === 'array')
          : arrayField;
        const targetName = targetArray?.name || arrayName;
        if (targetName) {
          lines.push(`const ${name} = (id) => {`);
          lines.push(`  ${setter(targetName)}(prev => prev.filter(item => item.id !== id));`);
          lines.push('};');
        }
      }
    } else if (name === 'toggle') {
      if (match) {
        lines.push(`const ${name} = async (id, field) => {`);
        lines.push(`  try {`);
        if (arrayName) {
          lines.push(`    const current = ${arrayName}.find(i => i.id === id);`);
          lines.push(`    await api.${match.fnName}(id, { [field]: !(current?.[field]) });`);
        } else {
          lines.push(`    await api.${match.fnName}(id, { [field]: true });`);
        }
        if (match.refetchFnName && match.refetchSetter) {
          lines.push(`    const updated = await api.${match.refetchFnName}();`);
          lines.push(`    ${match.refetchSetter}(updated);`);
        }
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('toggle failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else if (arrayName) {
        lines.push(`const ${name} = (id, field) => {`);
        lines.push(`  ${setter(arrayName)}(prev => prev.map(item => item.id === id ? { ...item, [field]: !item[field] } : item));`);
        lines.push('};');
      }
    } else if (name === 'login') {
      if (match) {
        lines.push(`const login = async (e) => {`);
        lines.push(`  e?.preventDefault?.();`);
        if (hasLoading) lines.push(`  setLoading(true);`);
        if (hasAuth) lines.push(`  setAuthError(null);`);
        else if (hasError) lines.push(`  setError(null);`);
        lines.push(`  try {`);
        lines.push(`    const formData = e?.target ? Object.fromEntries(new FormData(e.target)) : {};`);
        lines.push(`    if (!formData.email || !formData.password) {`);
        if (hasAuth) lines.push(`      setAuthError('Please enter email and password');`);
        else if (hasError) lines.push(`      setError('Please enter email and password');`);
        lines.push(`      return;`);
        lines.push(`    }`);
        lines.push(`    const result = await api.${match.fnName}(formData);`);
        if (hasAuth) {
          lines.push(`    if (result.token) api.setToken(result.token);`);
          lines.push(`    setUser(result.user || result);`);
        } else {
          lines.push(`    setUser(result);`);
        }
        lines.push(`    setCurrentPage('${postLoginPage}');`);
        lines.push(`  } catch (err) {`);
        if (hasAuth) {
          lines.push(`    const msg = err.message?.includes('401') ? 'Invalid email or password' : (err.message || 'Login failed');`);
          lines.push(`    setAuthError(msg);`);
        } else if (hasError) {
          lines.push(`    setError(err.message || 'Login failed');`);
        }
        lines.push(`    console.error('Login failed:', err);`);
        lines.push(`  } finally {`);
        if (hasLoading) lines.push(`    setLoading(false);`);
        lines.push(`  }`);
        lines.push('};');
      } else {
        lines.push(`const login = async (e) => {`);
        lines.push(`  e?.preventDefault?.();`);
        if (hasLoading) lines.push(`  setLoading(true);`);
        if (hasAuth) lines.push(`  setAuthError(null);`);
        else if (hasError) lines.push(`  setError(null);`);
        lines.push(`  try {`);
        lines.push(`    const formData = e?.target ? Object.fromEntries(new FormData(e.target)) : {};`);
        lines.push(`    if (!formData.email || !formData.password) {`);
        if (hasAuth) lines.push(`      setAuthError('Please enter email and password');`);
        else if (hasError) lines.push(`      setError('Please enter email and password');`);
        lines.push(`      return;`);
        lines.push(`    }`);
        lines.push(`    console.log('Login attempted');`);
        lines.push(`    setUser({ name: 'User', email: formData.email });`);
        lines.push(`    setCurrentPage('${postLoginPage}');`);
        lines.push(`  } catch (err) {`);
        if (hasAuth) lines.push(`    setAuthError(err.message || 'Login failed');`);
        else if (hasError) lines.push(`    setError(err.message || 'Login failed');`);
        lines.push(`    console.error('Login failed:', err);`);
        lines.push(`  } finally {`);
        if (hasLoading) lines.push(`    setLoading(false);`);
        lines.push(`  }`);
        lines.push('};');
      }
    } else if (name === 'logout') {
      if (match) {
        lines.push(`const logout = async () => {`);
        lines.push(`  try { await api.${match.fnName}(); } catch (_) {}`);
        if (hasAuth) lines.push(`  api.clearToken();`);
        lines.push(`  setUser(null);`);
        lines.push(`  setCurrentPage('login');`);
        lines.push('};');
      } else {
        lines.push(`const logout = () => {`);
        if (hasAuth) lines.push(`  api.clearToken();`);
        lines.push(`  setUser(null);`);
        lines.push(`  setCurrentPage('login');`);
        lines.push('};');
      }
    } else if (name === 'signup' || name === 'register') {
      if (match) {
        lines.push(`const ${name} = async (e) => {`);
        lines.push(`  e?.preventDefault?.();`);
        if (hasLoading) lines.push(`  setLoading(true);`);
        if (hasAuth) lines.push(`  setAuthError(null);`);
        else if (hasError) lines.push(`  setError(null);`);
        lines.push(`  try {`);
        lines.push(`    const formData = e?.target ? Object.fromEntries(new FormData(e.target)) : {};`);
        lines.push(`    if (!formData.email || !formData.password) {`);
        if (hasAuth) lines.push(`      setAuthError('Please fill in all required fields');`);
        else if (hasError) lines.push(`      setError('Please fill in all required fields');`);
        lines.push(`      return;`);
        lines.push(`    }`);
        lines.push(`    await api.${match.fnName}(formData);`);
        lines.push(`    setCurrentPage('login');`);
        lines.push(`  } catch (err) {`);
        if (hasAuth) lines.push(`    setAuthError(err.message || '${capitalize(name)} failed');`);
        else if (hasError) lines.push(`    setError(err.message || '${capitalize(name)} failed');`);
        lines.push(`    console.error('${capitalize(name)} failed:', err);`);
        lines.push(`  } finally {`);
        if (hasLoading) lines.push(`    setLoading(false);`);
        lines.push(`  }`);
        lines.push('};');
      } else {
        lines.push(`const ${name} = async (e) => {`);
        lines.push(`  e?.preventDefault?.();`);
        if (hasLoading) lines.push(`  setLoading(true);`);
        if (hasAuth) lines.push(`  setAuthError(null);`);
        else if (hasError) lines.push(`  setError(null);`);
        lines.push(`  try {`);
        lines.push(`    const formData = e?.target ? Object.fromEntries(new FormData(e.target)) : {};`);
        lines.push(`    if (!formData.email || !formData.password) {`);
        if (hasAuth) lines.push(`      setAuthError('Please fill in all required fields');`);
        else if (hasError) lines.push(`      setError('Please fill in all required fields');`);
        lines.push(`      return;`);
        lines.push(`    }`);
        lines.push(`    console.log('${capitalize(name)} attempted');`);
        lines.push(`    setCurrentPage('login');`);
        lines.push(`  } catch (err) {`);
        if (hasAuth) lines.push(`    setAuthError(err.message || '${capitalize(name)} failed');`);
        else if (hasError) lines.push(`    setError(err.message || '${capitalize(name)} failed');`);
        lines.push(`    console.error('${capitalize(name)} failed:', err);`);
        lines.push(`  } finally {`);
        if (hasLoading) lines.push(`    setLoading(false);`);
        lines.push(`  }`);
        lines.push('};');
      }
    } else if (name === 'updateProfile') {
      // Form-based mutation: extract data from form, send to user update endpoint
      if (match) {
        lines.push(`const updateProfile = async (e) => {`);
        lines.push(`  e?.preventDefault?.();`);
        lines.push(`  try {`);
        lines.push(`    const formData = e?.target ? Object.fromEntries(new FormData(e.target)) : {};`);
        lines.push(`    const result = await api.${match.fnName}(user?.id, formData);`);
        lines.push(`    setUser(prev => ({ ...prev, ...formData }));`);
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('updateProfile failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else {
        lines.push(`const updateProfile = async (e) => {`);
        lines.push(`  e?.preventDefault?.();`);
        lines.push(`  const formData = e?.target ? Object.fromEntries(new FormData(e.target)) : {};`);
        lines.push(`  setUser(prev => ({ ...prev, ...formData }));`);
        lines.push('};');
      }
    } else if (name === 'updateWorkspace') {
      // Form-based mutation: extract data from form, send to workspace update endpoint
      if (match) {
        lines.push(`const updateWorkspace = async (e) => {`);
        lines.push(`  e?.preventDefault?.();`);
        lines.push(`  try {`);
        lines.push(`    const formData = e?.target ? Object.fromEntries(new FormData(e.target)) : {};`);
        lines.push(`    const result = await api.${match.fnName}(workspace?.id, formData);`);
        lines.push(`    setWorkspace(prev => ({ ...prev, ...formData }));`);
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('updateWorkspace failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else {
        lines.push(`const updateWorkspace = async (e) => {`);
        lines.push(`  e?.preventDefault?.();`);
        lines.push(`  const formData = e?.target ? Object.fromEntries(new FormData(e.target)) : {};`);
        lines.push(`  setWorkspace(prev => ({ ...prev, ...formData }));`);
        lines.push('};');
      }
    } else if (name === 'update' || name === 'save') {
      if (match) {
        lines.push(`const ${name} = async (id, data) => {`);
        lines.push(`  try {`);
        lines.push(`    await api.${match.fnName}(id, data);`);
        if (match.refetchFnName && match.refetchSetter) {
          lines.push(`    const updated = await api.${match.refetchFnName}();`);
          lines.push(`    ${match.refetchSetter}(updated);`);
        }
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('${name} failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else if (arrayName) {
        lines.push(`const ${name} = (id, data) => {`);
        lines.push(`  ${setter(arrayName)}(prev => prev.map(item => item.id === id ? { ...item, ...data } : item));`);
        lines.push('};');
      } else {
        lines.push(`const ${name} = (...args) => {`);
        lines.push(`  console.log('${name}', ...args);`);
        lines.push('};');
      }
    } else if (name === 'archive' || name === 'done') {
      // Determine field/value by inspecting the @db model
      // If model has 'archived'/'done' boolean field → use that. Otherwise use status enum.
      const boolFieldName = name === 'archive' ? 'archived' : 'done';
      let hasBoolField = false;
      if (ctx.db) {
        // Try handler-based model lookup first (e.g. ~db.Item.update → Item)
        const handlerModelMatch = match?.handler.match(/^~db\.(\w+)\.\w+$/);
        let modelName = handlerModelMatch?.[1];
        // Fallback: derive model from route path (e.g. /items/:id → Item)
        if (!modelName && match) {
          const resource = match.fnName.replace(/^update/, '').replace(/^delete/, '');
          if (resource) modelName = resource.charAt(0).toUpperCase() + resource.slice(1);
        }
        // Also try: path-based (e.g. /items/:id → items → Item)
        if (!modelName) {
          const pathResource = arrayName?.replace(/s$/, '');
          if (pathResource) modelName = pathResource.charAt(0).toUpperCase() + pathResource.slice(1);
        }
        if (modelName) {
          const model = ctx.db.models.find(m => m.name === modelName);
          hasBoolField = !!model?.fields.find(f => f.name === boolFieldName);
        }
      }
      const updatePayload = hasBoolField
        ? `${boolFieldName}: true`
        : `status: '${name === 'archive' ? 'archived' : 'done'}'`;
      if (match) {
        lines.push(`const ${name} = async (id) => {`);
        lines.push(`  try {`);
        lines.push(`    await api.${match.fnName}(id, { ${updatePayload} });`);
        if (match.refetchFnName && match.refetchSetter) {
          lines.push(`    const updated = await api.${match.refetchFnName}();`);
          lines.push(`    ${match.refetchSetter}(updated);`);
        }
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('${name} failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else if (arrayName) {
        // Check array element type for boolean field vs status field
        const arrayField = ctx.state.find(f => f.name === arrayName);
        const elemType = arrayField?.type.kind === 'array' ? (arrayField.type as { of: { kind: string; fields?: { name: string }[] } }).of : null;
        const boolFieldName = name === 'archive' ? 'archived' : 'done';
        const hasBoolInState = elemType?.kind === 'object' && elemType.fields?.some(f => f.name === boolFieldName);
        const localPayload = hasBoolInState ? `${boolFieldName}: true` : `status: '${name === 'archive' ? 'archived' : 'done'}'`;
        lines.push(`const ${name} = (id) => {`);
        lines.push(`  ${setter(arrayName)}(prev => prev.map(item => item.id === id ? { ...item, ${localPayload} } : item));`);
        lines.push('};');
      } else {
        lines.push(`const ${name} = (...args) => {`);
        lines.push(`  console.log('${name}', ...args);`);
        lines.push('};');
      }
    } else {
      // Generic mutation — try to match by name to any API route
      const genericMatch = canWireApi ? findGenericRouteMatch(name, expandedRoutes) : null;
      if (genericMatch) {
        lines.push(`const ${name.replace(/\./g, '_')} = async (data) => {`);
        lines.push(`  try {`);
        lines.push(`    const result = await api.${genericMatch}(data);`);
        lines.push(`    return result;`);
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('${name} failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else {
        lines.push(`const ${name.replace(/\./g, '_')} = (...args) => {`);
        lines.push(`  console.log('${name}', ...args);`);
        lines.push('};');
      }
    }
    lines.push('');
  }

  return lines;
}
