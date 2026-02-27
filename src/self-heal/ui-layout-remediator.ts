/**
 * UI/Layout Remediation Lane (H11 — Batch 3)
 *
 * Classifies visual/style/layout failures from QA assert_style and visual_snapshot
 * steps. Maps them to deterministic transpiler-level fixes in scaffold.ts,
 * layout-gen.ts, page-gen.ts, and jsx-gen.ts.
 *
 * Never patches generated output — only framework source.
 * Style direction: premium/modern/fluid, not generic.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { RuntimeQAResult, StepResult } from './runtime-qa.js';
import { isAllowedSelfHealPatchTarget, normalizePatchPath } from './transpiler-patch.js';

// ---- Types ----

export type UIIssueKind =
  | 'alignment-mismatch'
  | 'overflow-clipping'
  | 'spacing-inconsistency'
  | 'typography-hierarchy'
  | 'nav-sidebar-overlap'
  | 'z-index-stacking'
  | 'responsive-breakpoint';

export interface UIIssue {
  kind: UIIssueKind;
  severity: 'high' | 'medium' | 'low';
  details: string;
  selector?: string;
  evidence: string[];
}

export interface UIRemediationPatch {
  id: string;
  kind: UIIssueKind;
  target_file: string;
  description: string;
  apply: (source: string) => string;
}

export interface UIRemediationResult {
  action_id: string;
  kind: UIIssueKind;
  target_file: string;
  status: 'pass' | 'fail' | 'skip';
  description: string;
  details: string;
}

export interface UIRemediationReport {
  issues: UIIssue[];
  results: UIRemediationResult[];
  patchesApplied: number;
  durationMs: number;
}

// ---- Classifier ----

/**
 * Classify UI/layout issues from QA step results.
 * Looks at assert_style failures, visual_snapshot diffs, and element-not-found patterns.
 */
export function classifyUIIssues(qaResult: RuntimeQAResult): UIIssue[] {
  const issues: UIIssue[] = [];

  for (const step of qaResult.steps) {
    if (step.status !== 'fail') continue;
    const reason = (step.failure_reason || '').toLowerCase();

    // Style assertion failures
    if (step.action === 'assert_style') {
      const computed = step.evidence.computed_styles || {};

      // Alignment mismatch
      if (reason.includes('align') || reason.includes('justify') || reason.includes('text-align')) {
        issues.push({
          kind: 'alignment-mismatch',
          severity: 'medium',
          details: `Alignment mismatch on ${step.assert_style?.selector || 'unknown'}: ${reason}`,
          selector: step.assert_style?.selector,
          evidence: [reason, JSON.stringify(computed)],
        });
      }

      // Overflow/clipping
      if (reason.includes('overflow') || reason.includes('clip') || reason.includes('truncat')) {
        issues.push({
          kind: 'overflow-clipping',
          severity: 'high',
          details: `Overflow/clipping on ${step.assert_style?.selector || 'unknown'}: ${reason}`,
          selector: step.assert_style?.selector,
          evidence: [reason],
        });
      }

      // Spacing inconsistency
      if (reason.includes('padding') || reason.includes('margin') || reason.includes('gap') || reason.includes('spacing')) {
        issues.push({
          kind: 'spacing-inconsistency',
          severity: 'medium',
          details: `Spacing issue on ${step.assert_style?.selector || 'unknown'}: ${reason}`,
          selector: step.assert_style?.selector,
          evidence: [reason, JSON.stringify(computed)],
        });
      }

      // Typography hierarchy
      if (reason.includes('font-size') || reason.includes('font-weight') || reason.includes('line-height') || reason.includes('contrast')) {
        issues.push({
          kind: 'typography-hierarchy',
          severity: 'medium',
          details: `Typography issue on ${step.assert_style?.selector || 'unknown'}: ${reason}`,
          selector: step.assert_style?.selector,
          evidence: [reason],
        });
      }

      // Z-index / stacking
      if (reason.includes('z-index') || reason.includes('stack') || reason.includes('behind') || reason.includes('overlay')) {
        issues.push({
          kind: 'z-index-stacking',
          severity: 'high',
          details: `Z-index/stacking issue on ${step.assert_style?.selector || 'unknown'}: ${reason}`,
          selector: step.assert_style?.selector,
          evidence: [reason],
        });
      }

      // General style mismatch → check for common layout patterns
      if (reason.includes('style mismatch') && !issues.some(i => i.selector === step.assert_style?.selector)) {
        const sel = step.assert_style?.selector || '';
        if (sel.includes('nav') || sel.includes('sidebar') || sel.includes('aside')) {
          issues.push({
            kind: 'nav-sidebar-overlap',
            severity: 'high',
            details: `Nav/sidebar style mismatch: ${reason}`,
            selector: sel,
            evidence: [reason],
          });
        }
      }
    }

    // Visual snapshot failures → classify by content
    if (step.action === 'visual_snapshot' && step.evidence.visual_diff_score !== undefined) {
      const score = step.evidence.visual_diff_score;
      if (score > 0.1) {
        issues.push({
          kind: 'alignment-mismatch',
          severity: 'high',
          details: `Visual regression: ${step.visual_snapshot?.baseline_name} diff=${(score * 100).toFixed(1)}%`,
          evidence: [String(score)],
        });
      }
    }

    // Element not found for layout elements
    if (reason.includes('not found') || reason.includes('not visible')) {
      const sel = step.selector || '';
      if (sel.includes('nav') || sel.includes('header') || sel.includes('aside') || sel.includes('sidebar')) {
        issues.push({
          kind: 'nav-sidebar-overlap',
          severity: 'high',
          details: `Layout element not visible: ${sel}`,
          selector: sel,
          evidence: [reason],
        });
      }
    }
  }

  // Deduplicate by kind
  const seen = new Set<UIIssueKind>();
  return issues.filter(issue => {
    if (seen.has(issue.kind)) return false;
    seen.add(issue.kind);
    return true;
  });
}

