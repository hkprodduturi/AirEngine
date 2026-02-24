/**
 * API Router Generator
 *
 * Generates Express router files from @api routes.
 * Handles single-file api.ts, per-resource routers, and mount-point api.ts.
 */

import type { TranspileContext } from '../context.js';
import type { AirRoute, AirDbBlock, AirType } from '../../parser/types.js';
import { getGeneratedTypeNames } from '../types-gen.js';

/** Pluralize a model name: Property → Properties, Batch → Batches */
function pluralizeModel(name: string): string {
  if (name.endsWith('y') && !'aeiou'.includes(name.charAt(name.length - 2).toLowerCase())) {
    return name.slice(0, -1) + 'ies';
  }
  if (name.endsWith('s') || name.endsWith('sh') || name.endsWith('ch') || name.endsWith('x') || name.endsWith('z')) {
    return name + 'es';
  }
  return name + 's';
}

/** Map AIR type to validation schema type string */
function airTypeToValidation(type: AirType): string {
  if (type.kind === 'optional') return `optional_${airTypeToValidation(type.of).replace(/^optional_/, '')}`;
  if (type.kind === 'str' || type.kind === 'date' || type.kind === 'datetime' || type.kind === 'enum') return 'string';
  if (type.kind === 'int' || type.kind === 'float') return 'number';
  if (type.kind === 'bool') return 'boolean';
  if (type.kind === 'array') return 'object'; // arrays are typeof 'object'
  if (type.kind === 'object') return 'object';
  return 'string'; // fallback for ref and other types
}

/** Generate a validateFields schema object literal from route params */
function generateValidationSchema(route: AirRoute): string | null {
  if (!route.params || route.params.length === 0) return null;
  if (route.method !== 'POST' && route.method !== 'PUT') return null;
  const entries = route.params.map(p => `${p.name}: "${airTypeToValidation(p.type)}"`);
  return `{ ${entries.join(', ')} }`;
}

// ---- api.ts ----

