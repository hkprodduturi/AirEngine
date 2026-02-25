/**
 * AirEngine — AI-native Intermediate Representation Engine
 *
 * Parses .air files, validates against schema, and transpiles
 * to working React applications.
 */

export { parse } from './parser/index.js';
export { validate, diagnose } from './validator/index.js';
export { transpile } from './transpiler/index.js';
export { AirParseError, AirLexError } from './parser/errors.js';
export type { Diagnostic, DiagnosticResult } from './diagnostics.js';
export { buildResult, hashSource, wrapParseError, sortDiagnostics, formatDiagnosticCLI, SCHEMA_VERSION } from './diagnostics.js';
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