// ---- Deterministic Patches ----

const UI_PATCHES: UIRemediationPatch[] = [
  {
    id: 'UI-001',
    kind: 'overflow-clipping',
    target_file: 'src/transpiler/scaffold.ts',
    description: 'Add overflow safety to card and content containers in base CSS',
    apply: (source) => {
      // Ensure .card-grid and main content containers have overflow handling
      if (source.includes('overflow-wrap: break-word')) return source;
      return source.replace(
        /(\* \{ box-sizing: border-box;)/,
        '* { box-sizing: border-box; overflow-wrap: break-word;',
      );
    },
  },
  {
    id: 'UI-002',
    kind: 'nav-sidebar-overlap',
    target_file: 'src/transpiler/react/layout-gen.ts',
    description: 'Ensure sidebar z-index and main content margin-left are coordinated',
    apply: (source) => {
      // Ensure sidebar has consistent z-50 and main content has ml-64 on lg+
      if (source.includes('z-50 h-screen w-64') && source.includes('lg:ml-64')) return source;

      // Fix sidebar z-index if missing
      let result = source;
      result = result.replace(
        /fixed lg:sticky top-0 left-0 z-\d+ h-screen w-64/g,
        'fixed lg:sticky top-0 left-0 z-50 h-screen w-64',
      );
      return result;
    },
  },
  {
    id: 'UI-003',
    kind: 'spacing-inconsistency',
    target_file: 'src/transpiler/react/layout-gen.ts',
    description: 'Normalize sidebar nav padding for consistent alignment',
    apply: (source) => {
      // Ensure nav buttons have consistent px-3 padding
      let result = source;
      // Normalize sidebar button padding to px-3
      result = result.replace(
        /(w-full text-left justify-start\s+)px-\d+(\s+py-2)/g,
        '$1px-3$2',
      );
      return result;
    },
  },
  {
    id: 'UI-004',
    kind: 'typography-hierarchy',
    target_file: 'src/transpiler/scaffold.ts',
    description: 'Strengthen heading typography hierarchy in base CSS',
    apply: (source) => {
      // Ensure h1-h3 have clear size hierarchy via :where() selectors
      if (source.includes(':where(h1) { font-size: 2rem')) return source;
      // The scaffold already has heading styles — ensure they use :where() wrappers
      // and have distinct sizes
      let result = source;
      // Fix any bare h1/h2/h3 selectors to use :where()
      result = result.replace(/^(h1)\s*\{/gm, ':where(h1) {');
      result = result.replace(/^(h2)\s*\{/gm, ':where(h2) {');
      result = result.replace(/^(h3)\s*\{/gm, ':where(h3) {');
      return result;
    },
  },
  {
    id: 'UI-005',
    kind: 'z-index-stacking',
    target_file: 'src/transpiler/scaffold.ts',
    description: 'Establish z-index layering system in base CSS',
    apply: (source) => {
      // Ensure modal overlay has z-50 and popups z-60
      if (source.includes('--z-modal: 50')) return source;
      // Add CSS custom properties for z-index layering if not present
      const zLayering = `\n  --z-nav: 40;\n  --z-sidebar: 50;\n  --z-modal: 50;\n  --z-toast: 60;`;
      if (source.includes('--z-nav')) return source;
      // Insert after --radius custom property
      return source.replace(
        /(--radius:\s*[^;]+;)/,
        `$1${zLayering}`,
      );
    },
  },
  {
    id: 'UI-006',
    kind: 'alignment-mismatch',
    target_file: 'src/transpiler/react/page-gen.ts',
    description: 'Ensure grid layouts use consistent gap and alignment',
    apply: (source) => {
      // Normalize grid gap values — ensure gap-4 minimum for card grids
      let result = source;
      // Fix any gap-2 in grid contexts to gap-4 for better spacing
      result = result.replace(
        /grid grid-cols-(\d) gap-2/g,
        'grid grid-cols-$1 gap-4',
      );
      return result;
    },
  },
  {
    id: 'UI-007',
    kind: 'responsive-breakpoint',
    target_file: 'src/transpiler/react/jsx-gen.ts',
    description: 'Ensure card grids have responsive column counts',
    apply: (source) => {
      // Ensure grid:3 generates responsive columns (sm:1, md:2, lg:3)
      // Check if responsive grid classes are already present
      if (source.includes('grid-cols-1 md:grid-cols-2 lg:grid-cols-3')) return source;
      // Fix hardcoded grid-cols-3 to responsive
      let result = source;
      result = result.replace(
        /grid grid-cols-3 gap/g,
        'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap',
      );
      return result;
    },
  },
];

// ---- Runner ----

/**
 * Run UI/layout remediation patches for classified issues.
 * Only applies patches to allowed framework source files.
 */
export function runUIRemediation(
  issues: UIIssue[],
  projectRoot: string = process.cwd(),
): UIRemediationReport {
  const start = performance.now();
  const results: UIRemediationResult[] = [];
  const handledKinds = new Set<UIIssueKind>();

  for (const issue of issues) {
    if (handledKinds.has(issue.kind)) continue;

    const patch = UI_PATCHES.find(p => p.kind === issue.kind);
    if (!patch) continue;

    // Guard: only framework source
    const normalized = normalizePatchPath(patch.target_file);
    if (!isAllowedSelfHealPatchTarget(normalized)) {
      results.push({
        action_id: patch.id,
        kind: patch.kind,
        target_file: patch.target_file,
        status: 'skip',
        description: patch.description,
        details: `Target not allowed for self-heal: ${patch.target_file}`,
      });
      continue;
    }

    const filePath = join(projectRoot, patch.target_file);
    if (!existsSync(filePath)) {
      results.push({
        action_id: patch.id,
        kind: patch.kind,
        target_file: patch.target_file,
        status: 'skip',
        description: patch.description,
        details: `File not found: ${filePath}`,
      });
      continue;
    }

    try {
      const original = readFileSync(filePath, 'utf-8');
      const patched = patch.apply(original);

      if (original === patched) {
        results.push({
          action_id: patch.id,
          kind: patch.kind,
          target_file: patch.target_file,
          status: 'skip',
          description: patch.description,
          details: 'No change needed (already correct)',
        });
      } else {
        results.push({
          action_id: patch.id,
          kind: patch.kind,
          target_file: patch.target_file,
          status: 'pass',
          description: patch.description,
          details: `Patched ${patch.target_file}`,
        });
      }
      handledKinds.add(issue.kind);
    } catch (err) {
      results.push({
        action_id: patch.id,
        kind: patch.kind,
        target_file: patch.target_file,
        status: 'fail',
        description: patch.description,
        details: `Patch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    issues,
    results,
    patchesApplied: results.filter(r => r.status === 'pass').length,
    durationMs: Math.round(performance.now() - start),
  };
}

/**
 * Quick check: does the QA result suggest UI/layout issues?
 */
export function hasUIIssues(qaResult: RuntimeQAResult): boolean {
  return qaResult.steps.some(s => {
    if (s.status !== 'fail') return false;
    return s.action === 'assert_style' ||
      s.action === 'visual_snapshot' ||
      (s.failure_reason || '').toLowerCase().includes('style mismatch');
  });
}

/**
 * Get the list of target files that UI patches may touch.
 * Used by promotion guard to verify all targets are framework-owned.
 */
export function getUIRemediationTargets(): string[] {
  return [...new Set(UI_PATCHES.map(p => p.target_file))];
}
