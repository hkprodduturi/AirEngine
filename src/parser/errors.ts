/**
 * AIR Parser Error Types
 *
 * Structured errors with exact line/col info for user-facing diagnostics.
 */

export interface AirSourcePosition {
  line: number;
  col: number;
}

export interface AirErrorContext {
  line: number;
  col: number;
  sourceLine?: string;
  token?: string;
}

export class AirParseError extends Error {
  readonly line: number;
  readonly col: number;
  readonly sourceLine?: string;
  readonly token?: string;

  constructor(message: string, ctx: AirErrorContext) {
    const loc = `${ctx.line}:${ctx.col}`;
    const tokenInfo = ctx.token ? ` (token: '${ctx.token}')` : '';
    super(`[AIR Parse Error] Line ${loc}: ${message}${tokenInfo}`);
    this.name = 'AirParseError';
    this.line = ctx.line;
    this.col = ctx.col;
    this.sourceLine = ctx.sourceLine;
    this.token = ctx.token;
  }
}

export class AirLexError extends Error {
  readonly line: number;
  readonly col: number;

  constructor(message: string, line: number, col: number) {
    super(`[AIR Lex Error] Line ${line}:${col}: ${message}`);
    this.name = 'AirLexError';
    this.line = line;
    this.col = col;
  }
}
