/**
 * Prisma Schema Generator
 *
 * Converts AirDbBlock into a valid schema.prisma string.
 * Supports scalar fields, defaults, enums, auto-increment/timestamps,
 * relation fields (one-to-many), and index annotations.
 */

import type { AirDbBlock, AirDbField, AirDbModel, AirDbRelation, AirType } from '../parser/types.js';

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

// ---- Relation resolution ----

export interface ResolvedRelation {
  modelA: string;
  relNameA: string;
  modelB: string;
  relNameB: string;
  fkSide: 'A' | 'B';
  fkField: string;
  optional: boolean;
  onDelete?: 'cascade' | 'setNull' | 'restrict';
}

export interface ManyToManyRelation {
  modelA: string;
  modelB: string;
  fieldA: string;
  fieldB: string;
  name: string;
}

interface AmbiguousRelation {
  from: string;
  to: string;
  reason: string;
}

export function resolveRelations(db: AirDbBlock): { resolved: ResolvedRelation[]; ambiguous: AmbiguousRelation[]; manyToMany: ManyToManyRelation[] } {
  const resolved: ResolvedRelation[] = [];
  const ambiguous: AmbiguousRelation[] = [];
  const manyToMany: ManyToManyRelation[] = [];

  const modelMap = new Map<string, AirDbModel>();
  for (const m of db.models) modelMap.set(m.name, m);

  for (const rel of db.relations) {
    const dotA = rel.from.indexOf('.');
    const dotB = rel.to.indexOf('.');
    if (dotA === -1 || dotB === -1) {
      ambiguous.push({ from: rel.from, to: rel.to, reason: 'invalid dotted name format' });
      continue;
    }

    const modelA = rel.from.slice(0, dotA);
    const relNameA = rel.from.slice(dotA + 1);
    const modelB = rel.to.slice(0, dotB);
    const relNameB = rel.to.slice(dotB + 1);

    const mA = modelMap.get(modelA);
    const mB = modelMap.get(modelB);
    if (!mA || !mB) {
      ambiguous.push({ from: rel.from, to: rel.to, reason: `model not found: ${!mA ? modelA : modelB}` });
      continue;
    }

    // Find FK field on each side
    const fkOnB = findFkField(mB, relNameB, modelA);
    const fkOnA = findFkField(mA, relNameA, modelB);

    if (fkOnB && !fkOnA) {
      // FK on side B → B belongs to A
      const aHasId = mA.fields.some(f => f.name === 'id');
      if (!aHasId) {
        ambiguous.push({ from: rel.from, to: rel.to, reason: `model ${modelA} has no 'id' field for references` });
        continue;
      }
      if (hasFieldNameConflict(mA, relNameA) || hasFieldNameConflict(mB, relNameB)) {
        const conflict = hasFieldNameConflict(mA, relNameA) ? `${modelA}.${relNameA}` : `${modelB}.${relNameB}`;
        ambiguous.push({ from: rel.from, to: rel.to, reason: `relation field name '${conflict}' conflicts with existing scalar field` });
        continue;
      }
      resolved.push({
        modelA, relNameA, modelB, relNameB,
        fkSide: 'B',
        fkField: fkOnB.name,
        optional: isOptionalField(fkOnB),
        onDelete: rel.onDelete,
      });
    } else if (fkOnA && !fkOnB) {
      // FK on side A → A belongs to B
      const bHasId = mB.fields.some(f => f.name === 'id');
      if (!bHasId) {
        ambiguous.push({ from: rel.from, to: rel.to, reason: `model ${modelB} has no 'id' field for references` });
        continue;
      }
      if (hasFieldNameConflict(mA, relNameA) || hasFieldNameConflict(mB, relNameB)) {
        const conflict = hasFieldNameConflict(mA, relNameA) ? `${modelA}.${relNameA}` : `${modelB}.${relNameB}`;
        ambiguous.push({ from: rel.from, to: rel.to, reason: `relation field name '${conflict}' conflicts with existing scalar field` });
        continue;
      }
      resolved.push({
        modelA, relNameA, modelB, relNameB,
        fkSide: 'A',
        fkField: fkOnA.name,
        optional: isOptionalField(fkOnA),
        onDelete: rel.onDelete,
      });
    } else if (fkOnA && fkOnB) {
      ambiguous.push({ from: rel.from, to: rel.to, reason: 'FK fields found on both sides' });
    } else {
      // No FK on either side → many-to-many (Prisma implicit junction table)
      const aHasId = mA.fields.some(f => f.name === 'id');
      const bHasId = mB.fields.some(f => f.name === 'id');
      if (!aHasId || !bHasId) {
        ambiguous.push({ from: rel.from, to: rel.to, reason: `model ${!aHasId ? modelA : modelB} has no 'id' field for many-to-many` });
        continue;
      }
      if (hasFieldNameConflict(mA, relNameA) || hasFieldNameConflict(mB, relNameB)) {
        const conflict = hasFieldNameConflict(mA, relNameA) ? `${modelA}.${relNameA}` : `${modelB}.${relNameB}`;
        ambiguous.push({ from: rel.from, to: rel.to, reason: `relation field name '${conflict}' conflicts with existing scalar field` });
        continue;
      }
      manyToMany.push({
        modelA,
        modelB,
        fieldA: relNameA,
        fieldB: relNameB,
        name: `${modelA}_${relNameA}_${modelB}_${relNameB}`,
      });
    }
  }

  return { resolved, ambiguous, manyToMany };
}

