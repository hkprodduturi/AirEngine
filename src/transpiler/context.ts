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
import { expandCrud } from './route-utils.js';
import { isAuthPageName } from './react/helpers.js';

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
  /** Pre-expanded API routes (CRUD → GET/POST/PUT/DELETE). Computed once eagerly. */
  expandedRoutes: AirRoute[];
  /** Page names that are public (no auth guard) — derived from unconditional @nav routes */
  publicPageNames: string[];
  /** True when app has Product+Category models and shop/cart pages — triggers Amazon-style layout */
  isEcommerce: boolean;
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
    expandedRoutes: [],
    publicPageNames: [],
    isEcommerce: false,
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

  // Pre-expand CRUD routes once
  ctx.expandedRoutes = expandCrud(ctx.apiRoutes);

  // Derive public page names: unconditional @nav routes that aren't auth pages
  // Also filter out routes with empty paths (parser artifacts from complex nav syntax)
  ctx.publicPageNames = ctx.navRoutes
    .filter(r => r.path && !r.condition && !isAuthPageName(r.target))
    .map(r => r.target);

  // Detect ecommerce pattern: Product+Category models AND shop/cart pages
  if (ctx.db) {
    const modelNames = new Set(ctx.db.models.map(m => m.name.toLowerCase()));
    const hasProductModel = modelNames.has('product');
    const hasCategoryModel = modelNames.has('category');
    const pageNames = ctx.uiNodes
      .filter(n => n.kind === 'scoped' && n.scope === 'page')
      .map(n => (n as { name?: string }).name?.toLowerCase() ?? '');
    const hasShopPage = pageNames.includes('shop');
    const hasCartPage = pageNames.includes('cart');
    ctx.isEcommerce = hasProductModel && hasCategoryModel && hasShopPage && hasCartPage;
  }

  return ctx;
}
