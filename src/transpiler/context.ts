/**
 * Extract TranspileContext from a parsed AirAST.
 * Walks all blocks once and collects metadata for the code generator.
 */

import type {
  AirAST, AirField, AirLiteral, AirRoute, AirNavRoute,
  AirAuthBlock, AirHook, AirUINode,
} from '../parser/types.js';

export interface TranspileContext {
  appName: string;
  state: AirField[];
  style: Record<string, AirLiteral>;
  persistKeys: string[];
  persistMethod: string;
  persistOptions: Record<string, AirLiteral>;
  apiRoutes: AirRoute[];
  navRoutes: AirNavRoute[];
  auth: AirAuthBlock | null;
  hooks: AirHook[];
  uiNodes: AirUINode[];
}

export function extractContext(ast: AirAST): TranspileContext {
  const ctx: TranspileContext = {
    appName: ast.app.name,
    state: [],
    style: {},
    persistKeys: [],
    persistMethod: 'localStorage',
    persistOptions: {},
    apiRoutes: [],
    navRoutes: [],
    auth: null,
    hooks: [],
    uiNodes: [],
  };

  for (const block of ast.app.blocks) {
    switch (block.kind) {
      case 'state':
        ctx.state = block.fields;
        break;
      case 'style':
        ctx.style = block.properties;
        break;
      case 'ui':
        ctx.uiNodes = block.children;
        break;
      case 'api':
        ctx.apiRoutes = block.routes;
        break;
      case 'nav':
        ctx.navRoutes = block.routes;
        break;
      case 'auth':
        ctx.auth = block;
        break;
      case 'hook':
        ctx.hooks = block.hooks;
        break;
      case 'persist':
        ctx.persistKeys = block.keys;
        ctx.persistMethod = block.method;
        ctx.persistOptions = block.options ?? {};
        break;
      // Backend blocks — not relevant for React transpile context
      default:
        break;
    }
  }

  return ctx;
}
