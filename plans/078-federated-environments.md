# Plan 078: Federated environments — machines, SSH launch, one rail across machines

> **Executor instructions:** Read this plan completely, then read `AGENTS.md`, root `PLAN.md`,
> `docs/environments-and-remote-plan.md`, and the never-nester skill. Plan 077 is complete. Execute only after Plan 068
> is complete and deleted from `plans/`; reconcile every owner named below from source. Keep
> the current worktree; do not create a branch, worktree, commit, push, or PR unless the operator
> asks. Preserve user-owned changes. Reuse the running dev server. Every verification that needs a
> second machine uses a second loopback server or the `localhost` SSH target; nothing in this plan
> binds off loopback on either end.

## Status

The desktop SSH ownership described in this original plan was superseded on 2026-09-09.
The primary backend now owns SSH launch, authentication, and HTTP/WebSocket forwarding for all
clients. See [the current implementation](../docs/federated-environments.md#backend-ssh-lifecycle).

- **State:** Implemented; automated checks pass, live SSH/browser gates open
- **Priority:** P1
- **Effort:** XL
- **Risk:** HIGH — the desktop shell spawns `ssh` and remote processes; the rail, persistence, and
  workbench root switch all change owners at once; a wrong storage scope reads as data loss.
- **Platform baseline:** `1325b003` (re-baseline after 068 lands)
- **Prepared:** 2026-09-05
- **Dependency:** Plan 077 is complete: stable environment identity, owned transports and query
  clients, retained editor runtimes, keyed active consumers, and one command bus. Complete and
  close Plan 068 before execution; it supplies environment-shaped projections, scoped refs, rail
  identity, and machine-independent repository identity. Re-verify the foundation after 068.
- **Known dirty baseline:** re-run `git status --short`; preserve every unrelated path.

Root `PLAN.md` is the sole execution-order authority.

## Execution reconciliation, 2026-09-05

Execution began at `1bd35400f653ab79376976eee0d65b45a9c0ff80` in the existing dirty worktree.
The concurrent TUI extraction moved environment/store and transport owners into
`packages/client-core/src/`; the web modules now adapt those owners. The implementation preserves
that extraction. Workbench, settings UI, and persistence remain web/application owned.

Current source ownership and the rerunnable automated gate are recorded in
[`docs/federated-environments.md`](../docs/federated-environments.md). Workspace cache version is
20 and projection cache version is 3. SSH machine aliases hold separate leases on a shared managed
process record. The final lease release stops that process. Desktop quit waits for cleanup, and
SSH recovery checks remote health even while a forward remains alive.

The implementation reference records automated verification results. Regression coverage includes
shutdown cancellation, remote crashes, alias ownership across restarts, command settings ownership,
disconnected-machine edits, and Git commits that finish after a machine switch.

Live verification remains open: `localhost` has no trusted SSH host key, and no Platform dev
server was listening during inspection. Do not delete this plan until those gates pass.

## Drift-check preamble — this is the audit

Run before editing:

```sh
git rev-parse HEAD
git status --short
test ! -f plans/077-environment-runtime-origin.md && test ! -f plans/068-session-domain-model.md
rg -n "activeServerOrigin|environmentClientFor|createEnvironmentClient" apps/web/src/lib/client.ts
rg -n "activeOrigin|recordHandshake|recordDescriptor" apps/web/src/lib/environments/state/store.ts
rg -n "queryClientFor|clientForQueryClient|originForQueryClient" apps/web/src/lib/environments/state/query-clients.ts
rg -n "activateEnvironment|commandBinding|hasUnsavedDocuments" apps/web/src/state/application-runtime.ts
rg -n "key=|runtime=" apps/web/src/components/active-environment-application.tsx
rg -n "captureRuntime|binding.capture" apps/web/src/keymap/state/command-bus.ts apps/web/src/keymap/providers/bus-provider.tsx
rg -n "slices|dropEnvironment" apps/web/src/features/chat/state/chat-projection-store.ts
rg -n "scopedProjectKey|ScopedSessionRef" packages/contracts/src/chat-ids.ts
rg -n "machineLabel|projectGroupKey" apps/web/src/features/chat-mode/utils/session-rail-model.ts
rg -n "@<environmentId>|environment" apps/web/src/features/address/utils/grammar.ts
rg -n "devSwitchOrigin" apps/web/src
rg -n "pickEntry" apps/desktop/src/shared/rpc.ts apps/desktop/src/bun/index.ts
rg -n "'environments\." packages/contracts/src/settings/keys.ts
rg -n "WORKSPACE_CACHE_STORAGE_PREFIX|CHAT_PROJECTION_CACHE_STORAGE_KEY" apps/web/src -l
```

Expected: the plan-file check confirms dependency closeout. The client, runtime, command, and
domain searches find their owners. `devSwitchOrigin` exists for this plan to remove. The desktop
RPC has `pickEntry`, no `environments.*` setting exists, and the storage prefixes belong to
`apps/web/src/lib/workspace-cache-storage.ts` and
`apps/web/src/features/chat/state/chat-projection-cache.ts`. Reconcile drift before implementation.

### Plan 077 foundation and source anchors (re-verify after 068)

- `apps/web/src/lib/environments/state/store.ts` owns `useEnvironmentsStore`: `activeOrigin`,
  origin-keyed entries, learned `environmentId`, and descriptor/handshake identity checks. Its
  `activate(origin)` publishes metadata after updating the active HTTP origin. Product switches
  go through `ApplicationRuntime.activateEnvironment(origin)` to coordinate runtime lifetimes.
- `apps/web/src/lib/environments/state/query-clients.ts` owns `queryClientFor(origin)`,
  `clientForQueryClient`, and `originForQueryClient`. Each QueryClient has immutable HTTP ownership.
  Query functions use their execution context's client; pending mutations and saves keep that owner.
- `apps/web/src/state/application-runtime.ts` retains editor runtimes and query clients across
  switches. `features/editor/state/runtime.ts` owns documents, workspace state, save services, and
  file-open services. Suspension stops active work while retaining documents and unsaved text.
- `apps/web/src/components/active-environment-application.tsx` keys its query consumer subtree by
  origin and passes `runtime={active.editor}` to `EditorStateProvider`. Changing only the
  QueryClientProvider value leaves existing observers attached to their old query cache.
- `apps/web/src/main.tsx` places one `CommandBusProvider` outside that key. The provider calls
  `createCommandBus` with `captureRuntime: binding.capture`; `keymap/state/runtime-binding.ts`
  supplies `capture`, `bind`, and `clear`. A command retains its captured runtime through awaits.
- `features/chat/providers/transport-provider.tsx` creates one active-origin transport through
  `features/chat/transport/create-chat-transport.ts`. Plan 077 closes it on a workbench switch.
  This plan extends chat connection lifetimes while retaining the editor and command lifetimes.

- Per-environment localStorage owners: `apps/web/src/lib/workspace-cache-storage.ts:5-24` (prefix and
  key builder used by `apps/web/src/features/workspace/state/cache.ts:51-80,285-350`),
  `apps/web/src/features/chat/state/chat-projection-cache.ts:25,55-90`,
  `apps/web/src/features/chat/utils/draft-storage.ts`,
  `apps/web/src/features/chat/utils/changed-files-expansion-storage.ts`,
  `apps/web/src/features/chat/utils/session-diff-scope-storage.ts`,
  `apps/web/src/features/chat/state/prompt-stash-store.ts`,
  `apps/web/src/features/chat-mode/utils/session-read-storage.ts`,
  `apps/web/src/features/chat-mode/utils/rail-collapse-storage.ts`. Global chrome owners that stay
  unscoped: `apps/web/src/features/editor/state/color-theme-store.ts`,
  `apps/web/src/features/command-palette/state/recent-commands-store.ts`,
  `apps/web/src/features/address/state/storage.ts:13`, `uiMode`/`workbenchLayout`/`chatModePanels`
  entries in `workspace/state/cache.ts:293-301`.
- `workspace/state/cache.ts:617-625` sweeps `localStorage` by prefix; the scoped adapter must keep
  that sweep inside the current environment's namespace.
- `apps/web/src/features/workspace/hooks/use-open-root.ts` returns the root-open action. It captures
  its QueryClient's client and activity signal before calling `openWorkspaceRootPath`, then updates
  its own editor workspace. Plan 068 adds scoped checkout selection. An action captured on A stays
  owned by A after activation of B.
- "Add project" reaches the folder picker through
  `apps/web/src/features/chat-mode/providers/session-controller.tsx` and
  `apps/web/src/components/file-picker-dialog.tsx`. Picker queries and mutations already use their
  QueryClient owner; `filePickerKeys` remain local to that query cache.
- The rail scope menu is `apps/web/src/features/chat-mode/components/session-scope-menu.tsx`; the
  titlebar project menu is `apps/web/src/components/workspace-project-menu.tsx:26`; palette groups
  are built by factories under `apps/web/src/features/command-palette/*-groups.tsx`.
- The desktop shell exposes one RPC request (`pickEntry`) from the web view to the Bun process
  (`apps/desktop/src/shared/rpc.ts`, `apps/desktop/src/bun/index.ts:132`) and spawns the local server
  with `FS_HOST`, `PORT`, `SERVER_ALLOWED_ORIGINS` (`index.ts:96-108`). `isDesktop()` gates
  desktop-only chrome in the web app.
- The server honours `SERVER_ALLOWED_ORIGINS` (`apps/server/src/index.ts:23,113`) and refuses
  non-loopback binds (`:27,130`). A forwarded port is loopback on both ends, so neither changes.
- Settings widgets are a closed union (`packages/contracts/src/settings/registry.ts:35-53`) with
  custom sections for `providers` and `models`; `docs/settings-reference.md` is regenerated with
  `bun run settings:reference`.
- The chat shell supervisor's phases and retry ladder live in
  `apps/web/src/features/chat/hooks/use-chat-shell-subscription.ts` and
  `apps/web/src/features/chat/utils/stream-reconnect.ts`. Recovery is owned by each transport.
- `apps/web/src/features/workbench/utils/wallpaper-query.ts` resolves `/wallpaper` from
  `originForQueryClient(context.client)`. Attachment URLs in
  `apps/web/src/features/chat/utils/attachment-image.ts` still use the active origin; this plan
  passes the owning session's environment when multiple transcripts coexist.
- t3code's SSH launcher (`references/t3code/packages/ssh/src/tunnel.ts:711-940`,
  `references/t3code/apps/desktop/src/ssh/DesktopSshEnvironment.ts`) is the shape we port: probe,
  pick a remote port, launch or reuse, forward, wait for readiness, record. We drop its install
  step, its Node version-manager probing, its pairing token, and its askpass prompts.

