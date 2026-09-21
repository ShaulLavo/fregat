# Processes, leases and dev plumbing each get an owner

Status: **PROPOSED — PHASE 1 FIRST; D4 NEEDS THE OWNER'S ANSWER.** Requested 2026-09-21. Inspected
at Platform `d1ca6472`. Covers `apps/desktop`, `apps/tui`, `apps/server` outside the provider
adapters ([plan 131](131-provider-codes-not-prose.md)), `apps/web/vite.config.ts` and `scripts/`.

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
- D4 (**owner**): `apps/server/src/db/migrations.ts` holds ten migrations and squashes history below
  version 11. `CLAUDE.md` says no migration or healing code. Either session and chat data is worth
  preserving, in which case the rule gets a stated exception, or the database is recreated on a
  schema change and the ledger is deleted. The migration code itself is careful; this is a policy
  question, not a defect.

## Phase 1 — stop killing and stop hiding (items 1, 2, 4)

Lease file for desktop children and a loud port conflict. LSP backend death reported to the client.
`untilAccepted` gets bounded attempts with backoff, then fails the lease operation with a
structured error.

## Phase 2 — dev plumbing (items 3, 9, 10, 12)

Save notifications over the server channel. Origins come from `SERVER_ALLOWED_ORIGINS` or options
only, computed once in `runtime-network.ts`. One generated tsconfig, the one `dev-sources.ts` already
writes, serves every typecheck path. HMR disposal in the editor and terminal packages, then delete
the forced reload.

## Phase 3 — terminal and TUI (items 5 to 8, 11)

Ancestry through the ppid chain instead of executable names. A window handle from `BrowserWindow`
into the FFI call. Terminal state restored by query or a documented reset, with each surviving mode
commented. Name the repaint constants, or replay stored scrollback instead of poking the app. A
supported terminal namespace parameter so the harness asks instead of intercepting.

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