export function generateApiRouter(ctx: TranspileContext): string {
  const lines: string[] = [];
  lines.push("import { Router } from 'express';");
  if (ctx.db) {
    lines.push("import { prisma } from './prisma.js';");
  }

  // Expand CRUD shortcut into individual routes
  const routes = ctx.expandedRoutes;

  // Import createToken if any route is an auth handler
  const hasAuthRoutes = ctx.auth && routes.some(r => isAuthHandler(r.handler, r.path));
  if (hasAuthRoutes) {
    lines.push("import { createToken } from './auth.js';");
  }

  // Collect type names used by routes in this file
  const typeNames = getGeneratedTypeNames(ctx);
  const usedTypes: string[] = [];
  for (const route of routes) {
    // Find matching original route (expanded routes share params reference)
    for (const [origRoute, typeName] of typeNames) {
      if (origRoute === route || (origRoute.params === route.params && route.params && route.params.length > 0)) {
        if (!usedTypes.includes(typeName)) usedTypes.push(typeName);
      }
    }
  }

  if (usedTypes.length > 0) {
    lines.push(`import type { ${usedTypes.join(', ')} } from './types.js';`);
  }

  // Import validation helpers if any route has params
  const hasValidatableRoutes = routes.some(r => r.params && r.params.length > 0 && (r.method === 'POST' || r.method === 'PUT'));
  if (hasValidatableRoutes) {
    lines.push("import { validateFields } from './validation.js';");
  }

  lines.push('');
  lines.push('export const apiRouter = Router();');
  lines.push('');

  for (const route of routes) {
    const method = route.method.toLowerCase();
    const path = route.path;
    const handler = route.handler;

    lines.push(`apiRouter.${method}('${path}', async (req, res) => {`);
    lines.push('  try {');

    // Validate :id param for integer primary keys
    const hasIdParam = path.includes(':id');
    if (hasIdParam && ctx.db) {
      const modelMatch = handler.match(/^~db\.(\w+)\./);
      if (modelMatch) {
        const isIntId = hasIntPrimaryKey(modelMatch[1], ctx.db);
        if (isIntId) {
          lines.push("    if (isNaN(parseInt(req.params.id))) {");
          lines.push("      return res.status(400).json({ error: 'Invalid id', details: 'id must be an integer' });");
          lines.push('    }');
        }
      }
    }

    // Get body type name for typed destructuring
    let bodyTypeName: string | undefined;
    if (route.params && route.params.length > 0) {
      for (const [origRoute, typeName] of typeNames) {
        if (origRoute === route || origRoute.params === route.params) {
          bodyTypeName = typeName;
          break;
        }
      }
    }

    // Detect nested resource routes (e.g., /tasks/:id/comments)
    const nestedMatch = path.match(/^\/(\w+)\/:id\/(\w+)$/);
    // Check if this is a findMany route — use enriched handler
    const isFindMany = handler.match(/^~db\.(\w+)\.findMany$/) && ctx.db;
    if (isFindMany && nestedMatch && ctx.db) {
      // Nested findMany: filter by parent FK
      const parentResource = nestedMatch[1];
      const parentSingular = parentResource.endsWith('s') ? parentResource.slice(0, -1) : parentResource;
      const modelMatch = handler.match(/^~db\.(\w+)\.findMany$/);
      const modelVar = modelMatch ? modelMatch[1].charAt(0).toLowerCase() + modelMatch[1].slice(1) : 'item';
      const fkField = `${parentSingular}_id`;
      lines.push(`    const parentId = parseInt(req.params.id);`);
      lines.push(`    const result = await prisma.${modelVar}.findMany({ where: { ${fkField}: parentId }, orderBy: { id: 'desc' } });`);
      lines.push('    res.json(result);');
    } else if (isFindMany) {
      const findManyLines = generateFindManyHandler(handler, ctx.db!);
      for (const l of findManyLines) lines.push(l);
    } else {
    // Check for aggregate handler
    const aggregateLines = ctx.db ? generateAggregateHandler(handler, ctx.db) : null;
    if (aggregateLines) {
      for (const l of aggregateLines) lines.push(l);
    } else {
    const prismaCall = mapHandlerToPrisma(handler, route, ctx.db, bodyTypeName);
    if (prismaCall) {
      // Add typed destructuring with validation if we have params and a body type
      if (bodyTypeName && route.params && route.params.length > 0) {
        // Use _body to avoid collision when a param is named 'body'
        const hasBodyParam = route.params.some(p => p.name === 'body');
        const bodyVar = hasBodyParam ? '_body' : 'body';
        lines.push(`    const ${bodyVar} = (req.body ?? {}) as ${bodyTypeName};`);
        const paramNames = route.params.map(p => p.name).join(', ');
        lines.push(`    const { ${paramNames} } = ${bodyVar};`);

        // Validate required params
        const requiredParams = route.params.filter(p => p.type.kind !== 'optional');
        if (requiredParams.length > 0) {
          const checks = requiredParams.map(p => `${p.name} === undefined || ${p.name} === null`).join(' || ');
          const names = requiredParams.map(p => p.name).join(', ');
          lines.push(`    if (${checks}) {`);
          lines.push(`      return res.status(400).json({ error: 'Missing required fields', details: 'Required: ${names}' });`);
          lines.push('    }');
        }

        // Type validation via validateFields
        const valSchema = generateValidationSchema(route);
        if (valSchema) {
          lines.push(`    const _errors = validateFields(${bodyVar} as unknown as Record<string, unknown>, ${valSchema});`);
          lines.push("    if (_errors.length > 0) return res.status(400).json({ error: 'Validation error', details: _errors });");
        }
      }
      // For nested POST: inject parent FK from URL param
      if (nestedMatch && method === 'post' && ctx.db) {
        const parentSingular = nestedMatch[1].endsWith('s') ? nestedMatch[1].slice(0, -1) : nestedMatch[1];
        const modelMatch = handler.match(/^~db\.(\w+)\.\w+$/);
        const modelVar = modelMatch ? modelMatch[1].charAt(0).toLowerCase() + modelMatch[1].slice(1) : 'item';
        const fkField = `${parentSingular}_id`;
        const bodyParams = route.params?.map(p => p.name).join(', ') || '';
        lines.push(`    const parentId = parseInt(req.params.id);`);
        lines.push(`    const result = await prisma.${modelVar}.create({ data: { ${bodyParams ? bodyParams + ', ' : ''}${fkField}: parentId } });`);
        lines.push('    res.status(201).json(result);');
      } else {
        lines.push(`    const result = ${prismaCall};`);
        // POST/create → 201 Created, others → 200 OK
        if (method === 'post' && handler.includes('.create')) {
          lines.push('    res.status(201).json(result);');
        } else {
          lines.push('    res.json(result);');
        }
      }
    } else {
      // Check for auth handler before falling through to 501
      const authType = ctx.auth ? isAuthHandler(handler, path) : null;
      if (authType) {
        const authLines = generateAuthHandlerLines(authType, route, ctx);
        for (const l of authLines) lines.push(l);
      } else {
        lines.push(`    // TODO: implement handler: ${handler}`);
        lines.push("    res.status(501).json({ error: 'Not implemented' });");
      }
    }
    } // end aggregate else
    } // end else (non-findMany)

    lines.push('  } catch (error) {');
    lines.push("    const details = process.env.NODE_ENV !== 'production' && error instanceof Error ? error.message : undefined;");
    lines.push("    res.status(500).json({ error: 'Internal server error', ...(details && { details }) });");
    lines.push('  }');
    lines.push('});');
    lines.push('');
  }

  return lines.join('\n');
}

