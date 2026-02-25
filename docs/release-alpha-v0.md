# AirEngine v0.2.0-alpha Release Notes

## Overview

First alpha release of AirEngine — an AI-native intermediate representation engine that compiles `.air` files into full-stack React + Express applications.

## What's New

### Core Compiler

- **Parser**: 15 block types, full lexer with operator overloading, hex color support
- **Validator**: AST validation with structured diagnostics (AIR-E001 through AIR-E005+)
- **Transpiler**: Full-stack code generation — React + Tailwind client, Express + Prisma server
  - JWT authentication, request validation, rate limiting
  - Prisma schema generation with relations, cascading deletes, many-to-many
  - Seed generation with FK-safe topological ordering
  - Lazy-loaded pages, reusable components, resource hooks
  - Incremental builds with SHA-256 content hashing
- **Repair engine**: Deterministic single-pass repair for common AIR errors
  - Claude-backed repair adapter for complex issues (A3e)

### CLI

- `air transpile` — Compile .air to React + Express
- `air validate` — Check .air correctness
- `air init` — Interactive project scaffolding
- `air dev` — Watch mode with Vite HMR + server restart
- `air loop` — Full pipeline: validate, repair, transpile, smoke, determinism
- `air doctor` — Environment readiness checks

### MCP Server

- 7 tools for Claude Desktop / Claude Code integration
- Session-level AST caching with 5-min TTL
- Diff-first transpile for cached sources
- `air_loop` tool for full pipeline execution via MCP

### AI-First Pipeline

- **Generator adapters**: Replay (fixture-backed), Claude (LLM-backed via Messages API)
- **Prompt-to-app**: Natural language to running application
- **Online eval harness**: Benchmark corpus with success rate metrics
- **Quality gates**: Offline/online/nightly CI modes
- **Canonical demo**: Single-command live demo pipeline

### Quality Infrastructure

- 869+ tests across 16 test files
- Golden output snapshots with hash verification
- Conformance suite: parser, React, Express, Prisma targets
- Performance benchmarks: 200ms ceiling per example
- Foundation gate: tsc + vitest + eval-local + schema sanity
- Doctor checks: runtime, repo files, env vars, writable directories

## Example

```air
@app:todo
  @state{items:[{id:int,text:str,done:bool}]}
  @style(theme:light,accent:#6366f1)
  @ui(
    input:text>#text+btn:!add
    list>items>*item(check:#item.done+text:#item.text+btn:!del(#item.id))
  )
  @persist:localStorage(items)
```

```bash
npx tsx src/cli/index.js transpile todo.air -o ./todo-app
cd todo-app && npm install && npm run dev
```

## Requirements

- Node.js >= 18
- npm
- (Optional) ANTHROPIC_API_KEY for Claude-backed features

## Getting Started

See [docs/quickstart-ai-first.md](quickstart-ai-first.md).

## Known Limitations

- Only React framework target supported
- Claude adapter requires Anthropic API key (offline fallback available)
- Parser error messages may be cryptic for deeply nested syntax
- No built-in deployment beyond generated Dockerfile/docker-compose

## Links

- Repository: https://github.com/hkprodduturi/AirEngine
- Issues: https://github.com/hkprodduturi/AirEngine/issues
- MCP setup: [docs/mcp-quickstart.md](mcp-quickstart.md)
- Troubleshooting: [docs/troubleshooting-ai-first.md](troubleshooting-ai-first.md)
