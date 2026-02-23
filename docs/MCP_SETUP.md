# AirEngine MCP Server Setup

## What This Does

The AirEngine MCP server gives Claude (Desktop or Code) native AIR language capabilities:

- **`air_generate`** — Generate .air files from natural language
- **`air_validate`** — Validate AIR source code
- **`air_transpile`** — Convert AIR to working React apps
- **`air_explain`** — Explain what an AIR file does
- **`air_lint`** — Detect common issues (unused state, missing routes, ambiguous relations)
- **`air_capabilities`** — Query supported blocks, targets, operators, and version

Plus resources:
- **`air://spec`** — Full AIR language specification
- **`air://examples`** — Example .air files

## Setup for Claude Desktop

1. Clone the repo and install dependencies:
```bash
git clone https://github.com/hkprodduturi/AirEngine.git
cd AirEngine
npm install
```

2. Find your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the AirEngine server:
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

4. Restart Claude Desktop. You should see the 🔨 hammer icon with 6 tools.

5. Try it:
   > "Generate an AIR file for a task management app with projects and deadlines"

## Setup for Claude Code

1. In your project root, add `.mcp.json`:
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

2. Claude Code will auto-detect the MCP server. Verify with `/mcp` command.

3. Try it:
   > "Use air_generate to create an expense tracker, then air_transpile it to React"

## How It Works

```
You: "Build me a todo app"
         │
         ▼
   Claude + AirEngine MCP
         │
    ┌────┴────┐
    ▼         ▼
air_generate  air://spec (reads language spec)
    │
    ▼
  .air file (11 lines)
    │
    ▼
air_validate (checks correctness)
    │
    ▼
air_transpile (generates React)
    │
    ▼
  Working App (~150 lines)
```

Claude uses the embedded AIR spec + examples to generate correct AIR code,
then transpiles it to a working application — all through MCP tools.

## Example Session

```
You: Generate an AIR file for a budget tracker

Claude: [calls air_generate]

@app:budget-tracker
  @state{
    transactions:[{id:int,desc:str,amount:float,type:enum(income,expense),date:date}],
    balance:float(0),
    filter:enum(all,income,expense)
  }
  @style(theme:dark,accent:#10b981,radius:10,font:mono+sans)
  @ui(
    header>"Budget Tracker"+stat:balance:$#balance
    row(input:text>#desc+input:number>#amount+select:type>#type+btn:!add)
    tabs:filter>#filter
    list>transactions|filter|sort:newest>*tx(
      card(row(text:#tx.desc+badge:#tx.type+text:$#tx.amount)+btn:icon:!del(#tx.id))
    )
  )
  @persist:localStorage(transactions)

You: Validate it

Claude: [calls air_validate]
✅ Valid — 15 lines, ~45 tokens, 3 state refs, 2 mutations

You: Now transpile to React

Claude: [calls air_transpile]
[generates complete working React component]
```

## Troubleshooting

- **Server not detected**: Make sure the path in your config is absolute
- **"tsx not found"**: Run `npm install -g tsx` or use `npx tsx`
- **Tools not showing**: Restart Claude Desktop completely (quit + reopen)
- **Errors in output**: Check Claude Desktop logs or run `npm run mcp` directly to test
