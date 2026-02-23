/**
 * React code-gen helpers — utility functions shared across all react/ modules.
 */

import type { AirUINode, AirField, AirType } from '../../parser/types.js';
import type { TranspileContext } from '../context.js';
import type { UIAnalysis, ResolvedBind } from '../normalize-ui.js';
import { resolveBindChain } from '../normalize-ui.js';
import { mapElement } from '../element-map.js';

// ---- Icon emoji map ----

export const ICON_EMOJI: Record<string, string> = {
  zap: '&#9889;', shield: '&#128737;', users: '&#128101;',
  star: '&#11088;', heart: '&#10084;', check: '&#10004;',
  x: '&#10006;', search: '&#128269;', settings: '&#9881;',
  mail: '&#9993;', lock: '&#128274;', globe: '&#127760;',
  home: '&#127968;', bell: '&#128276;', edit: '&#9998;',
  trash: '&#128465;', plus: '&#43;', minus: '&#8722;',
  arrow: '&#10140;', clock: '&#128339;', calendar: '&#128197;',
};

// ---- Scope tracking for code generation ----

export interface Scope {
  iterVar?: string;
  iterData?: string;
  baseArray?: string;
  insideIter: boolean;
  insideForm?: boolean;
}

export const ROOT_SCOPE: Scope = { insideIter: false };

// ---- Text / String Utilities ----

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function escapeText(text: string): string {
  return text.replace(/[{}<>]/g, c => {
    switch (c) {
      case '{': return '&#123;';
      case '}': return '&#125;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      default: return c;
    }
  });
}

export function interpolateText(text: string, ctx: TranspileContext, scope: Scope): string {
  // Handle # references inside text strings
  if (text.includes('#')) {
    // Replace #var.prop and #var patterns with ${} expressions
    let result = text.replace(/#(\w+(?:\.\w+)*(?:\|[!]?\w+(?:\.\w+)*)*)/g, (_, ref) => {
      // Handle pipes in text refs like #items|!done.length
      const parts = ref.split('|');
      let expr = parts[0];

      // Use optional chaining if root state var is nullable
      const dotParts = expr.split('.');
      if (dotParts.length > 1) {
        const rootVar = dotParts[0];
        const stateField = ctx.state.find(f => f.name === rootVar);
        if (stateField && stateField.type.kind === 'optional') {
          expr = rootVar + '?.' + dotParts.slice(1).join('.');
        }
      }

      for (let i = 1; i < parts.length; i++) {
        const pipe = parts[i];
        if (pipe.startsWith('!')) {
          // Filter negation: !done → .filter(i => !i.done)
          const field = pipe.slice(1).split('.')[0];
          const rest = pipe.slice(1).split('.').slice(1).join('.');
          expr = `${expr}.filter(i => !i.${field})`;
          if (rest) expr = `${expr}.${rest}`;
        } else {
          expr = `${expr}.${pipe}`;
        }
      }
      return `\${${expr}}`;
    });
    return '`' + result + '`';
  }
  return JSON.stringify(text);
}

