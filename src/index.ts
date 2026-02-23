/**
 * AirEngine — AI-native Intermediate Representation Engine
 *
 * Parses .air files, validates against schema, and transpiles
 * to working React applications.
 */

export { parse } from './parser/index.js';
export { validate } from './validator/index.js';
export { transpile } from './transpiler/index.js';
export { AirParseError, AirLexError } from './parser/errors.js';
export type {
  AirAST,
  AirApp,
  AirBlock,
  AirType,
  AirField,
  AirLiteral,
  AirStateBlock,
  AirStyleBlock,
  AirUIBlock,
  AirUINode,
  AirAPIBlock,
  AirAuthBlock,
  AirNavBlock,
  AirPersistBlock,
  AirHookBlock,
  AirDbBlock,
  AirCronBlock,
  AirWebhookBlock,
  AirQueueBlock,
  AirEmailBlock,
  AirEnvBlock,
  AirDeployBlock,
} from './parser/types.js';
