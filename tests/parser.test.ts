import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser/index.js';

describe('AIR Parser', () => {
  it('should parse @app declaration', () => {
    const source = '@app:todo';
    const ast = parse(source);
    expect(ast.app.name).toBe('todo');
  });

  it('should throw on missing @app', () => {
    const source = '@state{items:[str]}';
    expect(() => parse(source)).toThrow('Missing @app declaration');
  });

  it('should ignore comments', () => {
    const source = `# This is a comment
@app:my-app`;
    const ast = parse(source);
    expect(ast.app.name).toBe('my-app');
  });

  it('should ignore empty lines', () => {
    const source = `

@app:test-app

`;
    const ast = parse(source);
    expect(ast.app.name).toBe('test-app');
  });
});
