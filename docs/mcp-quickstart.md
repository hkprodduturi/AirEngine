# AirEngine MCP Quickstart

The AirEngine MCP server exposes 7 tools to Claude Desktop and Claude Code:

| Tool | Description |
|------|-------------|
| `air_validate` | Validate AIR source code |
| `air_transpile` | Convert AIR to React + Express apps |
| `air_generate` | Generate .air from natural language |
| `air_explain` | Explain what an AIR file does |
| `air_lint` | Detect common issues |
| `air_capabilities` | Query supported blocks, targets, operators |
| `air_loop` | Full pipeline: validate, repair, transpile, smoke, determinism |

## Setup for Claude Desktop

1. Install dependencies:

```bash
cd AirEngine && npm install
```

2. Add to Claude Desktop config:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "airengine": {
      "command": "npx",
      "args": ["tsx", "/FULL/PATH/TO/AirEngine/src/mcp/server.ts"]
    }
  }
}
```

3. Restart Claude Desktop.

## Setup for Claude Code

Add `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "airengine": {
      "command": "npx",
      "args": ["tsx", "/FULL/PATH/TO/AirEngine/src/mcp/server.ts"]
    }
  }
}
```

Verify with `/mcp` command in Claude Code.

## Example: Full Loop via MCP

Ask Claude:

> "Use air_loop to validate, repair, and transpile this AIR source into a working app:
> @app:notes @state{notes:[{id:int,text:str}]} @ui(list>notes>*n(card(text:#n.text)))"

Claude calls `air_loop` and returns structured results: validation status, repair actions, generated file count, smoke test pass/fail, and determinism check.

## air_loop Options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `source` | (required) | AIR source code |
| `output_dir` | `./output` | Output directory |
| `repair_mode` | `deterministic` | `deterministic`, `claude`, or `none` |
| `max_repair_attempts` | `1` | Retry count (1-5) |
| `repair_model` | (adapter default) | Claude model for repair |
| `write_artifacts` | `false` | Write debug artifacts |

## Troubleshooting

- **Server not detected**: Use absolute path in config
- **"tsx not found"**: Run `npm install` in AirEngine directory
- **Tools not showing**: Restart Claude Desktop (quit + reopen)
- **Test server**: Run `npm run mcp` directly to verify startup
