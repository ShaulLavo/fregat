# Processes, leases and dev plumbing each get an owner

Status: **PHASE 1 IMPLEMENTED AND DEPLOYED 2026-09-23** (release
`20260923T083633Z-51995766-plan-131-132-phase1`); Phases 2–4 proposed; research question 1
(Vite memory) answered 2026-09-25, see Research findings; D4 decided
2026-09-21: delete the migrations. Phase 4's backup and reset of the dev and prod databases
approved 2026-09-25, after all lanes merge. Requested 2026-09-21. Phase 1 outcome:
item 1 — each desktop child is spawned `detached` (its own process group, so one signal also reaches
Vite's node child) and recorded with its `ps lstart` in `~/.platform/desktop/<hash of root>.json`;
launch stops only live leased groups, then a held port is `desktop.PORT_IN_USE` in a native dialog
naming the holder, never a kill. Item 2 — backend death was already broadcast as
`$/platform/serverExited`, but the client dropped its params; a failed exit now carries
`lsp.SERVER_EXITED` (message, why, fix) and the editor toasts it, and the rust-analyzer shim
directory rule became a `--version` probe run from the project root. Item 4 — `untilAccepted` makes 5
attempts at 250 ms doubling, then throws `orchestration.TERMINAL_LEASE_UNPERSISTED`; `end` releases
the worktree hold in `finally`. Verified: `scenario editor-lsp-server-exit` on the mesh; not verified:
a real desktop launch against a held port (unit-tested in `apps/desktop/src/bun/tests/ports.test.ts`).
Review fixes the same day: lease-file writes are serialized (two children exiting at quit raced
the rename every time), the conflict names the holder's executable, not its command line, a
failed lease `end` can be written again, cleanup failures no longer mask the original error, and
the rust-analyzer probe times out after 5 s. Found on the way and fixed the same day: each
`@parcel/watcher` subscribe left one zombie `sh` on the server, because parcel's default backend
order probes Watchman through `popen` and never reaps it when Watchman is absent; `fs/watch.ts`
now names the native backend. Session discovery started one `claude-discovery-worker` per root
per page every minute (168 roots, 13.4 s per scan); it is now one call with every root, one
worker (or one Codex app-server) per scan, 185 ms for the same 106 sessions. Inspected
at Platform `d1ca6472`. Covers `apps/desktop`, `apps/tui`, `apps/server` outside the provider
adapters (plan 131, done), `apps/web/vite.config.ts` and `scripts/`.

These are the places where one process guesses about another: who holds a port, which window is
ours, whether a binary is a shim, whether a save came from the app. The guess is a name, a path
fragment, a title or a timer. Each gets a handle or a message instead.

## What is on the table

| #   | Where                                                                      | The guess                                                                                                                                                                                 | Failure mode                                                                                                                             | Verified |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `apps/desktop/src/bun/index.ts:325-417`                                    | `releasePlatformPort` scrapes `lsof` and `ps`, calls a process "ours" when its cwd is under the repo or its command line `includes(ROOT_DIR)`, then SIGTERM, 2.5 s, SIGKILL.              | Any process whose command line mentions the repo path (an editor, a `tail`, an agent) is killed.                                         | yes      |
| 2   | `apps/server/src/lsp/installers.ts:371-395`                                | `isRustupShim`: any binary in `~/.cargo/bin` is a shim. The comment gives the real reason: "nothing in this stack reports a backend death".                                               | A real `cargo install rust-analyzer` is refused and Rust support disappears silently.                                                    | no       |
| 3   | `apps/web/vite.config.ts:120-131`, `apps/server/src/fs/app-save-marker.ts` | A JSON file in `~/.platform` is the IPC between the server's save path and Vite's HMR; `vite.config.ts` imports it out of `apps/server/src`. 10 s expiry, 512 cap, every error swallowed. | A slow watcher, a second checkout sharing `$HOME` or a large save falls back to a full reload, or one project consumes another's marker. | no       |
| 4   | `apps/server/src/orchestration/terminal-lease-controller.ts:111-124`       | `untilAccepted` retries any persistence failure forever at 250 ms, warning on each pass.                                                                                                  | A full disk becomes an endless warning stream that never reaches the user.                                                               | no       |
| 5   | `apps/tui/src/host/job-control.ts:24-33`                                   | "Is this process group mine?" compares `ps -o comm=` to the executable's basename.                                                                                                        | Another `bun` in the group passes and can be stopped.                                                                                    | no       |
| 6   | `apps/desktop/src/bun/vibrancy.ts:25-43`                                   | The native window is found by its title, polled 40 times at 50 ms.                                                                                                                        | Two windows with one title, or a slow machine, miss; the result is an opaque window and a log line.                                      | no       |
| 7   | `apps/tui/src/host/attach.ts:69`                                           | An uncommented 20-mode escape blob resets whatever the detached program left set.                                                                                                         | A mode not on the list leaks into the user's shell.                                                                                      | no       |
| 8   | `apps/server/src/terminal/service.ts:790-796`                              | `repaint()` resizes the PTY by one column and back after 50 ms; the 50 and a magic 500 are unexplained.                                                                                   | An app that debounces SIGWINCH longer than 50 ms still coalesces.                                                                        | no       |
| 9   | `apps/server/src/auth.ts:22-28` and `scripts/runtime-network.ts:55-78`     | Allowed origins hardcoded in one, computed from the chosen port in the other; `dev.ts` picks another port when 5173 is taken.                                                             | The two drift into 403s.                                                                                                                 | no       |
| 10  | `scripts/check-linked-sources.ts`                                          | Typecheck freshness defended by comparing mtimes and rebuilding the sibling checkout; a 5 s walk budget gives up silently.                                                                | The typechecker reads a days-old Editor build. Three path mappings that should be one.                                                   | no       |
| 11  | `scripts/agent/product-terminal.ts:52-70`                                  | The harness monkey-patches `globalThis.WebSocket` to rewrite terminal ids.                                                                                                                | Test tooling silently changes app behaviour under capture.                                                                               | no       |
| 12  | `apps/web/vite.config.ts:109-117`                                          | Any change under a linked editor checkout forces a full reload, because mounted editors and terminals keep their old implementation after Fast Refresh.                                   | Hides missing `import.meta.hot.dispose` in those packages.                                                                               | no       |

Also recorded: `packages/tree/src/hooks/useFileTree.ts:54-65` defers model teardown by
`setTimeout(…, 1)` to survive StrictMode, which plan 128 already names as a prerequisite
(`packages/tree` lifetime); `packages/tree/src/utils/render/web-components.ts:93-104` sweeps the
document at import and is kept alive by a sentinel export.

## Decisions

- D1: the desktop app never kills a process it did not start. It records its children in a lease
  file, as `machines/remote-scripts.ts` already does with `startedAt` reuse checks. A port held by
  something else is a structured error the user sees, not a kill.
- D2: item 2 is fixed at the cause. A language-server backend that exits immediately is reported to
  the client as a structured LSP error with the exit code in `internal`. The shim check becomes a
  probe of the candidate, not a judgement of its directory.
- D3: item 3 stops crossing the app boundary through a file. The dev server learns about
  app-originated saves over the server's existing channel, and `vite.config.ts` stops importing
  `apps/server/src/**`.
- D4 (decided by the owner, 2026-09-21): delete the migrations and start from scratch.
  `apps/server/src/db/migrations.ts` holds ten migrations (versions 11 to 20) and squashes history
  below 11, against the rule in `CLAUDE.md` that this project carries no migration or healing code.
  Nothing in the database is worth a ledger. Phase 4 does it.

## Phase 1 — stop killing and stop hiding (items 1, 2, 4)

Lease file for desktop children and a loud port conflict. LSP backend death reported to the client.
`untilAccepted` gets bounded attempts with backoff, then fails the lease operation with a
structured error.

## Phase 2 — dev plumbing (items 3, 9, 10, 12)

Landed 2026-09-25 (lane L4):

- Item 3: the server keeps the content version of each app write in memory (`fs/app-writes.ts`) and
  answers `GET /fs/app-write?path&version`. The Vite plugin (`apps/web/scripts/app-save-hmr-plugin.ts`)
  asks with the version it read, so an outside edit after an app save still hot-updates.
  `app-save-marker.ts` and its `~/.platform` file are deleted; `vite.config.ts` no longer imports
  `apps/server/src`.
- Item 9: already true in effect. `scripts/dev.ts` and the desktop app compute
  `SERVER_ALLOWED_ORIGINS` from `runtime-network.ts` for the port they chose; the server's
  hardcoded list is only the fallback for a bare `bun src/index.ts`. `serverUrlFromEnv` is now the
  one place that derives the API URL (Vite plugin, TUI launcher).
- Item 10, partly: the freshness walk no longer gives up silently; an overrun names the unverified
  directories. Serving every typecheck from the generated source-mapped tsconfig is not done: it
  typechecks the Editor's source under Platform's settings, which lane L7 owns.
- Item 12: the forced reload stays, with a comment naming the missing `import.meta.hot.dispose` in
  `@singapore-editor/react`'s controller and ghostty-webgpu's `Terminal`; both fixes live in those
  repos.

Save notifications over the server channel. Origins come from `SERVER_ALLOWED_ORIGINS` or options
only, computed once in `runtime-network.ts`. One generated tsconfig, the one `dev-sources.ts` already
writes, serves every typecheck path. HMR disposal in the editor and terminal packages, then delete
the forced reload.

## Phase 3 — terminal and TUI (items 5 to 8, 11)

Ancestry through the ppid chain instead of executable names. A window handle from `BrowserWindow`
into the FFI call. Terminal state restored by query or a documented reset, with each surviving mode
commented. Name the repaint constants, or replay stored scrollback instead of poking the app. A
supported terminal namespace parameter so the harness asks instead of intercepting.

Status 2026-09-25 (lane L4):

- Item 5: done. The TUI stops its job group only when it leads the group, or when the launcher
  that named itself in `PLATFORM_TUI_LAUNCHER_PID` (set by `scripts/tui.ts`) leads it and is the
  TUI's parent. Walking ancestry alone would stop a non-job-control shell that leads the group,
  which the `shared-shell` job-control test pins.
- Item 7: done. The detach reset is a list with one comment per mode (`DETACH_RESET` in
  `apps/tui/src/host/attach.ts`).
- Item 6: not done. `vibrancy.m` resolves the window by title because Electrobun's `createWindow`
  pointer type is not a public contract, and messaging a non-Objective-C pointer would crash the
  app. The change can only be verified on the Mac: owner check.
- Item 8: done. Repaint uses named delay and column-delta constants and the shared terminal
  column limit. The terminal service tests cover redraw and maximum-width behavior.
- Item 11: deferred. The capture prefix is also how `chat-queue`, `terminal-history` and product
  captures find and kill their own terminals, and a page URL parameter does not survive the app's
  own URL rewriting across the reloads those scenarios do. Since Plan 146 a default run has its own
  server, so the prefix matters only for `--shared-dev` captures.

## Phase 4 — one schema, no ledger (D4)

`migrations.ts` (511 lines) becomes one function that creates the current schema, which is what
versions 11 to 20 add up to. Delete the `Migration` type, the `platformMigrations` list, the
`schema_migrations` table and its Drizzle definition in `db/schema.ts`, and the
`DELETE … WHERE version < 11` squash. The three callers (`app.ts`, `fs/metadata.ts`,
`orchestration/engine.ts`) call the schema function instead. Delete the migration tests that pin
upgrade behaviour; keep or add one that a fresh database has every table the code reads.

A database written by an older schema is not repaired. The server stamps the schema with a single
number (`PRAGMA user_version`), and on a mismatch fails at boot with a structured error whose `fix`
names the file to delete. That is detection, not healing, and it is the rule's own instruction:
"delete the bad state, or tell the user what to delete". A schema change from then on bumps the
number.

Landing this means deleting the dev and mesh databases once. Sessions, chat history and terminal
history in them are lost; say so in the deploy reason.

Decided 2026-09-25: owner — approved: back up, then reset, the dev database
(`/work/platform-dev/home/fs-metadata.sqlite`) and the production database
(`~/.platform/fs-metadata.sqlite`), after all completion-wave lanes have merged. Phase 4 lands
last, against the final migration chain. Constraint: production already has migrations applied up
to version 30, so the one schema must cover everything through the final merged chain, and the
backup is taken from that version-30 database.

## Research questions

1. **Vite dev server memory: leak or load?** On 2026-09-25 per-lane Vite dev servers grew to
   2–3 GB within about ten minutes of scenario runs; lane L4's reached 2.06 GB ten minutes after a
   restart. Suspects: linked Editor sources under `/@fs` re-transformed while the Editor checkout
   changes (item 12's forced reload is the same path), and fresh pages loading the unbundled dev
   graph. Measure with heap snapshots of the Vite process before and after a scenario run, and
   compare the retained module-graph and transform-cache sizes. The answer decides whether this
   joins Phase 2.

## Research findings (2026-09-25)

Research id `132mem`. The question came from the 2026-09-25 brief and landed on main while the
work ran; the text above is the one answered. Measured on Vite 8.3.0, rolldown 1.2.8,
`@vitejs/plugin-react` 6.1.1 (`oxc-transform-react` 0.145.0), Node 26.7.0, 28 cores, Platform at
`9f343825`, Editor linked from `/work/projects/Editor` as every lane does.

### How it was measured

One Vite on port 5397 in a research worktree, launched as
`node --inspect --heapsnapshot-signal=SIGUSR2 node_modules/vite/bin/vite.js` inside the heavy-slot
wrapper. A throwaway config wrapped `apps/web/vite.config.ts` with a probe plugin that put the dev
server on `globalThis`. After every step a CDP client forced two GCs and read
`process.memoryUsage()`, the module graph (modules, `transformResult` code and map sizes) and
transform counts, and the shell read RSS, swap and the `[anon:mimalloc]` mappings from
`/proc/<pid>/smaps`. Pages came from `bun run agent:browser look` (its own API server per run).
Editor churn was simulated by emitting watcher `change` events for Editor sources, which runs
Vite's real invalidation and the `platform-dev-sources` reload hook without touching the shared
checkout. Heap snapshots were taken after the first look and after three in-process restarts and
summarised by a streaming parser. Scripts and raw logs: `/work/tmp/research/132mem/`.

### Answer: neither suspect; the memory is native, from rolldown's dependency optimizer

The JS heap never exceeded 150 MB outside restarts. RSS sits in mimalloc arenas owned by the
rolldown binding (both it and `oxc-transform-react` link mimalloc; the growth follows optimizer
runs, which are rolldown bundles).

| Step (settled, after GC)                                 | RSS                                       | mimalloc      | JS heap            |
| -------------------------------------------------------- | ----------------------------------------- | ------------- | ------------------ |
| Warm optimizer cache, boot + first page                  | 662 MB                                    | 320 MB        | 148 MB             |
| Same, after 10 `look` runs                               | 663 MB                                    | 320 MB        | 147 MB             |
| Same, after 3 × 60 Editor files changed + look           | 684 MB                                    | 337 MB        | 148 MB             |
| Same, after 3 × 391 Editor files changed + look          | 694 MB                                    | 346 MB        | 148 MB             |
| Cold optimizer cache, boot + first look (two runs)       | 2500–2580 MB                              | 2136–2238 MB  | 147 MB             |
| Warm, then 5 forced optimizer runs, no restart, no pages | 710 → 2152 → 2478 → 2709 → 2887 → 2914 MB | 353 → 2268 MB | 147 MB             |
| Then 3 in-process `server.restart(true)` + look          | 2996 → 3502 → 3749 MB                     | 2821 MB       | 240 → 333 → 425 MB |

- **Fresh pages are not it.** Ten fresh-browser looks moved RSS by 1 MB. The whole transform cache
  is 2,775 modules holding 22.6 MB of code and 30.7 MB of source maps.
- **Linked Editor re-transforms are not it.** Re-transforming all 391 Editor source files three
  times added 30 MB and levelled off.
- **A cold optimizer cache is.** The first scan and pre-bundle leave about 2.2 GB in mimalloc that is
  never returned, so a lane Vite starting on a fresh worktree or after a lockfile or config change
  reaches 2.5 GB before the first scenario finishes. That matches L4's 2.06 GB ten minutes after a
  restart. Each later optimizer run adds less (+1155, +327, +231, +175, +27 MB) and it levels off
  near 2.3 GB of mimalloc. Upstream calls this fragmentation across rolldown's long-lived tokio and
  rayon threads, not live memory: rolldown#10985 (tracking allocator shows ~26 MB live while RSS
  grows) and rolldown#9330 (Vite 8 dev ~7× Vite 7's footprint). This process runs 98 threads.
- **In-process restarts leak for real.** Each `server.restart` kept the old server: the JS heap
  grew 92 MB per restart and the snapshot holds 8 `EnvironmentModuleGraph` objects (4 servers ×
  client and ssr) against 2 before, with 25,483 module nodes against 6,195. The retainer path is
  `(Global handles) → closure onWarn → getEnv → envs → DevEnvironment → moduleGraph`: the callbacks
  Vite passes to rolldown's native `vite:resolve-builtin` plugin are held as native handles that are
  never released (`BindingCallableBuiltinPlugin` 11 → 41). That is rolldown#10887, open, reproduced
  upstream on the same 1.2.8. Vite restarts in-process whenever a config dependency changes;
  `vite.config.ts` pulls in `scripts/dev-sources.ts`, `scripts/runtime-network.ts`,
  `apps/server/src/fs/app-save-marker.ts`, `apps/server/src/home.ts` and five plugins under
  `apps/web/scripts/`; commits on main touched those files five times on 2026-09-25.
- None of this is fixed in the newest releases (Vite 8.3.1, rolldown 1.2.11); their notes do not
  mention it.

Two mitigations were measured on a cold cache (settled after three looks, no change in look time,
9–10 s each):

| Environment                                  | RSS          | Threads |
| -------------------------------------------- | ------------ | ------- |
| defaults                                     | 2.50–2.58 GB | 98      |
| `RAYON_NUM_THREADS=4`                        | 2.04 GB      | 50      |
| `MIMALLOC_PURGE_DELAY=0`                     | 2.03 GB      | 98      |
| `RAYON_NUM_THREADS=4 MIMALLOC_PURGE_DELAY=0` | 1.31–1.35 GB | 50      |
| `RAYON_NUM_THREADS=1 MIMALLOC_PURGE_DELAY=0` | 1.19 GB      | 44      |

`MIMALLOC_PURGE_DELAY=0` alone also cut the five-optimizer-run case from 2.91 GB to 1.68 GB.

Two smaller findings on the same path:

- The linked Editor packages are in `optimizeDeps.exclude`, so the scanner never reads their
  imports. `diff`, `evlog/client` and `shiki/textmate` (imported from `packages/editor-core` and
  `packages/editor-diff` sources) are discovered on the first page, which re-runs the whole
  pre-bundle and reloads the page; in the first run, the pages after that added
  `@shikijs/engine-oniguruma` and `remark-stringify` in a third bundle. Listing the linked sources
  in `optimizeDeps.entries` made the scan find them: reloads 1 → 0, memory unchanged (2.60 GB).
- `devSourcePlugin` watches whole package roots (11,916 watched paths) and sends `full-reload`
  for any change under them, `dist/`, `bench/` and `.turbo/` included. 1,661 files under Editor
  `dist/` changed on 2026-09-25, and one Editor `bun run build` rewrites them all, so every open
  page reloads for files the dev graph never loads. This is item 12's hook.

**Recommendation: yes, it joins Phase 2**, as three small changes:

1. Launch Vite with `RAYON_NUM_THREADS=4 MIMALLOC_PURGE_DELAY=0`, in `apps/web`'s `dev:vite`
   (`run-with-env.ts` already takes leading assignments). Halves a lane's steady state, measured.
2. Add the linked sources to `optimizeDeps.entries` from `readDevSources`, excluding tests and
   benches, so a cold start bundles once and the first page does not reload.
3. Item 12's hook reloads only when `modules` is non-empty. D3 removing
   `apps/server/src/**` from the config's imports also removes restart triggers, each of which
   costs about 100 MB until the process exits.

A lane that restarts its Vite process instead of relying on in-process restarts never pays the
rolldown#10887 leak; nothing else is needed while that issue is open. Revisit the environment
settings when rolldown#10985 or #10887 ships a fix.

Not measured: heavy scenarios that start language servers inside the same memory scope (the
`editor-type-burst` run was killed by systemd-oomd at 6.4 GB for the whole scope, Vite at
~2.9 GB including swap), and the settings on a machine with fewer cores.

### Owner questions

None. The environment settings touch only the dev server and are measured; the rest is ordinary
Phase 2 work.

## Verification

Phase 1: a desktop launch with an unrelated process holding the port, whose command line contains
the repo path, shows the conflict and leaves that process running. A missing or crashing language
server shows a structured error in the client and a wide event with the exit code. Phase 2: two
checkouts sharing `$HOME` save concurrently and neither reloads the other. Server changes deploy
with `bun run deploy --server`.

## What this plan does not do

It does not change the mesh deployment, the PTY protocol or provider adapters. Justified
third-party workarounds that were checked and left alone: `/health` readiness polling in
`machines/forward.ts`, `terminal/foreground.ts` polling for tpgid, the Bun version gate in
`packages/pty`.