// ---- findMany enrichment ----

export function generateFindManyHandler(handler: string, db: AirDbBlock): string[] {
  const match = handler.match(/^~db\.(\w+)\.findMany$/);
  if (!match) return [];

  const [, modelName] = match;
  const modelVar = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const model = db.models.find(m => m.name === modelName);
  const lines: string[] = [];

  // Pagination
  lines.push("    const page = parseInt(req.query.page as string) || 1;");
  lines.push("    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);");
  lines.push("    const skip = (page - 1) * limit;");

  // orderBy: prefer created_at > createdAt > id > omit
  let orderByExpr = '';
  if (model) {
    const hasCreatedAt = model.fields.some(f => f.name === 'created_at');
    const hasCreatedAtCamel = model.fields.some(f => f.name === 'createdAt');
    const hasId = model.fields.some(f => f.name === 'id');
    if (hasCreatedAt) orderByExpr = "{ created_at: 'desc' }";
    else if (hasCreatedAtCamel) orderByExpr = "{ createdAt: 'desc' }";
    else if (hasId) orderByExpr = "{ id: 'desc' }";
  }

  // Text search: find string fields (non-PK)
  const stringFields = model
    ? model.fields.filter(f => {
        const baseKind = f.type.kind === 'optional'
          ? (f.type as { kind: 'optional'; of: { kind: string } }).of.kind
          : f.type.kind;
        return baseKind === 'str' && !f.primary;
      }).map(f => f.name)
    : [];

  // Build where clause
  if (stringFields.length > 0) {
    lines.push("    const search = (req.query.search as string) || '';");
    lines.push("    const where = search ? {");
    lines.push("      OR: [");
    for (const f of stringFields) {
      lines.push(`        { ${f}: { contains: search } },`);
    }
    lines.push("      ],");
    lines.push("    } : {};");
  }

  // Build prisma query args
  const queryParts: string[] = [];
  if (stringFields.length > 0) queryParts.push('where');
  if (orderByExpr) queryParts.push(`orderBy: ${orderByExpr}`);
  queryParts.push('skip');
  queryParts.push('take: limit');

  const queryArg = `{ ${queryParts.join(', ')} }`;

  // Total count + findMany
  lines.push(`    const [result, total] = await Promise.all([`);
  lines.push(`      prisma.${modelVar}.findMany(${queryArg}),`);
  if (stringFields.length > 0) {
    lines.push(`      prisma.${modelVar}.count({ where }),`);
  } else {
    lines.push(`      prisma.${modelVar}.count(),`);
  }
  lines.push("    ]);");
  lines.push("    res.setHeader('X-Total-Count', String(total));");
  lines.push("    res.json(result);");

  return lines;
}

// ---- Handler → Prisma mapping ----

export function mapHandlerToPrisma(
  handler: string,
  route: AirRoute,
  db: AirDbBlock | null,
  bodyTypeName?: string,
): string | null {
  // Pattern: ~db.Model.operation
  const match = handler.match(/^~db\.(\w+)\.(\w+)$/);
  if (!match || !db) return null;

  const [, modelName, operation] = match;
  const modelVar = modelName.charAt(0).toLowerCase() + modelName.slice(1);

  // Check if :id param exists → extract with type coercion
  const hasIdParam = route.path.includes(':id');
  const idExpr = getIdExpression(modelName, db);

  // Use destructured param names if typed body is available
  const hasTypedBody = bodyTypeName && route.params && route.params.length > 0;
  const dataExpr = hasTypedBody
    ? `{ ${route.params!.map(p => p.name).join(', ')} }`
    : 'req.body';

  switch (operation) {
    case 'findMany':
      return `await prisma.${modelVar}.findMany()`;
    case 'findFirst':
      return hasIdParam
        ? `await prisma.${modelVar}.findFirst({ where: { id: ${idExpr} } })`
        : `await prisma.${modelVar}.findFirst({ where: req.query })`;
    case 'findUnique':
      return hasIdParam
        ? `await prisma.${modelVar}.findUnique({ where: { id: ${idExpr} } })`
        : `await prisma.${modelVar}.findUnique({ where: req.body })`;
    case 'create':
      return `await prisma.${modelVar}.create({ data: ${dataExpr} })`;
    case 'update':
      return hasIdParam
        ? `await prisma.${modelVar}.update({ where: { id: ${idExpr} }, data: ${dataExpr} })`
        : `await prisma.${modelVar}.update({ where: req.body.where, data: req.body.data })`;
    case 'delete':
      return hasIdParam
        ? `await prisma.${modelVar}.delete({ where: { id: ${idExpr} } })`
        : `await prisma.${modelVar}.delete({ where: req.body })`;
    case 'aggregate':
      return null; // Handled specially by generateAggregateHandler
    default:
      return null;
  }
}

