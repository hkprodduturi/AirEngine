/**
 * AIR Block Parsers — recursive-descent parsers for each block type.
 *
 * Design: permissive first. Parse all 5 existing examples before tightening.
 * UI parser supports arbitrary nesting depth with a recursion guard at 500.
 */

import type { Token, TokenKind } from './lexer.js';
import { AirParseError } from './errors.js';
import type {
  AirType,
  AirField,
  AirLiteral,
  AirStateBlock,
  AirStyleBlock,
  AirUIBlock,
  AirUINode,
  AirAPIBlock,
  AirRoute,
  AirAuthBlock,
  AirNavBlock,
  AirNavRoute,
  AirPersistBlock,
  AirHookBlock,
  AirHook,
  AirDbBlock,
  AirDbModel,
  AirDbField,
  AirDbRelation,
  AirDbIndex,
  AirCronBlock,
  AirWebhookBlock,
  AirWebhookRoute,
  AirQueueBlock,
  AirQueueJob,
  AirEmailBlock,
  AirEmailTemplate,
  AirEnvBlock,
  AirEnvVar,
  AirDeployBlock,
  AirHandlerBlock,
  AirHandlerContract,
} from './types.js';

const MAX_DEPTH = 500;

// ---- Token Stream ----

export class TokenStream {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(offset = 0): Token {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) return this.tokens[this.tokens.length - 1];
    return this.tokens[idx];
  }

  current(): Token {
    return this.peek();
  }

  advance(): Token {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  expect(kind: TokenKind, value?: string): Token {
    const t = this.current();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw this.error(`Expected ${kind}${value ? ` '${value}'` : ''}, got ${t.kind} '${t.value}'`);
    }
    return this.advance();
  }

  match(kind: TokenKind, value?: string): boolean {
    const t = this.current();
    if (t.kind === kind && (value === undefined || t.value === value)) {
      this.advance();
      return true;
    }
    return false;
  }

  is(kind: TokenKind, value?: string): boolean {
    const t = this.current();
    return t.kind === kind && (value === undefined || t.value === value);
  }

  isEof(): boolean {
    return this.current().kind === 'eof';
  }

  skipNewlines() {
    while (this.current().kind === 'newline') this.advance();
  }

  error(msg: string): AirParseError {
    const t = this.current();
    return new AirParseError(msg, { line: t.line, col: t.col, token: t.value });
  }

  save(): number {
    return this.pos;
  }

  restore(pos: number) {
    this.pos = pos;
  }
}

// ---- Type Parser ----

export function parseType(s: TokenStream): AirType {
  // Optional prefix: ?type
  if (s.is('operator', '?')) {
    s.advance();
    return { kind: 'optional', of: parseType(s) };
  }

  // Array: [type]
  if (s.is('open_bracket')) {
    s.advance();
    const inner = parseType(s);
    s.expect('close_bracket');
    return { kind: 'array', of: inner };
  }

  // Object: {field, field, ...}
  if (s.is('open_brace')) {
    s.advance();
    const fields = parseFieldList(s, 'close_brace');
    s.expect('close_brace');
    return { kind: 'object', fields };
  }

  // Ref: #Entity
  if (s.is('hash')) {
    s.advance();
    const name = s.expect('identifier').value;
    return { kind: 'ref', entity: name };
  }

  // Type keyword: str, int, float, bool, date, enum, list, map, any
  if (s.is('type_keyword')) {
    const kw = s.advance().value;
    if (kw === 'enum') {
      if (s.is('open_paren')) {
        s.advance();
        const values: string[] = [];
        while (!s.is('close_paren') && !s.isEof()) {
          // enum values can be identifiers or type_keywords used as names
          if (s.is('identifier') || s.is('type_keyword')) {
            values.push(s.advance().value);
          } else {
            values.push(s.advance().value);
          }
          if (!s.match('comma')) break;
        }
        s.expect('close_paren');
        return { kind: 'enum', values };
      }
      return { kind: 'enum', values: [] };
    }
    // list → shorthand for array of any (e.g. items:list)
    if (kw === 'list') {
      // list(type) → typed array, or bare list → array of str
      if (s.is('open_paren')) {
        s.advance();
        const inner = parseType(s);
        s.expect('close_paren');
        return { kind: 'array', of: inner };
      }
      return { kind: 'array', of: { kind: 'str' } };
    }
    // map → shorthand for object
    if (kw === 'map') {
      return { kind: 'object', fields: [] };
    }
    // any → treat as str (safest default)
    if (kw === 'any') {
      return { kind: 'str' };
    }
    const k = kw as 'str' | 'int' | 'float' | 'bool' | 'date' | 'datetime';
    // Default value: type(literal) e.g. float(2000)
    if (s.is('open_paren')) {
      s.advance();
      const defVal = parseLiteral(s);
      s.expect('close_paren');
      return { kind: k, default: defVal } as AirType;
    }
    return { kind: k };
  }

  // Inline enum shorthand: value1|value2|value3 (identifiers separated by pipe)
  // Triggered when we see an identifier followed by a pipe operator
  if (s.is('identifier')) {
    const pos = s.save();
    const firstVal = s.advance().value;
    if (s.is('operator', '|')) {
      // It's an inline enum: collect all pipe-separated values
      const values: string[] = [firstVal];
      while (s.is('operator', '|')) {
        s.advance(); // consume |
        if (s.is('identifier') || s.is('type_keyword')) {
          values.push(s.advance().value);
        } else {
          break;
        }
      }
      return { kind: 'enum', values };
    }
    // Not an inline enum — restore position and fall through to error
    s.restore(pos);
  }

  throw s.error(`Expected type, got ${s.current().kind} '${s.current().value}'`);
}

