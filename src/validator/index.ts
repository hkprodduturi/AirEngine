/**
 * AIR Validator
 *
 * Validates an AirAST against the AIR schema rules.
 * Ensures structural correctness that goes beyond parsing —
 * e.g., state references in @ui actually exist in @state.
 */

import type { AirAST } from '../parser/types.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  block?: string;
  path?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

export function validate(ast: AirAST): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Rule: app must have a name
  if (!ast.app.name) {
    errors.push({
      code: 'E001',
      message: 'App must have a name (@app:name)',
    });
  }

  // Rule: must have at least @state and @ui blocks
  const hasState = ast.app.blocks.some(b => b.kind === 'state');
  const hasUI = ast.app.blocks.some(b => b.kind === 'ui');

  if (!hasState) {
    warnings.push({
      code: 'W001',
      message: 'No @state block found — app has no reactive state',
      suggestion: 'Add @state{...} to define your app state',
    });
  }

  if (!hasUI) {
    errors.push({
      code: 'E002',
      message: 'No @ui block found — app has no interface',
    });
  }

  // TODO: Phase 1 will add:
  // - State reference validation (#refs exist in @state)
  // - API route validation
  // - Type checking
  // - Circular reference detection

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
