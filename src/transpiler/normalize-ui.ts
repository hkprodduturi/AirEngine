/**
 * UI Tree Analysis
 *
 * Normalizes the raw UI AST before code generation:
 * - Resolves `:` bind chains into element + modifiers + binding/action
 * - Extracts mutation names from `!` unary nodes
 * - Detects pages and sections from scoped nodes
 */

import type { AirUINode } from '../parser/types.js';

// ---- Resolved Bind Chain ----

export interface ResolvedBind {
  element: string;
  modifiers: string[];
  binding?: AirUINode;
  action?: AirUINode;
  label?: string;
  children?: AirUINode[];
}

/**
 * Walk a binary `:` tree (left-associative) and extract:
 *   element + modifiers + optional binding/action/label
 *
 * Examples:
 *   btn:primary           → { element:'btn', modifiers:['primary'] }
 *   input:text            → { element:'input', modifiers:['text'] }
 *   btn:icon:!del(#id)    → { element:'btn', modifiers:['icon'], action:unary(!) }
 *   badge:#items.length   → { element:'badge', modifiers:[], binding:... }
 *   text:title:#exp.title → { element:'text', modifiers:['title'], binding:... }
 *   stat:"Total"          → { element:'stat', modifiers:[], label:'Total' }
 */
export function resolveBindChain(node: AirUINode): ResolvedBind | null {
  if (node.kind !== 'binary' || node.operator !== ':') return null;

  const result: ResolvedBind = { element: '', modifiers: [] };

  // Walk left side — inner `:` nodes accumulate modifiers
  let left = node.left;
  const rightParts: AirUINode[] = [];

  // Collect all right sides of inner `:` nodes (walked from outside in)
  while (left.kind === 'binary' && left.operator === ':') {
    rightParts.push(left.right);
    left = left.left;
  }

  // Leftmost node is the base element
  if (left.kind === 'element') {
    result.element = left.element;
    if (left.children) result.children = left.children;
  } else {
    return null; // Can't resolve — leftmost isn't an element
  }

  // Process collected inner right parts (reversed = original left-to-right order)
  rightParts.reverse();
  for (const part of rightParts) {
    classifyPart(result, part);
  }

  // Classify the outermost right side
  classifyPart(result, node.right);

  return result;
}

function classifyPart(result: ResolvedBind, node: AirUINode): void {
  if (node.kind === 'element') {
    // Plain element on right side of `:` → modifier
    result.modifiers.push(node.element);
    if (node.children) result.children = node.children;
  } else if (node.kind === 'unary' && node.operator === '#') {
    result.binding = node;
  } else if (node.kind === 'unary' && node.operator === '!') {
    result.action = node;
  } else if (node.kind === 'unary' && node.operator === '$') {
    result.binding = node;
  } else if (node.kind === 'text') {
    result.label = node.text;
  } else if (node.kind === 'binary' && node.operator === '.') {
    result.binding = node;
  } else if (node.kind === 'binary' && node.operator === '|') {
    result.binding = node;
  } else {
    // Unknown — treat as binding
    result.binding = node;
  }
}

// ---- Mutation Extraction ----

export interface MutationInfo {
  name: string;
  argNodes: AirUINode[];
}

/**
 * Recursively walk the UI tree and collect all `!` unary nodes.
 * Returns unique mutation names with their argument nodes.
 */
export function extractMutations(nodes: AirUINode[]): MutationInfo[] {
  const seen = new Map<string, MutationInfo>();
  for (const node of nodes) {
    walkForMutations(node, seen);
  }
  return Array.from(seen.values());
}

function walkForMutations(node: AirUINode, seen: Map<string, MutationInfo>): void {
  if (node.kind === 'unary' && node.operator === '!') {
    const name = extractMutationName(node.operand);
    if (name && !seen.has(name)) {
      const args = node.operand.kind === 'element' ? (node.operand.children ?? []) : [];
      seen.set(name, { name, argNodes: args });
    }
  }

  // Recurse into children
  switch (node.kind) {
    case 'element':
      if (node.children) node.children.forEach(c => walkForMutations(c, seen));
      break;
    case 'scoped':
      node.children.forEach(c => walkForMutations(c, seen));
      break;
    case 'unary':
      walkForMutations(node.operand, seen);
      break;
    case 'binary':
      walkForMutations(node.left, seen);
      walkForMutations(node.right, seen);
      break;
  }
}

function extractMutationName(node: AirUINode): string | null {
  if (node.kind === 'element') return node.element;
  if (node.kind === 'binary' && node.operator === '.') {
    const left = node.left.kind === 'element' ? node.left.element : null;
    const right = node.right.kind === 'element' ? node.right.element : null;
    if (left && right) return `${left}.${right}`;
  }
  return null;
}

// ---- UI Analysis ----

export interface PageInfo {
  name: string;
  children: AirUINode[];
}

export interface UIAnalysis {
  pages: PageInfo[];
  sections: PageInfo[];
  mutations: MutationInfo[];
  hasPages: boolean;
}

/**
 * Top-level UI analysis: extract pages, sections, and mutations.
 */
export function analyzeUI(nodes: AirUINode[]): UIAnalysis {
  const pages: PageInfo[] = [];
  const sections: PageInfo[] = [];

  collectScoped(nodes, pages, sections);

  const mutations = extractMutations(nodes);

  return {
    pages,
    sections,
    mutations,
    hasPages: pages.length > 0,
  };
}

function collectScoped(
  nodes: AirUINode[],
  pages: PageInfo[],
  sections: PageInfo[],
): void {
  for (const node of nodes) {
    if (node.kind === 'scoped') {
      if (node.scope === 'page') {
        pages.push({ name: node.name, children: node.children });
      } else if (node.scope === 'section') {
        sections.push({ name: node.name, children: node.children });
      }
    }
    // Also look inside binary compose/flow for nested scoped nodes
    if (node.kind === 'binary') {
      collectScoped([node.left, node.right], pages, sections);
    }
    if (node.kind === 'element' && node.children) {
      collectScoped(node.children, pages, sections);
    }
  }
}