function parseLiteral(s: TokenStream): AirLiteral {
  if (s.is('number')) return parseFloat(s.advance().value);
  if (s.is('string')) return s.advance().value;
  if (s.is('boolean')) return s.advance().value === 'true';
  if (s.is('identifier')) return s.advance().value;
  throw s.error(`Expected literal, got ${s.current().kind}`);
}

export function parseFieldList(s: TokenStream, terminator: TokenKind): AirField[] {
  const fields: AirField[] = [];
  s.skipNewlines();
  while (!s.is(terminator) && !s.isEof()) {
    if (s.is('identifier') || s.is('type_keyword')) {
      const name = s.advance().value;
      s.expect('colon');
      const type = parseType(s);
      fields.push({ name, type });
    } else {
      break;
    }
    s.skipNewlines();
    if (!s.match('comma')) {
      s.skipNewlines();
      if (!s.is(terminator)) break;
    }
    s.skipNewlines();
  }
  return fields;
}

// ---- DB Field Parser (with modifiers) ----

export function parseDbFieldList(s: TokenStream, terminator: TokenKind): AirDbField[] {
  const fields: AirDbField[] = [];
  s.skipNewlines();
  while (!s.is(terminator) && !s.isEof()) {
    if (s.is('identifier') || s.is('type_keyword')) {
      const name = s.advance().value;
      s.expect('colon');
      const type = parseType(s);
      const field: AirDbField = { name, type };

      // Consume `:modifier` chains
      while (s.is('colon') && !s.isEof()) {
        const save = s.save();
        s.advance(); // consume :
        if (s.is('identifier', 'primary')) {
          s.advance();
          field.primary = true;
        } else if (s.is('identifier', 'required')) {
          s.advance();
          field.required = true;
        } else if (s.is('identifier', 'auto')) {
          s.advance();
          field.auto = true;
        } else if (s.is('identifier', 'default')) {
          s.advance();
          s.expect('open_paren');
          field.default = parseLiteral(s);
          s.expect('close_paren');
        } else {
          // Unknown modifier — restore and stop
          s.restore(save);
          break;
        }
      }

      fields.push(field);
    } else {
      break;
    }
    s.skipNewlines();
    if (!s.match('comma')) {
      s.skipNewlines();
      if (!s.is(terminator)) break;
    }
    s.skipNewlines();
  }
  return fields;
}

// ---- @state parser ----

export function parseState(s: TokenStream): AirStateBlock {
  s.expect('open_brace');
  s.skipNewlines();
  const fields = parseFieldList(s, 'close_brace');
  s.skipNewlines();
  s.expect('close_brace');
  return { kind: 'state', fields };
}

// ---- @style parser ----

export function parseStyle(s: TokenStream): AirStyleBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const properties: Record<string, AirLiteral> = {};
  while (!s.is('close_paren') && !s.isEof()) {
    const key = s.expect('identifier').value;
    s.expect('colon');
    const val = parseStyleValue(s);
    properties[key] = val;
    s.skipNewlines();
    if (!s.match('comma')) {
      s.skipNewlines();
      break;
    }
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'style', properties };
}

