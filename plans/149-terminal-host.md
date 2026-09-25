# Plan 149: Terminals outlive the server

## Status and authorization

- Status: PROPOSED — decisions have recommended answers; D2 wants the owner's nod.
- Priority: P1. A deploy that restarts the server kills every shell, and with it any dev server or
  agent CLI running in a fregat terminal.
- Effort: M–L, roughly 1–1.5k lines across a new host entry, a client `Pty`, lease adoption and
  launch placement.
- Risk: MED. A host that outlives the server also outlives its bugs; a wrong reattach shows one
  terminal's bytes in another.
- Planned at: Platform `bf806401`, 2026-09-25. Origin: the 2026-09-25 daily-driver blocker review.
- Pairs with Plan 148 (deferred server restart). 148 stops a restart from killing agent turns;
  this plan stops it from killing shells. Neither depends on the other.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Server changes deploy with `bun run deploy --server`.

## Outcome

`bun run deploy --server`, a crash-and-restart, or a `bun --watch` reload of the dev server leaves
every terminal running. The panel reconnects and shows the output produced while the server was
down. A shell ends only when the user closes it, it exits, or its worktree is removed.

## What exists today

- Every PTY is a child of the server. `TerminalSession` spawns through `ptyFactory`
  (`apps/server/src/terminal/service.ts:826-859`, default `spawnPty` at `:91`), which is
  `Bun.spawn` with `terminal:` (`packages/pty/src/process.ts:40-50`). The `Pty` interface is
  small: `pid`, `exited`, `write`, `resize`, `kill` (`packages/pty/src/utils/types.ts:15-21`).
- Shutdown kills them on purpose. `SIGTERM` → `stopServer` (`apps/server/src/index.ts:111-122`) →
  `closeApp` → `terminal.dispose()` (`apps/server/src/app.ts:469`) → `session.dispose()` for every
  session (`service.ts:232-236`), whose `kill` defaults to true (`service.ts:690`). The unit's
  default `KillMode=control-group` would kill any survivor anyway.
- Scrollback survives as SQLite rows: `TerminalHistory` keeps up to 8 MiB / 5,000 lines in 16 KiB
  chunks (`terminal/history.ts:5-7`), appended on every output (`service.ts` `handleOutput`) and
  replayed into a new shell on open (`service.ts:560-563`). That is replay, not survival.
- Leases tie a terminal to the server process. `TerminalLeaseController.runtimeEpoch` is a fresh
  UUID per process (`orchestration/terminal-lease-controller.ts:30`). At boot `recover()` marks
  every older-epoch lease `ownership-unknown` (`:86-99`), and the decider refuses to `end` an
  unknown lease (`orchestration/worktree-decider.ts:563`). `worktree-policy.ts:70` then blocks
  removing that worktree with `terminal-ownership-unknown`. Nothing clears that state, so every
  restart with a live terminal leaves its worktree permanently undeletable.
- Agent CLIs launched in a terminal (`terminal/agent-launch.ts`) carry a handoff. At boot
  `recoverTerminalHistory` marks an `active` handoff's ownership `unknown`
  (`orchestration/engine.ts:1044-1080`), so the provider session is stuck the same way.
- Sessions are keyed `JSON.stringify([rootPath, 'shell' | 'agent', id])` (`service.ts:997-1003`).
  Browser I/O is binary frames, controls are JSON (`packages/contracts/src/terminal.ts:43-92`).
- The dev server runs `bun --watch` (`apps/server/package.json:19`). A reload re-evaluates the
  module in-process (Plan 076), so today's `TerminalService` loses its handles to live PTYs.
  What happens to those shells after a reload has not been verified.
- The server bundle is one entry (`scripts/deploy/release.ts:107-116`; `bun run build` in
  `apps/server`).

## What the references do

