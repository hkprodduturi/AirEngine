/**
 * AIR Validator
 *
 * Validates an AirAST against the AIR schema rules.
 * Ensures structural correctness that goes beyond parsing —
 * e.g., state references in @ui actually exist in @state.
 *
 * Supports both legacy format (validate) and new Diagnostic format (diagnose).
 */

import type { AirAST, AirUINode } from '../parser/types.js';
import type { Diagnostic } from '../diagnostics.js';
import { createDiagnostic } from '../diagnostics.js';

// ---- Helpers ----

/** Recursively collect @page names from UI node tree */
function collectPages(nodes: AirUINode[], pages: { name: string }[]): void {
  for (const node of nodes) {
    if (node.kind === 'scoped' && node.scope === 'page') {
      pages.push({ name: node.name });
      collectPages(node.children, pages);
    } else if (node.kind === 'binary') {
      collectPages([node.left, node.right], pages);
    } else if (node.kind === 'unary') {
      collectPages([node.operand], pages);
    } else if ('children' in node && node.children) {
      collectPages(node.children as AirUINode[], pages);
    }
  }
}

// ---- Legacy Types (backward compatibility) ----

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

// ---- New Diagnostic-Based Validation ----

/**
 * Produce structured diagnostics from an AST.
 * This is the primary validation entry point for v2 format.
 */
