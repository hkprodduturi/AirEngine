# AirEngine Quickstart (AI-First)

## Prerequisites

- Node.js >= 18
- npm
- (Optional) `ANTHROPIC_API_KEY` for live Claude features

Verify with:

```bash
npm run doctor
```

## 1. Install

```bash
git clone https://github.com/hkprodduturi/AirEngine.git
cd AirEngine
npm install
```

## 2. Offline Demo (no API key needed)

Generate and run a fullstack todo app from a fixture:

```bash
npm run demo-prompt-replay -- --fixture-id fullstack-todo
```

Or transpile an existing `.air` file:

```bash
npx tsx src/cli/index.js transpile examples/todo.air -o ./output
cd output && npm install && npm run dev
```

## 3. Live Demo (requires ANTHROPIC_API_KEY)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run demo-live-canonical
```

This runs the canonical "fullstack todo with auth" prompt through Claude generation, repair, transpile, and smoke testing.

## 4. Write Your Own .air File

```bash
npx tsx src/cli/index.js init --name myapp --fullstack
npx tsx src/cli/index.js transpile myapp.air -o ./myapp
cd myapp && npm install && npm run dev
```

## 5. Watch Mode

```bash
npx tsx src/cli/index.js dev myapp.air -o ./myapp
```

Edit `myapp.air` and the app rebuilds automatically.

## 6. MCP Integration

See [docs/mcp-quickstart.md](mcp-quickstart.md) for Claude Desktop / Claude Code setup.

## Available Commands

| Command | Description |
|---------|-------------|
| `air transpile <file>` | Compile .air to React + Express |
| `air validate <file>` | Check .air for errors |
| `air init` | Create a starter .air file |
| `air dev <file>` | Watch mode with live reload |
| `air loop <file>` | Full pipeline (validate, repair, transpile, smoke) |
| `air doctor` | Check environment readiness |

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run doctor` | Environment readiness check |
| `npm run eval-local` | Offline benchmark suite |
| `npm run foundation-check` | Full foundation gate (tsc + vitest + eval) |
| `npm run quality-gate` | Unified CI gate (offline/online/nightly) |
| `npm run demo-prompt-replay` | Fixture-backed prompt-to-app demo |
| `npm run demo-live-canonical` | Live Claude demo pipeline |
| `npm run demo-canonical` | Canonical offline demo |
| `npm run eval-online` | Online eval harness (requires API key) |

## Troubleshooting

See [docs/troubleshooting-ai-first.md](troubleshooting-ai-first.md).