function parseStyleValue(s: TokenStream): AirLiteral {
  if (s.is('number')) return parseFloat(s.advance().value);
  if (s.is('string')) return s.advance().value; // includes hex colors
  if (s.is('boolean')) return s.advance().value === 'true';
  // Identifier, possibly compound: mono+sans, display+sans
  if (s.is('identifier') || s.is('type_keyword')) {
    let val = s.advance().value;
    while (s.is('operator', '+')) {
      s.advance();
      if (s.is('identifier') || s.is('type_keyword')) {
        val += '+' + s.advance().value;
      }
    }
    return val;
  }
  throw s.error(`Expected style value, got ${s.current().kind} '${s.current().value}'`);
}

// ---- @ui parser ----
// Recursive descent with operator precedence. Supports 500+ nesting levels.

export function parseUI(s: TokenStream): AirUIBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const children = parseUIExpressionList(s, 'close_paren', 0);
  s.expect('close_paren');
  return { kind: 'ui', children };
}

function parseUIExpressionList(s: TokenStream, terminator: TokenKind, depth: number): AirUINode[] {
  if (depth > MAX_DEPTH) throw s.error(`Max nesting depth (${MAX_DEPTH}) exceeded`);
  const nodes: AirUINode[] = [];
  skipSeparators(s);
  while (!s.is(terminator) && !s.isEof()) {
    const node = parseUICompose(s, depth);
    nodes.push(node);
    skipSeparators(s);
  }
  return nodes;
}

/** Skip newlines and commas — both act as expression separators in UI blocks */
function skipSeparators(s: TokenStream) {
  while (s.is('newline') || s.is('comma')) s.advance();
}

/**
 * Operator precedence (lowest to highest binding):
 * 1. newline — splits siblings (handled by parseUIExpressionList)
 * 2. + (compose)
 * 3. > (flow)
 * 4. | (pipe)
 * 5. : (bind)
 * 6. prefix: * ! # ~ ^ ? $
 * 7. atom: identifier, string, number, @page/@section, paren group
 */

function parseUICompose(s: TokenStream, depth: number): AirUINode {
  let left = parseUIFlow(s, depth);
  while (s.is('operator', '+')) {
    s.advance();
    const right = parseUIFlow(s, depth);
    left = { kind: 'binary', operator: '+', left, right };
  }
  return left;
}

function parseUIFlow(s: TokenStream, depth: number): AirUINode {
  let left = parseUIPipe(s, depth);
  while (s.is('operator', '>')) {
    s.advance();
    const right = parseUIPipe(s, depth);
    left = { kind: 'binary', operator: '>', left, right };
  }
  return left;
}

function parseUIPipe(s: TokenStream, depth: number): AirUINode {
  let left = parseUIBind(s, depth);
  while (s.is('operator', '|')) {
    s.advance();
    const right = parseUIBind(s, depth);
    left = { kind: 'binary', operator: '|', left, right };
  }
  return left;
}

function parseUIBind(s: TokenStream, depth: number): AirUINode {
  let left = parseUIPrefix(s, depth);
  while (s.is('colon')) {
    s.advance();
    const right = parseUIPrefix(s, depth);
    left = { kind: 'binary', operator: ':', left, right };
  }
  // After bind chain, check for (...) children — handles grid:3(...), plan("Free",0,[...])
  if (s.is('open_paren')) {
    s.advance();
    skipSeparators(s);
    const children = parseUIExpressionList(s, 'close_paren', depth + 1);
    s.expect('close_paren');
    if (children.length > 0) {
      // Extract element name from the bind chain for a cleaner AST
      const elemName = extractElementName(left);
      if (elemName && left.kind === 'element') {
        left = { ...left, children };
      } else {
        left = { kind: 'element', element: elemName || '_expr', children: [left, ...children] };
      }
    }
  }
  return left;
}

/** Extract the leftmost element name from a node tree */
function extractElementName(node: AirUINode): string | undefined {
  if (node.kind === 'element') return node.element;
  if (node.kind === 'binary' && node.operator === ':') return extractElementName(node.left);
  return undefined;
}

