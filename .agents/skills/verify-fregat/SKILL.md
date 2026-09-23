---
name: verify-fregat
description: Drive the fregat web app the way a user does and capture evidence — screenshots, console and network problems, log windows, Chrome traces, per-component render counts, and query-cache dumps. Use before calling any UI, performance, or render change done, for "verify this in the browser", "look at it", "trace it", "count renders", or "what is in the query cache".
---

# Verify fregat

The app is a Vite web client (`apps/web`) over a Bun server (`apps/server`). One CLI drives it: `bun run agent:browser`. Every verb writes an evidence directory and prints a summary short enough to read in one screen. The raw artifacts are for the human who disagrees with the summary.

## Launch

Use the existing dev server: web on `http://localhost:5173/`, API on `http://localhost:3001/`. Do not start a duplicate. This project, including the mesh deployment called production, is under development. Restart the existing service when needed to complete an authorized fix. Persisted sessions survive restarts; active processes and connections may be interrupted.

When web changes depend on a server protocol change, deploy both with `bun run deploy --server`. A web-only deployment reuses the old server. Verify `/release` and exercise the changed protocol in the browser before calling the deployment done.

Any verb also accepts `--url` for a different target, including the mesh build at `https://omarchy.mesh.shaulavo.dev/platform/` and any address URL the user pastes. An address URL puts you in the user's exact state (workspace, tabs, selection).

## Doctor

```bash
bun run agent:browser look --doctor
```

Passes when the release route answers, the window toolbar renders, and no alert is on screen. Run it first whenever anything looks off, and again after any failed drive.

## Drive

```bash
bun run agent:browser look [--url U] [--selector CSS]     # screenshot + problems
bun run agent:browser scenario <name> [--file NAME]       # a named user path, screenshot per step
bun run agent:browser trace <name> [--compare DIR]        # Chrome trace + summary, before/after diff
bun run agent:browser renders <name>                      # per-component render counts and what changed
bun run agent:browser caches                              # every query and mutation in the page
bun run agent:browser list                                # scenario names
bun run logs --since 5m [--level warn] [--area editor]    # the structured log, filtered
```

Scenarios live in `scripts/agent/scenarios/`. They open a file through the command palette and exercise one surface: `editor-large-paste`, `editor-fast-scroll`, `editor-type-burst`. When you touch a surface with no scenario, add one. Selectors live in `scripts/agent/selectors.ts`; add there, never inline. The stable handles are `aria-label="Window toolbar"`, the editor textarea `role="textbox"` named `Editor input`, the viewport `.editor-virtualized-viewport` (click that, not the textarea), the palette input `[data-slot="command-input"]`, and editor tabs `[data-editor-tab-path]`.

A scenario that makes a fixture workspace releases it with `releaseFixture` from `scripts/agent/fixture-workspace.ts`, not `rm`: the workspace's terminal shell persists by design and its language servers idle for minutes, so a bare `rm` leaves them running on the server under test.

The scenarios land on a workspace by registering a root-relative folder (`--workspace`, default `work/projects/platform`) and opening its address URL. A fresh browser context has no workspace otherwise.

## Landing page and product assets

Use the same tool for `apps/site`. Its build includes the real app demo. The existing Vite server serves the built site at `/fregat/`:

```bash
bun run --cwd apps/site site:build
bun run agent:browser look --site --headed --url http://localhost:5173/fregat/ --width 1440 --height 1200
bun run agent:browser look --site --headed --url http://localhost:5173/fregat/ --width 390 --height 844
```

Read both screenshots. `layout.json` records viewport, document width, image and iframe dimensions and positions. Final screenshots wait for the embedded app. The `demo-startup` scenario separately checks that the iframe is visible during loading and no screenshot preview replaces it. `--static-dir` remains useful for documents without service workers; use real HTTP through the existing Vite server for this demo.

Run `scenario demo-workspace` and `scenario demo-agent-git` against `/fregat/demo/index.html`, and `scenario demo-reset` against `/fregat/`. These use the actual app UI. `inspection.json` retains mock requests, unhandled operations and client log batches. The mock's logs are the relevant logs here; demo scenarios do not read the unrelated development server log window. `observed.json` includes service-worker responses, native socket connections and console source locations. Inspect failures as well as successful steps.

For mesh verification, set `OBSERVABILITY_DIR=/work/platform-production/logs` on the browser or logs command so the captured log window comes from the process being driven.

The CLI launches Chrome without Playwright's default `--hide-scrollbars`, so scrollbars take the space they take for a user. Every run records its actual browser and GPU in `browser-renderer.json`. Use `--headed` for product assets and inspect that record; the headless shell can use software rendering.

For a real editor hero capture, see [landing.md](features/landing.md). The `editor-product` scenario opens four source tabs and runs the web typecheck in a capture-owned terminal. Its terminal IDs are isolated from existing sessions and cleaned up after the page closes; inspect `product-terminals.json` to confirm cleanup. Wallpaper overrides affect only the fresh browser context. Never type promotional commands into an existing user's terminal.

## Evidence

`/work/tmp/fregat-evidence/<stamp>-<verb>-<label>/` holds `summary.md`, the screenshots, `observed.json` (page errors, console, failed requests, sockets), `logs.txt` (warn and error events written during the run) and the verb's artifact: `trace.json` for Chrome's Performance panel, `renders.json`, `caches.json`.

Proof standards: exercise the real user path, not a setter. Capture the action and the resulting state, not just the final screen. Check side effects where they land: the file on disk, the log line, the cache entry. A claim about performance cites a `trace` summary before and after on the same scenario. A claim about fewer renders cites `renders` before and after. Read the screenshot back with the image-viewing tool; a screenshot nobody looked at is not evidence.

Trace tables use `ProfileChunk` samples to name the deepest application function on each sampled stack, including its callees. These are interval estimates, not function self time. Each row reports task wall time separately. Scenario markers identify the worst task during each step, including steps whose tasks stay below 50ms. Compare the same scenario with `--compare` against a recorded baseline; shared-server timings can vary with language-server state and background work.

`trace-sources.json` records captured source maps or an explicit unavailability reason. The corresponding generated scripts and maps stay beside the trace, so a later source edit cannot silently change its attribution. A mapped frame names the original source, function and one-based line/column; `[generated]` means mapping was unavailable. Use `readTraceSources` with `summarizeTrace` for offline analysis.

`renders` counts completed component renders, including scenario setup. Its timing is React `actualDuration` (subtree render duration), not exclusive self time. A component absent from `renders.json` rendered zero times in that measured window. `render-steps.json` holds cumulative counts at each scenario checkpoint, so subtract consecutive snapshots to isolate the action from setup. The screenshot is taken after measurement; use `scenario` when you need screenshots at each action.

A `/themes/palettes` 404 can mean the dev process predates the route. Confirm the route and process start time, then restart the existing service if needed for the fix. WebGL "GPU stall" warnings can come from screenshot capture. TypeScript language-server exits are failures to investigate, not expected noise: inspect the exact log window printed by the command. CLI summaries can omit stderr fields; read the structured event or capture a standalone process replay when the retained tail omits the cause.

## Cleanup

The CLI closes the browser it opened. It never touches the dev server or the user's browser. Evidence stays; delete an old evidence directory only when the user asks.

## Feature map

[`features/README.md`](features/README.md) indexes the user-facing surfaces, one file each. A proof that drives one convenient entry point is incomplete when the map lists others.
