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
  return `import { useState } from 'react';

/**
 * Reusable data table component with loading, empty states, action column, and row hover.
 *
 * @param {{ columns: { key: string, label: string, render?: (value: any, row: any) => any }[], data: any[], loading?: boolean, emptyMessage?: string, onEdit?: (row: any) => void, onDelete?: (row: any) => void, actions?: (row: any) => any }} props
 */
export default function DataTable({ columns, data, loading = false, emptyMessage = 'No data available', onEdit, onDelete, actions }) {
  const [deleteId, setDeleteId] = useState(null);

  if (loading) {
    return (
      <div className="border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
        <div className="animate-pulse">
          <div className="h-11 bg-[var(--hover)] border-b border-[var(--border)]" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 p-4 border-b border-[var(--border)] last:border-0">
              {columns.map((_, j) => (
                <div key={j} className="h-4 bg-[var(--hover)] rounded flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const hasActions = onEdit || onDelete || actions;

  return (
    <>
      <div className="border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--surface)]">
                {columns.map((col) => (
                  <th key={col.key} className="text-left px-4 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">{col.label}</th>
                ))}
                {hasActions && <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + (hasActions ? 1 : 0)} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2 text-[var(--muted)]">
                      <svg className="w-10 h-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                      </svg>
                      <p className="text-sm">{emptyMessage}</p>
                    </div>
                  </td>
                </tr>
              ) : data.map((row, i) => (
                <tr key={row.id ?? i} className="hover:bg-[var(--hover)] transition-colors">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-sm">
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {actions && actions(row)}
                        {onEdit && (
                          <button onClick={() => onEdit(row)} className="p-1.5 rounded-md hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors" title="Edit">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                            </svg>
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-md hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 transition-colors" title="Delete">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteId !== null && (
        <div className="modal-backdrop" onClick={() => setDeleteId(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Confirm Deletion</h3>
            <p className="text-sm text-[var(--muted)] mb-6">Are you sure you want to delete this item? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-[var(--radius)] border border-[var(--border)] hover:bg-[var(--hover)] text-sm transition-colors">Cancel</button>
              <button onClick={() => { onDelete(data.find(r => r.id === deleteId)); setDeleteId(null); }} className="px-4 py-2 rounded-[var(--radius)] bg-red-500 text-white hover:bg-red-600 text-sm transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
`;
}

function emptyStateComponent(): string {
  return `/**
 * Empty state placeholder with icon, message, and optional action button.
 *
 * @param {{ message?: string, description?: string, action?: string, onAction?: () => void }} props
 */
export default function EmptyState({ message = 'No items yet', description, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-[var(--hover)] flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <h3 className="text-sm font-medium mb-1">{message}</h3>
      {description && <p className="text-sm text-[var(--muted)] max-w-sm mb-4">{description}</p>}
      {action && onAction && (
        <button
          onClick={onAction}
          className="mt-2 px-4 py-2 bg-[var(--accent)] text-white rounded-[var(--radius)] text-sm font-medium hover:opacity-90 transition-colors"
        >
          {action}
        </button>
      )}
    </div>
  );
}
`;
}

function statCardComponent(): string {
  return `/**
 * Stat display card with label, value, optional formatting, trend indicator, and icon.
 *
 * @param {{ label: string, value: any, format?: 'number' | 'currency' | 'percent', trend?: number, icon?: any, description?: string }} props
 */
export default function StatCard({ label, value, format, trend, icon, description }) {
  const formatted = (() => {
    if (format === 'currency') return '$' + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (format === 'percent') return Number(value).toFixed(1) + '%';
    if (format === 'number') return Number(value).toLocaleString();
    return value;
  })();

  const trendColor = trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-[var(--muted)]';
  const trendIcon = trend > 0 ? '\\u2191' : trend < 0 ? '\\u2193' : '';

  return (
    <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] p-6 hover:border-[color-mix(in_srgb,var(--border)_60%,var(--accent))] transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">{label}</span>
        {icon && <span className="text-[var(--muted)] opacity-60">{icon}</span>}
      </div>
      <div className="text-2xl font-bold tracking-tight">{formatted}</div>
      {(trend !== undefined || description) && (
        <div className="flex items-center gap-2 mt-2">
          {trend !== undefined && (
            <span className={\`text-xs font-medium \${trendColor}\`}>
              {trendIcon} {Math.abs(trend)}%
            </span>
          )}
          {description && <span className="text-xs text-[var(--muted)]">{description}</span>}
        </div>
      )}
    </div>
  );
}
`;
}

// ---- Confirm Modal Component ----

function confirmModalComponent(): string {
  return `/**
 * Reusable confirmation modal — replaces window.confirm with a styled dialog.
 *
 * @param {{ open: boolean, title?: string, message?: string, confirmLabel?: string, onConfirm: () => void, onCancel: () => void, variant?: 'danger' | 'default' }} props
 */
export default function ConfirmModal({ open, title = 'Confirm', message = 'Are you sure?', confirmLabel = 'Confirm', onConfirm, onCancel, variant = 'default' }) {
  if (!open) return null;

  const btnClass = variant === 'danger'
    ? 'bg-red-500 text-white hover:bg-red-600'
    : 'bg-[var(--accent)] text-white hover:opacity-90';

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-[var(--muted)] mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-[var(--radius)] border border-[var(--border)] hover:bg-[var(--hover)] text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={\`px-4 py-2 rounded-[var(--radius)] text-sm font-medium transition-colors \${btnClass}\`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
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

  // Generate ConfirmModal when other components are present (avoids dead code in simple apps)
  if (files.length > 0) {
    files.push({
      path: 'src/components/ConfirmModal.jsx',
      content: confirmModalComponent(),
    });
  }

  return files;
}