## Outcome

After this plan:

1. A user lists machines in Settings → Machines: an SSH target with automatic server discovery, or a
   direct `https://`/loopback origin. The local machine is implicit.
2. Connecting an SSH machine from the desktop app starts or reuses the platform server on that
   machine, forwards its loopback port to a local loopback port, and records its `environmentId`.
   Disconnecting closes the forward and stops a server the launcher started.
3. Every connected machine has a live chat connection. The rail is one flat list across machines:
   the same repository on two machines is one group with machine-labelled worktrees, session rows
   carry a machine chip when it matters, and a machine filter sits beside the project scope.
4. "Add project" asks which machine and opens that machine's picker.
5. Opening a project or session on another machine activates that machine's retained editor runtime
   and query consumers. Its root, tabs, and selection return without losing another machine's
   unsaved files. Files, terminal, LSP, Git, and search use the target owner.
6. Per-environment browser state is namespaced; two machines with the same repo path never share a
   tab list, a tree cache, or a draft.
7. An unreachable machine is visible per machine, never a global modal; its workbench surfaces are
   honestly stale or dead; every machine recovers automatically.

Not in this plan: direct `https://` origins beyond accepting the URL (the mesh proxy spike is
scheduled separately), pairing or sessions, remote server install, password or askpass prompts,
web (non-desktop) SSH, cross-machine worktree creation (Plan 069 stays single-machine).

