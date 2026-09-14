# Agent verification tooling

Status: **IMPLEMENTED 2026-09-14 — units 0 through 7 landed; see [Outcome](#outcome).** Requested 2026-09-14.

An agent working on this repo must be able to prove its change the way the owner does by hand: open the app in the state the owner is in, drive the surface, watch it, and read the numbers. Today the pieces exist in fragments. Playwright is installed, the deploy runs a headless live check, the address grammar puts any state in a URL, the editor has performance marks behind a global, and the logs are structured. Nothing tells an agent it must look, and nothing gives it the performance panel, the render counts, or the query caches it would need to argue about a lag.

This plan does two things. It brings pstack's engineering discipline into this machine's skills without its Cursor plumbing, and it builds the project-local verification skill and the tools that discipline assumes exist. The tools are one CLI. The skill is the manual for it. The rule in `AGENTS.md` is what makes both non-optional.

## What exists today

| Piece             | Current state                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser driving   | Playwright is a dependency. [`live-check.mjs`](../scripts/deploy/live-check.mjs) launches headless Chromium, waits for the window toolbar, and collects page errors, console errors, failed requests and socket frames. The `*.browser.tsx` tests run the real app behind a Vite proxy.                                                                                                                                    |
| Shared state      | The address feature (`features/address/`) round-trips workspace, tabs, selection, search, logs and settings category through the URL. An agent handed the owner's URL lands in the owner's state.                                                                                                                                                                                                                          |
| Performance marks | `features/editor/state/performance-trace.ts` and `editor-open-benchmark-control.ts` emit `performance.mark` behind `globalThis.__editorPerfTrace`. Editor only, no consumer outside tests.                                                                                                                                                                                                                                 |
| Logs              | JSONL per day under `logs/`, wide events with `requestId`, `area`, `action`. Agents grep and jq. No helper, no correlation between "the thing I just drove" and "these lines".                                                                                                                                                                                                                                             |
| Skills            | `~/.agents/skills` holds Cursor-neutralised ports of most pstack skills (the principles, `how`, `why`, `architect`, `interrogate`, `blast-radius`, `figure-it-out`, `no-comments`, `show-me-your-work`, `tdd`, `teach`, `technical-writing`, `unslop`), ported 2026-08-27. Missing: `poteto-mode` and its 22 playbooks, `create-verification-skill`, `maintain-verification-skill`, `arena`, `swarm`, `reflect`, `recall`. |
| Control surface   | pstack's playbooks send every UI proof through a "control skill" that Cursor ships as `control-ui`. Nothing here plays that role. The built-in `run` skill launches the app and stops there.                                                                                                                                                                                                                               |
| Render tooling    | None. No react-scan, no React DevTools backend, no TanStack devtools. React 19.3, no compiler.                                                                                                                                                                                                                                                                                                                             |

Reference clone of pstack: `/work/projects/references/pstack`.

## Decisions

| Decision                                      | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — port, do not mirror                      | Skills land in `~/.agents/skills` in the shape the existing ports already use. Cursor terms are replaced, never left in: `.cursor/skills` becomes `.agents/skills`, `control-ui` and `control-cli` become this repo's `verify-fregat` skill, named models become "a strong reasoning model" or the inherited parent model, `poteto-agent` becomes a Claude Code agent definition, `cursor-team-kit`'s `deslop` becomes `unslop`. `setup-pstack` and `automate-me` are not ported; they are Cursor features. |
| D2 — Graphite                                 | pstack's shipping and babysit playbooks assume Graphite stacks. Ported against plain `git` and `gh`: a stack is a chain of PRs with `gh pr` base branches, merge-when-ready is `gh pr merge --auto`. Confirmed 2026-09-14.                                                                                                                                                                                                                                                                                  |
| D3 — one CLI, five verbs                      | `bun run agent:browser <verb>` under `scripts/agent/`. Verbs: `look`, `scenario`, `trace`, `renders`, `caches`. Every verb writes to one evidence directory per run and prints a path and a summary the agent can read in one screen. The raw artifact is for the human who disagrees with the summary.                                                                                                                                                                                                     |
| D4 — the dev server is the target             | The CLI drives the running dev server by default, or any URL passed in, including the mesh. It never starts a server. The `AGENTS.md` rule that a dev server is always running stays the contract. Doctor is a `GET` of the release route plus the window toolbar appearing.                                                                                                                                                                                                                                |
| D5 — the CLI injects, the app carries nothing | react-scan and the React DevTools backend are injected by the CLI through Playwright's init script before React loads. No query parameter, no env flag, no import in `main.tsx`. The editor's existing `performance-trace` query parameter stays and the CLI sets it for `trace`. The one app-side line is a development-only debug global that registers each query client for `caches`. Confirmed 2026-09-14: the owner wants as little tracking in the code base as possible.                            |
| D6 — react-scan and the React profiler both   | react-scan answers "which component rendered, how often, and was the DOM unchanged". The React DevTools backend, driven headlessly with `recordChangeDescriptions`, answers "why: which prop, hook, state or context changed, and how long each commit took". `renders` reports the first; `renders --why` adds the second. Both read from the same scenario run.                                                                                                                                           |
| D7 — scenarios are code                       | `scripts/agent/scenarios/*.ts`, one exported function per scenario, taking a Playwright page and the app's stable selectors. The owner's hand-tests become named scenarios: `editor-large-paste`, `editor-fast-scroll`, `editor-type-burst`, `tree-expand-all`, `search-replace-bulk`, `chat-long-session`. An agent that touches a surface adds or extends one. A scenario is also the argument to `trace` and `renders`.                                                                                  |
| D8 — evidence location                        | `/work/tmp/fregat-evidence/<yyyymmdd-hhmmss>-<verb>-<scenario>/`. Survives cleanup, never committed. Confirmed 2026-09-14.                                                                                                                                                                                                                                                                                                                                                                                  |
| D9 — the rule                                 | `AGENTS.md` gains a verification section. A UI change is not done until the agent has run `look` on the changed surface and names the screenshot in its report. A performance claim is not done without `trace` before and after on a named scenario. A "fewer renders" claim is not done without `renders` before and after. The design census precedent applies: the tool exists, the rule names it.                                                                                                      |
| D10 — feature map is the maintained artifact  | The `verify-fregat` skill carries a feature map in pstack's shape, one file per user-facing surface, four H2s each. `maintain-verification-skill` keeps it honest. The map is what `swarm` splits by.                                                                                                                                                                                                                                                                                                       |

## Unit 0 — port pstack

Target: `~/.agents/skills`, which `~/.claude/skills` links to.

1. `poteto-mode` and `skills/poteto-mode/playbooks/*` and `references/*`. Replace every Cursor term per D1. The "control skill" sentence in ten playbooks becomes "the `verify-fregat` skill". The subagent section becomes Claude Code's `Agent` tool with `subagent_type` from `.claude/agents/`. `/loop` stays; Claude Code has it. The Babysit, Shipping, Autopilot and Orchestrate playbooks follow D2.
2. `create-verification-skill` and `maintain-verification-skill` with `references/feature-map-example/`. Output path becomes `.agents/skills/verify-<app>/`.
3. `arena`, `swarm`, `reflect`, `recall`. `recall` reads Cursor chat history; port only the shared-record half (git log, logs, plans) or drop it. Default: drop.
4. `agents/poteto-agent.md` becomes `~/.claude/agents/poteto-agent.md`.
5. Refresh the nine existing ports whose upstream moved (`how`, `why`, `architect`, `interrogate`, `blast-radius`, `figure-it-out`, `no-comments`, `show-me-your-work`, `typescript-best-practices`), re-applying the same neutralisation to the new text.
6. A `scripts/skills/port-pstack.ts` that does steps 1 through 5 from the reference clone with a table of replacements, so the next upstream pull is a rerun, not a redo. The replacement table is the documentation of what was Cursor-specific.

Verification: `grep -rn "cursor\|graphite\|grok\|sol-max\|bugbot" ~/.agents/skills` returns nothing outside a comment that names the origin.

## Unit 1 — `verify-fregat`

Generated by the ported `create-verification-skill`, then edited by hand. Lives at `.agents/skills/verify-fregat/` in this repo, linked from `.claude/skills/`.

- **Launch.** None. The dev server is running. If it is not, the skill says to tell the user, not to start one.
- **Doctor.** `bun run agent:browser look --doctor`: the release route answers, the window toolbar renders, no page errors in the first five seconds, the environment is live.
- **Drive.** The CLI verbs, with the stable handles this repo already has: `aria-label="Window toolbar"`, the `data-workbench` attribute, tab roles, the command palette, and the address URL for state.
- **Evidence.** The evidence directory per D8. Proof standards copied from pstack: real user path, action and resulting state, side effects checked on disk and in the logs.
- **Cleanup.** Close the browser the CLI opened. Never touch the dev server or the user's browser.
- **Feature map.** Seed with editor, file tree, search, chat, terminal, git, settings, and the address URL. One file each.

Verification: run the skill's own instructions end to end once, driving the editor feature, and confirm the evidence exists after cleanup.

## Unit 2 — `look` and `scenario`

`scripts/agent/browser.ts` with Playwright, sharing the observation code `live-check.mjs` already has. Move that code into `scripts/agent/observe.ts` and have the deploy import it, so there is one definition of "what the page reported".

- `look <url|address> [--selector] [--doctor]`: open, wait for ready, screenshot full page and the selector if given, dump console errors, failed requests, page errors, socket state, and the log lines written during the visit. Summary on stdout, files in the evidence directory.
- `scenario <name> [--url]`: run a named scenario from D7 against the page, screenshot at each labelled step, same observation dump.
- Log correlation: record the first and last timestamp of the run and print the `logs/` lines in that window filtered to `warn` and `error`, plus a `jq` command that reproduces the full window.

Verification: `look` on the current dev server produces a screenshot the agent can read back with the `Read` tool. `scenario editor-large-paste` runs the paste without an error.

## Unit 3 — `trace`

`trace <scenario>`: Playwright's Chromium tracing around the scenario, categories for the timeline, v8 and rendering, saved as a Chrome-loadable trace JSON. Then a summariser over the trace events:

- long tasks over 50ms with their top three self-time frames, attributed to file and line through the source map
- time split by scripting, style and layout, paint and composite
- frames longer than 16ms during the scenario, as a count and the worst ten
- the editor's own `performance.mark` entries, if `__editorPerfTrace` was on, aligned with the long tasks

The summary is a markdown table under a screen long. The JSON is next to it for the Performance panel. A `--compare <previous-dir>` flag diffs two summaries and prints the delta per row, which is what a perf claim cites.

Verification: `trace editor-large-paste` on the current build, then the same after deliberately adding a synchronous loop to a keystroke handler on a scratch branch, and the summary names the handler.

## Unit 4 — `renders`

Two data sources, one table.

- **react-scan.** The CLI injects react-scan's browser bundle with `page.addInitScript` and calls `scan({ showToolbar: false, trackUnnecessaryRenders: true, onRender })` in the page, collecting per-component render counts and unnecessary-render counts into a page global it owns. `renders <scenario>` runs the scenario and reads the report with `getReport()` plus the collected counts. Output: component, renders, unnecessary renders, total self time, sorted by unnecessary then renders.
- **React DevTools backend.** The CLI injects `react-devtools-core`'s backend bundle the same way, before React loads, with profiling started and `recordChangeDescriptions` on. After the scenario the CLI calls `stopProfiling` and `getProfilingData` on the renderer interface through `page.evaluate` and reads the commit data: per commit, per fiber, actual and self durations, and the change description that says which props, state, hooks or context changed. `renders --why` joins that to the react-scan table: for each component with unnecessary renders, the most common trigger.

This unit starts with a two-hour spike proving the DevTools backend can be installed via `page.addInitScript` and yields change descriptions headlessly. If it cannot, `--why` falls back to react-scan's `onRender` fiber data, which carries the changed props but not hooks or context, and the plan says so.

Verification: `renders editor-type-burst` names the components that re-render per keystroke. One of them is then wrapped in a narrower selector on a scratch branch and the table shows the drop.

## Unit 5 — `caches`

- In development the query clients register themselves on a debug global keyed by origin, and `caches [--url]` dumps every query with key, status, staleness and data size, and every mutation with key, status, variables and scope. This is the TanStack devtools panel as text, and it is what an agent reads when a refresh does not happen.
- No in-app devtools panel for now. The owner would rather build a devtools surface of their own later than mount a third-party one.

Verification: `caches` after `scenario editor-large-paste` shows the save mutation with its key and scope.

## Unit 6 — logs

`bun run logs [--since 5m] [--area editor] [--level warn] [--request <id>] [--action <name>]`: a thin reader over the JSONL files that picks the right day and continuation files, filters, and prints one line per event with the fields that matter for the area. `--follow` tails. The CLI verbs call the same reader for their correlation window.

Verification: `bun run logs --since 1m --level error` after a failed `look` prints the error the page reported.

## Unit 7 — the rule and the reminders

- `AGENTS.md` gains "Verification" per D9, placed after "Dev Server". It names the CLI verbs, the evidence directory, and what each kind of claim needs.
- `.claude/agents/poteto-agent.md` from unit 0 and the `verify-fregat` skill are what an agent reads first.
- The `run` skill's project hook points at `verify-fregat` so "run the app" and "prove the change" are one path.

## Order

Unit 0 first; the playbooks are what make agents ask for the tools. Units 1 and 2 together, one deploy. Unit 3 and unit 4's spike can run in parallel with unit 5 and 6. Unit 7 last, once the verbs exist to name.

## Open questions

- Whether `recall` is worth a partial port. It reconstructs context from chat history, which this environment stores in the memory directory and the plans, not in a Cursor transcript.

## Outcome

Landed 2026-09-14, uncommitted in the working tree.

- **Unit 0.** `scripts/skills/port-pstack.ts` copies fifteen skills from the reference clone into `~/.agents/skills` through a replacement table and prints what it could not map. Fifteen skills and `~/.claude/agents/poteto-agent.md` are in place; the three lines it still reports are benign ("precursor", the text cursor, a macOS path example). Babysit and Shipping are ported against `gh`: auto-merge armed on the bottom PR only, the next PR retargeted to trunk after each merge. `recall` and `setup-pstack` were not ported.
- **Units 1 and 2.** `.agents/skills/verify-fregat/` with an eight-entry feature map, linked into `.claude/skills/`. `scripts/agent/browser.ts` with `look`, `scenario`, `trace`, `renders`, `caches` and `list`; `scripts/agent/logs.ts` behind `bun run logs`; `scripts/agent/observe.mjs` shared with the deploy live check. Three editor scenarios. A fresh browser context has no workspace, so the CLI registers one through `POST /fs/workspace-address` and opens its address URL, which is the same mechanism a pasted URL uses.
- **Unit 3.** Chromium tracing with the timeline, user-timing and CPU-profiler categories. The summary attributes long tasks through `FunctionCall` events, which lands on React's commit for framework-heavy work; the CPU-profile samples are in the JSON for Chrome and are the next step if attribution needs to reach app code.
- **Unit 4.** The CLI injects a Bun-built IIFE over `bippy` before React loads; the app carries nothing. react-scan was tried first and dropped: its 0.5.7 build rejects `trackUnnecessaryRenders`, keeps change tracking behind a private flag, and ships an overlay we never render. bippy's `instrument` and `traverseRenderedFibers` give the per-commit fiber visit; the script diffs props by reference, hook slots and context by value, reads `actualDuration` for self time, and flags a render whose subtree carries no mutation flag as "no DOM change", which is the real unnecessary-render definition. The React DevTools backend stays a follow-up for per-commit commit timings.
- **Unit 5.** One development-only line registers the query clients on a global; `caches` dumps queries with staleness and observers, and mutations with key, scope and variables.
- **Unit 7.** `AGENTS.md` gained a Verification section.
- **First findings from the tools themselves.** The running dev server predates the palettes route and 404s `/themes/palettes`. During `editor-type-burst`, `BreadcrumbItem` and `PopoverTrigger` render about 4,100 times for 300 keystrokes, driven by fresh `children`, `icon` and `onOpenChange` references from the cursor breadcrumbs; the truncation helpers re-render with nothing of their own changed. That is a candidate perf pass, not part of this plan.
- Not done: scenarios for tree, search, chat, terminal, git and settings (the feature map names what each should do), `renders --why` from the DevTools profiler, and a `trace` attribution that reaches app frames.
