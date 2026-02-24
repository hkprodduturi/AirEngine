/**
 * Database Seed Generator
 *
 * Generates server/seed.ts with 5 sample records per @db model.
 * FK-safe: resolves relations, topologically sorts models, and
 * generates sequential creates with captured IDs for FK references.
 * Models with no relations use createMany for efficiency.
 */

import type { TranspileContext } from './context.js';
import type { AirDbModel, AirDbField } from '../parser/types.js';
import { resolveRelations, type ResolvedRelation, type ManyToManyRelation } from './prisma.js';

// ---- FK edge types ----

interface FkEdge {
  childModel: string;
  fkField: string;
  parentModel: string;
  optional: boolean;
}

// ---- Main generator ----

export function generateSeedFile(ctx: TranspileContext): string {
  if (!ctx.db) return '';

  const models = ctx.db.models;

  // Resolve relations to get FK edges and many-to-many
  const { resolved, manyToMany } = resolveRelations(ctx.db);
  const fkEdges = buildFkEdges(resolved);

  // Topological sort with FK awareness
  const { sorted, brokenEdges } = topologicalSort(models, fkEdges);
  const reversed = [...sorted].reverse();

  // Determine which models need sequential creates (has FK, is a parent, or in m:n)
  const parentModels = new Set(fkEdges.map(e => e.parentModel));
  const childModels = new Set(fkEdges.map(e => e.childModel));
  const m2mModels = new Set<string>();
  for (const m of manyToMany) {
    m2mModels.add(m.modelA);
    m2mModels.add(m.modelB);
  }
  const needsSequential = new Set<string>();
  for (const m of models) {
    if (parentModels.has(m.name) || childModels.has(m.name) || m2mModels.has(m.name)) {
      needsSequential.add(m.name);
    }
  }

  // Track resolved FK fields per model
  const resolvedFkFields = new Map<string, Set<string>>();
  for (const edge of fkEdges) {
    if (!resolvedFkFields.has(edge.childModel)) resolvedFkFields.set(edge.childModel, new Set());
    resolvedFkFields.get(edge.childModel)!.add(edge.fkField);
  }

  // Models with unresolved required _id fields should be skipped
  const skipModels = new Set<string>();
  for (const model of models) {
    const hasUnresolvedRequiredFk = model.fields.some(f => {
      if (!f.name.endsWith('_id')) return false;
      if (resolvedFkFields.has(model.name) && resolvedFkFields.get(model.name)!.has(f.name)) return false;
      // Unresolved _id field — skip model if required (not optional)
      return f.type.kind !== 'optional';
    });
    if (hasUnresolvedRequiredFk) {
      skipModels.add(model.name);
    }
  }

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

  // Broken edge comments
  for (const edge of brokenEdges) {
    lines.push(`  // Note: cycle broken at optional FK ${edge.childModel}.${edge.fkField} → ${edge.parentModel}`);
  }
  if (brokenEdges.length > 0) lines.push('');

  // Seed in dependency order
  for (const model of sorted) {
    const varName = model.name.charAt(0).toLowerCase() + model.name.slice(1);

    if (skipModels.has(model.name)) {
      lines.push(`  // TODO: ${model.name} has unresolved required FK fields — skipping seed`);
      lines.push('');
      continue;
    }

    const modelFkEdges = fkEdges.filter(e => e.childModel === model.name);
    const seedableFields = getSeedableFields(model, modelFkEdges);

    if (seedableFields.length === 0 && modelFkEdges.length === 0) {
      lines.push(`  // ${model.name}: no seedable fields (all auto/FK)`);
      lines.push('');
      continue;
    }

    if (needsSequential.has(model.name)) {
      // Sequential creates with captured IDs
      for (let n = 1; n <= 5; n++) {
        const fieldValues = seedableFields.map(f => {
          const val = generateFieldValue(f, model.name, n);
          return `${f.name}: ${val}`;
        });

        // Inject password for User model when @auth is present
        if (ctx.auth && model.name === 'User' && !seedableFields.some(f => f.name === 'password')) {
          fieldValues.push(`password: 'password${n}'`);
        }

        // Add FK field references
        for (const edge of modelFkEdges) {
          if (edge.optional) {
            // Optional FK: null for record 1, parent ref for records 2-5
            if (n === 1) {
              fieldValues.push(`${edge.fkField}: null`);
            } else {
              const parentVar = edge.parentModel.charAt(0).toLowerCase() + edge.parentModel.slice(1);
              const parentIdx = ((n - 2) % 5) + 1;
              fieldValues.push(`${edge.fkField}: ${parentVar}${parentIdx}.id`);
            }
          } else {
            // Required FK: child n → parent n (modulo 5)
            const parentVar = edge.parentModel.charAt(0).toLowerCase() + edge.parentModel.slice(1);
            const parentIdx = ((n - 1) % 5) + 1;
            fieldValues.push(`${edge.fkField}: ${parentVar}${parentIdx}.id`);
          }
        }

        lines.push(`  const ${varName}${n} = await prisma.${varName}.create({ data: { ${fieldValues.join(', ')} } });`);
      }
    } else {
      // Batch createMany (no relations)
      lines.push(`  await prisma.${varName}.createMany({`);
      lines.push('    data: [');
      for (let n = 1; n <= 5; n++) {
        const fieldValues = seedableFields.map(f => {
          const val = generateFieldValue(f, model.name, n);
          return `${f.name}: ${val}`;
        });
        lines.push(`      { ${fieldValues.join(', ')} },`);
      }
      lines.push('    ],');
      lines.push('  });');
    }
    lines.push('');
  }

  // Many-to-many connect calls (skip if either model was skipped)
  if (manyToMany.length > 0) {
    const validM2m = manyToMany.filter(m => !skipModels.has(m.modelA) && !skipModels.has(m.modelB));
    if (validM2m.length > 0) {
      lines.push('  // Connect many-to-many relations');
      for (const m of validM2m) {
        const varA = m.modelA.charAt(0).toLowerCase() + m.modelA.slice(1);
        const varB = m.modelB.charAt(0).toLowerCase() + m.modelB.slice(1);
        const fieldA = m.fieldA;
        // Connect records: A1↔B1, A2↔B2, A3↔B3, A4↔B4, A5↔B5
        for (let n = 1; n <= 5; n++) {
          lines.push(`  await prisma.${varA}.update({ where: { id: ${varA}${n}.id }, data: { ${fieldA}: { connect: { id: ${varB}${n}.id } } } });`);
        }
      }
      lines.push('');
    }
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

// ---- FK edge builder ----

function buildFkEdges(resolved: ResolvedRelation[]): FkEdge[] {
  const edges: FkEdge[] = [];
  for (const r of resolved) {
    if (r.fkSide === 'B') {
      // FK on model B → B is child, A is parent
      edges.push({
        childModel: r.modelB,
        fkField: r.fkField,
        parentModel: r.modelA,
        optional: r.optional,
      });
    } else {
      // FK on model A → A is child, B is parent
      edges.push({
        childModel: r.modelA,
        fkField: r.fkField,
        parentModel: r.modelB,
        optional: r.optional,
      });
    }
  }
  return edges;
}

// ---- Topological sort (Kahn's algorithm) ----

interface SortResult {
  sorted: AirDbModel[];
  brokenEdges: FkEdge[];
}

function topologicalSort(models: AirDbModel[], fkEdges: FkEdge[]): SortResult {
  const modelMap = new Map<string, AirDbModel>();
  for (const m of models) modelMap.set(m.name, m);

  let edges = [...fkEdges];
  const brokenEdges: FkEdge[] = [];
  const result: AirDbModel[] = [];
  const remaining = new Set(models.map(m => m.name));

  while (remaining.size > 0) {
    // Compute in-degree from current edges for remaining models
    const inDegree = new Map<string, number>();
    for (const name of remaining) inDegree.set(name, 0);

    for (const edge of edges) {
      if (remaining.has(edge.childModel) && remaining.has(edge.parentModel)) {
        inDegree.set(edge.childModel, (inDegree.get(edge.childModel) ?? 0) + 1);
      }
    }

    // Find zero in-degree models (sorted lexically for determinism)
    const queue = [...remaining].filter(name => (inDegree.get(name) ?? 0) === 0).sort();

    if (queue.length > 0) {
      for (const name of queue) {
        result.push(modelMap.get(name)!);
        remaining.delete(name);
      }
    } else {
      // Cycle detected — find optional FK edge to break (lexical order)
      const optionalEdges = edges
        .filter(e => e.optional && remaining.has(e.childModel) && remaining.has(e.parentModel))
        .sort((a, b) => `${a.childModel}.${a.fkField}`.localeCompare(`${b.childModel}.${b.fkField}`));

      if (optionalEdges.length > 0) {
        const edgeToBreak = optionalEdges[0];
        brokenEdges.push(edgeToBreak);
        edges = edges.filter(e => e !== edgeToBreak);
      } else {
        // No optional edge to break — append remaining with TODO
        const remainingModels = [...remaining].sort().map(name => modelMap.get(name)!);
        result.push(...remainingModels);
        break;
      }
    }
  }

  return { sorted: result, brokenEdges };
}

// ---- Seedable fields ----

/** Get fields that should be included in seed data */
function getSeedableFields(model: AirDbModel, fkEdges: FkEdge[] = []): AirDbField[] {
  const resolvedFkFieldNames = new Set(fkEdges.map(e => e.fkField));

  return model.fields.filter(f => {
    // Skip auto-increment primary keys
    if (f.primary && f.auto) return false;
    // Skip auto datetime fields (let @default(now()) handle them)
    if ((f.type.kind === 'datetime' || f.type.kind === 'date') && f.auto) return false;
    // Skip FK fields covered by resolved relations (wired separately)
    if (resolvedFkFieldNames.has(f.name)) return false;
    // Skip unresolved FK fields (heuristic: ends with _id)
    if (f.name.endsWith('_id')) return false;
    return true;
  });
}

// ---- Value generators ----

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
      return generateIntValue(name, n);
    case 'float':
      return generateFloatValue(name, n);
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

const PERSON_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
const PERSON_MODELS = new Set([
  'user', 'agent', 'customer', 'contact', 'volunteer', 'donor', 'patient',
  'doctor', 'student', 'author', 'adopter', 'driver', 'guest', 'responder',
  'shipper', 'staff', 'member', 'employee', 'owner', 'manager', 'carrier',
  'instructor', 'therapist', 'client', 'teacher', 'worker', 'inspector',
  'technician', 'nurse', 'alumnus', 'tutor', 'applicant', 'reviewer',
  'crewmember', 'player',
]);

function isPersonModel(modelName: string): boolean {
  return PERSON_MODELS.has(modelName.toLowerCase());
}

/** Generate smart string values based on field name heuristics */
function generateStringValue(fieldName: string, modelName: string, n: number): string {
  const lower = fieldName.toLowerCase();
  const idx = (n - 1) % PERSON_NAMES.length;
  const modelPrefix = modelName.toLowerCase();
  // Email: prefix with model name to avoid cross-model unique conflicts
  if (lower === 'email') return `'${modelPrefix}${n}@example.com'`;
  // Name: use person names for person models, model-based names otherwise
  if (lower === 'name') {
    if (isPersonModel(modelName)) return `'${PERSON_NAMES[idx]}'`;
    return `'${modelName} ${n}'`;
  }
  if (lower === 'slug') return `'sample-${modelPrefix}-${n}'`;
  if (lower === 'password') return `'password${n}'`;
  if (lower === 'title') {
    const titles = [
      `'Design landing page'`, `'Fix navigation bug'`, `'Update API docs'`,
      `'Add unit tests'`, `'Refactor auth flow'`,
    ];
    return titles[(n - 1) % titles.length];
  }
  if (lower === 'subject') {
    const subjects = [
      `'Welcome aboard'`, `'Weekly update'`, `'Action required'`,
      `'Meeting notes'`, `'Quick question'`,
    ];
    return subjects[(n - 1) % subjects.length];
  }
  if (lower === 'description' || lower === 'bio') return `'${modelName} description for record ${n}.'`;
  if (lower === 'url' || lower === 'website') return `'https://example.com/${modelPrefix}/${n}'`;
  if (lower === 'avatar' || lower === 'image') return `'https://api.dicebear.com/7.x/initials/svg?seed=${modelPrefix}${n}'`;
  if (lower.includes('image') && lower.includes('url')) return `'https://picsum.photos/seed/${modelPrefix}${n}/400/300'`;
  if (lower === 'phone') return `'+155500${n}${String(modelPrefix.charCodeAt(0)).slice(-2)}'`;
  if (lower === 'address') return `'${n}00 Main St, City, ST'`;
  if (lower === 'content' || lower === 'body' || lower === 'text') return `'Sample content for ${modelPrefix} ${n}.'`;
  return `'${modelName} ${fieldName} ${n}'`;
}

/** Generate smart integer values based on field name heuristics */
function generateIntValue(fieldName: string, n: number): string {
  const lower = fieldName.toLowerCase();
  if (lower === 'age') return `${20 + 5 * n}`;
  if (lower === 'quantity' || lower === 'count') return `${n * 3}`;
  if (lower === 'rating') return `${Math.min(5, n + 2)}`;
  if (lower === 'priority' || lower === 'order' || lower === 'position') return `${n}`;
  if (lower === 'views' || lower === 'likes') return `${n * 42}`;
  return `${n * 10}`;
}

/** Generate smart float values based on field name heuristics */
function generateFloatValue(fieldName: string, n: number): string {
  const lower = fieldName.toLowerCase();
  if (lower === 'price' || lower === 'amount' || lower === 'cost') return `${(29.99 * n).toFixed(2)}`;
  if (lower === 'rating' || lower === 'score') return `${(3.0 + 0.5 * n).toFixed(1)}`;
  if (lower === 'percentage' || lower === 'percent') return `${(25.0 * n).toFixed(1)}`;
  return `${n * 10.5}`;
}
