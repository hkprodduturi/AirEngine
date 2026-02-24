/**
 * Mutation function generator — wires !add, !del, !toggle, !login, etc.
 * to local state or API client calls.
 */

import type { AirRoute } from '../../parser/types.js';
import type { TranspileContext } from '../context.js';
import type { UIAnalysis } from '../normalize-ui.js';
import { routeToFunctionName } from '../route-utils.js';
import { capitalize, setter } from './helpers.js';

// ---- Mutation-to-Route Matching ----

export interface MutationRouteMatch {
  fnName: string;        // e.g. 'createTodo'
  method: string;        // e.g. 'POST'
  refetchFnName: string | null;  // e.g. 'getTodos'
  refetchSetter: string | null;  // e.g. 'setItems'
}

/**
 * Match a mutation name to an API route for fullstack wiring.
 * Returns the API function name, HTTP method, and refetch info, or null if no match.
 */
export function findMatchingRoute(
  mutName: string,
  expandedRoutes: AirRoute[],
  ctx: TranspileContext,
): MutationRouteMatch | null {
  let matchedRoute: AirRoute | undefined;

  if (mutName === 'add' || mutName === 'addItem') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'POST' && /~db\.\w+\.create/.test(r.handler)
    );
  } else if (mutName === 'del' || mutName === 'delItem' || mutName === 'remove') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'DELETE' && /~db\.\w+\.delete/.test(r.handler)
    );
  } else if (mutName === 'toggle') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'PUT' && /~db\.\w+\.update/.test(r.handler)
    );
  } else if (mutName === 'update' || mutName === 'save' || mutName === 'updateProfile') {
    matchedRoute = expandedRoutes.find(r =>
      r.method === 'PUT' && /\.update$/.test(r.handler)
    );
  } else if (mutName === 'archive' || mutName === 'done') {
    matchedRoute = expandedRoutes.find(r =>
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

  return { fnName, method: matchedRoute.method, refetchFnName, refetchSetter };
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

export function generateMutations(ctx: TranspileContext, analysis: UIAnalysis): string[] {
  const lines: string[] = [];
  const arrayField = ctx.state.find(f => f.type.kind === 'array');
  const arrayName = arrayField?.name;

  const canWireApi = ctx.hasBackend && ctx.apiRoutes.length > 0;
  const expandedRoutes = canWireApi ? ctx.expandedRoutes : [];
  const hasLoading = ctx.state.some(f => f.name === 'loading');
  const hasError = ctx.state.some(f => f.name === 'error');
  const hasAuth = ctx.auth !== null || expandedRoutes.some(r => r.path.includes('/auth/') || r.path.endsWith('/login') || r.path.endsWith('/signup') || r.path.endsWith('/register'));

  for (const mut of analysis.mutations) {
    const name = mut.name;
    const match = canWireApi ? findMatchingRoute(name, expandedRoutes, ctx) : null;

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
      if (match) {
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
      } else if (arrayName) {
        lines.push(`const ${name} = (id) => {`);
        lines.push(`  ${setter(arrayName)}(prev => prev.filter(item => item.id !== id));`);
        lines.push('};');
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
        lines.push(`    setCurrentPage('dashboard');`);
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
        lines.push(`    setCurrentPage('dashboard');`);
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
    } else if (name === 'update' || name === 'save' || name === 'updateProfile') {
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
      const field = name === 'archive' ? 'archived' : 'done';
      if (match) {
        lines.push(`const ${name} = async (id) => {`);
        lines.push(`  try {`);
        lines.push(`    await api.${match.fnName}(id, { ${field}: true });`);
        if (match.refetchFnName && match.refetchSetter) {
          lines.push(`    const updated = await api.${match.refetchFnName}();`);
          lines.push(`    ${match.refetchSetter}(updated);`);
        }
        lines.push(`  } catch (err) {`);
        lines.push(`    console.error('${name} failed:', err);`);
        lines.push(`  }`);
        lines.push('};');
      } else if (arrayName) {
        lines.push(`const ${name} = (id) => {`);
        lines.push(`  ${setter(arrayName)}(prev => prev.map(item => item.id === id ? { ...item, ${field}: true } : item));`);
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
