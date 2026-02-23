import { describe, it, expect } from 'vitest';
import { tokenize, type Token } from '../src/parser/lexer.js';

function kinds(tokens: Token[]): string[] {
  return tokens.filter(t => t.kind !== 'eof').map(t => t.kind);
}

function values(tokens: Token[]): string[] {
  return tokens.filter(t => t.kind !== 'eof' && t.kind !== 'newline').map(t => t.value);
}

describe('AIR Lexer', () => {
  describe('basic tokens', () => {
    it('should tokenize @keywords', () => {
      const tokens = tokenize('@app @state @ui @api');
      expect(values(tokens)).toEqual(['@app', '@state', '@ui', '@api']);
      expect(kinds(tokens).filter(k => k === 'at_keyword')).toHaveLength(4);
    });

    it('should tokenize identifiers', () => {
      const tokens = tokenize('foo bar-baz _test');
      expect(values(tokens)).toEqual(['foo', 'bar-baz', '_test']);
    });

    it('should tokenize type keywords', () => {
      const tokens = tokenize('str int float bool date enum');
      expect(kinds(tokens).filter(k => k === 'type_keyword')).toHaveLength(6);
    });

    it('should tokenize string literals', () => {
      const tokens = tokenize('"hello world" "test"');
      const strings = tokens.filter(t => t.kind === 'string');
      expect(strings.map(t => t.value)).toEqual(['hello world', 'test']);
    });

    it('should tokenize numbers', () => {
      const tokens = tokenize('42 3.14 0');
      const nums = tokens.filter(t => t.kind === 'number');
      expect(nums.map(t => t.value)).toEqual(['42', '3.14', '0']);
    });

    it('should tokenize booleans', () => {
      const tokens = tokenize('true false');
      expect(kinds(tokens)).toEqual(['boolean', 'boolean']);
    });

    it('should tokenize number+identifier suffix as identifier', () => {
      const tokens = tokenize('7d 5_apps 30d');
      expect(tokens.filter(t => t.kind === 'identifier').map(t => t.value)).toEqual(['7d', '5_apps', '30d']);
    });
  });

  describe('operators', () => {
    it('should tokenize all operators', () => {
      const tokens = tokenize('> | + ? * ! ~ ^ . / - $ <');
      const ops = tokens.filter(t => t.kind === 'operator');
      expect(ops.map(t => t.value)).toEqual(['>', '|', '+', '?', '*', '!', '~', '^', '.', '/', '-', '$', '<']);
    });

    it('should tokenize hash as hash token', () => {
      const tokens = tokenize('a #b');
      expect(tokens[1].kind).toBe('hash');
    });

    it('should tokenize structural tokens', () => {
      const tokens = tokenize('( ) { } [ ] , :');
      expect(kinds(tokens)).toEqual([
        'open_paren', 'close_paren', 'open_brace', 'close_brace',
        'open_bracket', 'close_bracket', 'comma', 'colon',
      ]);
    });
  });

  describe('comments', () => {
    it('should strip line comments at start of line', () => {
      const tokens = tokenize('# this is a comment\n@app');
      expect(values(tokens)).toEqual(['@app']);
    });

    it('should strip comment after indentation', () => {
      const tokens = tokenize('  # indented comment\n@app');
      expect(values(tokens)).toEqual(['@app']);
    });

    it('should NOT treat mid-expression # as comment', () => {
      const tokens = tokenize('badge:#items');
      expect(tokens.some(t => t.kind === 'hash')).toBe(true);
    });
  });

  describe('hex colors', () => {
    it('should tokenize hex color after colon as string', () => {
      const tokens = tokenize('accent:#6366f1');
      const str = tokens.find(t => t.kind === 'string');
      expect(str?.value).toBe('#6366f1');
    });

    it('should tokenize 3-digit hex color', () => {
      const tokens = tokenize('color:#fff');
      const str = tokens.find(t => t.kind === 'string');
      expect(str?.value).toBe('#fff');
    });

    it('should treat # at start of line outside delimiters as comment', () => {
      const tokens = tokenize('#items');
      // At top level, # at start of line is a comment
      expect(tokens[0].kind).toBe('eof');
    });

    it('should treat # inside delimiters as ref operator', () => {
      const tokens = tokenize('(#items)');
      const hash = tokens.find(t => t.kind === 'hash');
      expect(hash).toBeDefined();
    });
  });

  describe('newlines', () => {
    it('should emit newline tokens', () => {
      const tokens = tokenize('a\nb');
      expect(tokens[1].kind).toBe('newline');
    });

    it('should collapse consecutive newlines', () => {
      const tokens = tokenize('a\n\n\nb');
      const newlines = tokens.filter(t => t.kind === 'newline');
      expect(newlines).toHaveLength(1);
    });

    it('should not end with a newline token', () => {
      const tokens = tokenize('a\n');
      expect(tokens[tokens.length - 1].kind).toBe('eof');
      expect(tokens[tokens.length - 2].kind).not.toBe('newline');
    });
  });

  describe('line/col tracking', () => {
    it('should track line numbers', () => {
      const tokens = tokenize('@app\n@state');
      expect(tokens[0].line).toBe(1);
      expect(tokens[2].line).toBe(2); // after newline
    });

    it('should track column numbers', () => {
      const tokens = tokenize('  @app:todo');
      expect(tokens[0].col).toBe(3); // after 2 spaces
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', () => {
      const tokens = tokenize('');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].kind).toBe('eof');
    });

    it('should handle only comments', () => {
      const tokens = tokenize('# just a comment\n# another');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].kind).toBe('eof');
    });

    it('should emit symbol for unknown characters', () => {
      const tokens = tokenize('a ; b');
      expect(tokens.some(t => t.kind === 'symbol')).toBe(true);
    });

    it('should handle escaped characters in strings', () => {
      const tokens = tokenize('"hello \\"world\\""');
      const str = tokens.find(t => t.kind === 'string');
      expect(str?.value).toBe('hello "world"');
    });
  });
});