| Reference | Pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Paths                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orca      | A terminal daemon owns every PTY. orcad detaches it and calls `disconnectDaemon()`, never shutdown; the successor adopts the endpoint. On Linux it launches through `systemd-run --user --scope` because `KillMode=mixed`, `control-group` and `process` all fail to protect the children. Socket and token paths carry the protocol version (`daemon-v<N>.sock`); previous versions are adopted through legacy adapters. The daemon's health payload reports its real cgroup. | `references/orca/docs/reference/orcad-operations.md`, `src/main/daemon/daemon-cgroup-scope.ts`, `daemon-protocol-version.ts`, `daemon-legacy-adapters.ts` |
| VS Code   | A pty host process separate from the window. Persistent terminals survive a window reload; an orphan is kept for a grace time (60 s, 6 s short) and replayed through a headless xterm serializer on reattach.                                                                                                                                                                                                                                                                  | `references/vscode/src/vs/platform/terminal/node/ptyHostMain.ts`, `ptyService.ts`, `common/terminal.ts:859-873`                                           |
| herdr     | Hands PTY file descriptors to its successor over `SCM_RIGHTS`.                                                                                                                                                                                                                                                                                                                                                                                                                 | `references/herdr/src/server/handoff.rs`                                                                                                                  |

Orca's daemon directory is ~200 modules and its protocol is at version 36 with a compatibility
constant per bump. That is the cost of a rich host protocol. This plan keeps ours to a handful of
verbs so it rarely changes. Fd handoff is out: Bun has no API for passing descriptors over a socket.

## Scope

- A host process (Bun, because `Bun.Terminal` owns the master fd) that spawns PTYs with
  `@workspace/pty`, keeps a per-session ring buffer, and serves one Unix socket.
- A client `Pty` implementation injected through the existing `ptyFactory` seam, so
  `TerminalSession`, history, modes, repaint and the browser protocol stay as they are.
- Reattach on server boot, lease and handoff adoption, and orphan cleanup.
- Launch placement that escapes the service cgroup, and a lifetime that ends with the last shell.

## Decisions

- **D1 — Placement.** Recommended: on Linux with systemd as PID 1 and a reachable user bus, launch
  the host with `systemd-run --user --scope --collect --unit=platform-pty-<id>`, as orca does. Else
  (macOS, the Mac reached over SSH, containers) spawn it `detached` in its own session, which
  survives a server exit but not a unit-wide kill. The host reports its actual cgroup from
  `/proc/self/cgroup` in its health reply, so the difference is visible rather than assumed.
- **D2 — Lifetime (owner).** Recommended: the host lives while it has a live shell, then exits after
  a 30 s grace with no sessions and no client. A server restart never ends a host. Quitting the
  desktop app does: `apps/desktop` sends an explicit `shutdown`, matching VS Code, where terminals
  survive a reload but not a quit. The alternative is terminals that also survive quitting the
  desktop app, which is what the mesh gets anyway.
