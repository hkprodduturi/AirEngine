# Validation Diagnostics Specification

## Purpose

Define a structured diagnostic format optimized for AI agent self-repair. Every parse error, validation error, and lint warning must be machine-readable with stable identifiers, precise locations, and actionable fix information.

## Diagnostic Structure

### Schema

```typescript
interface Diagnostic {
  // Stable identifier (never changes across versions)
  code: string;           // e.g., "AIR-E001", "AIR-W003", "AIR-L005"

  // Severity
  severity: 'error' | 'warning' | 'info';

  // Human-readable description
  message: string;        // e.g., "Missing @app:name declaration"

  // Location (all optional — not all diagnostics have source positions)
  location?: {
    line: number;         // 1-indexed
    col: number;          // 1-indexed
    endLine?: number;     // For span-based errors
    endCol?: number;
    sourceLine?: string;  // The raw source text at error location
  };

  // Block context (which @block the error is in)
  block?: string;         // e.g., "@db", "@api", "@ui", "@state"

  // Path within block (for nested errors)
  path?: string;          // e.g., "User.email", "@page:login>form"

  // Machine-friendly fix hint
  fix?: {
    description: string;  // What to do, in imperative form
    suggestion?: string;  // Exact replacement text (when deterministic)
    pattern?: string;     // Regex pattern to find the problematic text
    insertAt?: {          // Where to insert (for missing-block errors)
      line: number;
      col: number;
    };
  };

  // Categorization for agent routing
  category: 'syntax' | 'structural' | 'semantic' | 'style' | 'performance';
}
```

### Response Envelope

```typescript
interface DiagnosticResult {
  valid: boolean;                    // false if any severity='error'
  diagnostics: Diagnostic[];         // All issues, ordered by severity then line
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  source_hash: string;              // SHA-256 of input (for cache correlation)
  airengine_version: string;        // e.g., "0.1.7"
  schema_version: string;           // "1.0" — versioned for forward compatibility
}
```

**Schema Version**: The `schema_version` field tracks the diagnostics envelope format. Current version is `"1.0"`. Consumers should check this field to handle future format evolution gracefully. A JSON Schema file (`docs/diagnostics.schema.json`) will formalize the contract.

## Error Code Registry

### Naming Convention

```
AIR-{CATEGORY}{NUMBER}

Categories:
  E = Error (blocks compilation)
  W = Warning (compiles but may have issues)
  L = Lint (code quality, not correctness)
  P = Parse (syntax errors)
```

### Parse Errors (AIR-P*)

| Code | Message | Category | Current Source |
|------|---------|----------|---------------|
| AIR-P001 | Unexpected token '{token}' at line {line}:{col} | syntax | AirParseError |
| AIR-P002 | Unterminated string literal | syntax | AirLexError |
| AIR-P003 | Expected {expected}, got {actual} | syntax | AirParseError |
| AIR-P004 | Unknown block type '@{name}' | syntax | parser |
| AIR-P005 | Invalid type '{type}' — expected str/int/float/bool/date/datetime/enum/list/map/any/[type]/{fields} | syntax | parseType() |

### Validation Errors (AIR-E*)

| Code | Message | Category | Current Source |
|------|---------|----------|---------------|
| AIR-E001 | Missing @app:name declaration | structural | validator E001 |
| AIR-E002 | No @ui block found — app has no interface | structural | validator E002 |
| AIR-E003 | @api route references unknown model '{model}' | semantic | lint rule |
| AIR-E004 | Duplicate @page name '{name}' | structural | NEW |
| AIR-E005 | @nav references page '{page}' not defined in @ui | semantic | NEW |
| AIR-E006 | @db field type invalid: '{type}' | semantic | NEW |
| AIR-E007 | @api CRUD handler references model not in @db | semantic | NEW |
| ~~AIR-E008~~ | ~~@auth(required) without login route in @api~~ | — | Moved to AIR-W008 |
| AIR-E009 | @state field '{field}' shadows @db model name | semantic | NEW |

### Validation Warnings (AIR-W*)

| Code | Message | Category | Current Source |
|------|---------|----------|---------------|
| AIR-W001 | No @state block found — app has no reactive state | structural | validator W001 |
| AIR-W002 | @db models defined but no @api routes — models won't be accessible | semantic | lint rule |
| AIR-W003 | Ambiguous relation {from}<>{to}: {reason} | semantic | lint rule |
| AIR-W004 | @state field '{field}' appears unused in @ui | style | lint rule |
| AIR-W005 | Auth route without @auth block — auth may not be enforced | semantic | NEW |
| AIR-W006 | @page has no interactive elements (no forms, buttons, or inputs) | style | NEW |
| AIR-W007 | @db model '{model}' has no primary key field | structural | NEW |
| AIR-W008 | @auth(required) without login route in @api — external auth may be intended | semantic | NEW (was AIR-E008) |

### Lint Info (AIR-L*)

| Code | Message | Category | Current Source |
|------|---------|----------|---------------|
| AIR-L001 | Frontend-only app with @state but no @persist — data won't survive page refresh | style | lint rule |
| AIR-L002 | @style not specified — default theme will be applied | style | NEW |
| AIR-L003 | Consider adding @nav for multi-page apps | style | NEW |
| AIR-L004 | Large @db model ({n} fields) — consider splitting | performance | NEW |

