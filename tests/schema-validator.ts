/**
 * Mini JSON Schema Validator
 *
 * Recursive validator supporting a practical subset of JSON Schema 2020-12:
 *   type, required, properties, additionalProperties, items, enum, const,
 *   pattern, minimum, oneOf, $ref/$defs.
 *
 * Returns an array of human-readable error strings; empty = valid.
 * Shared between tests and foundation-check.
 */

export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  rootSchema: Record<string, unknown>,
  path: string = '$',
): string[] {
  const errors: string[] = [];

  // Resolve $ref
  if (schema.$ref) {
    const refPath = (schema.$ref as string).replace('#/$defs/', '');
    const defs = (rootSchema.$defs ?? {}) as Record<string, Record<string, unknown>>;
    const resolved = defs[refPath];
    if (!resolved) {
      errors.push(`${path}: unresolvable $ref "${schema.$ref}"`);
      return errors;
    }
    return validateJsonSchema(value, resolved, rootSchema, path);
  }

  // oneOf
  if (schema.oneOf) {
    const branches = schema.oneOf as Record<string, unknown>[];
    const branchValid = branches.some(
      branch => validateJsonSchema(value, branch, rootSchema, path).length === 0,
    );
    if (!branchValid) {
      errors.push(`${path}: value does not match any oneOf branch`);
    }
    return errors;
  }

  // null check
  if (value === null || value === undefined) {
    if (schema.type === 'null') return errors;
    errors.push(`${path}: expected type "${schema.type}" but got null/undefined`);
    return errors;
  }

  // type check
  if (schema.type) {
    const sType = schema.type as string;
    let typeOk = false;
    if (sType === 'object') typeOk = typeof value === 'object' && !Array.isArray(value);
    else if (sType === 'array') typeOk = Array.isArray(value);
    else if (sType === 'string') typeOk = typeof value === 'string';
    else if (sType === 'number') typeOk = typeof value === 'number';
    else if (sType === 'integer') typeOk = typeof value === 'number' && Number.isInteger(value);
    else if (sType === 'boolean') typeOk = typeof value === 'boolean';
    else if (sType === 'null') typeOk = value === null;
    if (!typeOk) {
      errors.push(`${path}: expected type "${sType}" but got ${typeof value}${Array.isArray(value) ? '(array)' : ''}`);
      return errors;
    }
  }

  // const
  if ('const' in schema) {
    if (value !== schema.const) {
      errors.push(`${path}: expected const ${JSON.stringify(schema.const)} but got ${JSON.stringify(value)}`);
    }
  }

  // enum
  if (schema.enum) {
    if (!(schema.enum as unknown[]).includes(value)) {
      errors.push(`${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
    }
  }

  // pattern (strings)
  if (schema.pattern && typeof value === 'string') {
    if (!new RegExp(schema.pattern as string).test(value)) {
      errors.push(`${path}: "${value}" does not match pattern ${schema.pattern}`);
    }
  }

  // minimum (numbers)
  if (typeof schema.minimum === 'number' && typeof value === 'number') {
    if (value < (schema.minimum as number)) {
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    }
  }

  // object: required + properties + additionalProperties
  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    const obj = value as Record<string, unknown>;

    if (schema.required) {
      for (const field of schema.required as string[]) {
        if (!(field in obj)) {
          errors.push(`${path}: missing required field "${field}"`);
        }
      }
    }

    if (schema.properties) {
      const props = schema.properties as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(props)) {
        // Skip absent or undefined values (undefined is dropped by JSON.stringify)
        if (key in obj && obj[key] !== undefined) {
          errors.push(...validateJsonSchema(obj[key], propSchema, rootSchema, `${path}.${key}`));
        }
      }
    }

    // additionalProperties: false — check for unexpected keys (skip undefined values)
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties as object));
      for (const key of Object.keys(obj)) {
        if (obj[key] === undefined) continue; // dropped by JSON.stringify
        if (!allowed.has(key)) {
          errors.push(`${path}: unexpected field "${key}" (additionalProperties=false)`);
        }
      }
    }

    // additionalProperties as schema (for Maps like outputHashes)
    if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
      const valSchema = schema.additionalProperties as Record<string, unknown>;
      for (const [key, val] of Object.entries(obj)) {
        if (schema.properties && key in (schema.properties as object)) continue;
        errors.push(...validateJsonSchema(val, valSchema, rootSchema, `${path}.${key}`));
      }
    }
  }

  // array: items
  if (Array.isArray(value) && schema.items) {
    const itemSchema = schema.items as Record<string, unknown>;
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateJsonSchema(value[i], itemSchema, rootSchema, `${path}[${i}]`));
    }
  }

  return errors;
}