## Locked design

### Machines setting

- Register `environments.machines` in `packages/contracts/src/settings/keys.ts`:

  ```ts
  schema: v.record(machineNameSchema, v.variant('kind', [
    v.object({ kind: v.literal('ssh'), target: sshTargetSchema,
               remotePort: v.optional(portSchema), label: v.optional(labelSchema) }),
    v.object({ kind: v.literal('origin'), url: originSchema, label: v.optional(labelSchema) }),
  ]))
  default: {}
  scope: 'machine'      // an SSH target is executed by this machine's launcher; never 'window'
  widget: 'machines'    // new custom section, like 'providers'
  merge: 'record'
  category: 'Machines'
  ```

  `originSchema` accepts `https://` anything or `http://` loopback only; the registry refuses the
  rest with the real reason ("plain http off loopback is refused; use an SSH machine or https").
  `machineNameSchema` is the record key: short, lowercase, `[a-z0-9-]`, used in labels and logs.

- Application orchestration derives entries from this setting and publishes metadata through
  `apps/web/src/lib/environments/state/store.ts`. `EnvironmentEntry` lives in
  `lib/environments/utils/connection.ts`. Keep settings and desktop orchestration above `lib/`;
  the shared metadata store must not import feature modules. Delete
  `environment.devSwitchOrigin` and `features/environments/components/dev-origin-dialog.tsx`.