function parseUIPrefix(s: TokenStream, depth: number): AirUINode {
  // Prefix operators: * ! ~ ^ ?
  if (s.is('operator', '*') || s.is('operator', '!') || s.is('operator', '~') ||
      s.is('operator', '^') || s.is('operator', '?')) {
    const op = s.advance().value;
    const operand = parseUIAtom(s, depth);
    return { kind: 'unary', operator: op, operand };
  }
  // # ref prefix
  if (s.is('hash')) {
    s.advance();
    const operand = parseUIAtom(s, depth);
    return { kind: 'unary', operator: '#', operand };
  }
  // $ prefix (currency/value)
  if (s.is('operator', '$')) {
    s.advance();
    const operand = parseUIPrefix(s, depth);
    return { kind: 'unary', operator: '$', operand };
  }
  return parseUIAtom(s, depth);
}

function parseUIAtom(s: TokenStream, depth: number): AirUINode {
  // String literal
  if (s.is('string')) {
    return { kind: 'text', text: s.advance().value };
  }

  // Number literal
  if (s.is('number')) {
    const val = s.advance().value;
    return { kind: 'value', value: parseFloat(val) };
  }

  // Boolean literal
  if (s.is('boolean')) {
    return { kind: 'value', value: s.advance().value === 'true' };
  }

  // Inline object literal: {key:val, ...} — consume balanced braces as raw text
  if (s.is('open_brace')) {
    let depth2 = 0;
    let raw = '';
    while (!s.isEof()) {
      if (s.is('open_brace')) depth2++;
      if (s.is('close_brace')) {
        depth2--;
        if (depth2 === 0) {
          s.advance(); // consume final }
          break;
        }
      }
      raw += s.advance().value;
    }
    return { kind: 'text', text: '{' + raw + '}' };
  }

  // Bracket array literal: [...] — consume balanced brackets as raw text
  if (s.is('open_bracket')) {
    let depth2 = 0;
    let raw = '';
    while (!s.isEof()) {
      if (s.is('open_bracket')) depth2++;
      if (s.is('close_bracket')) {
        depth2--;
        if (depth2 === 0) {
          s.advance();
          break;
        }
      }
      raw += s.advance().value;
    }
    return { kind: 'text', text: '[' + raw + ']' };
  }

  // Scoped: @page:name(...) or @section:name(...)
  if (s.is('at_keyword')) {
    const kw = s.current().value;
    if (kw === '@page' || kw === '@section') {
      s.advance();
      s.expect('colon');
      const name = s.advance().value; // identifier or type_keyword
      s.expect('open_paren');
      s.skipNewlines();
      const children = parseUIExpressionList(s, 'close_paren', depth + 1);
      s.expect('close_paren');
      return { kind: 'scoped', scope: kw.slice(1) as 'page' | 'section', name, children };
    }
    // Other @keywords inside UI — treat as element
    return { kind: 'element', element: s.advance().value };
  }

  // Identifier (element) or type_keyword used as element name
  if (s.is('identifier') || s.is('type_keyword')) {
    const element = s.advance().value;
    // Dot-chained: items.length, filter.set, etc.
    let fullName = element;
    while (s.is('operator', '.')) {
      s.advance();
      if (s.is('identifier') || s.is('type_keyword') || s.is('number')) {
        fullName += '.' + s.advance().value;
      } else {
        break;
      }
    }
    // Parenthesized children: element(...)
    let children: AirUINode[] | undefined;
    if (s.is('open_paren')) {
      s.advance();
      s.skipNewlines();
      children = parseUIExpressionList(s, 'close_paren', depth + 1);
      s.expect('close_paren');
    }
    return { kind: 'element', element: fullName, children: children && children.length > 0 ? children : undefined };
  }

  // / path-like value (e.g. /signup, /assets/hero.png)
  if (s.is('operator', '/')) {
    let path = '';
    while (s.is('operator', '/') || s.is('identifier') || s.is('type_keyword') || s.is('operator', '.') || s.is('operator', '-')) {
      path += s.advance().value;
    }
    return { kind: 'text', text: path };
  }

  // Operator used as element in some contexts (e.g. - in expressions)
  if (s.is('operator')) {
    const val = s.advance().value;
    return { kind: 'value', value: val };
  }

  throw s.error(`Unexpected token in @ui: ${s.current().kind} '${s.current().value}'`);
}

// ---- @api parser ----

