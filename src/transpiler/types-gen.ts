/**
 * Server Types Generator
 *
 * Generates server/types.ts with request body / DTO interfaces
 * from @api route params. Does NOT duplicate Prisma model types.
 */

import type { TranspileContext } from './context.js';
import type { AirRoute, AirType, AirField } from '../parser/types.js';
export function generateTypesFile(ctx: TranspileContext): string {
  const routes = ctx.expandedRoutes;
  const lines: string[] = [];

  lines.push('// Auto-generated request body types');
  lines.push('// Do not edit — regenerate from .air source');
  lines.push('');

  for (const route of routes) {
    if (!route.params || route.params.length === 0) continue;

    const typeName = deriveTypeName(route);
    lines.push(`export interface ${typeName} {`);
    for (const param of route.params) {
      lines.push(`  ${param.name}: ${airTypeToTS(param.type)};`);
    }
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

/** Derive interface name from method + handler/path context */
function deriveTypeName(route: AirRoute): string {
  const handler = route.handler;

  // Pattern: ~db.Model.operation → {Operation}{Model}Body
  const dbMatch = handler.match(/^~db\.(\w+)\.(\w+)$/);
  if (dbMatch) {
    const [, model, operation] = dbMatch;
    const verb = capitalize(operation);
    return `${verb}${model}Body`;
  }

  // Non-db routes: use last path segment capitalized + method prefix
  const method = route.method;
  const segments = route.path.replace(/^\//, '').split('/').filter(s => !s.startsWith(':'));
  const lastSegment = segments[segments.length - 1] || 'Request';

  if (method === 'POST') return `${capitalize(lastSegment)}Body`;
  if (method === 'PUT') return `Update${capitalize(lastSegment)}Body`;

  return `${capitalize(lastSegment)}Body`;
}

/** Map AIR type to TypeScript type string */
export function airTypeToTS(type: AirType): string {
  switch (type.kind) {
    case 'str':
      return 'string';
    case 'int':
    case 'float':
      return 'number';
    case 'bool':
      return 'boolean';
    case 'date':
    case 'datetime':
      return 'string';
    case 'enum':
      return type.values.map(v => `'${v}'`).join(' | ');
    case 'optional':
      return `${airTypeToTS(type.of)} | null`;
    case 'array':
      return `${airTypeToTS(type.of)}[]`;
    case 'object':
      return `{ ${type.fields.map(f => `${f.name}: ${airTypeToTS(f.type)}`).join('; ')} }`;
    case 'ref':
      return 'string';
    default:
      return 'unknown';
  }
}

/** Get all type names that would be generated for a set of routes */
export function getGeneratedTypeNames(ctx: TranspileContext): Map<AirRoute, string> {
  const routes = ctx.expandedRoutes;
  const map = new Map<AirRoute, string>();
  for (const route of routes) {
    if (!route.params || route.params.length === 0) continue;
    map.set(route, deriveTypeName(route));
  }
  return map;
}

/**
 * Generate client/src/types.ts — model interfaces for the frontend.
 * One `export interface` per @db model.
 */
export function generateClientTypesFile(ctx: TranspileContext): string {
  if (!ctx.db) return '';
  const lines: string[] = [];
  lines.push('// Auto-generated model types from @db');
  lines.push('// Do not edit — regenerate from .air source');
  lines.push('');

  for (const model of ctx.db.models) {
    lines.push(`export interface ${model.name} {`);
    for (const field of model.fields) {
      const tsType = airTypeToTS(field.type);
      const optional = field.type.kind === 'optional' ? '?' : '';
      lines.push(`  ${field.name}${optional}: ${tsType};`);
    }
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