- Global Machines settings use the primary environment's QueryClient from `queryClientFor`. Bind
  other global settings consumers to that owner explicitly. Preserve each editor runtime's existing
  settings document, intent queue, and save-service owner. Never re-register an existing QueryClient
  with another client. Each server reads its execution settings from its own file.

### Environment entries and connection lifecycle

- Extend `EnvironmentEntry` in `lib/environments/utils/connection.ts` with
  `kind: 'primary' | 'ssh' | 'origin'`, `name`, `label`, and for SSH the
  runtime `localPort`. Connection state per environment is
  `idle | launching | connecting | live | reconnecting | offline | blocked | identity-drift`, with
  `lastError`, `lastErrorAt`, `connectedAt`, and the `/health` descriptor once known.
- A machine connects on explicit user action (Machines page, palette, rail header) and stays
  connected until disconnected or the app closes. On launch, machines that were connected when the
  app last closed reconnect automatically; that list is ephemeral state persisted under the global
  chrome namespace as `platform.environments.connected.v1` (names only, no secrets; this is the one
  new localStorage key and it holds nothing a setting should).
- Add `apps/web/src/state/environment-recovery.ts` beside `application-runtime.ts`. It coordinates
  `online`, window focus, and each transport's retry ladder, and retries non-primary environments
  through the same path as the primary. Connection metadata stays in `lib/environments/state/store.ts`.
- Key connected domain ownership by confirmed `EnvironmentId`, using Plan 068's scoped refs. Origin
  is an endpoint and can change when a forward is recreated. Do not infer identity from an origin
  or a checkout path, and do not create a second environment for an alias of the same identity.
  Endpoint replacement must preserve retained editor ownership and immutable QueryClient clients.
- SSH machines are desktop-only. In a plain browser the Machines page shows SSH entries as
  "desktop only" and offers connect only for `origin` entries.

### SSH launcher (desktop shell)

- New `apps/desktop/src/bun/ssh/` owning `launcher.ts` (orchestration), `remote-scripts.ts` (pure
  string builders with placeholders, tested), and `forward.ts` (the `ssh -N -L` child and its
  lifecycle). Desktop RPC gains `connectMachine(name)`, `disconnectMachine(name)`, and a
  `machineState` message the Bun process pushes on every transition; the web view never spawns
  anything.
- Steps, each logged as fields on one wide `desktop.ssh.connect` event with `machine`, `target`,
  `step`, `durationMs`, `outcome`:
  1. **Discover** `platform-server --describe` on the remote PATH, falling back to
     `~/.local/bin/platform-server`. Install that launcher once with `bun run server:install`
     from a prepared checkout. The validated descriptor supplies the directory and Bun executable.
     Current authentication uses the backend's shared SSH control connection and askpass flow.
  2. **Reuse or launch.** `curl`-free readiness on the remote: run a small Bun script from
     `remote-scripts.ts` that reads `<installation.directory>/.platform-ssh-launch/<clientId>.json` (remote pid,
     port, environmentId), checks `/health` on remote loopback, and prints it; else picks a free
     loopback port, writes the record, and starts
     `nohup bun --env-file=.env apps/server/src/index.ts` with `FS_HOST=127.0.0.1`, `PORT`,
     `SERVER_ALLOWED_ORIGINS=<the client's web origin>`, `FS_METADATA_DB` left default, stdout and
     stderr appended to `<installation.directory>/logs/ssh-launch.log`. The remote record is keyed by the
     connecting client's instance so two laptops get two records.
  3. **Forward** `ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:<local>:127.0.0.1:<remote>
<target>`; the local port is picked from an ephemeral range and verified free with
     `isPortAvailable` (`scripts/runtime-network.ts:32`).
  4. **Readiness** waits on `http://127.0.0.1:<local>/health` with a bounded timeout and records the
     descriptor. Application orchestration passes it to `recordDescriptor(origin, descriptor)`
     before registering the confirmed environment and connecting chat.
  5. **Identity**: the `environmentId` from `/health` is compared against the entry's recorded id
     when present; drift is surfaced, not healed.
- Disconnect kills the forward child; if the launcher started the remote server (record says
  `managed`), it stops it through `ssh <target> kill <pid>` and removes the record; an `external`
  server is left running. App exit disconnects every machine the same way.
- Mesh hosts need nothing special: `Host *.mesh.shaulavo.dev` in `~/.ssh/config` with port 2222 and
  the identity file makes `pc.mesh.shaulavo.dev` a plain target. The launcher runs `ssh` from
  `PATH` and never reads or writes SSH configuration.

### Scoped persistence

