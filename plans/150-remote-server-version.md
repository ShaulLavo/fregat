# Plan 150: Remote machines run a server that matches

## Status and authorization

- Status: PROPOSED — Phase 1 ready; D2 needs the owner.
- Priority: P1 while the Mac is a daily machine. It is blocked today.
- Effort: S (Phase 1) + M (Phase 2).
- Risk: MED. Phase 2 runs commands on another machine's checkout.
- Planned at: Platform `bf806401`, 2026-09-25. Origin: the 2026-09-25 daily-driver blocker review.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Server changes deploy with `bun run deploy --server`.

## Outcome

Connecting to a remote machine either reaches a server that speaks this client's protocol, or
says exactly why not and offers the one action that fixes it. A stale server never sits behind a
bare "Could not connect".

## Today's manual fix

The Mac (`shaul-mac`, SSH alias `mac`) reports protocol 6; this client needs 7. On the Mac:

```bash
cd /Users/shaul/projects/platform-verification && git pull --ff-only && bun install
```

Then stop the managed server (its pid is in `.platform-ssh-launch/*.process` in that checkout) and
press Retry on the machine notice. The launcher starts a fresh server from the updated source.

## What exists today

- The protocol is `ORCHESTRATION_WS_PROTOCOL_VERSION = 7`
  (`packages/contracts/src/orchestration-ws.ts:33`), bumped to 7 in `2acc3b73` on 2026-09-20. The
  health descriptor carries `protocolVersion` and `serverVersion` (`packages/contracts/src/health.ts:9-10`).
- Remote installation is a source checkout. `bun run server:install` (`package.json:44`,
  `scripts/install-server.ts`) writes `~/.local/bin/platform-server`, which `exec`s
  `apps/server/src/index.ts` from that checkout (`apps/server/src/installation/install.ts:40-57`).
  The descriptor is only `{ kind: 'source', directory, executable }`
  (`apps/server/src/installation/descriptor.ts:9-13`): no commit, no protocol.
  `docs/federated-environments.md:34-57` and `:190` document it and name the Mac checkout.
- Nothing updates a remote checkout. Pulling it does not restart a running server either.
- The launch script reuses whatever is healthy, without checking the protocol:
  `reuse()` (`apps/server/src/machines/remote-scripts.ts:154-174`), `sharedManagedServer()`
  (`:211-223`) and the external `remotePort` path (`:179-183`) all `emit` any descriptor that
  parses.
- The server-side launcher checks identity, not protocol: `establish` goes probe → launch →
  forward → readiness → identity (`apps/server/src/machines/launcher.ts:188-244`, identity at
  `:247-255`). The catalog has no protocol entry (`apps/server/src/machines/structured-errors.ts:4-73`).
- The only check is in the browser: `assertEnvironmentProtocol` in `recordHandshake` and
  `recordDescriptor` (`packages/client-core/src/environments/state/store.ts:124,162`) throws
  `ENVIRONMENT_PROTOCOL_MISMATCH` (`packages/client-core/src/environments/utils/structured-errors.ts:3-16`).
  Its `fix` is generic: "Run matching client and server versions before reconnecting."
- How it surfaces: the connection lands in phase `blocked`
  (`apps/web/src/state/environment-connections.ts:305-315`) and recovery stops retrying
  (`apps/web/src/state/environment-recovery.ts:16-19`). The notice reads "Could not connect"
  (`apps/web/src/lib/environments/utils/connection-notice.ts:13`). `lastError` stores only the message
  (`errorMessage`, `apps/web/src/lib/error-message.ts:1-6`), so the `why` naming 6 vs 7 and the `fix`
  are lost before they reach the notice or the picker (`features/environments/components/picker-dialog.tsx:45`).
  The server does not see the failure, so it has no wide event on the launcher side. The
  production log carries 16 client lines for it on 2026-09-24/25.

## Scope

- Server-side protocol check during connect, with a catalog error that names both versions.
- Relaunch of a stale _managed_ server when the checkout on disk already matches.
- A notice and picker that show why and offer the fix.
- Phase 2: an explicit update action for the remote checkout.

## Decisions

- **D1 — Where to check.** Recommended: both ends of the SSH launch. The launch script receives
  the expected protocol in `config` and reads the checkout's own constant (it already imports
  `./packages/contracts/src/health.ts` from the checkout, `remote-scripts.ts:44`). The server-side
  launcher adds a `protocol` step after `readiness` and before `identity`. The browser assert stays
  as the last line for non-SSH origins.
