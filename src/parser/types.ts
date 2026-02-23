/**
 * AIR Abstract Syntax Tree type definitions
 */

// ---- Primitive Types ----

export type AirType =
  | { kind: 'str' }
  | { kind: 'int' }
  | { kind: 'float'; default?: number }
  | { kind: 'bool' }
  | { kind: 'date' }
  | { kind: 'enum'; values: string[] }
  | { kind: 'array'; of: AirType }
  | { kind: 'object'; fields: AirField[] }
  | { kind: 'optional'; of: AirType }
  | { kind: 'ref'; entity: string };

export interface AirField {
  name: string;
  type: AirType;
}

// ---- Operators ----

export type AirOperator =
  | '>'   // flow
  | '|'   // pipe
  | '+'   // compose
  | ':'   // bind
  | '?'   // condition
  | '*'   // iterate
  | '!'   // mutate
  | '#'   // reference
  | '~'   // async
  | '^';  // emit

// ---- Blocks ----

export interface AirApp {
  name: string;
  blocks: AirBlock[];
}

export type AirBlock =
  | AirStateBlock
  | AirStyleBlock
  | AirUIBlock
  | AirAPIBlock
  | AirAuthBlock
  | AirNavBlock
  | AirPersistBlock
  | AirHookBlock;

export interface AirStateBlock {
  kind: 'state';
  fields: AirField[];
}

export interface AirStyleBlock {
  kind: 'style';
  properties: Record<string, string | number>;
}

export interface AirUIBlock {
  kind: 'ui';
  children: AirUINode[];
}

export interface AirUINode {
  element: string;
  modifier?: string;
  operator?: AirOperator;
  target?: string;
  children?: AirUINode[];
  props?: Record<string, string | number | boolean>;
  text?: string;
}

export interface AirAPIBlock {
  kind: 'api';
  routes: AirRoute[];
}

export interface AirRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'CRUD';
  path: string;
  params?: AirField[];
  handler: string;
}

export interface AirAuthBlock {
  kind: 'auth';
  required: boolean;
  role?: { kind: 'enum'; values: string[] };
  redirect?: string;
}

export interface AirNavBlock {
  kind: 'nav';
  routes: AirNavRoute[];
}

export interface AirNavRoute {
  path: string;
  condition?: string;
  target: string;
  fallback?: string;
}

export interface AirPersistBlock {
  kind: 'persist';
  method: 'localStorage' | 'cookie' | 'session';
  keys: string[];
  options?: Record<string, string | number | boolean>;
}

export interface AirHookBlock {
  kind: 'hook';
  trigger: string;
  actions: string[];
}

// ---- Top-level AST ----

export interface AirAST {
  version: string;
  app: AirApp;
}
