/**
 * Prisma Schema Generator
 *
 * Converts AirDbBlock into a valid schema.prisma string.
 * Supports scalar fields, defaults, enums, and auto-increment/timestamps.
 * Relations are deferred — generates TODO comments for now.
 */

import type { AirDbBlock, AirDbField, AirDbModel, AirType } from '../parser/types.js';

// ---- Type mapping ----

const AIR_TO_PRISMA: Record<string, string> = {
  str: 'String',
  int: 'Int',
  float: 'Float',
  bool: 'Boolean',
  date: 'DateTime',
  datetime: 'DateTime',
};

function mapFieldType(type: AirType): string {
  if (type.kind === 'optional') {
    return mapFieldType(type.of) + '?';
  }
  if (type.kind === 'array') {
    return mapFieldType(type.of) + '[]';
  }
  if (type.kind === 'ref') {
    return type.entity;
  }
  if (type.kind === 'enum') {
    // Handled separately — caller must pass the generated enum name
    return '__ENUM__';
  }
  if (type.kind === 'object') {
    return 'Json';
  }
  return AIR_TO_PRISMA[type.kind] ?? 'String';
}

// ---- Default attribute ----

function formatDefault(field: AirDbField): string {
  // DB modifier :default wins
  if (field.default !== undefined) {
    if (typeof field.default === 'boolean') return `@default(${field.default})`;
    if (typeof field.default === 'number') return `@default(${field.default})`;
    return `@default("${field.default}")`;
  }
  return '';
}

// ---- Auto attribute ----

function formatAuto(field: AirDbField): string {
  if (!field.auto) return '';
  const baseKind = unwrapKind(field.type);
  if (baseKind === 'int') return '@default(autoincrement())';
  if (baseKind === 'datetime' || baseKind === 'date') return '@default(now())';
  return '@updatedAt';
}

function unwrapKind(type: AirType): string {
  if (type.kind === 'optional') return unwrapKind(type.of);
  return type.kind;
}

// ---- Enum collection ----

interface PrismaEnum {
  name: string;
  values: string[];
}

function collectEnums(models: AirDbModel[]): PrismaEnum[] {
  const enums: PrismaEnum[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    for (const field of model.fields) {
      const baseType = unwrapType(field.type);
      if (baseType?.kind === 'enum' && baseType.values.length > 0) {
        const enumName = `${model.name}${capitalize(field.name)}`;
        const key = baseType.values.sort().join(',');
        if (!seen.has(key)) {
          seen.add(key);
          enums.push({ name: enumName, values: baseType.values });
        }
      }
    }
  }
  return enums;
}

function unwrapType(type: AirType): AirType {
  if (type.kind === 'optional') return unwrapType(type.of);
  if (type.kind === 'array') return unwrapType(type.of);
  return type;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Field line generator ----

function generateFieldLine(field: AirDbField, model: AirDbModel, enums: PrismaEnum[]): string {
  const parts: string[] = [];

  // Field name
  parts.push(`  ${field.name}`);

  // Type
  let prismaType: string;
  const baseType = unwrapType(field.type);
  if (baseType.kind === 'enum') {
    const enumName = `${model.name}${capitalize(field.name)}`;
    const matched = enums.find(e => e.name === enumName);
    prismaType = matched ? matched.name : 'String';
    if (field.type.kind === 'optional') prismaType += '?';
  } else {
    prismaType = mapFieldType(field.type);
  }
  parts.push(prismaType);

  // Attributes
  const attrs: string[] = [];

  if (field.primary) {
    attrs.push('@id');
  }

  const autoAttr = formatAuto(field);
  if (autoAttr) attrs.push(autoAttr);

  const defaultAttr = formatDefault(field);
  if (defaultAttr && !autoAttr) attrs.push(defaultAttr);

  if (attrs.length > 0) {
    parts.push(attrs.join(' '));
  }

  return parts.join('  ');
}

// ---- Main generator ----

export function generatePrismaSchema(db: AirDbBlock): string {
  const lines: string[] = [];

  // Header
  lines.push('generator client {');
  lines.push('  provider = "prisma-client-js"');
  lines.push('}');
  lines.push('');
  lines.push('datasource db {');
  lines.push('  provider = "sqlite"');
  lines.push('  url      = env("DATABASE_URL")');
  lines.push('}');

  // Collect enums
  const enums = collectEnums(db.models);

  // Enum blocks
  for (const e of enums) {
    lines.push('');
    lines.push(`enum ${e.name} {`);
    for (const v of e.values) {
      lines.push(`  ${v}`);
    }
    lines.push('}');
  }

  // Model blocks
  for (const model of db.models) {
    lines.push('');
    lines.push(`model ${model.name} {`);
    for (const field of model.fields) {
      lines.push(generateFieldLine(field, model, enums));
    }
    lines.push('}');
  }

  // Relations (deferred — generate TODO comments)
  if (db.relations.length > 0) {
    lines.push('');
    lines.push('// TODO: Prisma relation fields');
    for (const rel of db.relations) {
      lines.push(`// ${rel.from} <-> ${rel.to}`);
    }
  }

  // Indexes
  if (db.indexes.length > 0) {
    lines.push('');
    lines.push('// TODO: Add index annotations to models');
    for (const idx of db.indexes) {
      const unique = idx.unique ? ' (unique)' : '';
      lines.push(`// @@index([${idx.fields.join(', ')}])${unique}`);
    }
  }

  return lines.join('\n') + '\n';
}