export function diagnose(ast: AirAST): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // E001: app must have a name
  if (!ast.app.name) {
    diagnostics.push(createDiagnostic('AIR-E001', 'error', 'Missing @app:name declaration', 'structural', {
      fix: {
        description: 'Add @app:name as the first line of the file',
        suggestion: '@app:myapp',
      },
    }));
  }

  const hasState = ast.app.blocks.some(b => b.kind === 'state');
  const hasUI = ast.app.blocks.some(b => b.kind === 'ui');
  const hasPersist = ast.app.blocks.some(b => b.kind === 'persist');
  const hasDb = ast.app.blocks.some(b => b.kind === 'db');
  const hasApi = ast.app.blocks.some(b => b.kind === 'api');
  const hasAuth = ast.app.blocks.some(b => b.kind === 'auth');

  // E002: must have @ui block
  if (!hasUI) {
    diagnostics.push(createDiagnostic('AIR-E002', 'error', 'No @ui block found — app has no interface', 'structural', {
      fix: {
        description: 'Add @ui{...} to define your app interface',
        suggestion: '@ui(h1>"Hello World")',
      },
    }));
  }

  // W001: no @state block
  if (!hasState) {
    diagnostics.push(createDiagnostic('AIR-W001', 'warning', 'No @state block found — app has no reactive state', 'structural', {
      fix: {
        description: 'Add @state{...} to define your app state',
        suggestion: '@state{items:[{id:int,name:str}]}',
      },
    }));
  }

  // W002: @db without @api (migrated from MCP lint)
  if (hasDb && !hasApi) {
    diagnostics.push(createDiagnostic('AIR-W002', 'warning', "@db models defined but no @api routes — models won't be accessible", 'semantic', {
      block: '@db',
      fix: {
        description: 'Add @api routes to expose your @db models via REST endpoints',
        suggestion: '@api(CRUD:/items>~db.Item)',
      },
    }));
  }

  // W004: unused state fields (migrated from MCP lint)
  if (hasState && hasUI) {
    const uiSource = JSON.stringify(ast.app.blocks.filter(b => b.kind === 'ui'));
    for (const block of ast.app.blocks) {
      if (block.kind === 'state') {
        for (const field of block.fields) {
          if (!uiSource.includes(field.name) && !uiSource.includes(`#${field.name}`)) {
            diagnostics.push(createDiagnostic('AIR-W004', 'warning', `State field '${field.name}' appears unused in @ui`, 'style', {
              block: '@state',
              path: field.name,
              fix: {
                description: `Either reference #${field.name} in @ui or remove from @state`,
              },
            }));
          }
        }
      }
    }
  }

  // E003: API routes referencing unknown models (migrated from MCP lint)
  if (hasApi && hasDb) {
    const dbBlock = ast.app.blocks.find(b => b.kind === 'db');
    if (dbBlock && 'models' in dbBlock) {
      const modelNames = new Set((dbBlock as { models: { name: string }[] }).models.map(m => m.name));
      const apiBlock = ast.app.blocks.find(b => b.kind === 'api');
      if (apiBlock && 'routes' in apiBlock) {
        for (const route of (apiBlock as { routes: { method: string; path: string; handler: string }[] }).routes) {
          const match = route.handler.match(/~db\.(\w+)/);
          if (match && !modelNames.has(match[1])) {
            diagnostics.push(createDiagnostic('AIR-E003', 'error', `API route ${route.method} ${route.path} references unknown model '${match[1]}'`, 'semantic', {
              block: '@api',
              path: `${route.method}:${route.path}`,
              fix: {
                description: `Add a ${match[1]} model to @db, or fix the model name in the route handler`,
                suggestion: `@db{${match[1]}{id:int:primary:auto,name:str:required}}`,
              },
            }));
          }
        }
      }
    }
  }

  // L001: missing @persist on frontend-only stateful apps (migrated from MCP lint)
  if (hasState && !hasPersist && !hasDb) {
    diagnostics.push(createDiagnostic('AIR-L001', 'info', "Frontend-only app with @state but no @persist — data won't survive page refresh", 'style', {
      fix: {
        description: 'Add @persist:localStorage(fieldName) to persist state across page refreshes',
        suggestion: '@persist:localStorage(items)',
      },
    }));
  }

  // ---- A1-Rules: Expanded Validator Rules ----

  // Extract pages from @ui blocks
  const pages: { name: string }[] = [];
  for (const block of ast.app.blocks) {
    if (block.kind === 'ui') {
      collectPages(block.children, pages);
    }
  }

  // E004: Duplicate @page name
  const pageNameCounts = new Map<string, number>();
  for (const p of pages) {
    pageNameCounts.set(p.name, (pageNameCounts.get(p.name) || 0) + 1);
  }
  for (const [name, count] of pageNameCounts) {
    if (count > 1) {
      diagnostics.push(createDiagnostic('AIR-E004', 'error', `Duplicate @page name '${name}'`, 'structural', {
        block: '@ui',
        path: `@page:${name}`,
        fix: {
          description: `Rename one of the duplicate @page:${name} declarations to a unique name`,
        },
      }));
    }
  }

  // E005: @nav references undefined page
  // Nav routes: { path, target, fallback?, condition? }
  // target/fallback are page names when target === 'page' (fallback is the page name)
  // or direct page names otherwise
  const pageNames = new Set(pages.map(p => p.name));
  for (const block of ast.app.blocks) {
    if (block.kind === 'nav') {
      for (const route of block.routes) {
        // Collect all page references from target and fallback
        const refs: string[] = [];
        if (route.target && route.target !== 'page') {
          refs.push(route.target);
        }
        if (route.fallback) {
          refs.push(route.fallback);
        }
        for (const ref of refs) {
          // Skip condition-like values (e.g., 'user'), directives (@protected),
          // redirect paths containing '/', route-like references, and navigation action keywords
          const NAV_KEYWORDS = new Set(['redirect', 'back', 'reload', 'replace', 'push', 'pop']);
          if (ref.startsWith('?') || ref === '/' || ref.startsWith('@') || ref.includes('/') || ref.includes(':') || NAV_KEYWORDS.has(ref)) continue;
          if (!pageNames.has(ref) && pageNames.size > 0) {
            diagnostics.push(createDiagnostic('AIR-E005', 'error', `@nav references page '${ref}' not defined in @ui`, 'semantic', {
              block: '@nav',
              path: route.path,
              fix: {
                description: `Add @page:${ref} to @ui, or fix the page name in @nav`,
                suggestion: `@page:${ref}(h1>"${ref}")`,
              },
            }));
          }
        }
      }
    }
  }

  // E007: CRUD handler refs missing model
  if (hasApi && hasDb) {
    const dbBlock = ast.app.blocks.find(b => b.kind === 'db');
    if (dbBlock && 'models' in dbBlock) {
      const modelNames = new Set((dbBlock as { models: { name: string }[] }).models.map(m => m.name));
      const apiBlock = ast.app.blocks.find(b => b.kind === 'api');
      if (apiBlock && 'routes' in apiBlock) {
        for (const route of (apiBlock as { routes: { method: string; path: string; handler: string }[] }).routes) {
          if (route.method === 'CRUD') {
            const match = route.handler.match(/~db\.(\w+)/);
            if (match && !modelNames.has(match[1])) {
              diagnostics.push(createDiagnostic('AIR-E007', 'error', `CRUD handler references model '${match[1]}' not in @db`, 'semantic', {
                block: '@api',
                path: `CRUD:${route.path}`,
                fix: {
                  description: `Add ${match[1]} model to @db or fix the model name`,
                  suggestion: `@db{${match[1]}{id:int:primary:auto,name:str:required}}`,
                },
              }));
            }
          }
        }
      }
    }
  }

  // E008: @auth(required) without login route in @api
  if (hasAuth) {
    const authBlock = ast.app.blocks.find(b => b.kind === 'auth');
    if (authBlock && 'required' in authBlock && authBlock.required) {
      const apiBlock = ast.app.blocks.find(b => b.kind === 'api');
      const hasLoginRoute = apiBlock && 'routes' in apiBlock &&
        (apiBlock as { routes: { path: string }[] }).routes.some(r =>
          r.path.endsWith('/login')
        );
      if (!hasLoginRoute) {
        diagnostics.push(createDiagnostic('AIR-W008', 'warning', '@auth(required) without login route in @api — external auth may be intended', 'semantic', {
          block: '@auth',
          fix: {
            description: 'Add a login route to @api for authentication',
            suggestion: 'POST:/auth/login(email:str,password:str)>auth.login',
          },
        }));
      }
    }
  }

  // W005: Auth routes without @auth block
  if (!hasAuth && hasApi) {
    const apiBlock = ast.app.blocks.find(b => b.kind === 'api');
    if (apiBlock && 'routes' in apiBlock) {
      const authRoutes = (apiBlock as { routes: { path: string }[] }).routes.filter(r =>
        r.path.includes('/auth/') || r.path.endsWith('/login') || r.path.endsWith('/signup') || r.path.endsWith('/register')
      );
      if (authRoutes.length > 0) {
        diagnostics.push(createDiagnostic('AIR-W005', 'warning', 'Auth routes defined without @auth block — auth may not be enforced', 'semantic', {
          block: '@api',
          fix: {
            description: 'Add @auth(required) to enforce authentication on protected routes',
            suggestion: '@auth(required)',
          },
        }));
      }
    }
  }

  // W007: @db model no PK
  if (hasDb) {
    const dbBlock = ast.app.blocks.find(b => b.kind === 'db');
    if (dbBlock && 'models' in dbBlock) {
      for (const model of (dbBlock as { models: { name: string; fields: { primary?: boolean; name: string }[] }[] }).models) {
        const hasPK = model.fields.some(f => f.primary);
        if (!hasPK) {
          diagnostics.push(createDiagnostic('AIR-W007', 'warning', `@db model '${model.name}' has no primary key field`, 'structural', {
            block: '@db',
            path: model.name,
            fix: {
              description: `Add a primary key field to ${model.name}`,
              suggestion: `id:int:primary:auto`,
            },
          }));
        }
      }
    }
  }

  // W003: Ambiguous relation (basic check — full check requires transpiler context)
  // This checks for models that reference each other without explicit @relation
  if (hasDb) {
    const dbBlock = ast.app.blocks.find(b => b.kind === 'db');
    if (dbBlock && 'models' in dbBlock && 'relations' in dbBlock) {
      const db = dbBlock as { models: { name: string; fields: { name: string }[] }[]; relations: { from: string; to: string }[] };
      // Check for multiple FK fields between same model pairs
      const refCounts = new Map<string, number>();
      for (const model of db.models) {
        for (const field of model.fields) {
          if (field.name.endsWith('_id')) {
            const refModel = field.name.replace(/_id$/, '');
            const key = `${model.name}->${refModel}`;
            refCounts.set(key, (refCounts.get(key) || 0) + 1);
          }
        }
      }
      for (const [key, count] of refCounts) {
        if (count > 1) {
          const [from, to] = key.split('->');
          diagnostics.push(createDiagnostic('AIR-W003', 'warning', `Ambiguous relation ${from}<>${to}: multiple FK fields found`, 'semantic', {
            block: '@db',
            path: `${from}<>${to}`,
            fix: {
              description: 'Add explicit @relation to clarify which field is the foreign key',
            },
          }));
        }
      }
    }
  }

  // L002: @style not specified
  const hasStyle = ast.app.blocks.some(b => b.kind === 'style');
  if (!hasStyle) {
    diagnostics.push(createDiagnostic('AIR-L002', 'info', '@style not specified — default theme will be applied', 'style', {
      fix: {
        description: 'Add @style(...) to customize colors, fonts, and layout',
        suggestion: '@style(dark,rounded,indigo)',
      },
    }));
  }

  return diagnostics;
}

// ---- Legacy API (backward compatible) ----

export function validate(ast: AirAST): ValidationResult {
  const diagnostics = diagnose(ast);

  const errors: ValidationError[] = diagnostics
    .filter(d => d.severity === 'error')
    .map(d => ({
      code: d.code.replace('AIR-', ''),
      message: d.message,
      ...(d.block && { block: d.block }),
      ...(d.path && { path: d.path }),
    }));

  const warnings: ValidationWarning[] = diagnostics
    .filter(d => d.severity === 'warning' || d.severity === 'info')
    .map(d => ({
      code: d.code.replace('AIR-', ''),
      message: d.message,
      ...(d.fix?.description && { suggestion: d.fix.description }),
    }));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