export function deriveLabel(name: string): string {
  // snake_case → Title Case
  if (name.includes('_')) {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  // camelCase → split on capitals
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function classAttr(className: string): string {
  return className ? ` className="${className}"` : '';
}

export function indent(lines: string[], n: number): string[] {
  const pad = ' '.repeat(n);
  return lines.flatMap(l => {
    if (!l) return [l];
    if (l.includes('\n')) {
      return l.split('\n').map(sub => sub ? pad + sub : sub);
    }
    return [pad + l];
  });
}

export function findStateField(name: string, ctx: TranspileContext): AirField | undefined {
  // Handle dotted names
  const baseName = name.split('.')[0];
  return ctx.state.find(f => f.name === baseName);
}

export function resolveSetterFromRef(ref: string): string {
  // ref could be 'input.title' → need setInput(prev => ({...prev, title: value}))
  const parts = ref.split('.');
  if (parts.length === 1) {
    return `set${capitalize(parts[0])}`;
  }
  // For nested: return a lambda
  // Actually return a string that the caller will use differently
  return `((v) => set${capitalize(parts[0])}(prev => ({ ...prev, ${parts.slice(1).join('.')}: v })))`;
}

export function nodeToString(node: AirUINode): string {
  switch (node.kind) {
    case 'text': return node.text;
    case 'value': return String(node.value);
    case 'element': return node.element;
    case 'unary': return `${node.operator}${nodeToString(node.operand)}`;
    case 'binary': return `${nodeToString(node.left)}${node.operator}${nodeToString(node.right)}`;
    case 'scoped': return `@${node.scope}:${node.name}`;
  }
}

export function pluralize(s: string): string {
  if (s.endsWith('y')) return s.slice(0, -1) + 'ies';
  if (s.endsWith('s') || s.endsWith('x') || s.endsWith('z')) return s + 'es';
  return s + 's';
}

/** Derive context-aware empty state label from a data expression */
export function deriveEmptyLabel(dataExpr: string): string {
  if (!dataExpr || dataExpr === 'items') return 'No items yet';
  // Strip filter/pipe expressions: "tasks.filter(...)" → "tasks"
  const baseName = dataExpr.replace(/\..*/,'').replace(/\[.*/,'');
  // Convert camelCase to words
  const words = baseName.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return `No ${words} yet`;
}

export function inferModelFieldsFromDataSource(dataSource: string, ctx: TranspileContext): string[] {
  if (!ctx.db || !dataSource) return [];
  // Strip filter/pipe expressions: "tasks.filter(...)" → "tasks"
  const baseName = dataSource.replace(/\..*/,'').replace(/\[.*/,'');
  for (const model of ctx.db.models) {
    const modelLower = model.name.toLowerCase();
    if (baseName === modelLower || baseName === modelLower + 's' || baseName === pluralize(modelLower)) {
      return model.fields
        .filter(f => !f.primary || !f.auto)     // skip auto PK
        .filter(f => !f.auto)                    // skip auto datetime
        .filter(f => !f.name.endsWith('_id'))    // skip FK
        .map(f => f.name)
        .slice(0, 6);
    }
  }
  return [];
}

export function setter(name: string): string {
  return 'set' + capitalize(name);
}

export function wrapFormGroup(inputJsx: string, label: string, pad: string): string {
  return `${pad}<div className="form-group">\n${pad}  <label>${label}</label>\n${inputJsx.replace(/^(\s*)/, `${pad}  `)}\n${pad}</div>`;
}

// ---- Expression Resolvers ----

export function resolveRef(node: AirUINode, scope: Scope): string {
  if (node.kind === 'element') {
    // Sanitize element name — strip trailing operators that shouldn't be in JS expressions
    const name = node.element.replace(/[-+*/]+$/, '');
    if (scope.insideIter && scope.iterVar && name === scope.iterVar) {
      return scope.iterVar;
    }
    return name;
  }
  if (node.kind === 'binary' && node.operator === '.') {
    const left = resolveRef(node.left, scope);
    const right = resolveRef(node.right, scope);
    return `${left}.${right}`;
  }
  if (node.kind === 'unary' && node.operator === '#') {
    return resolveRef(node.operand, scope);
  }
  if (node.kind === 'text') {
    return JSON.stringify(node.text);
  }
  if (node.kind === 'value') {
    return JSON.stringify(node.value);
  }
  return nodeToString(node);
}

export function resolveRefNode(node: AirUINode, scope: Scope): string {
  if (node.kind === 'unary' && node.operator === '#') {
    return resolveRef(node.operand, scope);
  }
  if (node.kind === 'unary' && node.operator === '$') {
    const inner = resolveRefNode(node.operand, scope);
    return `'$' + ${inner}`;
  }
  if (node.kind === 'binary' && node.operator === '.') {
    return resolveDotExpr(node, scope);
  }
  if (node.kind === 'binary' && node.operator === '|') {
    return resolvePipeExprSimple(node, scope);
  }
  if (node.kind === 'binary' && node.operator === '-') {
    return `${resolveRefNode(node.left, scope)} - ${resolveRefNode(node.right, scope)}`;
  }
  return resolveRef(node, scope);
}

export function resolveDotExpr(node: AirUINode & { kind: 'binary' }, scope: Scope): string {
  const left = resolveRef(node.left, scope);
  const right = node.right.kind === 'element' ? node.right.element : resolveRef(node.right, scope);
  return `${left}.${right}`;
}

export function resolvePipeExpr(
  node: AirUINode & { kind: 'binary' },
  ctx: TranspileContext,
  scope: Scope,
): string {
  const left = resolvePipeSource(node.left, ctx, scope);
  const right = node.right;

  if (right.kind === 'element') {
    const fn = right.element;
    const args = right.children?.map(c => c.kind === 'element' ? c.element : nodeToString(c)) ?? [];

    switch (fn) {
      case 'filter': {
        // Check if there's an enum filter state
        const filterField = ctx.state.find(f => f.name === 'filter' && f.type.kind === 'enum');
        if (filterField) {
          return `${left}.filter(_item => filter === 'all' || _item.category === filter || _item.done === (filter === 'done'))`;
        }
        return `${left}`;
      }
      case 'sort': {
        const sortField = ctx.state.find(f => f.name === 'sort');
        if (sortField) {
          return `[...${left}].sort((a, b) => sort === 'newest' ? b.id - a.id : sort === 'oldest' ? a.id - b.id : sort === 'highest' ? b.amount - a.amount : a.amount - b.amount)`;
        }
        return left;
      }
      case 'sum':
        if (args.length > 0) {
          return `${left}.reduce((s, x) => s + x.${args[0]}, 0)`;
        }
        return `${left}.reduce((s, x) => s + x, 0)`;
      case 'avg':
        if (args.length > 0) {
          return `(${left}.length ? ${left}.reduce((s, x) => s + x.${args[0]}, 0) / ${left}.length : 0)`;
        }
        return `(${left}.length ? ${left}.reduce((s, x) => s + x, 0) / ${left}.length : 0)`;
      case 'count':
        return `${left}.length`;
      case 'search': {
        return `${left}.filter(_item => Object.values(_item).some(v => String(v).toLowerCase().includes(search.toLowerCase())))`;
      }
      default:
        return `${left} /* |${fn} */`;
    }
  }

  // Chained pipes: left | right where right is also a pipe
  if (right.kind === 'binary' && right.operator === '|') {
    return resolvePipeExpr(
      { ...right, left: { kind: 'text', text: resolvePipeExpr({ kind: 'binary', operator: '|', left: node.left, right: right.left }, ctx, scope) } } as AirUINode & { kind: 'binary' },
      ctx,
      scope,
    );
  }

  return left;
}

export function resolvePipeExprSimple(node: AirUINode & { kind: 'binary' }, scope: Scope): string {
  const left = resolveRefNode(node.left, scope);
  const right = node.right;

  if (right.kind === 'element') {
    const fn = right.element;
    const args = right.children?.map(c => c.kind === 'element' ? c.element : nodeToString(c)) ?? [];

    switch (fn) {
      case 'sum':
        return args.length > 0
          ? `${left}.reduce((s, x) => s + x.${args[0]}, 0)`
          : `${left}.reduce((s, x) => s + x, 0)`;
      case 'avg':
        return args.length > 0
          ? `(${left}.length ? ${left}.reduce((s, x) => s + x.${args[0]}, 0) / ${left}.length : 0)`
          : `(${left}.length ? ${left}.reduce((s, x) => s + x, 0) / ${left}.length : 0)`;
      default:
        return `${left}.${fn}`;
    }
  }

  return left;
}

export function resolvePipeSource(node: AirUINode, ctx: TranspileContext, scope: Scope): string {
  if (node.kind === 'element') return node.element;
  if (node.kind === 'unary' && node.operator === '#') return resolveRef(node.operand, scope);
  if (node.kind === 'unary' && node.operator === '$') return resolvePipeSource(node.operand, ctx, scope);
  if (node.kind === 'binary' && node.operator === '.') return resolveDotExpr(node as AirUINode & { kind: 'binary' }, scope);
  if (node.kind === 'binary' && node.operator === '|') return resolvePipeExpr(node as AirUINode & { kind: 'binary' }, ctx, scope);
  if (node.kind === 'binary' && node.operator === ':') {
    // Bind chain — extract the binding value
    const resolved = resolveBindChain(node);
    if (resolved?.binding) return resolvePipeSource(resolved.binding, ctx, scope);
  }
  return nodeToString(node);
}

export function extractDataSource(node: AirUINode, scope: Scope): string {
  // From a flow chain, extract the data expression
  if (node.kind === 'binary' && node.operator === '>') {
    // e.g., list > items|filter → data is from the right side
    return extractDataSource(node.right, scope);
  }
  if (node.kind === 'binary' && node.operator === '|') {
    // Pipe chain — recursively resolve left side for chained pipes
    const left = extractDataSource(node.left, scope);
    const right = node.right;
    if (right.kind === 'element') {
      const fn = right.element;
      if (fn === 'filter') {
        return `${left}.filter(_item => filter === 'all' || _item.category === filter || _item.done === (filter === 'done'))`;
      }
      if (fn === 'sort') {
        return `[...${left}].sort((a, b) => sort === 'newest' ? b.id - a.id : sort === 'oldest' ? a.id - b.id : sort === 'highest' ? b.amount - a.amount : a.amount - b.amount)`;
      }
      return `${left}`;
    }
    return left;
  }
  if (node.kind === 'element') {
    return node.element;
  }
  return 'items';
}

export function extractActionName(node: AirUINode): string {
  if (node.kind === 'element') return node.element;
  if (node.kind === 'binary' && node.operator === '.') {
    const l = node.left.kind === 'element' ? node.left.element : '';
    const r = node.right.kind === 'element' ? node.right.element : '';
    return `${l}_${r}`;
  }
  return 'action';
}

export function extractActionArgs(node: AirUINode, scope: Scope): string {
  if (node.kind === 'element' && node.children && node.children.length > 0) {
    return node.children.map(c => {
      if (c.kind === 'text') {
        // Raw text like {text:#val,done:false} — parse minimally
        let raw = c.text;
        // Parser may produce double braces — normalize to single pair
        if (raw.startsWith('{{') && !raw.startsWith('{{{')) {
          raw = raw.slice(1);
        }
        if (raw.startsWith('{')) {
          // Ensure closing brace
          if (!raw.endsWith('}')) raw = raw + '}';
          // Convert #val references
          return raw.replace(/#(\w+(?:\.\w+)*)/g, (_, name) => {
            if (name === 'val') return 'e.target.value';
            return scope.insideIter && scope.iterVar && name.startsWith(scope.iterVar + '.')
              ? name
              : name;
          });
        }
        // Raw text for array literals like [name,email,...]
        if (raw.startsWith('[')) {
          return raw;
        }
        return JSON.stringify(raw);
      }
      if (c.kind === 'unary' && c.operator === '#') {
        return resolveRef(c.operand, scope);
      }
      if (c.kind === 'binary' && c.operator === '.') {
        return resolveDotExpr(c as AirUINode & { kind: 'binary' }, scope);
      }
      return resolveRefNode(c, scope);
    }).join(', ');
  }
  return '';
}

// ---- Resolved Element ----

export interface ResolvedElement {
  element: string;
  modifiers: string[];
  children?: AirUINode[];
}

export function tryResolveElement(node: AirUINode): ResolvedElement | null {
  if (node.kind === 'element') {
    return { element: node.element, modifiers: [], children: node.children };
  }
  if (node.kind === 'binary' && node.operator === ':') {
    const resolved = resolveBindChain(node);
    if (resolved) {
      return { element: resolved.element, modifiers: resolved.modifiers, children: resolved.children };
    }
  }
  return null;
}

export function getButtonLabel(resolved: ResolvedBind): string {
  if (resolved.label) return escapeText(resolved.label);
  if (resolved.modifiers.includes('icon')) return '\u2715';
  // Check if action is a delete/remove → use ✕
  if (resolved.action) {
    const actionName = resolved.action.kind === 'unary'
      ? extractActionName(resolved.action.operand)
      : extractActionName(resolved.action);
    if (actionName === 'del' || actionName === 'delete' || actionName === 'remove') return '\u2715';
    return capitalize(actionName);
  }
  if (resolved.element === 'btn') return 'Submit';
  return resolved.element;
}

export function extractBaseArrayName(node: AirUINode): string {
  if (node.kind === 'binary' && node.operator === '>') {
    return extractBaseArrayName(node.right);
  }
  if (node.kind === 'binary' && node.operator === '|') {
    return extractBaseArrayName(node.left);
  }
  if (node.kind === 'element') {
    return node.element;
  }
  return 'items';
}

// ---- Enum / Deep Type Helpers ----

export function findEnumValues(stateRef: string, modifiers: string[], ctx: TranspileContext): string[] {
  // Direct state field lookup
  const field = findStateField(stateRef, ctx);
  if (field) {
    const deepType = resolveDeepType(field.type, stateRef);
    if (deepType?.kind === 'enum' && deepType.values.length > 0) return deepType.values;
  }
  // Look for enum by modifier name (e.g., select:category → find category enum in any state field)
  for (const mod of modifiers) {
    for (const f of ctx.state) {
      const enumType = findEnumByName(f.type, mod);
      if (enumType) return enumType.values;
    }
  }
  return [];
}

export function resolveDeepType(type: AirType, path: string): AirType | null {
  const parts = path.split('.');
  if (parts.length <= 1) return type;
  // Walk into object types
  let current = type;
  for (let i = 1; i < parts.length; i++) {
    if (current.kind === 'object') {
      const field = current.fields.find(f => f.name === parts[i]);
      if (field) { current = field.type; } else { return null; }
    } else if (current.kind === 'optional') {
      current = current.of;
      i--; // retry with inner type
    } else {
      return null;
    }
  }
  return current;
}

export function findEnumByName(type: AirType, name: string): AirType & { kind: 'enum' } | null {
  if (type.kind === 'enum') return type;
  if (type.kind === 'array' && type.of.kind === 'object') {
    for (const f of type.of.fields) {
      if (f.name === name && f.type.kind === 'enum') return f.type;
    }
  }
  if (type.kind === 'object') {
    for (const f of type.fields) {
      if (f.name === name && f.type.kind === 'enum') return f.type;
    }
  }
  return null;
}

// ---- Page Dependency Analysis ----

export interface PageDeps {
  stateProps: string[];
  setterProps: string[];
  mutationProps: string[];
  needsNav: boolean;
}

/**
 * Walk page children recursively to determine which props the page needs.
 */
export function analyzePageDependencies(
  nodes: AirUINode[],
  ctx: TranspileContext,
  analysis: UIAnalysis,
): PageDeps {
  const deps: PageDeps = { stateProps: [], setterProps: [], mutationProps: [], needsNav: false };
  const stateNames = new Set(ctx.state.map(f => f.name));

  function walk(node: AirUINode): void {
    switch (node.kind) {
      case 'element':
        if (stateNames.has(node.element.split('.')[0])) {
          addProp(deps.stateProps, node.element.split('.')[0]);
        }
        if (node.element.includes('.set')) {
          addProp(deps.setterProps, node.element.split('.')[0]);
        }
        if (node.children) node.children.forEach(walk);
        break;
      case 'scoped':
        node.children.forEach(walk);
        break;
      case 'unary':
        if (node.operator === '#') {
          const refName = extractPageRefName(node.operand);
          if (refName && stateNames.has(refName)) {
            addProp(deps.stateProps, refName);
          }
        }
        if (node.operator === '!') {
          const mutName = extractPageMutName(node.operand);
          if (mutName) addProp(deps.mutationProps, mutName);
        }
        walk(node.operand);
        break;
      case 'binary':
        walk(node.left);
        walk(node.right);
        break;
    }
  }

  nodes.forEach(walk);

  if (analysis.hasPages && analysis.pages.length > 1) {
    deps.needsNav = true;
  }

  return deps;
}

function addProp(arr: string[], name: string): void {
  if (!arr.includes(name)) arr.push(name);
}

function extractPageRefName(node: AirUINode): string | null {
  if (node.kind === 'element') return node.element.split('.')[0];
  if (node.kind === 'binary' && node.operator === '.') {
    return node.left.kind === 'element' ? node.left.element : null;
  }
  return null;
}

function extractPageMutName(node: AirUINode): string | null {
  if (node.kind === 'element') return node.element;
  if (node.kind === 'binary' && node.operator === '.') {
    const l = node.left.kind === 'element' ? node.left.element : '';
    const r = node.right.kind === 'element' ? node.right.element : '';
    return `${l}_${r}`;
  }
  return null;
}

// ---- Hook Mapping ----

export interface HookMapping {
  hookName: string;
  modelName: string;
  routePath: string;
}

/**
 * Map state array variable names to resource hooks.
 * Returns a Map where key = state var name (e.g. "projects"),
 * value = hook info (e.g. { hookName: "useProjects", modelName: "Project" }).
 */
export function getHookableStateProps(ctx: TranspileContext): Map<string, HookMapping> {
  if (!ctx.hasBackend || !ctx.db) return new Map();

  const routes = ctx.expandedRoutes;
  const result = new Map<string, HookMapping>();

  for (const model of ctx.db.models) {
    const route = routes.find(
      r => r.method === 'GET' && r.handler === `~db.${model.name}.findMany`,
    );
    if (!route) continue;

    const modelPlural = pluralize(model.name);
    const hookName = `use${capitalize(modelPlural)}`;
    // State var is lowercase first char of plural (e.g., "Projects" → "projects")
    const stateVarName = modelPlural.charAt(0).toLowerCase() + modelPlural.slice(1);

    // Only map if there's actually a matching state variable
    const hasState = ctx.state.some(f => f.name === stateVarName);
    if (hasState) {
      result.set(stateVarName, { hookName, modelName: model.name, routePath: route.path });
    }
  }

  return result;
}
