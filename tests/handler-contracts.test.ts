/**
 * H13 + H14: Handler Contract Tests
 *
 * Tests for @handler block parsing, context extraction,
 * mutation wiring, server endpoints, API client naming,
 * diagnostics, executable targets, and integration.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser/index.js';
import { extractContext } from '../src/transpiler/context.js';
import { generateMutations, findGenericRouteMatch } from '../src/transpiler/react/mutation-gen.js';
import { analyzeUI } from '../src/transpiler/normalize-ui.js';
import { generateApiClient } from '../src/transpiler/api-client-gen.js';
import { transpile } from '../src/transpiler/index.js';
import { CODEGEN_TRACE_REGISTRY, runAllTraces } from '../src/self-heal/codegen-trace.js';

// ---- Helper ----
function makeSource(blocks: string): string {
  return `@app:test\n${blocks}`;
}

// ---- Parser Tests ----

describe('@handler parser', () => {
  it('parses @handler block with multiple contracts', () => {
    const ast = parse(makeSource(`
@handler(
  approveClaim(claimId:str, reason:str)
  processPayment(orderId:str, amount:float)
)
`));
    const handlerBlock = ast.app.blocks.find(b => b.kind === 'handler');
    expect(handlerBlock).toBeDefined();
    expect(handlerBlock!.kind).toBe('handler');
    if (handlerBlock!.kind === 'handler') {
      expect(handlerBlock!.contracts).toHaveLength(2);
      expect(handlerBlock!.contracts[0].name).toBe('approveClaim');
      expect(handlerBlock!.contracts[0].params).toHaveLength(2);
      expect(handlerBlock!.contracts[0].params[0]).toEqual({ name: 'claimId', type: { kind: 'str' } });
      expect(handlerBlock!.contracts[0].params[1]).toEqual({ name: 'reason', type: { kind: 'str' } });
      expect(handlerBlock!.contracts[1].name).toBe('processPayment');
      expect(handlerBlock!.contracts[1].params).toHaveLength(2);
    }
  });

  it('parses empty @handler block', () => {
    const ast = parse(makeSource('@handler()'));
    const handlerBlock = ast.app.blocks.find(b => b.kind === 'handler');
    expect(handlerBlock).toBeDefined();
    if (handlerBlock!.kind === 'handler') {
      expect(handlerBlock!.contracts).toHaveLength(0);
    }
  });

  it('parses handler with no params', () => {
    const ast = parse(makeSource('@handler(\n  resetAll\n)'));
    const handlerBlock = ast.app.blocks.find(b => b.kind === 'handler');
    if (handlerBlock!.kind === 'handler') {
      expect(handlerBlock!.contracts).toHaveLength(1);
      expect(handlerBlock!.contracts[0].name).toBe('resetAll');
      expect(handlerBlock!.contracts[0].params).toHaveLength(0);
    }
  });

  it('errors on duplicate contract names', () => {
    expect(() => parse(makeSource(`
@handler(
  doThing(a:str)
  doThing(b:int)
)
`))).toThrow(/Duplicate handler contract/);
  });

  // H14: executable target parsing
  it('parses handler with executable target', () => {
    const ast = parse(makeSource(`
@handler(
  checkout(cartId:str)>~db.Order.create
  approveClaim(claimId:str, reason:str)>~db.Claim.update
)
`));
    const handlerBlock = ast.app.blocks.find(b => b.kind === 'handler');
    expect(handlerBlock!.kind).toBe('handler');
    if (handlerBlock!.kind === 'handler') {
      expect(handlerBlock!.contracts[0].target).toBe('~db.Order.create');
      expect(handlerBlock!.contracts[1].target).toBe('~db.Claim.update');
    }
  });

  it('parses mixed contracts — some with targets, some without', () => {
    const ast = parse(makeSource(`
@handler(
  checkout(cartId:str)>~db.Order.create
  scaffoldOnly(id:str)
)
`));
    const handlerBlock = ast.app.blocks.find(b => b.kind === 'handler');
    if (handlerBlock!.kind === 'handler') {
      expect(handlerBlock!.contracts[0].target).toBe('~db.Order.create');
      expect(handlerBlock!.contracts[1].target).toBeUndefined();
    }
  });

  it('parses handler with no params but with target', () => {
    const ast = parse(makeSource('@handler(\n  clearAll>~db.Item.findMany\n)'));
    const handlerBlock = ast.app.blocks.find(b => b.kind === 'handler');
    if (handlerBlock!.kind === 'handler') {
      expect(handlerBlock!.contracts[0].name).toBe('clearAll');
      expect(handlerBlock!.contracts[0].params).toHaveLength(0);
      expect(handlerBlock!.contracts[0].target).toBe('~db.Item.findMany');
    }
  });

  it('backward compatible: contracts without target still parse', () => {
    const ast = parse(makeSource(`
@handler(
  legacyHandler(a:str, b:int)
)
`));
    const handlerBlock = ast.app.blocks.find(b => b.kind === 'handler');
    if (handlerBlock!.kind === 'handler') {
      expect(handlerBlock!.contracts[0].name).toBe('legacyHandler');
      expect(handlerBlock!.contracts[0].target).toBeUndefined();
      expect(handlerBlock!.contracts[0].params).toHaveLength(2);
    }
  });
});

// ---- Context Tests ----

describe('handler context extraction', () => {
  it('populates handlerContracts from @handler block', () => {
    const ast = parse(makeSource(`
@handler(
  approveClaim(claimId:str, reason:str)
)
@ui(btn>"test">!approveClaim)
`));
    const ctx = extractContext(ast);
    expect(ctx.handlerContracts).toHaveLength(1);
    expect(ctx.handlerContracts[0].name).toBe('approveClaim');
  });

  it('sets hasBackend when @handler is present', () => {
    const ast = parse(makeSource(`
@handler(
  doSomething(id:str)
)
@ui(btn>"test")
`));
    const ctx = extractContext(ast);
    expect(ctx.hasBackend).toBe(true);
  });

  it('injects synthetic routes into expandedRoutes', () => {
    const ast = parse(makeSource(`
@handler(
  approveClaim(claimId:str, reason:str)
  processPayment(orderId:str, amount:float)
)
@ui(btn>"test")
`));
    const ctx = extractContext(ast);
    const handlerRoutes = ctx.expandedRoutes.filter(r => r.handler.startsWith('~handler.'));
    expect(handlerRoutes).toHaveLength(2);
    expect(handlerRoutes[0].method).toBe('POST');
    expect(handlerRoutes[0].path).toBe('/handlers/approve-claim');
    expect(handlerRoutes[0].handler).toBe('~handler.approveClaim');
    expect(handlerRoutes[1].path).toBe('/handlers/process-payment');
  });

  it('rejects reserved mutation names', () => {
    expect(() => {
      const ast = parse(makeSource('@handler(\n  add(x:str)\n)\n@ui(btn>"test")'));
      extractContext(ast);
    }).toThrow(/reserved mutation name/);

    expect(() => {
      const ast = parse(makeSource('@handler(\n  login(x:str)\n)\n@ui(btn>"test")'));
      extractContext(ast);
    }).toThrow(/reserved mutation name/);

    expect(() => {
      const ast = parse(makeSource('@handler(\n  toggle(x:str)\n)\n@ui(btn>"test")'));
      extractContext(ast);
    }).toThrow(/reserved mutation name/);
  });

  it('kebab-cases camelCase names in route paths', () => {
    const ast = parse(makeSource(`
@handler(
  processPayment(orderId:str)
)
@ui(btn>"test")
`));
    const ctx = extractContext(ast);
    const route = ctx.expandedRoutes.find(r => r.handler === '~handler.processPayment');
    expect(route!.path).toBe('/handlers/process-payment');
  });

  // H14: target preserved in context
  it('preserves executable target in handlerContracts', () => {
    const ast = parse(makeSource(`
@handler(
  checkout(cartId:str)>~db.Order.create
)
@ui(btn>"test")
`));
    const ctx = extractContext(ast);
    expect(ctx.handlerContracts[0].target).toBe('~db.Order.create');
  });
});

// ---- Mutation-gen Tests ----

describe('handler mutation wiring', () => {
  it('contract-matched mutation generates api call (not stub)', () => {
    const ast = parse(makeSource(`
@handler(
  approveClaim(claimId:str, reason:str)
)
@state{items:[{id:int}]}
@ui(btn>"Approve">!approveClaim)
`));
    const ctx = extractContext(ast);
    const analysis = analyzeUI(ctx.uiNodes);
    const lines = generateMutations(ctx, analysis);
    const code = lines.join('\n');
    expect(code).toContain('api.approveClaim');
    expect(code).not.toContain("console.log('approveClaim'");
  });

  it('unmatched mutation still generates stub in non-strict mode', () => {
    const ast = parse(makeSource(`
@state{items:[{id:int}]}
@ui(btn>"Do">!unknownAction)
`));
    const ctx = extractContext(ast);
    const analysis = analyzeUI(ctx.uiNodes);
    const lines = generateMutations(ctx, analysis);
    const code = lines.join('\n');
    expect(code).toContain("console.log('unknownAction'");
  });

  it('strict mode throws on unresolved handler', () => {
    const ast = parse(makeSource(`
@state{items:[{id:int}]}
@ui(btn>"Do">!unknownAction)
`));
    expect(() => transpile(ast, { strictHandlers: true })).toThrow(/AIR-E009/);
  });

  it('unresolvedMutations tracked in result', () => {
    const ast = parse(makeSource(`
@state{items:[{id:int}]}
@ui(btn>"Do">!unknownAction)
`));
    const result = transpile(ast, { strictHandlers: false });
    expect(result.unresolvedMutations).toContain('unknownAction');
  });
});

// ---- Server Endpoint Tests ----

describe('handler server endpoints', () => {
  it('generates POST endpoint with param destructuring', () => {
    const ast = parse(makeSource(`
@handler(
  approveClaim(claimId:str, reason:str)
)
@api(
  GET:/items>~db.Item.findMany
)
@db{
  Item{id:int:primary:auto,name:str}
}
@ui(btn>"test">!approveClaim)
`));
    const result = transpile(ast);
    const apiRouter = result.files.find(f => f.path.endsWith('api.ts'));
    expect(apiRouter).toBeDefined();
    expect(apiRouter!.content).toContain("'/handlers/approve-claim'");
    expect(apiRouter!.content).toContain('claimId');
    expect(apiRouter!.content).toContain('reason');
    expect(apiRouter!.content).toContain("handler: 'approveClaim'");
  });

  // H14: executable target generates real Prisma logic
  it('generates real prisma.create for ~db.Model.create target', () => {
    const ast = parse(makeSource(`
@handler(
  checkout(cartId:str)>~db.Order.create
)
@api(
  GET:/orders>~db.Order.findMany
)
@db{
  Order{id:int:primary:auto,total:float,status:str,cartId:str}
}
@ui(btn>"test">!checkout)
`));
    const result = transpile(ast);
    const apiRouter = result.files.find(f => f.path.endsWith('api.ts'));
    expect(apiRouter).toBeDefined();
    const content = apiRouter!.content;
    expect(content).toContain("prisma.order.create");
    expect(content).toContain("data: { cartId }");
    expect(content).toContain("res.status(201)");
    expect(content).not.toContain("// TODO");
    expect(content).not.toContain("received:");
  });

  it('generates real prisma.update for ~db.Model.update target', () => {
    const ast = parse(makeSource(`
@handler(
  processPayment(orderId:str, amount:float, method:str)>~db.Order.update
)
@api(
  GET:/orders>~db.Order.findMany
)
@db{
  Order{id:int:primary:auto,total:float,status:str}
}
@ui(btn>"test">!processPayment)
`));
    const result = transpile(ast);
    const apiRouter = result.files.find(f => f.path.endsWith('api.ts'));
    const content = apiRouter!.content;
    expect(content).toContain("prisma.order.update");
    expect(content).toContain("where: { id:");
    expect(content).toContain("data: { amount, method }");
    expect(content).not.toContain("// TODO");
  });

  it('generates real prisma.delete for ~db.Model.delete target', () => {
    const ast = parse(makeSource(`
@handler(
  removeItem(itemId:str)>~db.Item.delete
)
@api(
  GET:/items>~db.Item.findMany
)
@db{
  Item{id:int:primary:auto,name:str}
}
@ui(btn>"test">!removeItem)
`));
    const result = transpile(ast);
    const apiRouter = result.files.find(f => f.path.endsWith('api.ts'));
    const content = apiRouter!.content;
    expect(content).toContain("prisma.item.delete");
    expect(content).toContain("where: { id:");
    expect(content).not.toContain("// TODO");
  });

  it('generates real prisma.findFirst for ~db.Model.findFirst target', () => {
    const ast = parse(makeSource(`
@handler(
  lookupOrder(orderId:str)>~db.Order.findFirst
)
@api(
  GET:/orders>~db.Order.findMany
)
@db{
  Order{id:int:primary:auto,total:float}
}
@ui(btn>"test">!lookupOrder)
`));
    const result = transpile(ast);
    const apiRouter = result.files.find(f => f.path.endsWith('api.ts'));
    const content = apiRouter!.content;
    expect(content).toContain("prisma.order.findFirst");
    expect(content).toContain("404");
    expect(content).not.toContain("// TODO");
  });

  it('generates validation for required params', () => {
    const ast = parse(makeSource(`
@handler(
  checkout(cartId:str, total:float)>~db.Order.create
)
@api(
  GET:/orders>~db.Order.findMany
)
@db{
  Order{id:int:primary:auto,total:float,cartId:str}
}
@ui(btn>"test">!checkout)
`));
    const result = transpile(ast);
    const apiRouter = result.files.find(f => f.path.endsWith('api.ts'));
    const content = apiRouter!.content;
    // Required field validation
    expect(content).toContain("Missing required fields");
    expect(content).toContain("cartId === undefined");
    // Type validation
    expect(content).toContain("_valSchema");
  });

  it('scaffold-only contracts still work (backward compat)', () => {
    const ast = parse(makeSource(`
@handler(
  legacyHandler(data:str)
)
@api(
  GET:/items>~db.Item.findMany
)
@db{
  Item{id:int:primary:auto,name:str}
}
@ui(btn>"test">!legacyHandler)
`));
    const result = transpile(ast);
    const apiRouter = result.files.find(f => f.path.endsWith('api.ts'));
    const content = apiRouter!.content;
    expect(content).toContain("handler: 'legacyHandler'");
    expect(content).toContain("received:");
    // Scaffold still has validation
    expect(content).toContain("Missing required fields");
  });
});

// ---- API Client Tests ----

describe('handler API client naming', () => {
  it('/handlers/approve-claim → function named approveClaim', () => {
    const ast = parse(makeSource(`
@handler(
  approveClaim(claimId:str, reason:str)
)
@api(
  GET:/items>~db.Item.findMany
)
@db{
  Item{id:int:primary:auto,name:str}
}
@ui(btn>"test">!approveClaim)
`));
    const ctx = extractContext(ast);
    const apiClient = generateApiClient(ctx);
    expect(apiClient).toContain('export async function approveClaim(');
    // Should NOT contain postHandlers prefix
    expect(apiClient).not.toContain('postHandlers');
    expect(apiClient).not.toContain('createHandler');
  });
});

// ---- Self-Heal Trace Tests ----

describe('SH9-005 handler stub detection', () => {
  it('detects console.log stub pattern in generated output', () => {
    const rule = CODEGEN_TRACE_REGISTRY.find(r => r.id === 'SH9-005');
    expect(rule).toBeDefined();
    const files = new Map<string, string>();
    files.set('client/src/App.jsx', `
const doSomething = (...args) => {
  console.log('doSomething', ...args);
};
`);
    const result = rule!.detect(files);
    expect(result.detected).toBe(true);
    expect(result.details).toContain('doSomething');
  });

  it('does not detect when no stubs present', () => {
    const rule = CODEGEN_TRACE_REGISTRY.find(r => r.id === 'SH9-005');
    const files = new Map<string, string>();
    files.set('client/src/App.jsx', `
const doSomething = async (data) => {
  const result = await api.doSomething(data);
  return result;
};
`);
    const result = rule!.detect(files);
    expect(result.detected).toBe(false);
  });
});

describe('SH9-006 handler scaffold detection', () => {
  it('detects scaffold-only handler endpoints in server output', () => {
    const rule = CODEGEN_TRACE_REGISTRY.find(r => r.id === 'SH9-006');
    expect(rule).toBeDefined();
    const files = new Map<string, string>();
    files.set('server/api.ts', `
    res.json({ success: true, handler: 'legacyHandler', received: { data } });
`);
    const result = rule!.detect(files);
    expect(result.detected).toBe(true);
    expect(result.details).toContain('legacyHandler');
  });

  it('does not detect executable handler endpoints', () => {
    const rule = CODEGEN_TRACE_REGISTRY.find(r => r.id === 'SH9-006');
    const files = new Map<string, string>();
    files.set('server/api.ts', `
    const result = await prisma.order.create({ data: { cartId } });
    res.status(201).json({ success: true, handler: 'checkout', data: result });
`);
    const result = rule!.detect(files);
    expect(result.detected).toBe(false);
  });
});

// ---- Strict Mode Tests ----

describe('handler strict mode', () => {
  it('strict mode fails on non-executable handler contracts (AIR-E010)', () => {
    const ast = parse(makeSource(`
@handler(
  scaffoldOnly(id:str)
)
@state{items:[{id:int}]}
@db{
  Item{id:int:primary:auto,name:str}
}
@api(
  CRUD:/items>~db.Item
)
@ui(btn>"Do">!scaffoldOnly)
`));
    expect(() => transpile(ast, { strictHandlers: true })).toThrow(/AIR-E010/);
  });

  it('strict mode passes when all contracts have executable targets', () => {
    const ast = parse(makeSource(`
@handler(
  checkout(cartId:str)>~db.Order.create
)
@state{items:[{id:int}]}
@db{
  Item{id:int:primary:auto,name:str}
  Order{id:int:primary:auto,cartId:str}
}
@api(
  CRUD:/items>~db.Item
)
@ui(
  btn>"Checkout">!checkout
  btn>"Add">!add
)
`));
    expect(() => transpile(ast, { strictHandlers: true })).not.toThrow();
  });

  it('strict mode fails on non-db target (AIR-E010)', () => {
    const ast = parse(makeSource(`
@handler(
  doCustom(id:str)>custom.dispatch
)
@state{items:[{id:int}]}
@db{
  Item{id:int:primary:auto,name:str}
}
@api(
  CRUD:/items>~db.Item
)
@ui(btn>"Do">!doCustom)
`));
    expect(() => transpile(ast, { strictHandlers: true })).toThrow(/AIR-E010/);
    expect(() => transpile(ast, { strictHandlers: true })).toThrow(/non-db target/);
  });
});

// ---- AIR-W009 Warning Tests ----

describe('AIR-W009 unused handler contract warning', () => {
  it('warns when handler contract is not referenced in @ui', () => {
    const ast = parse(makeSource(`
@handler(
  unusedHandler(id:str)>~db.Item.create
)
@state{items:[{id:int}]}
@db{
  Item{id:int:primary:auto,name:str}
}
@api(
  CRUD:/items>~db.Item
)
@ui(btn>"Add">!add)
`));
    const result = transpile(ast);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('AIR-W009') && w.includes('unusedHandler'))).toBe(true);
  });

  it('no warning when handler contract is referenced in @ui', () => {
    const ast = parse(makeSource(`
@handler(
  checkout(cartId:str)>~db.Order.create
)
@state{items:[{id:int}]}
@db{
  Item{id:int:primary:auto,name:str}
  Order{id:int:primary:auto,cartId:str}
}
@api(
  CRUD:/items>~db.Item
)
@ui(btn>"Checkout">!checkout)
`));
    const result = transpile(ast);
    expect(result.warnings).toBeUndefined();
  });
});

// ---- Integration Tests ----

describe('handler contract integration', () => {
  it('ecommerce.air with @handler → no stubs for contracted handlers', () => {
    const source = makeSource(`
@handler(
  checkout(cartId:str)>~db.Order.create
  processPayment(orderId:str, amount:float, method:str)>~db.Order.update
)
@state{items:[{id:int,name:str}],cart:[{productId:int}]}
@db{
  Item{id:int:primary:auto,name:str}
  Order{id:int:primary:auto,total:float,cartId:str}
}
@api(
  CRUD:/items>~db.Item
)
@ui(
  btn>"Checkout">!checkout
  btn>"Pay">!processPayment
)
`);
    const ast = parse(source);
    const result = transpile(ast);
    const appJsx = result.files.find(f => f.path.endsWith('App.jsx'));
    expect(appJsx).toBeDefined();
    // Contracted handlers should NOT have console.log stubs
    expect(appJsx!.content).not.toContain("console.log('checkout'");
    expect(appJsx!.content).not.toContain("console.log('processPayment'");
    // They should have api calls
    expect(appJsx!.content).toContain('api.checkout');
    expect(appJsx!.content).toContain('api.processPayment');
  });

  it('executable handler server output has no TODO stubs', () => {
    const source = makeSource(`
@handler(
  checkout(cartId:str)>~db.Order.create
  processPayment(orderId:str, amount:float, method:str)>~db.Order.update
)
@state{items:[{id:int,name:str}]}
@db{
  Item{id:int:primary:auto,name:str}
  Order{id:int:primary:auto,total:float,cartId:str}
}
@api(
  CRUD:/items>~db.Item
)
@ui(
  btn>"Checkout">!checkout
  btn>"Pay">!processPayment
)
`);
    const ast = parse(source);
    const result = transpile(ast);
    const apiRouter = result.files.find(f => f.path.endsWith('api.ts'));
    expect(apiRouter).toBeDefined();
    const content = apiRouter!.content;
    // No TODO stubs for executable handlers
    expect(content).not.toContain("// TODO: Implement checkout");
    expect(content).not.toContain("// TODO: Implement processPayment");
    // Real Prisma calls
    expect(content).toContain("prisma.order.create");
    expect(content).toContain("prisma.order.update");
    // Typed success responses
    expect(content).toContain("success: true");
    expect(content).toContain("data: result");
  });

  it('SH9-006 is reachable via runAllTraces (no classification needed)', () => {
    // Scaffold-only handler generates `received:` pattern in server output.
    // Even though no QA classification maps to handler-scaffold-only,
    // runAllTraces (used in heal-loop phase 4b) detects it.
    const files = new Map<string, string>();
    files.set('server/api.ts', `
    res.json({ success: true, handler: 'legacyHandler', received: { data } });
    `);
    const results = runAllTraces(files);
    const sh9006 = results.find(r => r.trace.id === 'SH9-006');
    expect(sh9006).toBeDefined();
    expect(sh9006!.result.detected).toBe(true);
  });

  it('SH9-006 does not fire for executable handler output', () => {
    const source = makeSource(`
@handler(
  checkout(cartId:str)>~db.Order.create
)
@state{items:[{id:int}]}
@db{
  Item{id:int:primary:auto,name:str}
  Order{id:int:primary:auto,cartId:str}
}
@api(
  CRUD:/items>~db.Item
)
@ui(btn>"Checkout">!checkout)
`);
    const ast = parse(source);
    const result = transpile(ast);
    const fileMap = new Map(result.files.map(f => [f.path, f.content]));
    const rule = CODEGEN_TRACE_REGISTRY.find(r => r.id === 'SH9-006');
    const detection = rule!.detect(fileMap);
    expect(detection.detected).toBe(false);
  });
});