- Add `apps/web/src/lib/environments/state/scoped-storage.ts`: `environmentScopedStorage(environmentId)`
  returning `{ getItem, setItem, removeItem, keys(prefix) }` over `localStorage` with the prefix
  `env:${environmentId}|`. Every per-environment owner listed in the source anchors takes a
  `ScopedStorage` argument instead of touching `localStorage`; `workspace-cache-storage.ts`'s key
  builder gains the environment segment so the workspace slices, search buffers, root folder,
  workspace index, and session selection move in one edit; the sweep in `workspace/state/cache.ts`
  iterates `keys(prefix)` of the current namespace only.
- Inject the environment's storage adapter when its retained runtime is first created. Reusing a
  runtime keeps its stores and adapter; activation must not reseed live documents from persistence.
  A confirmed `environmentId`, rather than a forwarding origin, selects the namespace.
- Within that namespace, checkout-owned state retains `worktreeId`. A checkout's browser identity
  is `(environmentId, worktreeId)`, including Git's main checkout. Keep tabs, unsaved buffers, Git
  commit drafts, and pending operations with that owner rather than the logical project group.
  Matching absolute paths on two machines must not share a buffer or a save destination. This
  ownership requirement does not add persistence of unsaved text.
- Chat projection cache: one entry per environment under its namespace; cold boot paints every
  machine that was connected at close from its own cache, marked stale until its socket is live.
- No migration. Bump the workspace cache version and the chat projection cache version once; the
  developer clears site data once. Ship no healing code.

### Rail across machines

- The rail model from 068 already emits `environmentId`, `machineLabel`, and `projectGroupKey`.
  This plan adds: `machineFilter: EnvironmentId | null` (in `session-scope-menu.tsx`, beside the
  project scope, listing connected machines with their phase dot), a machine chip on session rows
  and on worktree labels inside a project group rendered from `machineLabel`, and a connection row
  per non-live machine at the top of the rail (phase, last error, retry-now) styled with
  `warning`/`destructive` tokens. Loading is `OrbitLoader` beside the machine label; an offline
  machine's cached rows stay visible and are marked stale, never hidden.
- "Add project" (`stage-empty-state.tsx`, `session-rail.tsx`, `workspace-project-menu.tsx`): with
  one environment it behaves as today; with several it first shows a machine picker (a small menu
  from `@workspace/ui`), then opens `FilePickerDialog` bound to that machine's client. The dialog
  mounts under the selected machine's QueryClient owner with a key for that environment. Keep its
  existing query and mutation ownership through `clientForQueryClient`; a client prop alone cannot
  move mounted query observers. Registration dispatches through that machine's `ChatTransport`.
- Palette: `use-command-palette-sessions.ts` folds every slice; rows show the machine chip through
  the existing `scope-chip.tsx` pattern.
- `projectGroupKey` groups the same logical project across machines. Its checkouts keep separate
  files, staged changes, and Git UI state. The main checkout uses the same Worktree representation
  as linked worktrees, with its removal protection preserved.

### Switching the workbench

- Extend `state/application-runtime.ts` to resolve a confirmed `EnvironmentId` to its retained
  runtime and current endpoint. Scoped selection activates that runtime before invoking its root-open
  action and publishing selection. Do not call a hook captured on A to open a path on B.
- Preserve `activateEnvironment`'s editor suspension and activity cancellation. Remove only its
  workbench-switch teardown of chat transports when the new federation owner controls them.
  Returning to an environment reuses its document stores and save services. Load its storage
  namespace only when constructing a fresh runtime.
- Keep the keyed active query-consumer subtree in `ActiveEnvironmentApplication`. Supply its retained
  editor runtime through `EditorStateProvider`; never implement a provider-value-only swap or reset
  dirty buffers to force observers onto another cache.
- Keep one `CommandBusProvider` above that subtree. Activation clears `application.commandBinding`
  until the target controller binds; `captureRuntime: binding.capture` gives each invocation one
  runtime. A running command retains its scoped checkout and client through completion.
- Terminal and LSP connections use captured client and activity owners from
  `lib/server-sockets.ts`. Stop the old environment's local subscriptions on switch; retain its
  server PTYs. The target runtime resumes the connections for its open documents.
- Editor tabs, diff documents, and search buffers belong to the retained runtime and checkout.
  Paths keep their server-local meaning under that owner.
- Resolve checkout links through `ScopedWorktreeRef`, then the owning environment's Worktree path.
  Every Git query and mutation captures that checkout and client before async work. A workbench
  switch must not redirect an in-flight stage, commit, or save to another checkout. Preserve unsaved
  buffers with their owner when switching either machine or worktree.