export function parseAPI(s: TokenStream): AirAPIBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const routes: AirRoute[] = [];
  while (!s.is('close_paren') && !s.isEof()) {
    routes.push(parseAPIRoute(s));
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'api', routes };
}

function parseAPIRoute(s: TokenStream): AirRoute {
  const method = s.expect('identifier').value as AirRoute['method'];
  s.expect('colon');
  const path = readPath(s);
  let params: AirField[] | undefined;
  if (s.is('open_paren')) {
    s.advance();
    params = parseAPIParams(s);
    s.expect('close_paren');
  }
  s.expect('operator', '>');
  const handler = readExpressionUntilNewline(s);
  return { method, path, params: params && params.length > 0 ? params : undefined, handler };
}

function parseAPIParams(s: TokenStream): AirField[] {
  const params: AirField[] = [];
  while (!s.is('close_paren') && !s.isEof()) {
    let name: string;
    if (s.is('operator', '?')) {
      s.advance();
      name = '?' + s.advance().value;
    } else {
      name = s.advance().value;
    }
    let type: AirType = { kind: 'str' };
    if (s.is('colon')) {
      s.advance();
      type = parseType(s);
    }
    params.push({ name, type });
    if (!s.match('comma')) break;
  }
  return params;
}

function readPath(s: TokenStream): string {
  let path = '';
  if (s.is('operator', '/')) {
    path += s.advance().value;
  }
  while (!s.isEof()) {
    if (s.is('identifier') || s.is('type_keyword')) {
      path += s.advance().value;
    } else if (s.is('colon')) {
      // Path param :id — but only if followed by identifier
      if (s.peek(1).kind === 'identifier' || s.peek(1).kind === 'type_keyword') {
        // Check if this is a path param vs block syntax
        const nextVal = s.peek(1).value;
        // If after :identifier we see ( or > or newline, it's a path param
        s.advance(); // consume :
        path += ':' + s.advance().value;
      } else {
        break;
      }
    } else if (s.is('operator', '/')) {
      path += s.advance().value;
    } else if (s.is('operator', '.')) {
      path += s.advance().value;
    } else if (s.is('operator', '-')) {
      path += s.advance().value;
    } else {
      break;
    }
  }
  return path || '/';
}

function readExpressionUntilNewline(s: TokenStream): string {
  let expr = '';
  let parenDepth = 0;
  while (!s.isEof()) {
    // Stop at newline when not inside parens
    if (s.is('newline') && parenDepth === 0) break;
    // Stop at close_paren that would close our parent
    if (s.is('close_paren') && parenDepth === 0) break;

    const t = s.advance();
    if (t.kind === 'open_paren') {
      parenDepth++;
      expr += '(';
    } else if (t.kind === 'close_paren') {
      parenDepth--;
      expr += ')';
    } else if (t.kind === 'string') {
      expr += '"' + t.value + '"';
    } else {
      expr += t.value;
    }
  }
  return expr.trim();
}

// ---- @auth parser ----

export function parseAuth(s: TokenStream): AirAuthBlock {
  s.expect('open_paren');
  s.skipNewlines();
  let required = false;
  let role: string | { kind: 'enum'; values: string[] } | undefined;
  let redirect: string | undefined;

  while (!s.is('close_paren') && !s.isEof()) {
    if (s.is('identifier', 'required')) {
      s.advance();
      required = true;
    } else if (s.is('identifier', 'role')) {
      s.advance();
      s.expect('colon');
      // role:admin (string) or role:enum(admin,user)
      if (s.is('type_keyword', 'enum')) {
        s.advance();
        s.expect('open_paren');
        const values: string[] = [];
        while (!s.is('close_paren') && !s.isEof()) {
          values.push(s.advance().value);
          if (!s.match('comma')) break;
        }
        s.expect('close_paren');
        role = { kind: 'enum', values };
      } else {
        // Single role string: role:admin
        role = s.advance().value;
      }
    } else if (s.is('identifier', 'redirect')) {
      s.advance();
      s.expect('colon');
      redirect = readPath(s);
    } else {
      s.advance(); // skip unknown tokens permissively
    }
    s.skipNewlines();
    s.match('comma');
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'auth', required, role, redirect };
}

// ---- @nav parser ----
// Supports both shorthand path lists (landing.air: /#hero,/#features)
// and conditional mappings (auth.air: />?user>dashboard:login)

