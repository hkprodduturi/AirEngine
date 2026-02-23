/**
 * AIR Lexer — tokenizes .air source text into a token stream.
 *
 * # is a comment ONLY when it's the first non-whitespace char on a line.
 * Otherwise # is the ref operator (or part of a hex color after : or ,).
 *
 * Permissive: unknown characters emit a 'symbol' token rather than throwing.
 */

import { AirLexError } from './errors.js';

export type TokenKind =
  | 'at_keyword'     // @app, @state, @ui, etc.
  | 'identifier'     // variable names, element names
  | 'type_keyword'   // str, int, float, bool, date, enum
  | 'operator'       // > | + ? * ! ~ ^ . / - $ <
  | 'hash'           // # (ref operator)
  | 'colon'          // :
  | 'comma'          // ,
  | 'open_paren'     // (
  | 'close_paren'    // )
  | 'open_brace'     // {
  | 'close_brace'    // }
  | 'open_bracket'   // [
  | 'close_bracket'  // ]
  | 'string'         // "..."
  | 'number'         // 123, 12.5
  | 'boolean'        // true, false
  | 'newline'        // significant whitespace
  | 'symbol'         // generic fallback for unexpected chars
  | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

const TYPE_KEYWORDS = new Set(['str', 'int', 'float', 'bool', 'date', 'datetime', 'enum']);
const SINGLE_CHAR_TOKENS: Record<string, TokenKind> = {
  '(': 'open_paren',
  ')': 'close_paren',
  '{': 'open_brace',
  '}': 'close_brace',
  '[': 'open_bracket',
  ']': 'close_bracket',
  ',': 'comma',
  ':': 'colon',
};
const OPERATOR_CHARS = new Set(['>', '|', '+', '?', '*', '!', '~', '^', '.', '/', '-', '$', '<']);