- Git status and diff cache keys, mutation state, and invalidation targets retain the checkout
  owner. The shared `projectGroupKey` never substitutes for `ScopedWorktreeRef` in those operations.
- The titlebar project menu shows the active machine's label and phase dot; palette commands
  `environment.switch` (pick a connected machine, switch to its last root), `environment.connect`,
  `environment.disconnect`, `environment.openMachines`. All go through the typed command bus.

### Honest failure per machine

- Tree and git panels: paint the environment's cached slice with a stale marker (existing
  `EmptyState`/`LoadingState` are not used for this; a thin `warning` banner in the pane header).
- Terminal: a "machine unreachable" banner replaces the surface; no spinner.
- Editor: buffers stay readable; save is refused with a structured error whose `fix` names the
  machine; the tab shows the read-only affordance.
- Chat: the per-transport reconnecting phase from 077, surfaced per machine in the rail.
- Wallpaper: a remote workbench environment falls back to the bundled wallpaper; the remote
  machine's desktop image is never fetched.
- Attachment images: `attachment-image.ts` takes the owning session's environment origin (from the
  slice), closing the 077 tripwire.

### Logging

- Every client wide event carries `environmentId` (077) and now `machine` (name) when known.
- Capture those fields from the operation's owner before asynchronous work. The 077 fallback uses
  the active environment at emission time, so a late A completion can be labeled B after a switch.
  Verify that delayed work and inactive-environment queries retain A's attribution.
- The client log drain stays on the primary environment's server: it is the `logs/` a developer
  greps on the machine they sit at. Remote servers log to their own `logs/`.
- Desktop SSH steps are one wide event per connect/disconnect, enriched per step; remote launcher
  stdout is appended to the remote log file, never streamed into ours.

## Scope

### In scope

- `environments.machines` setting, Machines settings section, reference regeneration.
- Desktop SSH launcher, forward, reuse, stop, RPC surface, connected-machines persistence.
- N chat connections, recovery coordinator, per-machine phases.
- Scoped persistence adapter and the move of every per-environment key.
- Rail machine chips, machine filter, connection rows, add-project-on-machine, palette rows.
- Workbench switch with environment, titlebar chip, palette commands.
- Offline surfaces, wallpaper fallback, attachment origin.
- Tests for each of the above; two-server and `localhost` SSH gates.

### Out of scope

- Any non-loopback bind on either machine; TLS; pairing; sessions; revocation.
- Installing Bun or the repository on a remote machine; password prompts; SSH agent management.
- The mesh https proxy spike (WebSocket through the proxy, path prefix). Accepting an `https://`
  origin entry is in scope; proving it works through mesh is a separate scheduled check.
- Cross-machine worktree creation or comparison; Plan 069 remains single-machine.
- The project-wide Git overview of the main checkout and other local or remote worktrees. This is
  a separate, unscheduled feature. Collapsible sections, tabs, and grouping by machine remain open;
  this plan provides connection and ownership rules, not that layout.
- A user setting for reconnect cadence or retry limits.

## Git and state policy

- Work in the existing worktree; preserve unrelated changes.
- Bump both cache versions once; no migration, no healing.
- Production errors through each feature's `structured-errors.ts`; `desktop` gains
  `apps/desktop/src/bun/structured-errors.ts` entries for probe, launch, forward, readiness, stop.
- No new localStorage key other than `platform.environments.connected.v1`; no env var; no constant
  a user would need to recompile to change.

## Phase 1 — Machines setting, store, and Machines page

### Work

1. Register `environments.machines`; add `'machines'` to `SettingWidget`; build the custom section
   under `apps/web/src/features/settings/components/machines-section.tsx` and `machine-row.tsx`
   (one component per file): name, kind, target or URL, repo path, label, phase dot, last error,
   connect/disconnect/remove, and the root-shell statement copied from the strategy doc §4.
2. Derive `EnvironmentEntry` records in application orchestration and publish them through
   `lib/environments/state/store.ts`; delete `environment.devSwitchOrigin` and `dev-origin-dialog.tsx`.
3. Bind global Machines settings to the primary QueryClient. Preserve runtime-owned settings writes.
4. `bun run settings:reference`.

### Verify

```sh
cd packages/contracts && bun run test -- src/tests/settings-registry.test.ts && bun run typecheck && cd ../..
cd apps/web
bun --bun vitest run --project node --project dom \
  src/lib/environments/tests/store.test.ts \
  src/features/settings/components/tests/machines-section.test.tsx
bun run typecheck
if rg -n "devSwitchOrigin|dev-origin-dialog" src; then exit 1; fi
```