export function parseNav(s: TokenStream): AirNavBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const routes: AirNavRoute[] = [];
  while (!s.is('close_paren') && !s.isEof()) {
    routes.push(parseNavRoute(s));
    s.skipNewlines();
    s.match('comma');
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'nav', routes };
}

function parseNavRoute(s: TokenStream): AirNavRoute {
  let path = '';

  // Read the path: /, /dashboard, /#hero
  if (s.is('operator', '/')) {
    s.advance();
    path = '/';
    while (s.is('identifier') || s.is('type_keyword') || s.is('hash') ||
           s.is('operator', '/') || s.is('operator', '-')) {
      if (s.is('hash')) {
        path += '#';
        s.advance();
      } else if (s.is('operator', '/')) {
        path += '/';
        s.advance();
      } else {
        path += s.advance().value;
      }
    }
  }

  // Simple path with no mapping (e.g. /#hero) — used in landing.air shorthand
  if (!s.is('operator', '>')) {
    return { path, target: path };
  }

  // Conditional mapping: >?condition>target:fallback  OR  >target
  s.advance(); // consume >

  let condition: string | undefined;
  let target = '';
  let fallback: string | undefined;

  // Check for ?condition
  if (s.is('operator', '?')) {
    s.advance();
    if (s.is('identifier') || s.is('type_keyword')) {
      condition = s.advance().value;
    }
    s.expect('operator', '>');
  }

  // Read target — can be: identifier, @keyword, @keyword:/path
  if (s.is('at_keyword')) {
    target = s.advance().value;
    if (s.is('colon')) {
      s.advance();
      if (s.is('operator', '/')) {
        target += ':' + readPath(s);
      } else if (s.is('identifier') || s.is('type_keyword')) {
        target += ':' + s.advance().value;
      }
    }
  } else if (s.is('identifier') || s.is('type_keyword')) {
    target = s.advance().value;
  } else if (s.is('operator', '/')) {
    target = readPath(s);
  }

  // Fallback after :
  if (s.is('colon')) {
    s.advance();
    if (s.is('identifier') || s.is('type_keyword')) {
      fallback = s.advance().value;
    } else if (s.is('operator', '/')) {
      fallback = readPath(s);
    }
  }

  return { path, condition, target, fallback };
}

// ---- @persist parser ----
// Supports positional flags like httpOnly, 7d alongside named keys

export function parsePersist(s: TokenStream, method: string): AirPersistBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const allArgs: string[] = [];

  while (!s.is('close_paren') && !s.isEof()) {
    if (s.is('identifier') || s.is('type_keyword')) {
      let arg = s.advance().value;
      // Dotted keys: user.token
      while (s.is('operator', '.')) {
        s.advance();
        if (s.is('identifier') || s.is('type_keyword')) {
          arg += '.' + s.advance().value;
        }
      }
      allArgs.push(arg);
    } else if (s.is('number')) {
      // Bare number — likely part of something like "7d" already lexed as identifier
      allArgs.push(s.advance().value);
    } else {
      s.advance(); // skip unknown
    }
    s.skipNewlines();
    s.match('comma');
    s.skipNewlines();
  }
  s.expect('close_paren');

  // Separate keys from flag-style options
  const knownFlags = new Set(['httpOnly', 'secure', 'sameSite', 'strict', 'lax', 'none']);
  const durationPattern = /^\d+[dhms]$/;
  const keys: string[] = [];
  const options: Record<string, AirLiteral> = {};

  for (const arg of allArgs) {
    if (knownFlags.has(arg)) {
      options[arg] = true;
    } else if (durationPattern.test(arg)) {
      options[arg] = true;
    } else {
      keys.push(arg);
    }
  }

  return {
    kind: 'persist',
    method: method as 'localStorage' | 'cookie' | 'session',
    keys,
    options: Object.keys(options).length > 0 ? options : undefined,
  };
}

// ---- @hook parser ----

export function parseHook(s: TokenStream): AirHookBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const hooks: AirHook[] = [];

  while (!s.is('close_paren') && !s.isEof()) {
    let trigger = '';
    if (s.is('identifier') || s.is('type_keyword')) {
      trigger = s.advance().value;
      // onChange:field
      if (s.is('colon')) {
        s.advance();
        if (s.is('identifier') || s.is('type_keyword')) {
          trigger += ':' + s.advance().value;
        }
      }
    }
    s.expect('operator', '>');
    const actions: string[] = [];
    actions.push(readSingleAction(s));
    while (s.is('operator', '+')) {
      s.advance();
      actions.push(readSingleAction(s));
    }
    hooks.push({ trigger, actions });
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'hook', hooks };
}

