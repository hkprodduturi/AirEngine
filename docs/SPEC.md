# AIR Language Specification v0.1

## Overview

AIR (AI-native Intermediate Representation) is a compact, schema-validated language
for defining software applications. It is designed for AI agents to generate, parse,
and modify — with human readability as a secondary benefit, not a primary goal.

## Design Principles

1. **Token density** — maximize information per token
2. **Semantic clarity** — every symbol has one unambiguous meaning
3. **Schema safety** — structurally invalid programs are impossible
4. **Parseability** — simple grammar, no ambiguity, deterministic parsing
5. **Composability** — blocks combine predictably

## Types

| Type | Syntax | Example |
|------|--------|---------|
| String | `str` | `name:str` |
| Integer | `int` | `id:int` |
| Float | `float` | `price:float` |
| Boolean | `bool` | `active:bool` |
| Date | `date` | `created:date` |
| Enum | `enum(v1,v2,...)` | `role:enum(admin,user)` |
| Array | `[type]` | `items:[str]` |
| Object | `{key:type,...}` | `user:{name:str,age:int}` |
| Optional | `?type` | `error:?str` |
| Reference | `#entity` | `author:#users` |
| Constant | `type(value)` | `budget:float(2000)` |

## Operators

| Operator | Name | Meaning | Example |
|----------|------|---------|---------|
| `>` | Flow | Event/action flow | `input>items.push` (on input, push to items) |
| `\|` | Pipe | Transform/filter | `items\|filter` (pipe items through filter) |
| `+` | Compose | Combine elements | `text+btn` (text AND button together) |
| `:` | Bind | Binding/config | `theme:dark` (set theme to dark) |
| `?` | Condition | If/else | `?auth>dashboard:login` (if auth → dash, else → login) |
| `*` | Iterate | For each | `*item(card)` (for each item, render card) |
| `!` | Mutate | Action/mutation | `!delete(id)` (action: delete by id) |
| `#` | Ref | State reference | `#user.name` (reference user.name from state) |
| `~` | Async | Async operation | `~api.get(/users)` (async fetch) |
| `^` | Emit | Event emission | `^notify("saved")` (emit notification) |
| `.` | Access | Property access | `filter.set` (access set on filter) |
| `,` | Separate | List separator | `all,active,done` |
| `()` | Group | Grouping/params | `enum(a,b,c)` |
| `{}` | Define | Object/state def | `@state{...}` |
| `""` | String | String literal | `"Hello World"` |
| `$` | Currency | Format as money | `$#amount` |

## Blocks

### @app:name
Declares an application. Must be the first line.
```
@app:expense-tracker
```

### @state{...}
Defines all reactive state. Single source of truth.
```
@state{
  items:[{id:int,text:str,done:bool}],
  filter:enum(all,active,done),
  loading:bool
}
```

### @style(...)
Design tokens and theme configuration.
```
@style(theme:dark,accent:#8b5cf6,radius:12,font:mono+sans,density:compact)
```

Properties:
- `theme` — light | dark
- `accent` — hex color
- `green`, `red`, `amber` — semantic colors
- `radius` — border radius in px
- `font` — font stack (mono, sans, display, serif)
- `density` — compact | normal | spacious
- `maxWidth` — container max width in px

### @ui(...)
Component tree with behavior. The core of the app.

UI elements:
- `header`, `footer`, `main`, `sidebar` — layout
- `row`, `grid`, `grid:3`, `grid:responsive` — layout containers
- `input:text`, `input:number`, `input:email` — form inputs
- `select`, `tabs`, `toggle` — selection controls
- `btn`, `btn:primary`, `btn:ghost`, `btn:icon` — buttons
- `text`, `h1`, `h2`, `p` — text elements
- `list`, `table` — data display
- `card`, `badge`, `alert` — containers
- `chart:line`, `chart:bar`, `chart:pie` — charts
- `stat` — stat display card
- `progress:bar` — progress indicator
- `spinner` — loading spinner
- `img`, `icon` — media
- `link` — navigation link
- `form` — form group
- `search:input` — search input
- `pagination` — page navigation
- `daterange` — date range picker
- `@section:name(...)` — named section
- `@page:name(...)` — routed page

### @api(...)
Backend route definitions.
```
@api(
  GET:/users(?search,?page)>~users.set
  POST:/users(name:str,email:str)>~users.add
  PUT:/users/:id(data)>~users.update
  DELETE:/users/:id>~users.remove
  CRUD:/posts>~entities.posts
)
```

- `CRUD:` expands to GET (list + single), POST, PUT, DELETE
- `?param` — optional query parameter
- `:param` — URL parameter
- `(typed:params)` — request body

### @auth(...)
Authentication and authorization.
```
@auth(required,role:enum(admin,mod))
```

- `required` — must be authenticated
- `role:enum(...)` — role-based access
- `redirect:/login` — redirect on failure

### @nav(...)
Routing configuration.
```
@nav(
  />?user>dashboard:login
  /dashboard>?user>@protected:/>redirect
  /settings>@protected
)
```

### @persist:method(keys)
Data persistence.
```
@persist:localStorage(items,settings)
@persist:cookie(token,httpOnly,7d)
@persist:session(search,view)
```

### @hook(...)
Lifecycle and side effects.
```
@hook(onMount>~api.users+~api.stats)
@hook(onChange:filter>~api.users(?filter))
```

## Grammar (EBNF-like)

```
program     = app_decl block*
app_decl    = "@app:" identifier
block       = state_block | style_block | ui_block | api_block
              | auth_block | nav_block | persist_block | hook_block
state_block = "@state{" field_list "}"
field_list  = field ("," field)*
field       = identifier ":" type
type        = "str" | "int" | "float" | "bool" | "date"
              | "enum(" value_list ")"
              | "[" type "]"
              | "{" field_list "}"
              | "?" type
              | "#" identifier
              | type "(" literal ")"
ui_block    = "@ui(" ui_expr+ ")"
ui_expr     = element (operator element)*
element     = identifier (":" modifier)? ("(" ui_expr+ ")")?
operator    = ">" | "|" | "+" | ":" | "?"
identifier  = [a-zA-Z_][a-zA-Z0-9_.-]*
literal     = string | number | boolean
string      = '"' [^"]* '"'
number      = [0-9]+ ("." [0-9]+)?
boolean     = "true" | "false"
```

## File Extension

`.air`

## MIME Type

`text/x-air`