Expected: an `http://10.0.0.5:3001` origin entry is refused with the stated reason; an
`https://pc.mesh.example/platform` entry and an `http://127.0.0.1:3002` entry are accepted; the
store derives one entry per machine and the primary is not listed.

## Phase 2 — Desktop SSH launcher

### Work

1. `apps/desktop/src/bun/ssh/remote-scripts.ts`: pure builders for the probe command, the
   reuse-or-launch Bun script, and the stop script, with placeholder substitution tests; the launch
   script writes the record file atomically and prints one JSON line.
2. `apps/desktop/src/bun/ssh/forward.ts`: spawn, readiness, kill, exit observation.
3. `apps/desktop/src/bun/ssh/launcher.ts`: the five steps, wide-event logging, managed/external
   distinction, app-exit cleanup.
4. Extend `apps/desktop/src/shared/rpc.ts` and the `defineRPC` block in `apps/desktop/src/bun/index.ts`;
   the preload exposes `connectMachine`/`disconnectMachine` and the `machineState` message on
   `PlatformBridge`.
5. Web: application orchestration calls the bridge for SSH entries and passes the successful
   `http://127.0.0.1:<localPort>` descriptor to the shared metadata store.

### Verify

```sh
cd apps/desktop && bun --bun vitest run src/bun/ssh/tests/remote-scripts.test.ts src/bun/ssh/tests/launcher.test.ts && bun run typecheck && cd ../..
```

`launcher.test.ts` injects a fake `ssh` spawner (a script that answers the probe, prints a fixed
record, and holds a forward open) and asserts step order, the managed/external decision, the
forwarded origin, and that disconnect stops only a managed server. Then, by hand: add a machine
with target `localhost` after running `bun run server:install` in this checkout. Connect from
the app and confirm that readiness answers through the forward without entering a checkout path.
The same SQLite identity database must report the same `environmentId` through both endpoints.
Use a separate fixture checkout and identity database to prove two distinct environments; a new
port or server process alone does not create one. Verify that disconnect stops only a managed
process. Record identities, pids, and ports in the plan closeout.

## Phase 3 — Many connections and scoped persistence

### Work

1. Add an application-owned environment transport registry with one `ChatTransport` per confirmed
   environment. Build connections with `features/chat/transport/create-chat-transport.ts`. Replace
   the active-only lifetime in `features/chat/providers/transport-provider.tsx`; callers of
   `useChatTransport` resolve `transportFor(environmentId)` from their scoped selection.
2. Add `providers/environment-transports-provider.tsx` above `ActiveEnvironmentApplication` so
   workbench remounts cannot close federation. Run one shell subscription with its owning QueryClient
   per environment. Preserve the single outer command bus and retained editor runtime registry.
3. Add `state/environment-recovery.ts`; publish per-machine phases through the shared metadata store.
4. Add `lib/environments/state/scoped-storage.ts` and inject adapters into newly constructed runtime
   and chat-cache owners. Move every per-environment key and bump both cache versions. Reused editor
   runtimes keep their documents and pending saves; cold boot paints each machine from its own cache.
5. Persist `platform.environments.connected.v1` under global chrome.

### Verify

```sh
cd apps/web
bun --bun vitest run --project node --project dom \
  src/state/tests/environment-connections.test.tsx \
  src/state/tests/environment-recovery.test.tsx \
  src/lib/environments/tests/scoped-storage.test.tsx \
  src/features/workspace/state/tests/cache.test.ts \
  src/features/chat/state/tests/chat-projection-cache.test.ts
bun run typecheck
```

Expected: two in-process servers produce two live slices; killing one server moves only that
machine to `reconnecting` and the other keeps dispatching; a root folder saved under machine A's
namespace is invisible under B's; the sweep never touches another namespace.

## Phase 4 — Rail, add project, switch, chrome

### Work

1. Machine filter in `session-scope-menu.tsx`; machine chips on session rows and worktree labels;
   connection rows at the rail top; palette rows with chips.
2. Add-project machine picker; mount its query consumers under the selected machine's keyed
   QueryClient owner.
3. Scoped root selection through `ApplicationRuntime.activateEnvironment` and the target root-open
   owner; titlebar machine label and dot; palette commands
   `environment.switch|connect|disconnect|openMachines` in `keymap/table.ts` with enablement in
   `keymap/`.
4. Offline surfaces: tree and git stale banner, terminal unreachable banner, editor read-only save
   refusal, wallpaper fallback, attachment origin.
5. `attachment-image.ts` tripwire closed; remove the 077 comment.

