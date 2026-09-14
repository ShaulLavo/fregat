---
name: verify-fregat
description: Drive the fregat web app the way a user does and capture evidence — screenshots, console and network problems, log windows, Chrome traces, per-component render counts, and query-cache dumps. Use before calling any UI, performance, or render change done, for "verify this in the browser", "look at it", "trace it", "count renders", or "what is in the query cache".
---

# Verify fregat

The app is a Vite web client (`apps/web`) over a Bun server (`apps/server`). One CLI drives it: `bun run agent:browser`. Every verb writes an evidence directory and prints a summary short enough to read in one screen. The raw artifacts are for the human who disagrees with the summary.

## Launch

None. A dev server is always running: web on `http://localhost:5173/`, API on `http://localhost:3001/`. Never start your own. If the dev server is down, tell the user; do not spawn one, and do not restart theirs, because a restart drops their live terminal and agent sessions.

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

The scenarios land on a workspace by registering a root-relative folder (`--workspace`, default `work/projects/platform`) and opening its address URL. A fresh browser context has no workspace otherwise.

## Evidence

`/work/tmp/fregat-evidence/<stamp>-<verb>-<label>/` holds `summary.md`, the screenshots, `observed.json` (page errors, console, failed requests, sockets), `logs.txt` (warn and error events written during the run) and the verb's artifact: `trace.json` for Chrome's Performance panel, `renders.json`, `caches.json`.

Proof standards: exercise the real user path, not a setter. Capture the action and the resulting state, not just the final screen. Check side effects where they land: the file on disk, the log line, the cache entry. A claim about performance cites a `trace` summary before and after on the same scenario. A claim about fewer renders cites `renders` before and after. Read the screenshot back with the image-viewing tool; a screenshot nobody looked at is not evidence.

Trace tables use `ProfileChunk` samples to name the deepest application function on each sampled stack, including its callees. These are interval estimates, not function self time. Each row reports task wall time separately. Scenario markers identify the worst task during each step, including steps whose tasks stay below 50ms. Compare the same scenario with `--compare` against a recorded baseline; shared-server timings can vary with language-server state and background work.

`trace-sources.json` records captured source maps or an explicit unavailability reason. The corresponding generated scripts and maps stay beside the trace, so a later source edit cannot silently change its attribution. A mapped frame names the original source, function and one-based line/column; `[generated]` means mapping was unavailable. Use `readTraceSources` with `summarizeTrace` for offline analysis.

`renders` counts completed component renders, including scenario setup. Its timing is React `actualDuration` (subtree render duration), not exclusive self time. A component absent from `renders.json` rendered zero times in that measured window. The screenshot is taken after measurement; use `scenario` when you need screenshots at each action.

A `/themes/palettes` 404 can mean the dev process predates the route. Confirm the route and process start time, then report that a restart is needed; never restart it yourself. WebGL "GPU stall" warnings can come from screenshot capture. TypeScript language-server exits are failures to investigate, not expected noise: inspect the exact log window printed by the command. CLI summaries can omit stderr fields; read the structured event or capture a standalone process replay when the retained tail omits the cause.

## Cleanup

The CLI closes the browser it opened. It never touches the dev server or the user's browser. Evidence stays; delete an old evidence directory only when the user asks.

## Feature map

[`features/README.md`](features/README.md) indexes the user-facing surfaces, one file each. A proof that drives one convenient entry point is incomplete when the map lists others.