## Fix Hint Examples

### Example 1: Missing @app:name

```json
{
  "code": "AIR-E001",
  "severity": "error",
  "message": "Missing @app:name declaration",
  "category": "structural",
  "fix": {
    "description": "Add @app:name as the first line of the file",
    "suggestion": "@app:myapp",
    "insertAt": { "line": 1, "col": 1 }
  }
}
```

### Example 2: Parse Error — Wrong Bracket

```json
{
  "code": "AIR-P003",
  "severity": "error",
  "message": "Expected open_brace '{', got open_paren '('",
  "location": {
    "line": 4,
    "col": 4,
    "sourceLine": "@db(Todo{id:int:primary:auto})"
  },
  "block": "@db",
  "category": "syntax",
  "fix": {
    "description": "Replace '(' with '{' — @db blocks use braces, not parentheses",
    "pattern": "@db\\(",
    "suggestion": "@db{"
  }
}
```

### Example 3: Unknown Model Reference

```json
{
  "code": "AIR-E003",
  "severity": "error",
  "message": "API route POST /tasks references unknown model 'Task'",
  "block": "@api",
  "path": "POST:/tasks",
  "category": "semantic",
  "fix": {
    "description": "Add a Task model to @db, or fix the model name in the route handler",
    "suggestion": "@db{\n  Task{id:int:primary:auto,title:str:required}\n}"
  }
}
```

### Example 4: Invalid Type

```json
{
  "code": "AIR-P005",
  "severity": "error",
  "message": "Invalid type 'object' — expected str/int/float/bool/date/datetime/enum/list/map/any/[type]/{fields}",
  "location": {
    "line": 3,
    "col": 8,
    "sourceLine": "  user:object"
  },
  "block": "@state",
  "path": "user",
  "category": "syntax",
  "fix": {
    "description": "Replace 'object' with a structural type: use '{field:type,...}' for objects, 'map' for untyped objects, or '?map' for optional",
    "suggestion": "?map"
  }
}
```

### Example 5: Ambiguous Relation

```json
{
  "code": "AIR-W003",
  "severity": "warning",
  "message": "Ambiguous relation User<>Post: both models reference each other but no @relation defined",
  "block": "@db",
  "path": "User<>Post",
  "category": "semantic",
  "fix": {
    "description": "Add explicit @relation to clarify the foreign key direction",
    "suggestion": "@relation(Post.author_id<>User.id)"
  }
}
```

### Example 6: Unused State with Auth Pattern

```json
{
  "code": "AIR-W004",
  "severity": "warning",
  "message": "State field 'authError' appears unused in @ui",
  "block": "@state",
  "path": "authError",
  "category": "style",
  "fix": {
    "description": "Either reference #authError in @ui (e.g., in login form error display) or remove from @state"
  }
}
```

## Deterministic Formatting

### Output Ordering
1. Errors first, then warnings, then info
2. Within same severity: ordered by source line number (ascending)
3. Diagnostics without line numbers appear last within their severity group

### Serialization
- JSON output (via MCP tool response)
- Stable key ordering: `code`, `severity`, `message`, `location`, `block`, `path`, `fix`, `category`
- No optional fields omitted (use `null` for absent values in strict mode, omit in compact mode)

### Human-Readable Format (CLI)

```
error[AIR-E001]: Missing @app:name declaration
  --> line 1
  = fix: Add @app:name as the first line of the file

error[AIR-P003]: Expected open_brace '{', got open_paren '('
  --> line 4:4
  |
4 | @db(Todo{id:int:primary:auto})
  |    ^ expected '{'
  = fix: Replace '(' with '{' — @db blocks use braces, not parentheses

warning[AIR-W004]: State field 'authError' appears unused in @ui
  --> @state.authError
  = fix: Reference #authError in @ui or remove from @state
```

## Migration from Current Format

### Current → New Mapping

| Current | New |
|---------|-----|
| `AirParseError` with `{ line, col, token }` | `AIR-P001..P005` with full `location` + `fix` |
| `ValidationError` with `{ code: "E001" }` | `AIR-E001` with `fix` hint |
| `ValidationWarning` with `{ code: "W001" }` | `AIR-W001` with `fix` hint |
| `LintHint` with `{ level, message }` | `AIR-E003/W002..W004/L001` with structured `fix` |

### Implementation Plan

1. Define `Diagnostic` type in `src/types.ts`
2. Update `src/validator/index.ts` to return `Diagnostic[]`
3. Update `src/mcp/server.ts` lint tool to return `Diagnostic[]`
4. Wrap parser errors in `Diagnostic` format (catch → transform)
5. Update `air_validate` MCP tool response format
6. Add new validation rules (AIR-E004 through AIR-E009)
7. Backward compatibility: keep old response format available via `format` parameter

### Backward Compatibility

The MCP tools should support a `format` parameter:
- `format: "v1"` — current format (default during migration)
- `format: "v2"` — new Diagnostic format
- After migration period, `v2` becomes default
