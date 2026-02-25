# Canonical Demo Specification

## Demo Goal

Show the complete AI-first AirEngine loop in ~60 seconds: human prompt → AI writes `.air` → validate → transpile → running app with auth, database, API, and styled UI.

This demo should be homepage/video-ready and reproducible.

## The Prompt

```
Build a team task manager where users can sign up, create projects,
add tasks with priorities and assignments, and see a dashboard with
task counts by status.
```

**Why this prompt**: It hits all major features (auth, multiple models, relations, CRUD, dashboard) while being universally understandable.

## Expected `.air` Output

The AI agent should generate approximately this (35-50 lines):

```air
@app:taskflow
  @state{
    user:?map,
    authError:?str,
    currentPage:str
  }
  @style(theme:dark,accent:#6366f1,radius:12,font:sans)
  @db{
    User{id:int:primary:auto,email:str:required,name:str:required,password:str:required}
    Project{id:int:primary:auto,name:str:required,description:str,created_at:datetime:auto}
    Task{id:int:primary:auto,title:str:required,status:enum(todo,in_progress,done):required,priority:enum(low,medium,high):required,project_id:int:required,assignee_id:int}
    @relation(Task.project_id<>Project.id:cascade)
    @relation(Task.assignee_id<>User.id:set-null)
  }
  @api(
    POST:/auth/login(email:str,password:str)>auth.login
    POST:/auth/register(email:str,name:str,password:str)>auth.register
    POST:/auth/logout>auth.logout
    CRUD:/projects>~db.Project
    CRUD:/tasks>~db.Task
  )
  @auth(required)
  @nav(/>?user>page:login)
  @ui(
    @page:login(
      form(h2>"Sign In"+input:email>#email+input:password>#password+btn:primary>"Sign In">!login)
      +p>"No account?"+btn:ghost>"Register">!goToRegister
    )
    @page:register(
      form(h2>"Create Account"+input:text>#name+input:email>#email+input:password>#password+btn:primary>"Register">!register)
      +btn:ghost>"Back to Login">!goToLogin
    )
    @page:dashboard(
      sidebar(nav:vertical(btn:ghost>"Dashboard"+btn:ghost>"Projects"+btn:ghost>"Tasks"))
      +main(
        h1>"Dashboard"
        +grid:3(stat:"Total Tasks">#taskCount+stat:"In Progress">#inProgressCount+stat:"Done">#doneCount)
        +chart:bar>tasksByStatus
      )
    )
    @page:projects(
      sidebar(nav:vertical(btn:ghost>"Dashboard"+btn:ghost>"Projects"+btn:ghost>"Tasks"))
      +main(h1>"Projects"+table>projects>*p(text>#p.name+text>#p.description+badge:#p.taskCount))
    )
    @page:tasks(
      sidebar(nav:vertical(btn:ghost>"Dashboard"+btn:ghost>"Projects"+btn:ghost>"Tasks"))
      +main(
        h1>"Tasks"
        +tabs>statusFilter.set(all,todo,in_progress,done)
        +table>tasks|statusFilter>*t(text>#t.title+badge:#t.status+badge:#t.priority+text>#t.assignee)
      )
    )
  )
```

**Approximate token count**: ~600 output tokens for the `.air` file.

**Equivalent raw code**: ~50 files, ~2200 lines, ~15,000+ output tokens.

**Token ratio**: ~25:1.

## Demo Script

### Step 1: Prompt (5 seconds)

**Show**: Human types the prompt in Claude with AirEngine MCP connected.

**Narration**: "I describe what I want in plain English."

### Step 2: AI Generates `.air` (10-15 seconds)

**Show**: Claude generates the `.air` file in real-time.

**Narration**: "Claude writes a compact 45-line specification — 25x smaller than the final app."

**Metrics to capture**:
- Output tokens
- Generation time
- `.air` line count

### Step 3: Validate (1-2 seconds)

**Show**: `air_validate` returns `{ valid: true }` (or shows repair iteration).

**Narration**: "AirEngine validates the syntax and structure."

**Ideal path**: Validates on first pass.
**Acceptable path**: 1 repair iteration (shows self-correction capability).

**Metrics to capture**:
- Validation time
- Error count (should be 0 or 1)
- Repair iterations (should be 0 or 1)

