---
name: verify-fregat
description: Drive the fregat web app the way a user does and capture evidence — screenshots, console and network problems, log windows, Chrome traces, per-component render counts, and query-cache dumps. Use before calling any UI, performance, or render change done, for "verify this in the browser", "look at it", "trace it", "count renders", or "what is in the query cache".
---

# Verify fregat

The app is a Vite web client (`apps/web`) over a Bun server (`apps/server`). One CLI drives it: `bun run agent:browser`. Every verb writes an evidence directory and prints a summary short enough to read in one screen. The raw artifacts are for the human who disagrees with the summary.

## Launch

Use the existing Vite dev server on `http://localhost:5173/`. Against it, every run starts its own throwaway API server from the current source, with a temp state home and log directory under the OS temporary directory as `fregat-agent-*`, and removes it when the run ends; the summary names its port and directory, and its full log is copied into the evidence. So a run never touches the owner's sessions or settings, and never sees a stale server. `--shared-dev` drives the configured running dev API and its existing state instead; use it only when the task authorizes access to that state. Machine-specific targets (dev API URL, state home, the owner's instance) live in the host's local instructions.

The throwaway server never starts the machine's Codex or Claude CLI: those drivers run only a fixture binary under the canonical OS temporary directory, so status probes, discovery and turns on real accounts are refused, and a chat scenario installs a mock (`installMockProvider`, `createMockProviderSession`) or a native fixture: `isolatedNativeScenario` for one session, `withFixtureProvider` (Codex `native-conversation.mjs` or Claude `native-claude.mjs`) for scenarios that manage their own sessions. A scenario that needs a real account declares `realProviders: true`, and `agent:browser` refuses it, and any writing scenario under `--shared-dev` or a foreign `--url`, unless the owner passes `--real-providers`. Never pass that flag yourself.

For an authorized deployment where web changes depend on a server protocol change, ship a compatible server with the web build, since a web-only deployment reuses the old server. Verify the target's release endpoint and exercise the changed protocol in the browser before calling the deployment done.

A private Vite or API server uses an explicit free `--port` on a known loopback address, and stops when verification finishes.

The runner supports macOS and Linux. Fixture-only runs start with desktop wallpaper disabled; appearance scenarios can enable it or supply `--product-wallpaper`. It uses the host's temporary directory and Playwright's installed browsers; It uses Playwright's installed browser cache or the cache configured for the host. `FREGAT_EVIDENCE_ROOT` overrides the evidence directory. If the shared mesh route points to another machine, run a local Vite instance on an explicit free port and give the runner the same `WEB_PORT`:

```bash
# Terminal 1, from this checkout. Pick a free port.
cd apps/web && bun --bun vite --host 127.0.0.1 --port 5214 --strictPort
# Terminal 2, from the repository root.
WEB_PORT=5214 bun run agent:browser look --doctor
WEB_PORT=5214 bun run agent:browser scenario approval-turn-ended
```

`--engine firefox` or `--engine webkit` runs `look`, `scenario`, `renders` or `caches` in another engine; `trace` needs Chromium. Desktop uses an installed Chromium app or the native system-webview host; WebKit coverage also matters for iPhone mesh clients. Playwright's WebKit on Arch needs `scripts/playwright-webkit-arch.sh` after a new WebKit download.

`look`, `trace`, `renders` and `caches` also accept `--url` for a different target, including a deployed instance and any address URL the user pastes. An address URL puts you in the user's exact state (workspace, tabs, selection); one copied from the dev page needs `--shared-dev`, because a throwaway server has never seen that workspace. A deployed instance is someone's real state, so `scenario`, `trace` and `renders` refuse a production URL unless the scenario declares `readOnly: true`.

## Doctor

```bash
bun run agent:browser look --doctor
```

Passes when the release route answers, the app renders, no alert is on screen, and the probe records no page execution or required frontend load errors. Script and stylesheet console errors count when their source URL identifies a loaded frontend asset. An aborted request whose initiating frame has detached stays in raw evidence with its frame provenance and allows a healthy result. Raw warnings and other request problems stay in the evidence. Run it first whenever anything looks off, and again after any failed drive.

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

A scenario that needs two owners calls `connectSecondOwner` (`scripts/agent/second-owner.ts`): it starts a second throwaway server from this checkout and connects it as a Remote URL machine, as `project-grouping` does.

A scenario that makes a fixture workspace releases it with `releaseFixture` from `scripts/agent/fixture-workspace.ts`, not `rm`: the workspace's terminal shell persists by design and its language servers idle for minutes, so a bare `rm` leaves them running on the server under test.