/**
 * Generate aggregate handler lines for ~db.Model.aggregate routes.
 * Produces per-status counts if the model has a status enum field.
 */
export function generateAggregateHandler(handler: string, db: AirDbBlock): string[] | null {
  const match = handler.match(/^~db\.(\w+)\.aggregate$/);
  if (!match || !db) return null;

  const [, modelName] = match;
  const modelVar = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const model = db.models.find(m => m.name === modelName);
  if (!model) return null;

  const lines: string[] = [];
  const statusField = model.fields.find(f => {
    const base = f.type.kind === 'optional' ? (f.type as { of: { kind: string } }).of : f.type;
    return f.name === 'status' && base.kind === 'enum';
  });

  if (statusField) {
    const baseType = statusField.type.kind === 'optional'
      ? (statusField.type as { of: { kind: 'enum'; values: string[] } }).of
      : statusField.type as { kind: 'enum'; values: string[] };
    const values = baseType.values;

    lines.push(`    const total = await prisma.${modelVar}.count();`);
    for (const val of values) {
      const camelVal = val.replace(/_([a-z])/g, (_: string, l: string) => l.toUpperCase());
      lines.push(`    const ${camelVal} = await prisma.${modelVar}.count({ where: { status: '${val}' } });`);
    }
    const lcModelName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    const totalKey = `total${pluralizeModel(modelName)}`;
    const resultEntries = [
      `${totalKey}: total`,
      ...values.map(v => {
        const camel = v.replace(/_([a-z])/g, (_: string, l: string) => l.toUpperCase());
        return `${camel}: ${camel}`;
      }),
    ];
    lines.push(`    res.json({ ${resultEntries.join(', ')} });`);
  } else {
    lines.push(`    const total = await prisma.${modelVar}.count();`);
    lines.push(`    res.json({ total });`);
  }

  return lines;
}

/** Check if a model has an integer primary key */
export function hasIntPrimaryKey(modelName: string, db: AirDbBlock): boolean {
  for (const model of db.models) {
    if (model.name === modelName) {
      for (const field of model.fields) {
        if (field.primary && field.name === 'id') {
          return unwrapKind(field.type) === 'int';
        }
      }
    }
  }
  return false;
}

/** Determine id expression: parseInt for int primary keys, string otherwise */
export function getIdExpression(modelName: string, db: AirDbBlock): string {
  for (const model of db.models) {
    if (model.name === modelName) {
      for (const field of model.fields) {
        if (field.primary && field.name === 'id') {
          const baseKind = unwrapKind(field.type);
          if (baseKind === 'int') return 'parseInt(req.params.id)';
          return 'req.params.id';
        }
      }
    }
  }
  return 'req.params.id';
}

export function unwrapKind(type: { kind: string; of?: unknown }): string {
  if (type.kind === 'optional' && type.of && typeof type.of === 'object' && 'kind' in type.of) {
    return unwrapKind(type.of as { kind: string; of?: unknown });
  }
  return type.kind;
}

// ---- Auth handler detection & generation ----

/**
 * Check if a handler string is an auth-related handler.
 * Matches: auth.login, auth.register, or handlers ending with /login, /register, /signup.
 */
export function isAuthHandler(handler: string, path: string): 'login' | 'register' | null {
  // Handler-based detection
  if (handler === 'auth.login' || handler === '~jwt.verify') return 'login';
  if (handler === 'auth.register' || handler === 'auth.signup') return 'register';
  // Path-based detection
  if (path.endsWith('/login')) return 'login';
  if (path.endsWith('/register') || path.endsWith('/signup')) return 'register';
  return null;
}

/**
 * Generate handler lines for auth login/register routes.
 * Requires @db with a User model and @auth in the context.
 * Uses createToken from auth.ts for token generation.
 */
