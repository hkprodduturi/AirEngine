/**
 * AIR Abstract Syntax Tree type definitions
 */

// ---- Primitive Types ----

export type AirLiteral = string | number | boolean;

export type AirType =
  | { kind: 'str'; default?: AirLiteral }
  | { kind: 'int'; default?: AirLiteral }
  | { kind: 'float'; default?: AirLiteral }
  | { kind: 'bool'; default?: AirLiteral }
  | { kind: 'date'; default?: AirLiteral }
  | { kind: 'datetime'; default?: AirLiteral }
  | { kind: 'enum'; values: string[]; default?: AirLiteral }
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

// ---- UI Node Types (discriminated union for tree representation) ----

export type AirUINode =
  | AirUIElementNode
  | AirUIScopedNode
  | AirUITextNode
  | AirUIValueNode
  | AirUIUnaryNode
  | AirUIBinaryNode;

export interface AirUIElementNode {
  kind: 'element';
  element: string;
  modifier?: string;
  children?: AirUINode[];
  args?: AirUINode[];
}

export interface AirUIScopedNode {
  kind: 'scoped';
  scope: 'page' | 'section';
  name: string;
  children: AirUINode[];
}

export interface AirUITextNode {
  kind: 'text';
  text: string;
}

export interface AirUIValueNode {
  kind: 'value';
  value: string | number | boolean;
}

export interface AirUIUnaryNode {
  kind: 'unary';
  operator: string;
  operand: AirUINode;
}

export interface AirUIBinaryNode {
  kind: 'binary';
  operator: string;
  left: AirUINode;
  right: AirUINode;
}

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
  | AirHookBlock
  | AirDbBlock
  | AirCronBlock
  | AirWebhookBlock
  | AirQueueBlock
  | AirEmailBlock
  | AirEnvBlock
  | AirDeployBlock
  | AirHandlerBlock;

export interface AirStateBlock {
  kind: 'state';
  fields: AirField[];
}

export interface AirStyleBlock {
  kind: 'style';
  properties: Record<string, AirLiteral>;
}

export interface AirUIBlock {
  kind: 'ui';
  children: AirUINode[];
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
  role?: string | { kind: 'enum'; values: string[] };
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
  options?: Record<string, AirLiteral>;
}

export interface AirHookBlock {
  kind: 'hook';
  hooks: AirHook[];
}

export interface AirHook {
  trigger: string;
  actions: string[];
}

// ---- Full-Stack Block Types ----

export interface AirDbField extends AirField {
  primary?: boolean;
  required?: boolean;
  auto?: boolean;
  default?: AirLiteral;
}

export interface AirDbModel {
  name: string;
  fields: AirDbField[];
}

export interface AirDbRelation {
  from: string;
  to: string;
  onDelete?: 'cascade' | 'setNull' | 'restrict';
}

export interface AirDbIndex {
  fields: string[];
  unique: boolean;
}

export interface AirDbBlock {
  kind: 'db';
  models: AirDbModel[];
  relations: AirDbRelation[];
  indexes: AirDbIndex[];
}

export interface AirCronJob {
  name: string;
  schedule: string;
  handler: string;
}

export interface AirCronBlock {
  kind: 'cron';
  jobs: AirCronJob[];
}

export interface AirWebhookRoute {
  method: 'POST' | 'PUT';
  path: string;
  handler: string;
}

export interface AirWebhookBlock {
  kind: 'webhook';
  routes: AirWebhookRoute[];
}

export interface AirQueueJob {
  name: string;
  params?: AirField[];
  handler: string;
}

export interface AirQueueBlock {
  kind: 'queue';
  jobs: AirQueueJob[];
}

export interface AirEmailTemplate {
  name: string;
  params?: AirField[];
  subject: string;
}

export interface AirEmailBlock {
  kind: 'email';
  templates: AirEmailTemplate[];
}

export interface AirEnvVar {
  name: string;
  type: 'str' | 'int' | 'float' | 'bool';
  required: boolean;
  default?: AirLiteral;
}

export interface AirEnvBlock {
  kind: 'env';
  vars: AirEnvVar[];
}

export interface AirDeployBlock {
  kind: 'deploy';
  properties: Record<string, AirLiteral>;
}

export interface AirHandlerContract {
  name: string;
  params: AirField[];
  /** Executable target — e.g. ~db.Order.create, ~db.Claim.update. Omitted for scaffold-only contracts. */
  target?: string;
}

export interface AirHandlerBlock {
  kind: 'handler';
  contracts: AirHandlerContract[];
}

// ---- Top-level AST ----

export interface AirAST {
  version: string;
  app: AirApp;
}
