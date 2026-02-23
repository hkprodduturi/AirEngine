# Transpiler Semantics — React Target

How AIR language constructs map to React output. This documents what the transpiler
**actually generates**, not aspirational behavior.

Target: Vite + React 18 + Tailwind CSS 3 (single-page app, client-side only).

---

## Blocks

| Block | Status | React output |
|-------|--------|-------------|
| `@state` | Implemented | `useState` declarations with typed defaults |
| `@style` | Implemented | CSS variables in `index.css`, themed component classes |
| `@ui` | Implemented | JSX tree in `App.jsx` |
| `@persist` | Implemented | `useEffect` load/save (localStorage, cookie, sessionStorage) |
| `@hook` | Implemented | `useEffect` calls |
| `@nav` | Extracted | Routes stored in context, no client-side router |
| `@api` | Extracted | Routes parsed but NOT emitted as fetch calls |
| `@auth` | Extracted | Auth block parsed, pages render conditionally |
| `@db` `@cron` `@webhook` `@queue` `@email` `@env` `@deploy` | Parsed only | No output |

---

## State (`@state`)

Each field becomes a `useState` hook. Default values by type:

| Type | Default |
|------|---------|
| `str` | `''` (or specified default) |
| `int` / `float` | `0` (or specified default) |
| `bool` | `false` |
| `enum(a,b,c)` | `'a'` (first value) |
| `[type]` | `[]` |
| `{fields}` | Object with field defaults |
| `?type` | `null` |

```jsx
const [items, setItems] = useState([]);
const [filter, setFilter] = useState('all');
```

---

## Style (`@style`)

Tokens generate CSS custom properties in `index.css`:

| Token | CSS variable | Component usage |
|-------|-------------|-----------------|
| `theme:dark` | `--bg: #030712`, `--fg: #f3f4f6`, `--muted`, `--border`, etc. | `bg-[var(--bg)]` |
| `theme:light` | `--bg: #ffffff`, `--fg: #111827`, etc. | Same classes, different values |
| `accent:#hex` | `--accent: #hex` | `bg-[var(--accent)]`, `text-[var(--accent)]` |
| `radius:N` | `--radius: Npx` | `rounded-[var(--radius)]` |
| `maxWidth:N` | — | `max-w-[Npx] mx-auto` wrapper |
| `font:...` | — | Font family in body |

All component styles use CSS variables as source of truth. No hardcoded theme colors in JSX.

---

## UI Elements

### Layout

| AIR | HTML | Key classes |
|-----|------|-------------|
| `header` | `<header>` | `flex items-center justify-between p-4 border-b` |
| `footer` | `<footer>` | `p-4 text-center text-sm text-[var(--muted)]` |
| `main` | `<main>` | `flex-1 p-6` |
| `sidebar` | `<aside>` | `w-64 border-r p-4 flex flex-col gap-4` |
| `row` | `<div>` | `flex gap-4 items-center` |
| `grid` | `<div>` | `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` |
| `grid:N` | `<div>` | `grid grid-cols-N gap-4` |
| `card` | `<div>` | `rounded-[var(--radius)] border p-4 shadow-sm` |
| `form` | `<form>` | `space-y-4` |

### Interactive

| AIR | HTML | Behavior |
|-----|------|----------|
| `btn:primary` | `<button>` | Accent background, white text |
| `btn:secondary` | `<button>` | Accent border, accent text |
| `btn:ghost` | `<button>` | Transparent, hover background |
| `btn:icon` | `<button>` | Small round, hover background |
| `btn:submit` | `<button>` | Full-width accent (for forms) |
| `input:text` | `<input type="text">` | Full-width, border, focus ring |
| `input:email` | `<input type="email">` | Same + `placeholder="Email..."` |
| `input:password` | `<input type="password">` | Same + `placeholder="Password..."` |
| `select` | `<select>` | Border, rounded |
| `toggle` / `check` | `<input type="checkbox">` | Standard checkbox |
| `link` | `<a>` | Accent text, hover underline, centered |

### Content

| AIR | HTML | Notes |
|-----|------|-------|
| `h1` | `<h1>` | `text-3xl font-bold` |
| `h2` | `<h2>` | `text-2xl font-semibold` |
| `p` | `<p>` | No default classes |
| `text` | `<span>` | No default classes |
| `badge` | `<span>` | `rounded-full px-2.5 py-0.5 text-xs font-medium` |
| `img` | `<img>` | Self-closing, `max-w-full` |
| `icon:name` | `<span>` | Renders emoji (zap=⚡, shield=🛡, users=👥, etc.) |
| `logo` | `<div>` | Renders ⚡ placeholder |

### Data Display

| AIR | HTML | Notes |
|-----|------|-------|
| `stat:"Label"` | `<div>` | Card with label + value |
| `stat:"Label">#ref` | `<div>` | Card with label + state binding |
| `stat:"Label">$#ref` | `<div>` | Card with label + currency-formatted value |
| `table` with `cols:` | `<table>` | Full `<thead>/<tbody>`, column headers from `cols:[...]` |
| `chart:line` / `chart:bar` | `<div>` | Placeholder with "chart placeholder" text |
| `progress:bar` | `<div>` | Nested bar with percentage width |
| `pagination` | `<div>` | Prev/Next buttons with page indicator |
| `spinner` | `<div>` | CSS animation, centered |