export function generateAuthHandlerLines(
  authType: 'login' | 'register',
  route: AirRoute,
  ctx: TranspileContext,
): string[] {
  const lines: string[] = [];

  // Determine the user model name — ordered priority:
  // 1. Model named "User" (must have password field for auth)
  // 2. Model with both email AND password fields (most likely auth model)
  // 3. First model with email field (fallback for simple schemas)
  const userModelByName = ctx.db?.models.find(m => m.name === 'User');
  const userModel = (userModelByName && userModelByName.fields.some(f => f.name === 'password') ? userModelByName : null)
    || ctx.db?.models.find(m =>
      m.fields.some(f => f.name === 'email') && m.fields.some(f => f.name === 'password')
    )
    || userModelByName
    || ctx.db?.models.find(m => m.fields.some(f => f.name === 'email'));
  const modelVar = userModel
    ? userModel.name.charAt(0).toLowerCase() + userModel.name.slice(1)
    : 'user';

  if (authType === 'login') {
    lines.push('    const { email, password } = req.body;');
    lines.push("    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });");
    if (userModel && ctx.db) {
      lines.push(`    const user = await prisma.${modelVar}.findFirst({ where: { email } });`);
    } else {
      lines.push('    // TODO: implement user lookup without @db');
      lines.push('    const user = null as any;');
    }
    lines.push("    if (!user) return res.status(401).json({ error: 'Invalid credentials' });");
    lines.push('    // TODO: replace with bcrypt.compare() for production');
    lines.push("    if (user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });");
    lines.push("    const { password: _pw, ...safeUser } = user;");
    lines.push('    const token = createToken({ id: user.id, email: user.email, role: user.role });');
    lines.push('    res.json({ user: safeUser, token });');
  } else {
    // register
    const paramNames = route.params?.map(p => p.name) || ['email', 'name', 'password'];
    const destructure = paramNames.join(', ');
    lines.push(`    const { ${destructure} } = req.body;`);
    // Validate required fields
    const requiredChecks = paramNames.map(p => `!${p}`).join(' || ');
    lines.push(`    if (${requiredChecks}) return res.status(400).json({ error: 'All fields are required' });`);
    if (userModel && ctx.db) {
      lines.push(`    const existing = await prisma.${modelVar}.findFirst({ where: { email } });`);
      lines.push("    if (existing) return res.status(409).json({ error: 'Email already registered' });");
      // Build create data from params (include all params from the route)
      const createFields = paramNames.map(p => p).join(', ');
      lines.push(`    // TODO: hash password with bcrypt before storing`);
      lines.push(`    const user = await prisma.${modelVar}.create({ data: { ${createFields} } });`);
    } else {
      lines.push('    // TODO: implement user creation without @db');
      lines.push('    const user = { id: 1, email } as any;');
    }
    lines.push("    const { password: _pw, ...safeUser } = user;");
    lines.push('    const token = createToken({ id: user.id, email: user.email, role: user.role });');
    lines.push('    res.status(201).json({ user: safeUser, token });');
  }

  return lines;
}

// ---- Route grouping for resource splitting ----

/**
 * Group expanded routes by their model name.
 * ~db.User.* → key "users", non-model → "__misc__".
 */
export function groupRoutesByModel(routes: AirRoute[]): Map<string, AirRoute[]> {
  const groups = new Map<string, AirRoute[]>();
  for (const route of routes) {
    const modelMatch = route.handler.match(/^~db\.(\w+)\./);
    if (modelMatch) {
      const model = modelMatch[1];
      const key = model.charAt(0).toLowerCase() + model.slice(1) + 's';
      // Only group if route path starts with the expected resource prefix
      // e.g., /tasks routes go with "tasks" key, but /stats with ~db.Task.aggregate goes to __misc__
      // Also handles nested resources: /tasks/:id/comments → model "Comment" → key "comments"
      // but path starts with /tasks, not /comments → goes to __misc__
      if (route.path.startsWith('/' + key)) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(route);
        continue;
      }
    }
    if (!groups.has('__misc__')) groups.set('__misc__', []);
    groups.get('__misc__')!.push(route);
  }
  return groups;
}

/** Only split when 3+ distinct model groups exist */
export function shouldSplitRoutes(groups: Map<string, AirRoute[]>): boolean {
  const modelKeys = Array.from(groups.keys()).filter(k => k !== '__misc__');
  return modelKeys.length >= 3;
}

/**
 * Generate a per-resource router file.
 * e.g., server/routes/users.ts with all User CRUD routes.
 */