A second window in the same browser context stalls against the dev server. Each tab holds four event streams (`/settings/events`, `/machines/events`, two `/fs/events`), and a browser allows six HTTP/1.1 connections per host across every tab in a profile, so a second tab's requests queue until a stream closes — for tens of seconds, and a keypress that needs a read looks like it did nothing. Open a second window with `browser.newContext()`, which has its own pool. The mesh serves HTTP/2 and is unaffected; the desktop app talks HTTP/1.1 to `127.0.0.1`.

The scenarios land on a workspace by registering a root-relative folder (`--workspace`, default the checkout running the CLI) and opening its address URL. A fresh browser context has no workspace otherwise.

## Landing page and product assets

Use the same tool for `apps/site`. The build contains the Astro landing page and its
animated replica. Verify the built files without starting the web app:

```bash
bun run build:workspaces
bun run --cwd apps/site site:build
bun run agent:browser look --site --static-dir apps/site/dist --width 1440 --height 1200
bun run agent:browser look --site --static-dir apps/site/dist --width 390 --height 844
```

Read both screenshots. `layout.json` records viewport, document width, image and iframe
bounds. `--site` waits for document, fonts and images. The retired live-app demo and its
browser scenarios were removed after the replica shipped in PR #1012.

For a `--url` run, set `OBSERVABILITY_DIR` to the target process's log directory on the browser or logs command so the captured log window comes from the process being driven.

The CLI launches Chrome without Playwright's default `--hide-scrollbars`, so scrollbars take the space they take for a user. Every run records its actual browser and GPU in `browser-renderer.json`. Use `--headed` for product assets and inspect that record; the headless shell can use software rendering.

For a real editor hero capture, see [landing.md](features/landing.md). The `editor-product` scenario opens four source tabs and runs the web typecheck in a capture-owned terminal. Its terminal IDs are isolated from existing sessions and cleaned up after the page closes; inspect `product-terminals.json` to confirm cleanup. Wallpaper overrides affect only the fresh browser context. Never type promotional commands into an existing user's terminal.

## Evidence

`<OS temp>/fregat-evidence/<stamp>-<verb>-<label>/` holds `summary.md`, the screenshots, `observed.json` (page errors, console, failed requests, sockets), `logs.txt` (warn and error events written during the run) and the verb's artifact: `trace.json` for Chrome's Performance panel, `renders.json`, `caches.json`.

Proof standards: exercise the real user path, not a setter. Capture the action and the resulting state, not just the final screen. Check side effects where they land: the file on disk, the log line, the cache entry. A claim about performance cites a `trace` summary before and after on the same scenario. A claim about fewer renders cites `renders` before and after. Read the screenshot back with the image-viewing tool; a screenshot nobody looked at is not evidence.

Render counts locate repeated work; they do not measure its cost. A context consumer can execute while the compiler reuses its calculations and JSX. Distinguish consumer execution, subtree rendering, and DOM work, and pair render evidence with `trace --compare` for speed claims. Use a production build when validating compiler performance; development and StrictMode counts alone do not establish user cost.

Trace tables use `ProfileChunk` samples to name the deepest application function on each sampled stack, including its callees. These are interval estimates, not function self time. Each row reports task wall time separately. Scenario markers identify the worst task during each step, including steps whose tasks stay below 50ms. Compare the same scenario with `--compare` against a recorded baseline; shared-server timings can vary with language-server state and background work.

`trace-sources.json` records captured source maps or an explicit unavailability reason. The corresponding generated scripts and maps stay beside the trace, so a later source edit cannot silently change its attribution. A mapped frame names the original source, function and one-based line/column; `[generated]` means mapping was unavailable. Use `readTraceSources` with `summarizeTrace` for offline analysis.

`renders` counts completed component renders, including scenario setup. Its timing is React `actualDuration` (subtree render duration), not exclusive self time. A component absent from `renders.json` rendered zero times in that measured window. `render-steps.json` holds cumulative counts at each scenario checkpoint, so subtract consecutive snapshots to isolate the action from setup. The screenshot is taken after measurement; use `scenario` when you need screenshots at each action.

A 404 on a new route under `--shared-dev` can mean the dev process predates it; a default run starts from current source. WebGL "GPU stall" warnings can come from screenshot capture. TypeScript language-server exits are failures to investigate, not expected noise: inspect the exact log window printed by the command. CLI summaries can omit stderr fields; read the structured event or capture a standalone process replay when the retained tail omits the cause.

## Cleanup

The CLI closes the browser it opened. It never touches the dev server or the user's browser. Evidence stays; delete an old evidence directory only when the user asks.

## Feature map

[`features/README.md`](features/README.md) indexes the user-facing surfaces, one file each. A proof that drives one convenient entry point is incomplete when the map lists others.