function findFkField(model: AirDbModel, relName: string, otherModel: string): AirDbField | undefined {
  const lcOther = otherModel.charAt(0).toLowerCase() + otherModel.slice(1);
  return model.fields.find(f => f.name === `${relName}_id`) ??
    model.fields.find(f => f.name === `${lcOther}_id`);
}

function isOptionalField(field: AirDbField): boolean {
  return field.type.kind === 'optional';
}

function hasFieldNameConflict(model: AirDbModel, relName: string): boolean {
  return model.fields.some(f => f.name === relName);
}

// ---- Build relation field map ----

/** Map Prisma onDelete action keyword from resolved relation */
function resolveOnDelete(r: ResolvedRelation): string {
  // Explicit onDelete from AIR syntax takes priority
  if (r.onDelete === 'cascade') return 'Cascade';
  if (r.onDelete === 'setNull') return 'SetNull';
  if (r.onDelete === 'restrict') return 'Restrict';
  // Heuristic: required FK → Cascade, optional FK → SetNull
  return r.optional ? 'SetNull' : 'Cascade';
}

function buildRelationFieldMap(resolved: ResolvedRelation[], manyToMany: ManyToManyRelation[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  const getLines = (model: string) => {
    if (!map.has(model)) map.set(model, []);
    return map.get(model)!;
  };

  for (const r of resolved) {
    const onDeleteAction = resolveOnDelete(r);

    if (r.fkSide === 'B') {
      // B belongs to A via fkField on B
      const relationName = `${r.modelA}_${r.relNameA}`;
      getLines(r.modelA).push(`  ${r.relNameA}  ${r.modelB}[]  @relation("${relationName}")`);
      const opt = r.optional ? '?' : '';
      getLines(r.modelB).push(`  ${r.relNameB}  ${r.modelA}${opt}  @relation("${relationName}", fields: [${r.fkField}], references: [id], onDelete: ${onDeleteAction})`);
    } else {
      // A belongs to B via fkField on A
      const relationName = `${r.modelB}_${r.relNameB}`;
      const opt = r.optional ? '?' : '';
      getLines(r.modelA).push(`  ${r.relNameA}  ${r.modelB}${opt}  @relation("${relationName}", fields: [${r.fkField}], references: [id], onDelete: ${onDeleteAction})`);
      getLines(r.modelB).push(`  ${r.relNameB}  ${r.modelA}[]  @relation("${relationName}")`);
    }
  }

  // Many-to-many: both sides get Model[] fields (Prisma implicit junction table)
  for (const m of manyToMany) {
    getLines(m.modelA).push(`  ${m.fieldA}  ${m.modelB}[]`);
    getLines(m.modelB).push(`  ${m.fieldB}  ${m.modelA}[]`);
  }

  return map;
}

// ---- Index generation ----

function buildIndexMap(db: AirDbBlock): {
  fieldAttrs: Map<string, Map<string, string>>;
  modelAttrs: Map<string, string[]>;
  todoComments: string[];
} {
  const fieldAttrs = new Map<string, Map<string, string>>();
  const modelAttrs = new Map<string, string[]>();
  const todoComments: string[] = [];

  const modelNames = new Set(db.models.map(m => m.name));
  const modelFieldSets = new Map<string, Set<string>>();
  for (const m of db.models) {
    modelFieldSets.set(m.name, new Set(m.fields.map(f => f.name)));
  }

  for (const idx of db.indexes) {
    // Parse Model.field from each field entry
    const parsed = idx.fields.map(f => {
      const dot = f.indexOf('.');
      if (dot === -1) return null;
      return { model: f.slice(0, dot), field: f.slice(dot + 1) };
    });

    if (parsed.some(p => p === null)) {
      todoComments.push(`// TODO: invalid index field format: ${idx.fields.join(', ')}`);
      continue;
    }

    // All fields must reference the same model
    const models = new Set(parsed.map(p => p!.model));
    if (models.size > 1) {
      todoComments.push(`// TODO: cross-model index not supported: ${idx.fields.join(', ')}`);
      continue;
    }

    const modelName = parsed[0]!.model;
    const fieldNames = parsed.map(p => p!.field);

    // Validate model exists
    if (!modelNames.has(modelName)) {
      todoComments.push(`// TODO: index references unknown model '${modelName}': ${idx.fields.join(', ')}`);
      continue;
    }

    // Validate fields exist on model
    const fieldSet = modelFieldSets.get(modelName)!;
    const unknownFields = fieldNames.filter(fn => !fieldSet.has(fn));
    if (unknownFields.length > 0) {
      todoComments.push(`// TODO: index references unknown field(s) '${unknownFields.join(', ')}' on model '${modelName}'`);
      continue;
    }

    if (fieldNames.length === 1) {
      if (idx.unique) {
        // Single field + unique → field-level @unique
        if (!fieldAttrs.has(modelName)) fieldAttrs.set(modelName, new Map());
        fieldAttrs.get(modelName)!.set(fieldNames[0], '@unique');
      } else {
        // Single field + not unique → model-level @@index
        if (!modelAttrs.has(modelName)) modelAttrs.set(modelName, []);
        modelAttrs.get(modelName)!.push(`  @@index([${fieldNames[0]}])`);
      }
    } else {
      // Composite
      const fieldsStr = fieldNames.join(', ');
      if (idx.unique) {
        if (!modelAttrs.has(modelName)) modelAttrs.set(modelName, []);
        modelAttrs.get(modelName)!.push(`  @@unique([${fieldsStr}])`);
      } else {
        if (!modelAttrs.has(modelName)) modelAttrs.set(modelName, []);
        modelAttrs.get(modelName)!.push(`  @@index([${fieldsStr}])`);
      }
    }
  }

  return { fieldAttrs, modelAttrs, todoComments };
}

// ---- Field line generator ----

function generateFieldLine(
  field: AirDbField,
  model: AirDbModel,
  enums: PrismaEnum[],
  fieldAttrMap?: Map<string, string>,
): string {
  const parts: string[] = [];

  // Field name
  parts.push(`  ${field.name}`);

  // Type — SQLite doesn't support enums, map to String with comment
  let prismaType: string;
  let enumComment = '';
  const baseType = unwrapType(field.type);
  if (baseType.kind === 'enum') {
    prismaType = field.type.kind === 'optional' ? 'String?' : 'String';
    enumComment = ` // ${baseType.values.join(', ')}`;
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

  // Append field-level attributes from index map (e.g. @unique)
  if (fieldAttrMap) {
    const extra = fieldAttrMap.get(field.name);
    if (extra) attrs.push(extra);
  }

  if (attrs.length > 0) {
    parts.push(attrs.join(' '));
  }

  return parts.join('  ') + enumComment;
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

  // Resolve relations and indexes
  const { resolved, ambiguous, manyToMany } = resolveRelations(db);
  const relationFieldMap = buildRelationFieldMap(resolved, manyToMany);
  const { fieldAttrs, modelAttrs, todoComments } = buildIndexMap(db);

  // Enums not generated as Prisma enum blocks (SQLite doesn't support them).
  // Enum fields map to String with inline comments documenting valid values.
  const enums: PrismaEnum[] = [];

  // Model blocks
  for (const model of db.models) {
    lines.push('');
    lines.push(`model ${model.name} {`);

    // Scalar fields (with optional field-level attrs from indexes)
    const modelFieldAttrs = fieldAttrs.get(model.name);
    for (const field of model.fields) {
      lines.push(generateFieldLine(field, model, enums, modelFieldAttrs));
    }

    // Relation fields
    const relLines = relationFieldMap.get(model.name);
    if (relLines && relLines.length > 0) {
      lines.push('');
      for (const rl of relLines) {
        lines.push(rl);
      }
    }

    // Model-level @@index / @@unique
    const mAttrs = modelAttrs.get(model.name);
    if (mAttrs && mAttrs.length > 0) {
      lines.push('');
      for (const attr of mAttrs) {
        lines.push(attr);
      }
    }

    lines.push('}');
  }

  // Ambiguous relations as TODO comments at bottom
  if (ambiguous.length > 0) {
    lines.push('');
    lines.push('// TODO: Ambiguous relations (need manual resolution)');
    for (const a of ambiguous) {
      lines.push(`// ${a.from} <-> ${a.to} — ${a.reason}`);
    }
  }

  // Index TODO comments at bottom
  if (todoComments.length > 0) {
    lines.push('');
    for (const comment of todoComments) {
      lines.push(comment);
    }
  }

  return lines.join('\n') + '\n';
}