export function generateResourceRouter(
  resourceKey: string,
  routes: AirRoute[],
  ctx: TranspileContext,
): string {
  const lines: string[] = [];

  lines.push("import { Router } from 'express';");
  if (ctx.db) {
    lines.push("import { prisma } from '../prisma.js';");
  }

  // Only import validation helpers if routes actually need them
  const needsAssertRequired = routes.some(r => r.params && r.params.length > 0 && r.params.some(p => p.type.kind !== 'optional'));
  const needsAssertIntParam = routes.some(r => {
    const relPath = findCommonBasePath(routes) ? r.path.replace(findCommonBasePath(routes), '') || '/' : r.path;
    if (!relPath.includes(':id') || !ctx.db) return false;
    const m = r.handler.match(/^~db\.(\w+)\./);
    return m ? hasIntPrimaryKey(m[1], ctx.db) : false;
  });
  if (needsAssertRequired || needsAssertIntParam) {
    const imports: string[] = [];
    if (needsAssertRequired) imports.push('assertRequired');
    if (needsAssertIntParam) imports.push('assertIntParam');
    lines.push(`import { ${imports.join(', ')} } from '../validation.js';`);
  }

  // Import createToken if any route is an auth handler
  const hasAuthRoutes = ctx.auth && routes.some(r => isAuthHandler(r.handler, r.path));
  if (hasAuthRoutes) {
    lines.push("import { createToken } from '../auth.js';");
  }

  // Collect type names used
  const typeNames = getGeneratedTypeNames(ctx);
  const usedTypes: string[] = [];
  for (const route of routes) {
    for (const [origRoute, typeName] of typeNames) {
      if (origRoute === route || (origRoute.params === route.params && route.params && route.params.length > 0)) {
        if (!usedTypes.includes(typeName)) usedTypes.push(typeName);
      }
    }
  }
  if (usedTypes.length > 0) {
    lines.push(`import type { ${usedTypes.join(', ')} } from '../types.js';`);
  }

  lines.push('');
  lines.push(`export const ${resourceKey}Router = Router();`);
  lines.push('');

  // Compute base path shared by all routes in this group
  const basePath = findCommonBasePath(routes);

  for (const route of routes) {
    const method = route.method.toLowerCase();
    // Strip the common base path from route paths
    const relativePath = basePath ? route.path.replace(basePath, '') || '/' : route.path;
    const handler = route.handler;

    lines.push(`${resourceKey}Router.${method}('${relativePath}', async (req, res) => {`);
    lines.push('  try {');

    // Validate :id param
    const hasIdParam = relativePath.includes(':id');
    if (hasIdParam && ctx.db) {
      const modelMatch = handler.match(/^~db\.(\w+)\./);
      if (modelMatch && hasIntPrimaryKey(modelMatch[1], ctx.db)) {
        lines.push("    const id = assertIntParam(req.params.id);");
      }
    }

    // Body type handling
    let bodyTypeName: string | undefined;
    if (route.params && route.params.length > 0) {
      for (const [origRoute, typeName] of typeNames) {
        if (origRoute === route || origRoute.params === route.params) {
          bodyTypeName = typeName;
          break;
        }
      }
    }

    // Detect nested resource routes (e.g., /:id/comments → parent/:id/child)
    const nestedMatch = relativePath.match(/^\/:id\/(\w+)$/);
    const isFindMany = handler.match(/^~db\.(\w+)\.findMany$/) && ctx.db;
    const isAggregate = handler.match(/^~db\.(\w+)\.aggregate$/) && ctx.db;
    if (isFindMany && nestedMatch && ctx.db) {
      // Nested findMany: filter by parent FK
      const parentResource = resourceKey.endsWith('s') ? resourceKey.slice(0, -1) : resourceKey;
      const modelMatch = handler.match(/^~db\.(\w+)\.findMany$/);
      const modelVar = modelMatch ? modelMatch[1].charAt(0).toLowerCase() + modelMatch[1].slice(1) : 'item';
      const fkField = `${parentResource}_id`;
      lines.push(`    const parentId = parseInt(req.params.id);`);
      lines.push(`    const result = await prisma.${modelVar}.findMany({ where: { ${fkField}: parentId }, orderBy: { id: 'desc' } });`);
      lines.push('    res.json(result);');
    } else if (isFindMany) {
      const findManyLines = generateFindManyHandler(handler, ctx.db!);
      for (const l of findManyLines) lines.push(l);
    } else if (isAggregate) {
      const aggLines = generateAggregateHandler(handler, ctx.db!);
      if (aggLines) for (const l of aggLines) lines.push(l);
    } else {
      const prismaCall = mapHandlerToPrisma(handler, route, ctx.db, bodyTypeName);
      if (prismaCall) {
        if (bodyTypeName && route.params && route.params.length > 0) {
          const hasBodyParam = route.params.some(p => p.name === 'body');
          const bodyVar = hasBodyParam ? '_body' : 'body';
          lines.push(`    const ${bodyVar} = (req.body ?? {}) as ${bodyTypeName};`);
          const paramNames = route.params.map(p => p.name).join(', ');
          lines.push(`    const { ${paramNames} } = ${bodyVar};`);

          const requiredParams = route.params.filter(p => p.type.kind !== 'optional');
          if (requiredParams.length > 0) {
            const names = requiredParams.map(p => `'${p.name}'`).join(', ');
            lines.push(`    assertRequired(${bodyVar} as Record<string, unknown>, [${names}]);`);
          }
        }
        // For nested POST: inject parent FK from URL param
        if (nestedMatch && route.method.toLowerCase() === 'post' && ctx.db) {
          const parentResource = resourceKey.endsWith('s') ? resourceKey.slice(0, -1) : resourceKey;
          const modelMatch = handler.match(/^~db\.(\w+)\.\w+$/);
          const modelVar = modelMatch ? modelMatch[1].charAt(0).toLowerCase() + modelMatch[1].slice(1) : 'item';
          const fkField = `${parentResource}_id`;
          const bodyParams = route.params?.map(p => p.name).join(', ') || '';
          lines.push(`    const parentId = parseInt(req.params.id);`);
          lines.push(`    const result = await prisma.${modelVar}.create({ data: { ${bodyParams ? bodyParams + ', ' : ''}${fkField}: parentId } });`);
          lines.push('    res.status(201).json(result);');
        } else {
          lines.push(`    const result = ${prismaCall};`);
          // POST/create → 201 Created
          if (method === 'post' && handler.includes('.create')) {
            lines.push('    res.status(201).json(result);');
          } else {
            lines.push('    res.json(result);');
          }
        }
      } else {
        // Check for auth handler before falling through to 501
        const authType = ctx.auth ? isAuthHandler(handler, route.path) : null;
        if (authType) {
          const authLines = generateAuthHandlerLines(authType, route, ctx);
          for (const l of authLines) lines.push(l);
        } else {
          lines.push(`    // TODO: implement handler: ${handler}`);
          lines.push("    res.status(501).json({ error: 'Not implemented' });");
        }
      }
    }

    lines.push('  } catch (error) {');
    lines.push("    const details = process.env.NODE_ENV !== 'production' && error instanceof Error ? error.message : undefined;");
    lines.push("    const status = (error as any)?.status ?? 500;");
    lines.push("    res.status(status).json({ error: status === 400 ? 'Validation error' : 'Internal server error', ...(details && { details }) });");
    lines.push('  }');
    lines.push('});');
    lines.push('');
  }

  return lines.join('\n');
}

