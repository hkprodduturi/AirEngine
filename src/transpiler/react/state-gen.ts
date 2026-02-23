/**
 * State declaration generator — produces useState() calls from TranspileContext.
 */

import type { AirType, AirField } from '../../parser/types.js';
import type { TranspileContext } from '../context.js';
import { capitalize } from './helpers.js';

// ---- State Declarations ----

export function generateStateDecls(ctx: TranspileContext): string[] {
  const lines: string[] = [];
  for (const field of ctx.state) {
    const defVal = defaultForType(field.type);
    const setterName = 'set' + capitalize(field.name);
    lines.push(`const [${field.name}, ${setterName}] = useState(${defVal});`);
  }
  return lines;
}

export function defaultForType(type: AirType): string {
  switch (type.kind) {
    case 'str':
      return type.default !== undefined ? JSON.stringify(type.default) : "''";
    case 'int':
      return type.default !== undefined ? String(type.default) : '0';
    case 'float':
      return type.default !== undefined ? String(type.default) : '0';
    case 'bool':
      return type.default !== undefined ? String(type.default) : 'false';
    case 'date':
    case 'datetime':
      return "''";
    case 'enum':
      return type.default !== undefined
        ? JSON.stringify(type.default)
        : JSON.stringify(type.values[0] ?? '');
    case 'array':
      return '[]';
    case 'object':
      return generateObjectDefault(type.fields);
    case 'optional':
      return 'null';
    case 'ref':
      return 'null';
  }
}

export function generateObjectDefault(fields: AirField[]): string {
  const entries = fields.map(f => `${f.name}: ${defaultForType(f.type)}`);
  return `{ ${entries.join(', ')} }`;
}