export class Lexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];
  /** True when we're at the logical start of a line (only whitespace so far). */
  private lineStart = true;
  /** Nesting depth inside delimiters — # is only a comment at depth 0 */
  private depth = 0;

  constructor(source: string) {
    this.src = source;
  }

  tokenize(): Token[] {
    while (this.pos < this.src.length) {
      this.skipSpaces();
      if (this.pos >= this.src.length) break;

      const ch = this.src[this.pos];

      // Newlines
      if (ch === '\n') {
        if (this.tokens.length > 0 && this.tokens[this.tokens.length - 1].kind !== 'newline') {
          this.push('newline', '\n');
        }
        this.advance();
        this.line++;
        this.col = 1;
        this.lineStart = true;
        continue;
      }

      // Comment: # ONLY when first non-whitespace on the line AND at top level (not inside delimiters)
      if (ch === '#' && this.lineStart && this.depth === 0) {
        this.skipComment();
        continue;
      }

      this.lineStart = false;

      // String literal
      if (ch === '"') {
        this.readString();
        continue;
      }

      // @ keyword
      if (ch === '@') {
        this.readAtKeyword();
        continue;
      }

      // Hash — hex color or ref operator
      if (ch === '#') {
        if (this.isHexColor()) {
          this.readHexColor();
        } else {
          this.push('hash', '#');
          this.advance();
        }
        continue;
      }

      // Number: digit, or negative number (- followed by digit, but only if prev is operator/colon/comma/open)
      if (this.isDigit(ch)) {
        this.readNumber();
        continue;
      }

      // Single-char structural tokens
      if (ch in SINGLE_CHAR_TOKENS) {
        if (ch === '(' || ch === '{' || ch === '[') this.depth++;
        if (ch === ')' || ch === '}' || ch === ']') this.depth = Math.max(0, this.depth - 1);
        this.push(SINGLE_CHAR_TOKENS[ch], ch);
        this.advance();
        continue;
      }

      // Operators (including / | - $ < >)
      if (OPERATOR_CHARS.has(ch)) {
        this.push('operator', ch);
        this.advance();
        continue;
      }

      // Identifier / keyword
      if (this.isIdentStart(ch)) {
        this.readIdentifier();
        continue;
      }

      // Generic fallback — emit as symbol token instead of crashing
      this.push('symbol', ch);
      this.advance();
    }

    // Trim trailing newline
    if (this.tokens.length > 0 && this.tokens[this.tokens.length - 1].kind === 'newline') {
      this.tokens.pop();
    }

    this.tokens.push({ kind: 'eof', value: '', line: this.line, col: this.col });
    return this.tokens;
  }

  // ---- Helpers ----

  private push(kind: TokenKind, value: string) {
    this.tokens.push({ kind, value, line: this.line, col: this.col });
  }

  private advance(): string {
    const ch = this.src[this.pos];
    this.pos++;
    this.col++;
    return ch;
  }

  private skipSpaces() {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
      } else {
        break;
      }
    }
  }

  private skipComment() {
    while (this.pos < this.src.length && this.src[this.pos] !== '\n') {
      this.pos++;
      this.col++;
    }
  }

  private readString() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip opening "
    let value = '';
    while (this.pos < this.src.length && this.src[this.pos] !== '"') {
      if (this.src[this.pos] === '\\' && this.pos + 1 < this.src.length) {
        this.advance(); // skip backslash
        value += this.advance();
      } else {
        value += this.advance();
      }
    }
    if (this.pos >= this.src.length) {
      throw new AirLexError('Unterminated string literal', startLine, startCol);
    }
    this.advance(); // skip closing "
    this.tokens.push({ kind: 'string', value, line: startLine, col: startCol });
  }

  private readAtKeyword() {
    const startCol = this.col;
    this.advance(); // skip @
    let name = '';
    while (this.pos < this.src.length && this.isIdentChar(this.src[this.pos])) {
      name += this.advance();
    }
    this.tokens.push({ kind: 'at_keyword', value: '@' + name, line: this.line, col: startCol });
  }

  private readNumber() {
    const startCol = this.col;
    let num = '';
    while (this.pos < this.src.length && this.isDigit(this.src[this.pos])) {
      num += this.advance();
    }
    // Decimal part
    if (this.pos < this.src.length && this.src[this.pos] === '.' &&
        this.pos + 1 < this.src.length && this.isDigit(this.src[this.pos + 1])) {
      num += this.advance(); // .
      while (this.pos < this.src.length && this.isDigit(this.src[this.pos])) {
        num += this.advance();
      }
    }
    // Check for identifier suffix like "7d", "5_apps" — read as identifier
    if (this.pos < this.src.length && this.isIdentStart(this.src[this.pos])) {
      while (this.pos < this.src.length && this.isIdentChar(this.src[this.pos])) {
        num += this.advance();
      }
      this.tokens.push({ kind: 'identifier', value: num, line: this.line, col: startCol });
    } else {
      this.tokens.push({ kind: 'number', value: num, line: this.line, col: startCol });
    }
  }

  private readIdentifier() {
    const startCol = this.col;
    let id = '';
    while (this.pos < this.src.length && this.isIdentChar(this.src[this.pos])) {
      id += this.advance();
    }
    if (id === 'true' || id === 'false') {
      this.tokens.push({ kind: 'boolean', value: id, line: this.line, col: startCol });
    } else if (TYPE_KEYWORDS.has(id)) {
      this.tokens.push({ kind: 'type_keyword', value: id, line: this.line, col: startCol });
    } else {
      this.tokens.push({ kind: 'identifier', value: id, line: this.line, col: startCol });
    }
  }

  private isHexColor(): boolean {
    let i = this.pos + 1;
    let count = 0;
    while (i < this.src.length && this.isHexDigit(this.src[i])) {
      count++;
      i++;
    }
    if (count !== 3 && count !== 4 && count !== 6 && count !== 8) return false;
    // Must be followed by a non-identifier char (or end)
    if (i < this.src.length && this.isIdentChar(this.src[i])) return false;
    // Hex colors appear after : or ,
    const prev = this.tokens.length > 0 ? this.tokens[this.tokens.length - 1] : null;
    if (prev && (prev.kind === 'colon' || prev.kind === 'comma')) return true;
    return false;
  }

  private readHexColor() {
    const startCol = this.col;
    let hex = '';
    this.advance(); // skip #
    while (this.pos < this.src.length && this.isHexDigit(this.src[this.pos])) {
      hex += this.advance();
    }
    this.tokens.push({ kind: 'string', value: '#' + hex, line: this.line, col: startCol });
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isHexDigit(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch) || ch === '-' || ch === '_';
  }
}

export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}