function readSingleAction(s: TokenStream): string {
  let action = '';
  // Prefix: ~ ! #
  if (s.is('operator', '~') || s.is('operator', '!') || s.is('hash')) {
    action += s.advance().value;
  }
  // Dotted identifier: api.stats, db.users.create
  if (s.is('identifier') || s.is('type_keyword')) {
    action += s.advance().value;
    while (s.is('operator', '.')) {
      action += s.advance().value;
      if (s.is('identifier') || s.is('type_keyword')) {
        action += s.advance().value;
      }
    }
  }
  return action;
}

// ---- @db parser ----

export function parseDb(s: TokenStream): AirDbBlock {
  s.expect('open_brace');
  s.skipNewlines();
  const models: AirDbModel[] = [];
  const relations: AirDbRelation[] = [];
  const indexes: AirDbIndex[] = [];

  while (!s.is('close_brace') && !s.isEof()) {
    // @index and @relation are NOT top-level blocks — they're inside @db
    if (s.is('at_keyword', '@index')) {
      s.advance();
      s.expect('open_paren');
      while (!s.is('close_paren') && !s.isEof()) {
        const idxFields: string[] = [];
        let unique = false;
        let field = readDottedName(s);
        // :unique suffix
        if (s.is('colon')) {
          s.advance();
          if (s.is('identifier', 'unique')) {
            s.advance();
            unique = true;
          }
        }
        idxFields.push(field);
        // Composite: field+field
        while (s.is('operator', '+')) {
          s.advance();
          idxFields.push(readDottedName(s));
        }
        indexes.push({ fields: idxFields, unique });
        if (!s.match('comma')) break;
      }
      s.expect('close_paren');
    } else if (s.is('at_keyword', '@relation')) {
      s.advance();
      s.expect('open_paren');
      while (!s.is('close_paren') && !s.isEof()) {
        const from = readDottedName(s);
        s.expect('operator', '<');
        s.expect('operator', '>');
        const to = readDottedName(s);
        // Optional referential action: :cascade, :set-null, :restrict
        let onDelete: 'cascade' | 'setNull' | 'restrict' | undefined;
        if (s.is('colon')) {
          const save = s.save();
          s.advance(); // consume :
          if (s.is('identifier', 'cascade')) {
            s.advance();
            onDelete = 'cascade';
          } else if (s.is('identifier', 'set-null')) {
            // Hyphenated identifier: lexer reads set-null as single token
            s.advance();
            onDelete = 'setNull';
          } else if (s.is('identifier', 'restrict')) {
            s.advance();
            onDelete = 'restrict';
          } else {
            s.restore(save);
          }
        }
        const rel: AirDbRelation = { from, to };
        if (onDelete) rel.onDelete = onDelete;
        relations.push(rel);
        if (!s.match('comma')) break;
      }
      s.expect('close_paren');
    } else if (s.is('identifier')) {
      // Model: Name{field:type:modifier,...}
      const name = s.advance().value;
      s.expect('open_brace');
      const fields = parseDbFieldList(s, 'close_brace');
      s.expect('close_brace');
      models.push({ name, fields });
    } else {
      s.advance();
    }
    s.skipNewlines();
  }
  s.expect('close_brace');
  return { kind: 'db', models, relations, indexes };
}

function readDottedName(s: TokenStream): string {
  let name = s.advance().value;
  while (s.is('operator', '.')) {
    s.advance();
    if (s.is('identifier') || s.is('type_keyword') || s.is('number')) {
      name += '.' + s.advance().value;
    }
  }
  return name;
}

// ---- @cron parser ----

export function parseCron(s: TokenStream): AirCronBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const jobs: { name: string; schedule: string; handler: string }[] = [];

  while (!s.is('close_paren') && !s.isEof()) {
    const name = s.expect('identifier').value;
    s.expect('operator', '>');
    const schedule = s.expect('string').value;
    s.expect('operator', '>');
    const handler = readSingleAction(s);
    jobs.push({ name, schedule, handler });
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'cron', jobs };
}