### Compound

| AIR | HTML | Notes |
|-----|------|-------|
| `plan("Name",price,[features])` | `<div>` | Pricing card: name, formatted price, feature `<ul>` |
| `tabs(...)` | `<div>` | Tab buttons with active state |

---

## Operators

### Bind (`:`)

Parsed as left-associative binary. Resolved via `resolveBindChain()` into element + modifiers.

```
btn:primary         → { element: 'btn', modifiers: ['primary'] }
input:email         → { element: 'input', modifiers: ['email'] }
stat:"Total"        → { element: 'stat', label: 'Total' }
badge:#items.length → { element: 'badge', binding: #items.length }
btn:icon:!del(#id)  → { element: 'btn', modifiers: ['icon'], action: !del(#id) }
```

### Flow (`>`)

Connects element to content or action.

| Pattern | Output |
|---------|--------|
| `element > "text"` | Element with text children |
| `element > !mutation` | Element with `onSubmit` (form) or `onClick` (button) |
| `element > *iter(...)` | Container with `.map()` iteration |
| `?condition > content` | `{condition && (<content>)}` |
| `stat:"Label" > $#ref` | Stat card with currency-formatted binding |

### Compose (`+`)

Sibling elements rendered adjacently. Inside a `grid`, compose children are wrapped in `<div className="flex flex-col gap-4">` to form single grid cells.

```
btn:primary>"Go"+btn:ghost>"Cancel"  →  <button>Go</button>\n<button>Cancel</button>
```

Special case: `header>text + btn` → button is rendered inside the header.

### Pipe (`|`)

Data transformation chain.

| Pattern | Output |
|---------|--------|
| `items\|filter(field)` | `.filter(x => x.field === activeFilter)` |
| `items\|sum(field)` | `.reduce((s,x) => s + x.field, 0)` |
| `items\|avg(field)` | Sum / length |
| `items\|sort` | `.sort()` with comparator |
| `data\|search` | `.filter(item => Object.values(item).some(...))` |

### Prefix Operators

| Op | Name | Output |
|----|------|--------|
| `#` | State ref | `{stateName}` or `{obj.field}` |
| `!` | Mutation | Handler function call |
| `*` | Iteration | `.map()` with key |
| `?` | Conditional | `{condition && (...)}` |
| `$` | Currency | `{'$' + value.toFixed(2)}` |
| `~` | Async | `console.log` stub / TODO comment |
| `^` | Emit | Comment placeholder |

---

## Scoped Blocks

### `@page:name`

Renders as conditional block: `{currentPage === 'name' && (<div>...</div>)}`.

Generates `const [currentPage, setCurrentPage] = useState('firstPage')`.

**Form-centric pages** (login, signup — detected by form as primary child) get centered
card layout: `flex items-center justify-center min-h-screen` + `max-w-md` wrapper + heading.

### `@section:name`

Renders as `<section id="name" className="py-16 px-6">`.

Used in landing pages for anchor-linked content areas.

---

## Navigation

When `@page` blocks exist, nav elements auto-generate page-switching buttons:

```jsx
<nav className="flex flex-col gap-2">
  <button className={`... ${currentPage === 'overview' ? 'active' : ''}`}
          onClick={() => setCurrentPage('overview')}>Overview</button>
  ...
</nav>
```

Links with `/pageName` href use `setCurrentPage` instead of navigation.

---

## Tables

Generated from `table(cols:[name,email,role], data:#users|search)`:

- `<thead>` with column headers from `cols` array
- `<tbody>` with `.map()` over data source
- Search pipe generates `.filter()` with case-insensitive full-text search
- Column names cleaned: strip `[[` prefix, split by comma, strip `feat:` prefix

---

## Persistence

| Method | Load | Save |
|--------|------|------|
| `localStorage` | `useEffect(() => { getItem }, [])` | `useEffect(() => { setItem }, [deps])` |
| `cookie` | `useEffect(() => { document.cookie parse }, [])` | `useEffect(() => { document.cookie set }, [deps])` |
| `session` | `useEffect(() => { sessionStorage.getItem }, [])` | `useEffect(() => { sessionStorage.setItem }, [deps])` |

`httpOnly` flag generates a warning comment (requires server-side handling).

---

## Mutations

Extracted from `!name(args)` in the UI tree. Generated as functions:

- **Auth mutations** (`login`, `signup`): async with loading/error state management
- **CRUD mutations** (`add`, `del`): array manipulation with `setState`
- **Generic mutations**: function stub with action name

---

## Scaffold Files

Every transpile produces 8 files:

| File | Purpose |
|------|---------|
| `package.json` | React 18, Vite 5, Tailwind CSS 3 deps |
| `vite.config.js` | ESM Vite config |
| `tailwind.config.cjs` | CommonJS (avoids ESM conflict) |
| `postcss.config.cjs` | CommonJS |
| `index.html` | Root div + script |
| `src/main.jsx` | ReactDOM.createRoot |
| `src/index.css` | Tailwind directives + CSS variables |
| `src/App.jsx` | Generated component |

---

## Soft Failures

Unknown elements render as `<div>` with no data attribute. Unknown operators render
their operands with a comment. The goal: every `.air` file produces a **runnable** app,
even if some features are stubs.
