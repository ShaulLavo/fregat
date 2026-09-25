# Processes, leases and dev plumbing each get an owner

Status: **PHASE 1 IMPLEMENTED AND DEPLOYED 2026-09-23** (release
`20260923T083633Z-51995766-plan-131-132-phase1`); Phases 2–4 proposed; D4 decided
2026-09-21: delete the migrations. Requested 2026-09-21. Phase 1 outcome:
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
- Item 8: waits for Plan 149 Phase 2, which is changing `terminal/service.ts`.
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