/** Find common base path from a set of routes (e.g., /users, /users/:id → /users) */
export function findCommonBasePath(routes: AirRoute[]): string {
  if (routes.length === 0) return '';
  const paths = routes.map(r => r.path);
  // Find shortest path without param segments
  const basePaths = paths.map(p => {
    const segments = p.split('/').filter(s => !s.startsWith(':'));
    return '/' + segments.filter(Boolean).join('/');
  });
  // Return the most common
  const counts = new Map<string, number>();
  for (const bp of basePaths) {
    counts.set(bp, (counts.get(bp) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [k, v] of counts) {
    if (v > bestCount || (v === bestCount && k.length > best.length)) {
      best = k;
      bestCount = v;
    }
  }
  return best;
}

/**
 * Generate mount point api.ts that imports and mounts resource routers.
 */
export function generateMountPointApi(groups: Map<string, AirRoute[]>, ctx: TranspileContext): string {
  const lines: string[] = [];

  lines.push("import { Router } from 'express';");

  // Import resource routers
  const modelKeys = Array.from(groups.keys()).filter(k => k !== '__misc__');
  for (const key of modelKeys) {
    lines.push(`import { ${key}Router } from './routes/${key}.js';`);
  }

  // Import prisma for misc routes
  const hasMisc = groups.has('__misc__');
  if (hasMisc && ctx.db) {
    lines.push("import { prisma } from './prisma.js';");
  }

  // Import createToken if any misc route is an auth handler
  const miscRoutes = hasMisc ? groups.get('__misc__')! : [];
  const hasMiscAuthRoutes = ctx.auth && miscRoutes.some(r => isAuthHandler(r.handler, r.path));
  if (hasMiscAuthRoutes) {
    lines.push("import { createToken } from './auth.js';");
  }

  // Import types for misc routes
  if (hasMisc) {
    const typeNames = getGeneratedTypeNames(ctx);
    const usedTypes: string[] = [];
    for (const route of miscRoutes) {
      for (const [origRoute, typeName] of typeNames) {
        if (origRoute === route || (origRoute.params === route.params && route.params && route.params.length > 0)) {
          if (!usedTypes.includes(typeName)) usedTypes.push(typeName);
        }
      }
    }
    if (usedTypes.length > 0) {
      lines.push(`import type { ${usedTypes.join(', ')} } from './types.js';`);
    }
  }

  lines.push('');
  lines.push('export const apiRouter = Router();');
  lines.push('');

  // Mount resource routers under their base paths
  for (const key of modelKeys) {
    const routes = groups.get(key)!;
    const basePath = findCommonBasePath(routes);
    lines.push(`apiRouter.use('${basePath}', ${key}Router);`);
  }
  lines.push('');

  // Inline misc routes
  if (hasMisc) {
    const miscRoutes = groups.get('__misc__')!;
    const typeNames = getGeneratedTypeNames(ctx);
    for (const route of miscRoutes) {
      const method = route.method.toLowerCase();
      const handler = route.handler;

      // Validate :id param for integer primary keys
      const hasIdParam = route.path.includes(':id');

      lines.push(`apiRouter.${method}('${route.path}', async (req, res) => {`);
      lines.push('  try {');

      if (hasIdParam && ctx.db) {
        const modelMatch = handler.match(/^~db\.(\w+)\./);
        if (modelMatch) {
          lines.push("    if (isNaN(parseInt(req.params.id))) {");
          lines.push("      return res.status(400).json({ error: 'Invalid id', details: 'id must be an integer' });");
          lines.push('    }');
        }
      }

      let bodyTypeName: string | undefined;
      if (route.params && route.params.length > 0) {
        for (const [origRoute, typeName] of typeNames) {
          if (origRoute === route || origRoute.params === route.params) {
            bodyTypeName = typeName;
            break;
          }
        }
      }

      // Detect nested resource routes (e.g., /tasks/:id/comments)
      const nestedMatch = route.path.match(/^\/(\w+)\/:id\/(\w+)$/);
      const isFindMany = handler.match(/^~db\.(\w+)\.findMany$/) && ctx.db;
      const isAggregate = handler.match(/^~db\.(\w+)\.aggregate$/) && ctx.db;

      if (isFindMany && ctx.db) {
        if (nestedMatch) {
          // Nested findMany: filter by parent FK (e.g., GET /tasks/:id/comments → where: { task_id })
          const parentResource = nestedMatch[1];
          const parentSingular = parentResource.endsWith('s') ? parentResource.slice(0, -1) : parentResource;
          const modelMatch = handler.match(/^~db\.(\w+)\.findMany$/);
          const modelVar = modelMatch ? modelMatch[1].charAt(0).toLowerCase() + modelMatch[1].slice(1) : 'item';
          const fkField = `${parentSingular}_id`;
          lines.push(`    const parentId = parseInt(req.params.id);`);
          lines.push(`    const result = await prisma.${modelVar}.findMany({ where: { ${fkField}: parentId }, orderBy: { id: 'desc' } });`);
          lines.push('    res.json(result);');
        } else {
          const findManyLines = generateFindManyHandler(handler, ctx.db);
          for (const l of findManyLines) lines.push(l);
        }
      } else if (isAggregate && ctx.db) {
        const aggLines = generateAggregateHandler(handler, ctx.db);
        if (aggLines) for (const l of aggLines) lines.push(l);
      } else {
        const prismaCall = mapHandlerToPrisma(handler, route, ctx.db, bodyTypeName);
        if (prismaCall) {
          if (bodyTypeName && route.params && route.params.length > 0) {
            const hasBodyParam = route.params.some(p => p.name === 'body');
            const bodyVar = hasBodyParam ? '_body' : 'body';
            lines.push(`    const ${bodyVar} = (req.body ?? {}) as ${bodyTypeName};`);
            const paramNames = route.params.map(p => p.name).join(', ');
            lines.push(`    const { ${paramNames} } = ${bodyVar};`);
          }
          // For nested create: inject parent FK from URL param
          if (nestedMatch && route.method === 'POST') {
            const parentResource = nestedMatch[1];
            const parentSingular = parentResource.endsWith('s') ? parentResource.slice(0, -1) : parentResource;
            const fkField = `${parentSingular}_id`;
            const modelMatch = handler.match(/^~db\.(\w+)\.\w+$/);
            const modelVar = modelMatch ? modelMatch[1].charAt(0).toLowerCase() + modelMatch[1].slice(1) : 'item';
            const bodyParams = route.params?.map(p => p.name).join(', ') || '';
            lines.push(`    const parentId = parseInt(req.params.id);`);
            lines.push(`    const result = await prisma.${modelVar}.create({ data: { ${bodyParams ? bodyParams + ', ' : ''}${fkField}: parentId } });`);
            lines.push('    res.status(201).json(result);');
          } else {
            lines.push(`    const result = ${prismaCall};`);
            // POST/create → 201 Created
            if (method === 'post' && handler.includes('.create')) {
              lines.push('    res.status(201).json(result);');
            } else {
              lines.push('    res.json(result);');
            }
          }
        } else {
          // Check for auth handler before falling through to 501
          const authType = ctx.auth ? isAuthHandler(handler, route.path) : null;
          if (authType) {
            const authLines = generateAuthHandlerLines(authType, route, ctx);
            for (const l of authLines) lines.push(l);
          } else {
            lines.push(`    // TODO: implement handler: ${handler}`);
            lines.push("    res.status(501).json({ error: 'Not implemented' });");
          }
        }
      }

      lines.push('  } catch (error) {');
      lines.push("    const details = process.env.NODE_ENV !== 'production' && error instanceof Error ? error.message : undefined;");
      lines.push("    res.status(500).json({ error: 'Internal server error', ...(details && { details }) });");
      lines.push('  }');
      lines.push('});');
      lines.push('');
    }
  }

  return lines.join('\n');
}