// ---- @webhook parser ----

export function parseWebhook(s: TokenStream): AirWebhookBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const routes: AirWebhookRoute[] = [];

  while (!s.is('close_paren') && !s.isEof()) {
    const method = s.expect('identifier').value as 'POST' | 'PUT';
    s.expect('colon');
    const path = readPath(s);
    s.expect('operator', '>');
    const handler = readSingleAction(s);
    routes.push({ method, path, handler });
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'webhook', routes };
}

// ---- @queue parser ----

export function parseQueue(s: TokenStream): AirQueueBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const jobs: AirQueueJob[] = [];

  while (!s.is('close_paren') && !s.isEof()) {
    const name = s.expect('identifier').value;
    let params: AirField[] | undefined;
    if (s.is('open_paren')) {
      s.advance();
      params = parseFieldList(s, 'close_paren');
      s.expect('close_paren');
    }
    s.expect('operator', '>');
    const handler = readSingleAction(s);
    jobs.push({ name, params: params && params.length > 0 ? params : undefined, handler });
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'queue', jobs };
}

// ---- @email parser ----

export function parseEmail(s: TokenStream): AirEmailBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const templates: AirEmailTemplate[] = [];

  while (!s.is('close_paren') && !s.isEof()) {
    const name = s.expect('identifier').value;
    let params: AirField[] | undefined;
    if (s.is('open_paren')) {
      s.advance();
      params = parseFieldList(s, 'close_paren');
      s.expect('close_paren');
    }
    s.expect('operator', '>');
    const subject = s.expect('string').value;
    templates.push({ name, params: params && params.length > 0 ? params : undefined, subject });
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'email', templates };
}

// ---- @env parser ----

export function parseEnv(s: TokenStream): AirEnvBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const vars: AirEnvVar[] = [];

  while (!s.is('close_paren') && !s.isEof()) {
    const name = s.expect('identifier').value;
    s.expect('colon');
    const type = s.advance().value as AirEnvVar['type'];
    s.expect('colon');
    let required = false;
    let def: AirLiteral | undefined;
    if (s.is('identifier', 'required')) {
      s.advance();
      required = true;
    } else if (s.is('string')) {
      def = s.advance().value;
    } else if (s.is('number')) {
      def = parseFloat(s.advance().value);
    } else if (s.is('boolean')) {
      def = s.advance().value === 'true';
    }
    vars.push({ name, type, required, default: def });
    s.skipNewlines();
    s.match('comma');
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'env', vars };
}

// ---- @handler parser ----

export function parseHandler(s: TokenStream): AirHandlerBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const contracts: AirHandlerContract[] = [];
  const seen = new Set<string>();

  while (!s.is('close_paren') && !s.isEof()) {
    const name = s.expect('identifier').value;
    if (seen.has(name)) {
      throw s.error(`Duplicate handler contract: '${name}'`);
    }
    seen.add(name);
    let params: AirField[] = [];
    if (s.is('open_paren')) {
      s.advance();
      params = parseFieldList(s, 'close_paren');
      s.expect('close_paren');
    }
    // Optional executable target: > ~db.Model.operation or > someAction
    let target: string | undefined;
    if (s.is('operator', '>')) {
      s.advance();
      target = readSingleAction(s);
    }
    const contract: AirHandlerContract = { name, params };
    if (target) contract.target = target;
    contracts.push(contract);
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'handler', contracts };
}

// ---- @deploy parser ----

export function parseDeploy(s: TokenStream): AirDeployBlock {
  s.expect('open_paren');
  s.skipNewlines();
  const properties: Record<string, AirLiteral> = {};

  while (!s.is('close_paren') && !s.isEof()) {
    const key = s.expect('identifier').value;
    s.expect('colon');
    if (s.is('number')) {
      properties[key] = parseFloat(s.advance().value);
    } else if (s.is('boolean')) {
      properties[key] = s.advance().value === 'true';
    } else if (s.is('string')) {
      properties[key] = s.advance().value;
    } else if (s.is('operator', '/')) {
      properties[key] = readPath(s);
    } else if (s.is('identifier') || s.is('type_keyword')) {
      properties[key] = s.advance().value;
    }
    s.skipNewlines();
    s.match('comma');
    s.skipNewlines();
  }
  s.expect('close_paren');
  return { kind: 'deploy', properties };
}
