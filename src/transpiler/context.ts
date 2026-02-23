/**
 * Extract TranspileContext from a parsed AirAST.
 * Walks all blocks once and collects metadata for the code generator.
 */

import type {
  AirAST, AirField, AirLiteral, AirRoute, AirNavRoute,
  AirAuthBlock, AirHook, AirUINode,
  AirDbBlock, AirWebhookBlock, AirCronBlock, AirQueueBlock,
  AirEmailBlock, AirEnvBlock, AirDeployBlock,
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
  // Backend blocks
  db: AirDbBlock | null;
  webhooks: AirWebhookBlock | null;
  cron: AirCronBlock | null;
  queue: AirQueueBlock | null;
  email: AirEmailBlock | null;
  env: AirEnvBlock | null;
  deploy: AirDeployBlock | null;
  hasBackend: boolean;
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
    db: null,
    webhooks: null,
    cron: null,
    queue: null,
    email: null,
    env: null,
    deploy: null,
    hasBackend: false,
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
      case 'db':
        ctx.db = block;
        break;
      case 'webhook':
        ctx.webhooks = block;
        break;
      case 'cron':
        ctx.cron = block;
        break;
      case 'queue':
        ctx.queue = block;
        break;
      case 'email':
        ctx.email = block;
        break;
      case 'env':
        ctx.env = block;
        break;
      case 'deploy':
        ctx.deploy = block;
        break;
    }
  }

  // hasBackend if ANY backend block exists
  ctx.hasBackend = Boolean(
    ctx.db || ctx.apiRoutes.length > 0 || ctx.webhooks ||
    ctx.cron || ctx.queue || ctx.email || ctx.env || ctx.deploy
  );

  return ctx;
}
