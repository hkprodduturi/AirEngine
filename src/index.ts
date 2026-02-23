/**
 * AirEngine — AI-native Intermediate Representation Engine
 *
 * Parses .air files, validates against schema, and transpiles
 * to working React applications.
 */

export { parse } from './parser/index.js';
export { validate } from './validator/index.js';
export { transpile } from './transpiler/index.js';
export type { AirAST, AirApp, AirState, AirUI, AirBlock } from './parser/types.js';