- **D2 — How a checkout gets updated (owner).** Options:
  - (a) Pull the remote checkout to the commit this server runs. That fails often: production
    routinely runs uncommitted or unpushed work from the shared `main`, so the commit may not exist on
    `origin`.
  - (b) Ship the built server bundle over SSH, like a production release. The release's
    `server/node_modules` is a symlink to this machine's `apps/server/node_modules`: native
    packages, the PTY addon and language servers are linux-x64 and would not run on darwin-arm64. It
    would need a per-platform install on the remote, which makes it a packaged installer, the future
    `docs/federated-environments.md:54-57` defers.
  - (c) Recommended: an explicit "Update server" action on the machine notice. It runs
    `git pull --ff-only && bun install` in the installation directory, refuses a dirty checkout or
    a non-fast-forward, re-reads the checkout's protocol, then relaunches. It never runs on its own.
- **D3 — Other clients on a shared managed server.** Several leases can share one managed process
  (`hasOtherLease`, `remote-scripts.ts:109-116`). Recommended: relaunch a stale server only when no
  other lease holds it; otherwise fail with the catalog error and name the other lease count in
  `internal`.
- **D4 — External servers** (`remotePort` pointing at a server Platform did not start). Recommended:
  never restart; fail with the catalog error.

## Phases

### Phase 1: Check, relaunch, explain

1. Catalog entry `machines.SSH_PROTOCOL` in `machines/structured-errors.ts`, templated with both
   versions. Its `fix` is the exact command for this machine: `cd <directory> && git pull --ff-only
&& bun install`, then Retry. `internal`: expected, running, checkout protocol, record kind,
   other-lease count.
2. Launch script: pass `expectedProtocol` in `config`. In `reuse()` and `sharedManagedServer()`, a
   descriptor with the wrong protocol is stale:
   - if the checkout's constant matches and the server is managed with no other lease, stop it (the
     `stopScript` path) and fall through to a fresh launch;
   - otherwise fail with the checkout's protocol in the payload.
     The external path fails without restarting (D4).
3. Launcher: a `protocol` step between `readiness` and `identity` (`launcher.ts:231-240`) that throws
   the catalog error, so the wide event records it on the server side.
4. Web: keep the structured error on the machine state instead of flattening it at `errorMessage`
   in `environment-connections.ts`. The notice summary becomes "Server out of date"
   (`connection-notice.ts`), and `MachineErrorDetails` and the picker render `clientErrorDescription`
   (`apps/web/src/lib/client-error-taxonomy.ts:106`), so the fix is visible.

### Phase 2: Update action (after D2)

1. Server: an `update` remote command beside `probeCommand`/`launchCommand` in
   `remote-scripts.ts`. It is fixed text: only the probed `installation.directory` and
   `installation.executable`, already validated absolute paths and `shellQuote`d, reach execution.
   No setting value or client-supplied string reaches the command. The route takes a machine name,
   and the command runs only against the `application`-scope machine record.
2. It refuses a dirty tree (`git status --porcelain`) and a non-fast-forward, runs `bun install`,
   re-reads the protocol, and relaunches through the Phase 1 path. Each refusal is a catalog entry
   with a `fix`.
3. Web: an "Update server" button on the notice when the error is `machines.SSH_PROTOCOL`, as a
   TanStack mutation keyed in the environments feature's `mutation-keys.ts`. It invalidates the machine
   connection state on settle, and pending state comes from `useIsMutating`.
4. One wide event per update: machine, directory, from/to commit, install duration, outcome.

The Mac also runs `mesh`, which has its own update path. The update touches only the Platform
checkout named by the probe, never mesh or any other directory.

## Verification

- Server tests through the launcher's injectable `spawn`/`forward`/`fetcher` seams: stale managed
  plus matching checkout relaunches; stale plus old checkout fails with `SSH_PROTOCOL`; stale with
  a second lease fails without stopping; stale external fails without stopping.
- The remote scripts run under a real `bun -e` against a temp checkout fixture with a rewritten
  protocol constant, which the existing `apps/server/src/machines/tests` pattern supports.
- Web: a `dom` test that a `blocked` machine with `SSH_PROTOCOL` shows "Server out of date" and the fix.
- Live: connect `shaul-mac` before updating it. The notice shows 6 vs 7 and the command.
  After Phase 2, the button updates the checkout and the connection goes live. The CLI cannot reach
  the Mac (DNS fails from agent sandboxes), so this step is the owner's. Say so in the report.

## Out of scope and not copied

- A packaged, downloadable remote server (D2 option b) and automatic background updates.
- Version skew _within_ a protocol: `serverVersion` differences stay informational.
- The web-client/server skew on the primary origin; the release stamp already reports that.
