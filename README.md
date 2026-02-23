# AirEngine

**AI-native Intermediate Representation for Software**

AirEngine is a compact language and transpiler where AI agents generate, read, and modify software using a structured representation instead of human-readable source code.

```
@app:todo
  @state{items:[{id:int,text:str,done:bool}],filter:enum(all,active,done)}
  @ui(
    input:text>!add({text:#val,done:false})
    list>items|filter>*item(check:#item.done+text:#item.text+btn:!del(#item.id))
    tabs>filter.set(all,active,done)
  )
  @persist:localStorage(items)
```

**8 lines of AIR → 150+ lines of working React.**

---

## What is AIR?

AIR (AI-native Intermediate Representation) is a language designed for machines first, humans second.

**The premise:** If AI is both the author and maintainer of code, human-readable source code is a legacy interface. AIR replaces it with a compact, schema-validated, structurally-guaranteed representation that:

- **9x fewer lines** than equivalent React/JS
- **80% fewer tokens** for AI generation
- **Zero syntax errors** (schema-validated by design)
- **Deterministic output** (structural guarantees, not text guessing)
- **Multi-agent safe** (graph-based merging, not text diffs)

Human-readable code becomes a "view layer" — generated on demand when a human needs to inspect it.

## Architecture

```
Natural Language Prompt
        │
        ▼
┌─────────────────┐
│  LLM + Schema   │   AI generates constrained AIR
│  Constraint     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   .air file     │   Compact IR (~28 lines)
│   (validated)   │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│Transpile│ │Decompile │
│→ React  │ │→ Readable│
│  App    │ │  Code    │
└────────┘ └──────────┘
```

## Quick Start

```bash
# Generate an app from natural language
air generate "build an expense tracker with categories and budget"

# Transpile an .air file to React
air transpile app.air -o ./output

# Validate an .air file
air validate app.air
```

## AIR Language Reference

### Blocks
| Block | Purpose | Example |
|-------|---------|---------|
| `@app:name` | Declare application | `@app:todo` |
| `@state{...}` | Reactive state | `@state{items:[str]}` |
| `@ui(...)` | Component tree | `@ui(list>*item(text))` |
| `@api(...)` | Backend routes | `@api(GET:/users>~data)` |
| `@auth(...)` | Authentication | `@auth(required,role:admin)` |
| `@style(...)` | Design tokens | `@style(theme:dark)` |
| `@nav(...)` | Routing | `@nav(/,/dash,/settings)` |
| `@persist:x` | Data persistence | `@persist:localStorage(items)` |
| `@hook(...)` | Side effects | `@hook(onMount>~api.fetch)` |

### Operators
| Op | Meaning | Example |
|----|---------|---------|
| `>` | Action/event flow | `input>items.push` |
| `\|` | Pipe/transform | `items\|filter` |
| `+` | Compose | `text+btn` |
| `:` | Binding/config | `theme:dark` |
| `?` | Conditional | `?auth>dash:login` |
| `*` | Iteration | `*item(card)` |
| `!` | Mutation/action | `!delete(id)` |
| `#` | Reference | `#user.name` |
| `~` | Async | `~api.get(/users)` |
| `^` | Emit event | `^notify("saved")` |

## Project Structure

```
airengine/
├── src/
│   ├── parser/        # AIR syntax → AST
│   ├── validator/     # Schema validation (Zod)
│   ├── transpiler/    # AST → React/JS output
│   └── cli/           # CLI interface
├── examples/          # Example .air files
├── docs/              # Language spec & guides
└── tests/             # Test suite
```

## Status

🚧 **Pre-alpha** — Language spec is being defined. Transpiler is in development.

## License

Proprietary. All rights reserved.