- **D3 — One host per state root.** Dev, mesh prod, the desktop app and each isolated verification
  server get their own host, keyed by a hash of the state root (Plan 146's `PLATFORM_HOME`). Socket:
  `$XDG_RUNTIME_DIR/platform-pty/<hash>/v<N>.sock` in a `0700` directory, falling back to the
  state root on macOS. A `0600` token file in the state root is sent in `hello`; a server with the
  wrong token is refused. Same UID means the file modes are the security boundary; the token stops
  dev from attaching to prod's shells by accident.
- **D4 — Protocol and upgrades.** Recommended: a frozen core. Controls are JSON lines: `hello`
  (version, token, capabilities), `spawn`, `attach` (key, from-offset), `resize`, `signal`, `kill`,
  `list`, `shutdown`; events `spawned`, `exited`, `gap`. Data is binary frames
  `[type u8][session u32][offset u64][bytes]`, input the same without the offset. Additions are
  capabilities negotiated in `hello`, not version bumps. When a breaking change is unavoidable,
  the server speaks N and N-1; a host older than that is left running, its sessions are listed
  read-only from a `sessions.json` manifest the host keeps beside its socket (key, pid, started
  at), and the panel offers "Restart terminal", which kills by pid and spawns on the new host.
  Host code changes that keep the protocol do not restart a live host: it upgrades when it next
  exits. `/release` reports the host's build and protocol so a stale host is visible.
- **D5 — Where bytes live.** The host's ring (1 MiB per session, byte offsets that only grow) covers
  the server's absence. The server stays the only SQLite writer and records the last offset it
  persisted per session. On attach it asks for bytes from that offset; if the ring has already
  dropped them, the host sends `gap` and the panel shows one "output lost while the server was
  down" line. SQLite remains the cold fallback when the host itself is gone (reboot, crash).
- **D6 — Lease adoption.** Add a `terminal.lease.adopt` command that moves a lease to the new
  `runtimeEpoch`. At boot, `recover()` asks the host for `list` first: a lease whose session is
  alive is adopted, one whose session exited is ended, and only an unreachable host yields
  `ownership-unknown`, as today. Agent handoffs in `active` are adopted the same way instead of
  `restoreTerminalOwnership(…, 'unknown')`. Allow `end` from `ownership-unknown` once the host
  proves the process is gone, which also clears the undeletable-worktree state above.
- **D7 — Shutdown detaches.** `TerminalService.dispose()` becomes detach-all. The user's `kill`,
  `dispose`, `restart` and worktree removal still end a shell, now through the host's `kill`.

## Phases

### Phase 1: Host and client `Pty`

1. `apps/server/src/terminal-host/`: `main.ts` (the entry), `session.ts` (one `spawnPty` plus its
   ring), `protocol.ts` (frame codec, JSON controls, valibot schemas shared with the client). A
   second build entry emits `dist/pty-host.js`; `release.ts` checks it like `index.js`.
2. `terminal/host-client.ts`: connects, sends `hello`, and implements `Pty` over the socket.
   `pid` is the real shell pid, so `terminal/foreground.ts` keeps reading `/proc` on the server.
3. `TerminalService` gets the host factory by default; tests keep injecting `spawnPty` directly.
4. Errors through a `defineErrorCatalog` entry (`terminal.HOST_UNREACHABLE`,
   `terminal.HOST_PROTOCOL`), with the observed and expected versions in `internal`.

### Phase 2: Reattach and adoption

1. On boot the server lists host sessions, rebuilds a `TerminalSession` per live key without
   spawning, and fills history from its last persisted offset (D5).
2. `terminal.lease.adopt` in contracts, decider and projection; `recover()` and
   `recoverTerminalHistory` per D6.
3. `dispose()` detaches (D7). Orphans: a host session whose key has no lease, or whose worktree is
   gone from the read model, is killed and logged once.

### Phase 3: Placement and lifetime

1. Launcher per D1 with a capability probe (`/run/systemd/system`, user bus, `systemd-run
--version`) and the direct fallback. A pid-file identity check before adopting a socket.
2. Idle exit and the desktop `shutdown` per D2. The desktop's Plan 132 lease file records the host
   so a desktop relaunch can find it.
3. One wide event per host launch, adopt, attach and orphan kill: key count, cgroup, protocol,
   bytes replayed, gap size. No command lines or output in logs.

## Verification

- Node project under `--bun`: spawn a real host in a temp state root, start `sh -c 'while :; do
date; sleep 0.2; done'`, drop the client, reconnect, and assert the offsets are contiguous and
  the pid is unchanged. A second test fills the ring past 1 MiB while detached and asserts one
  `gap`. A third sends the wrong token and asserts refusal.
- Decider tests: `adopt` from each lease state; `end` from `ownership-unknown` only with host proof.
- On the mesh: open a terminal running the loop above, run `bun run deploy --server`, then
  `bun run agent:browser look` on the terminal and read the screenshot back: the loop is still
  counting and the gap line is absent. `systemctl --user status` shows the host in its own scope.
- Dev: touch a server file under `bun --watch` and confirm the terminal survives the reload.
- `bun run logs` shows the adopt event with the session count; name the evidence directory.
- The macOS fallback is exercised on the owner's Mac; say so if it was not.

## Out of scope and not copied

- Moving the provider adapters or SDK-driven agent CLIs into the host. `ProviderProcessLifetime`
  (`provider/adapters/process-lifetime.ts`) and restart survival for agent turns stay with Plan 148.
  Agent CLIs launched in a terminal do survive through this plan.
- Plan 076's zombie `node`/`sh` children from other spawn sites across `--watch` reloads. This plan
  only removes terminals from what a reload can lose.
- Plan 132 Phase 3 (TUI job control, the repaint resize hack at `service.ts` `repaint()`); both
  stay in the server-side `TerminalSession`. The browser-facing terminal protocol does not change.
- Headless-emulator serialization on reattach (VS Code, orca). Byte replay from an offset is enough
  while the server is the only renderer-facing writer.
- Fd handoff between hosts (herdr), and remote terminals on other machines beyond the D1 fallback.
