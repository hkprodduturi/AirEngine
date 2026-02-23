/**
 * Database Seed Generator
 *
 * Generates server/seed.ts with 3 sample records per @db model.
 * Best-effort — skips auto-id fields and FK (_id) fields.
 */

import type { TranspileContext } from './context.js';
import type { AirDbModel, AirDbField } from '../parser/types.js';

export function generateSeedFile(ctx: TranspileContext): string {
  if (!ctx.db) return '';

  const models = ctx.db.models;
  const sorted = sortByDependency(models);
  const reversed = [...sorted].reverse();

  const lines: string[] = [];
  lines.push("import { PrismaClient } from '@prisma/client';");
  lines.push('');
  lines.push('const prisma = new PrismaClient();');
  lines.push('');
  lines.push('async function main() {');

  // Delete in reverse dependency order
  for (const model of reversed) {
    const varName = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    lines.push(`  await prisma.${varName}.deleteMany();`);
  }
  lines.push('');

  // Seed in dependency order
  for (const model of sorted) {
    const varName = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    const seedableFields = getSeedableFields(model);

    if (seedableFields.length === 0) {
      lines.push(`  // ${model.name}: no seedable fields (all auto/FK)`);
      lines.push('');
      continue;
    }

    lines.push(`  await prisma.${varName}.createMany({`);
    lines.push('    data: [');

    for (let n = 1; n <= 3; n++) {
      const fieldValues = seedableFields.map(f => {
        const val = generateFieldValue(f, model.name, n);
        return `${f.name}: ${val}`;
      });
      lines.push(`      { ${fieldValues.join(', ')} },`);
    }

    lines.push('    ],');
    lines.push('  });');
    lines.push('');
  }

  lines.push("  console.log('Seeded database');");
  lines.push('}');
  lines.push('');
  lines.push('main()');
  lines.push("  .catch(console.error)");
  lines.push("  .finally(() => prisma.$disconnect());");
  lines.push('');

  return lines.join('\n');
}

/** Get fields that should be included in seed data */
function getSeedableFields(model: AirDbModel): AirDbField[] {
  return model.fields.filter(f => {
    // Skip auto-increment primary keys
    if (f.primary && f.auto) return false;
    // Skip auto datetime fields (let @default(now()) handle them)
    if ((f.type.kind === 'datetime' || f.type.kind === 'date') && f.auto) return false;
    // Skip FK fields (heuristic: ends with _id)
    if (f.name.endsWith('_id')) return false;
    return true;
  });
}

/** Generate a deterministic sample value for a field */
function generateFieldValue(field: AirDbField, modelName: string, n: number): string {
  const { name, type } = field;
  const isOptional = type.kind === 'optional';
  const baseType = isOptional ? (type as { kind: 'optional'; of: AirDbField['type'] }).of : type;

  // Optional fields: null for record 1, value for records 2-3
  if (isOptional && n === 1) return 'null';

  const kind = baseType.kind;

  switch (kind) {
    case 'str':
      return generateStringValue(name, modelName, n);
    case 'int':
      return `${n * 10}`;
    case 'float':
      return `${n * 10.5}`;
    case 'bool':
      return n % 2 === 0 ? 'true' : 'false';
    case 'enum': {
      const values = (baseType as { kind: 'enum'; values: string[] }).values;
      const idx = (n - 1) % values.length;
      return `'${values[idx]}'`;
    }
    case 'date':
    case 'datetime':
      // Skip — let @default(now()) handle it
      return 'new Date()';
    default:
      return `'sample_${n}'`;
  }
}

/** Generate smart string values based on field name heuristics */
function generateStringValue(fieldName: string, modelName: string, n: number): string {
  const lower = fieldName.toLowerCase();
  if (lower === 'email') return `'user${n}@example.com'`;
  if (lower === 'name') return `'User ${n}'`;
  if (lower === 'slug') return `'sample-${modelName.toLowerCase()}-${n}'`;
  if (lower === 'password') return `'password${n}'`;
  if (lower === 'title') return `'Sample ${fieldName} ${n}'`;
  return `'Sample ${fieldName} ${n}'`;
}

/**
 * Sort models by dependency order (fewer _id fields first).
 * Models with no FK fields are seeded first.
 */
function sortByDependency(models: AirDbModel[]): AirDbModel[] {
  return [...models].sort((a, b) => {
    const aFks = a.fields.filter(f => f.name.endsWith('_id')).length;
    const bFks = b.fields.filter(f => f.name.endsWith('_id')).length;
    return aFks - bFks;
  });
}
