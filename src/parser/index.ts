/**
 * AIR Parser
 *
 * Parses .air source text into an AirAST.
 * Architecture: Tokenizer → Token Stream → Recursive Descent → AST
 */

import { AirParseError } from './errors.js';
import { tokenize } from './lexer.js';
import { TokenStream } from './parsers.js';
import {
  parseState,
  parseStyle,
  parseUI,
  parseAPI,
  parseAuth,
  parseNav,
  parsePersist,
  parseHook,
  parseDb,
  parseCron,
  parseWebhook,
  parseQueue,
  parseEmail,
  parseEnv,
  parseDeploy,
  parseHandler,
} from './parsers.js';
import type { AirAST, AirBlock } from './types.js';

const BLOCK_KEYWORDS = new Set([
  '@state', '@style', '@ui', '@api', '@auth', '@nav', '@persist', '@hook',
  '@db', '@cron', '@webhook', '@queue', '@email', '@env', '@deploy', '@handler',
]);

export function parse(source: string): AirAST {
  const tokens = tokenize(source);
  const s = new TokenStream(tokens);

  const ast: AirAST = {
    version: '0.1',
    app: { name: '', blocks: [] },
  };

  s.skipNewlines();

  // Parse @app declaration
  if (!s.is('at_keyword', '@app')) {
    throw new AirParseError('Missing @app declaration', {
      line: s.current().line, col: s.current().col,
    });
  }
  s.advance(); // consume @app
  s.expect('colon');
  ast.app.name = s.expect('identifier').value;
  s.skipNewlines();

  // Parse blocks
  while (!s.isEof()) {
    s.skipNewlines();
    if (s.isEof()) break;

    const t = s.current();
    if (t.kind !== 'at_keyword') {
      throw s.error(`Expected @block keyword, got ${t.kind} '${t.value}'`);
    }

    const kw = t.value;

    if (!BLOCK_KEYWORDS.has(kw)) {
      throw s.error(`Unknown block type: ${kw}`);
    }

    s.advance(); // consume the @keyword

    const block = parseBlock(kw, s);
    ast.app.blocks.push(block);
    s.skipNewlines();
  }

  return ast;
}

function parseBlock(keyword: string, s: TokenStream): AirBlock {
  switch (keyword) {
    case '@state':
      return parseState(s);
    case '@style':
      return parseStyle(s);
    case '@ui':
      return parseUI(s);
    case '@api':
      return parseAPI(s);
    case '@auth':
      return parseAuth(s);
    case '@nav':
      return parseNav(s);
    case '@persist': {
      // @persist:method(keys) — the colon + method come next in the stream
      s.expect('colon');
      const method = s.expect('identifier').value;
      return parsePersist(s, method);
    }
    case '@hook':
      return parseHook(s);
    case '@db':
      return parseDb(s);
    case '@cron':
      return parseCron(s);
    case '@webhook':
      return parseWebhook(s);
    case '@queue':
      return parseQueue(s);
    case '@email':
      return parseEmail(s);
    case '@env':
      return parseEnv(s);
    case '@deploy':
      return parseDeploy(s);
    case '@handler':
      return parseHandler(s);
    default:
      throw s.error(`Unhandled block type: ${keyword}`);
  }
}
