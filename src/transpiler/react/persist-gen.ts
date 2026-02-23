/**
 * Persist code generator — localStorage / sessionStorage / cookie load & save.
 */

import type { TranspileContext } from '../context.js';
import { capitalize } from './helpers.js';

// ---- Persist: Key Resolution ----

/**
 * Resolves a persist key like "user.token" into:
 * - storeKey: the cookie/storage key name ("auth-user-token")
 * - getter: JS expression to read the value ("user?.token")
 * - depVar: the root state variable for useEffect dependency ("user")
 * - loadSetter: function that returns a setter statement for loading
 *
 * Simple keys like "items" resolve to themselves.
 * Dot-path keys like "user.token" access a sub-property of state.
 */
export function resolvePersistKey(key: string, ctx: TranspileContext): {
  storeKey: string;
  getter: string;
  depVar: string;
  loadSetter: (valueExpr: string) => string;
} {
  const parts = key.split('.');
  const rootVar = parts[0];
  const storeKey = `${ctx.appName}-${key.replace(/\./g, '-')}`;

  if (parts.length === 1) {
    // Simple key: "items" → getter=items, setter=setItems(val)
    return {
      storeKey,
      getter: rootVar,
      depVar: rootVar,
      loadSetter: (val) => `set${capitalize(rootVar)}(${val})`,
    };
  }

  // Dot-path key: "user.token" → getter=user?.token, setter=setUser(prev => ({...prev, token: val}))
  const optionalChain = parts.slice(1).reduce((acc, p) => `${acc}?.${p}`, rootVar);

  return {
    storeKey,
    getter: optionalChain,
    depVar: rootVar,
    loadSetter: (val) => {
      // Build nested spread: setUser(prev => ({...prev, token: val}))
      const lastProp = parts[parts.length - 1];
      return `set${capitalize(rootVar)}(prev => ({ ...prev, ${lastProp}: ${val} }))`;
    },
  };
}

// ---- Persist: Load ----

export function generatePersistLoad(ctx: TranspileContext): string[] {
  if (ctx.persistKeys.length === 0) return [];

  const lines: string[] = [];

  if (ctx.persistMethod === 'localStorage' || ctx.persistMethod === 'session') {
    const storage = ctx.persistMethod === 'session' ? 'sessionStorage' : 'localStorage';
    lines.push('useEffect(() => {');
    lines.push('  try {');
    for (let i = 0; i < ctx.persistKeys.length; i++) {
      const key = ctx.persistKeys[i];
      const { storeKey, loadSetter } = resolvePersistKey(key, ctx);
      const varName = `_saved_${key.replace(/\./g, '_')}`;
      const rawVar = ctx.persistKeys.length > 1 ? `raw${i}` : 'raw';
      lines.push(`    const ${rawVar} = ${storage}.getItem('${storeKey}');`);
      lines.push(`    if (${rawVar}) { const ${varName} = JSON.parse(${rawVar}); ${loadSetter(varName)}; }`);
    }
    lines.push('  } catch (e) { /* ignore corrupt storage */ }');
    lines.push('}, []);');
  } else if (ctx.persistMethod === 'cookie') {
    // Cookie persistence — warning for httpOnly
    if (ctx.persistOptions.httpOnly) {
      lines.push('// WARNING: httpOnly cookies require server-side handling');
    }
    lines.push('useEffect(() => {');
    lines.push('  try {');
    lines.push('    const cookies = Object.fromEntries(document.cookie.split("; ").map(c => c.split("=")));');
    for (const key of ctx.persistKeys) {
      const { storeKey, loadSetter } = resolvePersistKey(key, ctx);
      const varName = `_saved_${key.replace(/\./g, '_')}`;
      lines.push(`    if (cookies['${storeKey}']) { const ${varName} = JSON.parse(decodeURIComponent(cookies['${storeKey}'])); ${loadSetter(varName)}; }`);
    }
    lines.push('  } catch (e) { /* ignore */ }');
    lines.push('}, []);');
  }

  return lines;
}

// ---- Persist: Save ----

export function generatePersistSave(ctx: TranspileContext): string[] {
  if (ctx.persistKeys.length === 0) return [];

  const lines: string[] = [];

  if (ctx.persistMethod === 'localStorage' || ctx.persistMethod === 'session') {
    const storage = ctx.persistMethod === 'session' ? 'sessionStorage' : 'localStorage';
    for (const key of ctx.persistKeys) {
      const { storeKey, getter, depVar } = resolvePersistKey(key, ctx);
      const isDotPath = key.includes('.');
      lines.push(`useEffect(() => {`);
      if (isDotPath) {
        lines.push(`  if (${getter} !== undefined) ${storage}.setItem('${storeKey}', JSON.stringify(${getter}));`);
      } else {
        lines.push(`  ${storage}.setItem('${storeKey}', JSON.stringify(${getter}));`);
      }
      lines.push(`}, [${depVar}]);`);
    }
  } else if (ctx.persistMethod === 'cookie') {
    const maxAge = ctx.persistOptions['7d'] ? '; max-age=604800' : '';
    for (const key of ctx.persistKeys) {
      const { storeKey, getter, depVar } = resolvePersistKey(key, ctx);
      const isDotPath = key.includes('.');
      lines.push(`useEffect(() => {`);
      if (isDotPath) {
        lines.push(`  if (${getter} !== undefined) document.cookie = '${storeKey}=' + encodeURIComponent(JSON.stringify(${getter})) + '; path=/${maxAge}';`);
      } else {
        lines.push(`  document.cookie = '${storeKey}=' + encodeURIComponent(JSON.stringify(${getter})) + '; path=/${maxAge}';`);
      }
      lines.push(`}, [${depVar}]);`);
    }
  }

  return lines;
}
