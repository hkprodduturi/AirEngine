/**
 * AIR Parser
 *
 * Parses .air source text into an AirAST.
 * The parser is intentionally simple — AIR's grammar is designed
 * to be unambiguous and easy to parse without complex tooling.
 */

import type { AirAST } from './types.js';

export function parse(source: string): AirAST {
  const lines = source
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.length > 0 && !l.trimStart().startsWith('#'));

  const ast: AirAST = {
    version: '0.1',
    app: {
      name: '',
      blocks: [],
    },
  };

  // Parse @app declaration
  const appLine = lines.find(l => l.trimStart().startsWith('@app:'));
  if (!appLine) {
    throw new AirParseError('Missing @app declaration', 1);
  }
  ast.app.name = appLine.trimStart().slice(5);

  // TODO: Parse remaining blocks
  // Phase 1 implementation will expand this

  return ast;
}

export class AirParseError extends Error {
  line: number;

  constructor(message: string, line: number) {
    super(`[AIR Parse Error] Line ${line}: ${message}`);
    this.name = 'AirParseError';
    this.line = line;
  }
}