### Step 4: Transpile (< 1 second)

**Show**: `air_transpile` returns file list and stats.

**Narration**: "The compiler deterministically generates 50 files of React, Express, and Prisma code in 120 milliseconds."

**Metrics to capture**:
- File count
- Output lines
- Compression ratio
- Transpile time (ms)

### Step 5: Run (10-15 seconds)

**Show**: Terminal running `npm install && npm run dev`. Browser opens showing the app.

**Narration**: "Install dependencies, start the dev server, and we have a running app."

**What to show in the browser**:
1. Login page (dark theme, styled form)
2. Register → auto-login
3. Dashboard with stat cards and chart
4. Projects page with create form
5. Tasks page with filter tabs and table

**Metrics to capture**:
- npm install time
- Dev server start time
- Time from prompt to first browser render

### Step 6: Walkthrough (15-20 seconds)

**Show**: Click through the running app.

**Narration**: "Full authentication, database with relations, REST API, dashboard with charts — all from a 45-line specification."

**Key interactions to demonstrate**:
- Create a project
- Create a task (with priority and assignment)
- Filter tasks by status
- Dashboard updates with new data
- Logout and login again (persistence works)

## Timing Budget

| Step | Target | Acceptable |
|------|--------|-----------|
| Human types prompt | 5s | 10s |
| AI generates `.air` | 10s | 20s |
| Validate + repair | 2s | 5s |
| Transpile | 0.2s | 0.5s |
| npm install | 10s | 20s |
| Dev server start | 3s | 5s |
| **Total** | **~30s** | **~60s** |

## Success Criteria

### Must-Have
- [ ] App has working login/register (auth flow complete)
- [ ] App has database with 3 models (User, Project, Task)
- [ ] App has working REST API (CRUD for projects and tasks)
- [ ] App has styled UI (dark theme with accent color)
- [ ] App has dashboard page with stat cards
- [ ] Total time from prompt to browser < 60 seconds
- [ ] Zero human code edits required

### Should-Have
- [ ] App has relation-based queries (tasks grouped by project)
- [ ] App has chart visualization on dashboard
- [ ] App has filter/search on tasks page
- [ ] First-pass validation (no repair iterations)
- [ ] Compression ratio > 20:1

### Nice-to-Have
- [ ] App has responsive layout (mobile-friendly)
- [ ] App has loading states and error handling
- [ ] Token count < 800 for `.air` generation

## Reproducibility

### Static Baseline

To ensure the demo is reproducible:
1. Pre-generate the `.air` file and commit as `demo/taskflow.air`
2. Verify it transpiles deterministically (hash-check)
3. Verify it builds successfully
4. Capture screenshots at each step

### Live Demo Protocol

For live demonstrations:
1. Use the exact prompt text above
2. If AI generates different `.air`, that's fine — validates the system works
3. If validation fails, show the repair loop (demonstrates self-correction)
4. If build fails, fall back to the static baseline

### Environment Requirements

- Node.js >= 18
- npm >= 8
- AirEngine v0.1.7+
- Claude with AirEngine MCP configured
- Ports 3000 and 3001 available

## Failure Modes and Mitigations

| Failure | Likelihood | Mitigation |
|---------|-----------|-----------|
| AI generates invalid `.air` syntax | Medium | Show repair loop (feature, not bug) |
| Transpile produces broken imports | Low | Fix in A2 phase before demo |
| npm install fails (network) | Low | Pre-cache node_modules |
| Dev server port conflict | Low | Run `air doctor` before demo |
| Chart doesn't render (no data) | Medium | Ensure seed data or show empty state gracefully |

## Metrics to Report After Demo

```
┌─────────────────────────────────────┐
│ AirEngine Demo Results              │
├─────────────────────────────────────┤
│ Prompt → .air:     12.3 seconds     │
│ .air tokens:       583              │
│ Validation:        PASS (0 repairs) │
│ Transpile:         118ms            │
│ Output:            48 files, 2,143  │
│                    lines            │
│ Compression:       47:1             │
│ npm install:       8.2 seconds      │
│ Build:             PASS             │
│ Total:             34.7 seconds     │
│                                     │
│ Equivalent raw code: ~15,000 tokens │
│ Token savings: 25.7x               │
│ Human code edits: 0                 │
└─────────────────────────────────────┘
```
