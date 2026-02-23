/**
 * Reusable UI Component Generator
 *
 * Walks the UI tree and detects patterns that warrant reusable components.
 * Components are ADDITIVE only — existing inline JSX is unchanged.
 * Generated components are available for user refactoring.
 *
 * Detection rules:
 *   - `table` element  → DataTable.jsx
 *   - `*` iteration    → EmptyState.jsx
 *   - `stat` element   → StatCard.jsx
 */

import type { TranspileContext } from './context.js';
import type { OutputFile } from './index.js';
import type { AirUINode } from '../parser/types.js';
import type { UIAnalysis } from './normalize-ui.js';

// ---- Detection Flags ----

export interface ComponentFlags {
  hasTable: boolean;
  hasIteration: boolean;
  hasStat: boolean;
}

// ---- Tree Walker ----

/**
 * Recursively walk a UI node and set detection flags.
 */
function walkNode(node: AirUINode, flags: ComponentFlags): void {
  switch (node.kind) {
    case 'element':
      if (node.element === 'table') flags.hasTable = true;
      if (node.element === 'stat') flags.hasStat = true;
      if (node.children) {
        for (const child of node.children) {
          walkNode(child, flags);
        }
      }
      break;

    case 'scoped':
      for (const child of node.children) {
        walkNode(child, flags);
      }
      break;

    case 'unary':
      if (node.operator === '*') flags.hasIteration = true;
      walkNode(node.operand, flags);
      break;

    case 'binary':
      walkNode(node.left, flags);
      walkNode(node.right, flags);
      break;

    // text and value nodes are leaf nodes — nothing to detect
    case 'text':
    case 'value':
      break;
  }
}

/**
 * Walk all UI nodes and return detection flags.
 */
export function detectPatterns(nodes: AirUINode[]): ComponentFlags {
  const flags: ComponentFlags = {
    hasTable: false,
    hasIteration: false,
    hasStat: false,
  };

  for (const node of nodes) {
    walkNode(node, flags);
  }

  return flags;
}

// ---- Component Templates ----

function dataTableComponent(): string {
  return `/**
 * Reusable data table component with loading and empty states.
 *
 * @param {{ columns: { key: string, label: string }[], data: any[], loading?: boolean, emptyMessage?: string }} props
 */
export default function DataTable({ columns, data, loading = false, emptyMessage = 'No data available' }) {
  if (loading) {
    return <div className="animate-pulse space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-[var(--hover)] rounded" />)}</div>;
  }

  return (
    <table className="w-full">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className="text-left px-4 py-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">{col.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr><td colSpan={columns.length} className="text-center py-8 text-[var(--muted)]">{emptyMessage}</td></tr>
        ) : data.map((row, i) => (
          <tr key={row.id ?? i} className="border-t border-[var(--border)]">
            {columns.map((col) => (
              <td key={col.key} className="px-4 py-3">{row[col.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
`;
}

function emptyStateComponent(): string {
  return `/**
 * Empty state placeholder with optional icon and message.
 *
 * @param {{ message?: string, icon?: string }} props
 */
export default function EmptyState({ message = 'No items yet', icon = '\\u{1F4ED}' }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)]">
      <span className="text-4xl mb-3">{icon}</span>
      <p className="text-sm">{message}</p>
    </div>
  );
}
`;
}

function statCardComponent(): string {
  return `/**
 * Stat display card with label, value, and optional formatting.
 *
 * @param {{ label: string, value: any, format?: 'number' | 'currency' | 'percent' }} props
 */
export default function StatCard({ label, value, format }) {
  const formatted = (() => {
    if (format === 'currency') return '$' + Number(value).toFixed(2);
    if (format === 'percent') return Number(value).toFixed(1) + '%';
    if (format === 'number') return Number(value).toLocaleString();
    return value;
  })();

  return (
    <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] p-6 space-y-2">
      <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold">{formatted}</div>
    </div>
  );
}
`;
}

// ---- Public API ----

/**
 * Generate reusable UI components based on patterns detected in the UI tree.
 *
 * Only generates when `ctx.hasBackend` is true. Returns an empty array when
 * no patterns are detected or the app is frontend-only.
 */
export function generateReusableComponents(
  ctx: TranspileContext,
  analysis: UIAnalysis,
): OutputFile[] {
  // Guard: only generate for fullstack apps
  if (!ctx.hasBackend) return [];

  const flags = detectPatterns(ctx.uiNodes);
  const files: OutputFile[] = [];

  if (flags.hasTable) {
    files.push({
      path: 'src/components/DataTable.jsx',
      content: dataTableComponent(),
    });
  }

  if (flags.hasIteration) {
    files.push({
      path: 'src/components/EmptyState.jsx',
      content: emptyStateComponent(),
    });
  }

  if (flags.hasStat) {
    files.push({
      path: 'src/components/StatCard.jsx',
      content: statCardComponent(),
    });
  }

  return files;
}