### Verify

```sh
cd apps/web
bun --bun vitest run --project node --project dom \
  src/features/chat-mode/utils/tests/session-rail-model.test.ts \
  src/features/chat-mode/components/tests/session-rail.test.tsx \
  src/features/chat-mode/components/tests/session-scope-menu.test.tsx \
  src/features/workspace/tests/use-open-root.test.tsx \
  src/components/tests/file-picker-dialog.test.tsx \
  src/features/command-palette/tests/session-groups.test.tsx
bun run typecheck && bun run lint
```

Expected: with two machines holding the same fixture repository the rail shows one project group
with two machine-labelled worktrees; the filter hides the other machine's sessions; picking a
session on B activates B's retained runtime and query consumers before selection is published.
An unsaved A buffer survives A → B → A. The picker for B lists B's temp root.

## Phase 5 — Two-machine vertical gate

### Work

Create `apps/web/src/features/environments/tests/federated.integration.test.tsx` on
`apps/web/test/fixtures.ts` with two `makeTestServer()` instances whose roots each contain a clone of
one fixture repository with the same `origin` remote:

1. Connect both; assert one rail group, two worktrees, two machine labels.
2. Add a project on B through the machine picker; assert it lands in B's slice only.
3. Open the same relative path on A and B with different contents. Keep dirty text on A, select a
   session on B, and save B through the editor. Assert that only B changes, then return to A and
   verify the same retained document still holds its unsaved text. Resume an A mutation after the
   switch and prove that its command capture and HTTP owner still target A.
4. Kill A's app; assert A's rows are stale-marked and still visible, B keeps working, and A recovers
   when a new app is mounted on the same database with the same `environmentId`.
5. Forge A's handshake with B's id after reconnect; assert `identity-drift` on A and no slice change.
6. Reload the store from the two namespaces cold; assert both machines paint from cache before any
   socket and are marked stale until live.
7. Inspect the diff for raw palette colours, hand-rolled loaders, `new Error`, a second machines
   list, and any `localStorage` access outside the adapter or the global chrome owners.

Then, by hand, against the running dev server plus the `localhost` SSH machine from Phase 2: open
this repository on both, confirm one group with two worktrees, run a terminal command on each,
switch between them without reload, disconnect the SSH machine and confirm its rows go stale and its
terminal shows the unreachable banner.

### Verify

```sh
cd apps/web
bun --bun vitest run --project node --project dom src/features/environments/tests/federated.integration.test.tsx
bun run typecheck && bun run lint && bun run format:check
cd ../desktop && bun run typecheck && cd ..
cd .. && bun run settings:reference && git diff --check && git status --short
```

## Done when

- Machines are a setting with a page; SSH machines connect from the desktop app through a
  loopback-to-loopback forward with no server change; disconnect is clean.
- Every connected machine has a live chat connection and its own recovery; the rail is one flat
  list with repository grouping across machines, chips, and a filter.
- Add project targets a machine. Workbench switches reuse retained runtimes and keyed query
  consumers; unsaved documents and pending saves stay with their confirmed checkout owner.
- One outer command bus survives switches and captures one runtime per invocation. Files, terminal,
  LSP, Git, and search answer for that owner; chat federation survives workbench remounts.
- Per-environment browser state is namespaced; global chrome is not.
- Unreachable machines are visible per machine and recover automatically; no global modal.
- The dev-only origin switch is gone; both cache versions were bumped exactly once; no healing code.
- All phase checks pass; the two-machine gate passes; baseline-delta review shows only intended
  changes.

## STOP conditions

Stop and ask the operator if:

- Root `PLAN.md` has not scheduled this plan, or 077/068 are still in `plans/`.
- The SSH probe on the operator's target requires a password or host-key confirmation the launcher
  cannot satisfy non-interactively.
- The remote checkout cannot start the server without an install step.
- Electrobun's RPC cannot push `machineState` messages from Bun to the web view.
- Endpoint replacement or a proposed provider lifetime would discard a retained document, rebind
  a QueryClient to another client, or create another command bus. Reconcile the lifetime design
  before implementation; a cache reset is not a substitute for preserving unsaved edits.
- A setting is proposed that is not registered and consumed in the same change, or any value that
  reaches execution is proposed at `window` scope.
- Any step would bind a server off loopback, or send anything credential-shaped to a log.

## Maintenance

If owners move after 068 lands, update the drift preamble and phase paths first. When complete,
delete this plan, update `docs/environments-and-remote-plan.md` §6, and replace live backlinks with
source and tests; git history is the archive.
