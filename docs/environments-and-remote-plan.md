# Environments strategy

> **Status: Implemented; automated and live Linux/macOS checks pass.** Root
> [`PLAN.md`](../PLAN.md) owns execution order. The [session domain](session-domain.md) supplies
> repository identity, checkout ownership, recovery, and scoped browser records.
> The [implementation reference](federated-environments.md#verification) records the browser and SSH proof.
> This strategy document authorizes nothing by itself.

## 0. What changed since the first design, and why

The 2026-08-24 design chose **one active environment at a time** and deferred "several machines in
one sidebar" to a gated M6. The operator has now asked for exactly that sidebar: one flat list of
every project on every connected machine, the same repository on two machines grouped as one
project, and the editor able to open any of them. That is t3code's shipped model
(`references/t3code/docs/internals/remote.md`), so the simultaneity machinery the old design
deferred is now the product, not a tripwire.

Three things from the old design survive unchanged and are restated below rather than rederived:
the definition of an environment (§1), the security analysis of what a connected machine can do
(§4), and the list of reference behaviours we refuse to copy (§7).

Two things flip:

| Question                             | 2026-08-24                                   | Now                                                                                                                                                |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| One or several environments at once? | One                                          | **Several connected, one workbench.** Chat federates every connected machine; files, terminal, LSP and tabs follow one machine at a time (§3).     |
| Scoped `{environmentId, id}` refs?   | Deferred; "needed for simultaneity only"     | **Mandatory.** Plan 068 makes project ids deterministic from repository identity, so the same repo on two machines has the _same_ project id (§2). |
| First remote transport?              | TLS or tailnet origin, after pairing (M4–M5) | **SSH forward and direct-origin entries are implemented** (§3, §4). Mesh deployment checks and pairing remain deferred.                            |

## 1. What an environment is

An environment is a backend's persisted database identity and filesystem view of one machine.
A running process serves that environment at an origin. Restarting the process preserves
`environmentId` in the same database and creates a new `serverInstanceId`. A fresh database has a
new environment identity. User-facing copy says **machine**; code says `environmentId`.

Plan 077 provides runtime registries for clients, query caches, and connection state. Registry keys
use `canonicalServerOrigin`, so URL spellings that normalize to the same origin share an entry.
The client learns the environment identity from the authenticated descriptor and WS handshake.

| Our noun                   | Relationship to an environment                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server origin              | Connection route to a confirmed `EnvironmentId`. Endpoint replacement preserves that environment's client, QueryClient, and retained runtime.                                                        |
| Workspace root             | Many per environment; selecting a root does not change environment identity.                                                                                                                         |
| Project, worktree, session | Owned by an environment. Plan 068 derives project ids from repository identity, so the same repository can have the same `ProjectId` on two servers. Browser records then use `(environmentId, id)`. |
| Provider instance          | Per environment. Each machine uses its own provider credentials and available binaries.                                                                                                              |
| Terminal session, LSP      | Child processes on the owning machine. The active workbench mounts that machine's client connections.                                                                                                |
| Editor tab, diff document  | Paths and buffers belong to the retained editor runtime for an `EnvironmentId`. Browser cache namespaces separate identical paths on different machines (§2.4).                                      |
| Settings document          | Client settings use the primary environment's document. Each server retains its own server-consumed settings (§3.4).                                                                                 |
| `ChatTransport`            | The implemented chat connection interface. `createChatTransport(origin)` owns its RPC client, detail subscriptions, and earlier-page loader, with an explicit `close()`.                             |

## 2. Data model

### 2.1 Server identity

Plan 077 creates a singleton `environment_identity(id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`
row when initializing the platform SQLite database. The row survives server restarts. The WS
handshake carries its `environmentId` beside the per-process `serverInstanceId`, and the client
refuses an identity change at a recorded origin. A new `serverInstanceId` for the same environment
advances connection generation and invalidates that environment's server caches.

`/health` is the authenticated descriptor:

```ts
{ ok, environmentId, label, protocolVersion, serverVersion, platform: { os, arch }, ...fs.info() }
```

Without a cached descriptor, the initial workbench waits for `/health`. A cached descriptor can
restore stale content while fresh health checks run. Both the descriptor and WS handshake check
identity and protocol compatibility before accepting current server data. No unauthenticated
descriptor exists. Pairing remains deferred with the clients that need it.

### 2.2 Repository identity and the same repo on two machines

Plan 068 derives `Project.repositoryKey` from **machine-independent repository identity**, in this
order: the normalized `origin` remote URL (host plus path, `.git` stripped, lowercased, as
`references/t3code/packages/shared/src/git.ts:114`), else the root commit hash, else the canonical
path for non-Git directories. `ProjectId` is UUIDv5 of that key. Consequences, all intended:

- The same repository cloned on the laptop and the devbox is **one project** in the rail with two
  worktrees on two machines. That is t3code's `repository` grouping mode, achieved without a
  client-side logical-project layer.
- A second independent clone on one machine registers as another worktree of the same project.
- Identity is captured at registration; a later remote rename does not re-key a live project.
- Because ids repeat across machines, every browser-side map is keyed by
  `scopedProjectKey(environmentId, projectId)` and `scopedWorktreeKey(...)`. Session ids are UUIDv4
  and globally unique, but they are still stored under their environment so the transport that
  owns them is never guessed.

A machine is where the backend and files run. A checkout is one working directory of a repository
on that machine. One machine can hold the main checkout and several linked Git worktrees, and
another machine can hold its own checkouts of the same project.

The browser identifies each checkout by `(environmentId, worktreeId)`, represented by
`ScopedWorktreeRef`. The main checkout uses the same Worktree record and Git operations as every
other checkout. Its protection from removal remains a separate lifecycle rule. Plan 068's
`kind: 'current'` names the checkout used for registration, which need not be Git's main checkout.

The logical project groups these checkouts without combining their working files, staged changes,
commit drafts, or unsaved editor buffers. Git history may be shared between linked worktrees on one
machine. Each checkout still has its own working directory and index. A Git query or mutation names
the owning checkout, resolves its path on that environment, and keeps that owner if the active
workbench changes while the operation runs.
Git status and diff caches, mutation state, and invalidation targets retain this checkout owner.

### 2.3 Client registry

Configured machines use the `environments.machines` registry entry. Its `Machines` type is a
record of names to `MachineDefinition`, with these fields:

```ts
type MachineDefinition =
  | { kind: 'ssh'; target: string; remotePort?: number; label?: string }
  | { kind: 'origin'; url: string; label?: string }
```

The setting has `machine` scope because SSH configuration reaches execution through the launcher.
Settings → Machines edits it through the `machines` widget. The primary environment is implicit,
and `local` is reserved rather than stored as a configured entry. A Zustand store holds connection
phase, descriptor, last error, confirmed identity, and forwarded port.

`platform.environments.connected.v1` stores the connected machine names. The existing settings
mirror supplies cached configuration during startup. When the primary settings projection arrives,
it removes deleted names and stops their connections. Removing a configured machine hides its rail
data while preserving its disk cache and retained editor state. Explicit disconnect keeps cached
rows readable.

### 2.4 Environment storage namespaces

Per-environment localStorage owners (`workspace-cache-storage.ts`, `chat-projection-cache.ts`,
chat drafts, session reads, changed-files expansion, thread diff scope, prompt stash, rail
collapse) use one `environmentScopedStorage(environmentId)` adapter that prefixes
`env:${environmentId}|`. Global chrome (theme, palette, ui mode, workbench layout, address cache)
stays unscoped. Workspace cache version 20 and chat projection cache version 3 replace the old
caches without migration. Old development site data can be cleared once. Version sweeps enumerate
only the captured environment namespace.

Within each environment namespace, registered checkout caches use confirmed `WorktreeId` values.
An unregistered folder has an explicit folder location until the server supplies a Worktree record.
The retained editor runtime maps root paths to those records and owns Git commit drafts. Switching
checkouts preserves unsaved buffers and their save destination, including when two machines expose
the same absolute path. Unsaved editor text remains in memory.

Each chat projection cache also records its machine names, endpoint, and descriptor. Cold startup
restores configured, previously connected machines from their own caches and marks them stale
until their connections are live. Cached metadata supplies expected identity; fresh health checks
validate it before opening a transport.

## 3. Transport and connection model

### 3.1 The hard constraint

`treaty<App>(origin)` captures its origin. Plan 077 creates one client per canonical origin through
`createEnvironmentClient` and `environmentClientFor`. `VITE_SERVER_URL` supplies the initial origin;
`getClient()` resolves the selected origin at invocation time.

Queries use their owning QueryClient to select the client. Services and mutations capture that
owner before starting work and keep it across awaits. Changing the active origin cannot redirect
a delayed save, a queued mutation, or its cache invalidation to another machine.

### 3.2 Several connections, one workbench

Each confirmed environment retains an imperative editor runtime with its document buffers, dirty
text, views, undo history, workspace state, Git drafts, and save service. The QueryClient remains
mounted for the application lifetime, so queued mutations can resume while that environment's
React consumers are absent.

Switching keys the active query-consumer subtree by origin. Changing only the QueryClientProvider
value does not move existing React Query observers to a different client. The keyed subtree
recreates those consumers while retaining the editor and saver objects above it. Browser storage
seeds a runtime only when that environment is first opened. Returning to an existing runtime
preserves its in-memory state. One outer command bus captures the active runtime for each dispatch.

Federation uses these owners:

- One `ChatTransport` per connected environment, with its own RPC client, subscriptions, shell
  supervisor, and reconnect state. The projection store holds one slice per environment, and the
  rail reads all slices.
- A workbench that follows the environment owning the selected checkout. It selects that
  environment's retained runtime and persisted namespace. Files, terminal, LSP, Git, search, and
  visible editor tabs follow the selection.
- Chat connections that remain open when the workbench moves elsewhere. A running turn keeps
  streaming into its owning environment's projection.

The dev-only origin switch has been removed. Workbench switches preserve outgoing chat transports
and projections. Disconnect and configuration removal have separate lifetimes from workbench
selection.

### 3.3 How a client reaches a machine

Both connection types supply a validated endpoint to the same client and transport owners.

1. **SSH port forward.** The primary backend owns it: probe the target, start or reuse
   the installed server discovered through `platform-server --describe`, forward its remote loopback port,
   wait on `/health`, and confirm the `environmentId`. Browser and desktop clients reach this
   forward through the backend's `/machines/:name/proxy` HTTP/WebSocket relay. The backend uses
   its user's SSH configuration and agent; interactive prompts travel to the browser through
   the machine event stream and return through a private SSH_ASKPASS helper. Both ends of the
   forward remain on loopback, and the backend's origin allowlist protects the relay.
2. **Direct origin.** `{ kind: 'origin', url }` accepts HTTPS or loopback HTTP URLs. The remote
   server must allow the client's page origin. The mesh deployment remains unverified, including
   WebSocket upgrades through its reverse proxy and path-prefix handling for
   `mesh serve pc 3001 --at /platform`. Those deployment checks remain unscheduled.
   A plain `http://` non-loopback origin is refused with a real message, never upgraded silently.

The remote user runs `bun run server:install` once from a prepared Platform checkout. It installs
`~/.local/bin/platform-server`, recording that checkout and its Bun executable. SSH discovers the
launcher on PATH or at that fixed location, without asking for a repository path. See
[the installation contract](federated-environments.md#install-the-remote-server). A version skew
surfaces as the existing WS protocol-version refusal.

### 3.4 Settings across machines

Client settings belong to the primary environment. `SettingsOwnerProvider` retains its QueryClient
above the active workbench. `useSettingValue`, `readSettingsMirror`, and the Settings page use that
primary document when a remote workbench is selected. Pending settings operations retain their
owning client.

Each server continues reading its own server-consumed keys, including LSP and terminal
configuration. Workspace-scoped values on a remote machine stay with that server's consumers.
Editing the remote server's settings file remains an operation on that machine.

## 4. Auth and trust model

**Connecting a machine is equivalent to handing it a root shell as your user**, in both directions:
the client can spawn PTYs, read and write every file, push with the host's git credentials, and
spend the host's provider auth. The Machines page says so in those words.

- **SSH forward:** trust is the SSH key plus, for mesh hosts, tailnet membership and the mesh
  identity key. Traffic never leaves loopback on either machine. Nothing platform could add on top
  makes this safer, so **pairing codes, issued sessions and revocation are deferred** until a client
  that cannot SSH (a phone on the public edge) exists. Only the origin allowlist and the loopback
  bind guard the server, exactly as today.
- **Direct origin:** TLS or tailnet only. Plaintext HTTP off loopback is refused, not warned about.
  The remote server's allowlist must name the client page origin; a mismatch is a CORS refusal with
  a readable reason in the Machines page.
- **Log hygiene:** SSH targets and forwarded ports are fine to log; nothing credential-shaped ever
  exists to leak. If pairing lands later, ship the log-hygiene test with it.
- **Stated as unsolved:** nothing proves to the client that the process answering a forwarded port
  is the one it launched, beyond SSH host-key verification and the recorded `environmentId`. Accept.

The old design's session/pairing analysis (signed opaque tokens, atomic one-time consume, fragment
URLs, fd-3 desktop bootstrap, 1008 close on refusal) remains the reference for that later plan and
is recorded in git history at `docs/environments-and-remote-plan.md@1325b003`.

## 5. UI

### 5.1 The rail

One flat list, every machine, grouped by project id (repository identity). Inside a project group:
sessions ordered as today; a **machine chip** on a session row whenever more than one machine is
connected or the row's environment is not the primary; a **machine filter** in the existing scope
menu next to project scope. No per-machine sections. Discovered sessions from a remote machine
appear exactly like local ones.

### 5.2 Adding a project

"Add project" asks **which machine** when more than one is connected, then opens that machine's
file picker (the existing `FilePickerDialog`, parametrized by client). Registration goes to that
machine's transport. A project that is already registered on another machine with the same
repository identity joins the same group.

### 5.3 The workbench

The titlebar project menu shows the active machine with a status dot; the command palette exposes
`environment.switch`, `environment.connect`, `environment.openMachines`. Switching is described in
§3.2. The address accepts an optional `@<environmentId>` segment before the workspace segment,
omitted for the local environment, so a chat or editor link names the machine it belongs to.

### 5.4 Honest failure, per machine

Per-environment state, never a global modal. Rail header and Machines page show each machine's
phase; the workbench surfaces show, when its machine is unreachable: a stale-marked tree and git
panel painted from cache, a dead-terminal banner (not a spinner), a read-only editor with saves
refused with a reason, and chat's reconnecting phase. Recovery runs independently for each machine,
with backoff and retries on `online` and focus. Blocked connections and identity drift require an
explicit retry.

### 5.5 Settings → Machines

List, add (SSH target, or origin URL), connect, disconnect, remove, relabel, status,
last error, and the root-shell statement.

### 5.6 Git overview across checkouts, unscheduled

The intended Git view shows the main checkout and the project's other checkouts, including remote
machine worktrees, with separate changes and actions for each. Collapsible sections and tabs are
candidate layouts. Grouping by machine is also open. The rail's flat-list decision does not choose
the Git layout.

The current Git panel accepts one `rootPath` in
`apps/web/src/features/git/components/panel.tsx`. Its status query and Git UI state follow that
root through `hooks/use-status.ts` and `providers/store-provider.tsx`. It does not enumerate a
project's checkouts.

Plan 068 supplies checkout identity and project grouping. Plan 069 supplies worktree selection,
creation, and cleanup on one machine. Plan 078 supplies machine connections and routing to the
selected checkout. None of those plans delivers this Git overview. A separate, unscheduled design
must choose its layout and bind every section's queries, mutations, and file links to its
`ScopedWorktreeRef`. Showing several checkouts does not merge their changes or synchronize files.

## 6. Execution order

Plan 077 is implemented. It supplies persistent environment identity, authenticated descriptors,
identity and protocol checks, canonical origin registries, retained editor and QueryClient
lifetimes, owner-bound operations, closeable chat transports, and explicit `1008` auth refusal.
Its dev-only loopback origin switch has been removed by Plan 078.

Plan 068 is also implemented. The [session-domain reference](session-domain.md) links its
repository identity, checkout ownership, recovery, and environment-scoped navigation owners.

Federated environments are complete. Machines settings, backend SSH launch, concurrent chat
connections, scoped persistence, the cross-machine rail, and retained workbench switching are
described in [the implementation reference](federated-environments.md). Linux/macOS browser and
real SSH checks pass, including reconnect and managed-process cleanup; the executable plan is deleted.

The [implementation reference](federated-environments.md#verification) records automated and live
verification results. The checks are defined in `scripts/verify-federated-environments.sh`.
Plan 069 is implemented. The [worktree lifecycle reference](worktree-lifecycle.md) describes
worktree selection, creation, and cleanup on one machine. The Git overview in §5.6 remains
unscheduled. Mesh deployment checks and pairing follow only on demand.

## 7. What we deliberately will not copy from the reference

1. `owner`/`client` roles without capability checks at the RPC boundary. One trust level, stated.
2. `unsafe-no-auth` as a named contract variant.
3. Plaintext LAN pairing and `http://<lan-ip>:<port>` connection strings.
4. An unauthenticated descriptor leaking hostname, OS and arch.
5. The pairing URL in the startup log.
6. Bearer tokens in cleartext `localStorage`.
7. One global `wsConnectionState` fed by every transport; ours is keyed by environment from day one.
8. Automatic recovery wired only to the primary connection; ours retries every environment.
9. `envMode` as a name for worktree-vs-checkout; our worktree picker keeps the word worktree.
10. Downloading a standalone server over SSH; the current installer registers a prepared source checkout.
11. Silently upgrading a bare typed host to `https://`; we error with the real reason.
12. A client-side logical-project layer for grouping; our server-derived project id already groups.

## Appendix: implemented owners

- `apps/server/src/db/environment-identity.ts` reads the persisted identity row. The authenticated
  `/health` route in `apps/server/src/app.ts` and WS handshake in `orchestration/ws-rpc.ts` report
  that identity. A process restart changes `serverInstanceId` while retaining `environmentId`.
- `apps/web/src/lib/client.ts` owns runtime clients and canonical origin handling.
  `lib/environments/state/query-clients.ts` gives each QueryClient a fixed origin and client.
  Equivalent canonical origin spellings share both registries.
- `apps/web/src/components/application-bootstrap.tsx` admits a fresh authenticated descriptor or
  cached expected identity. `state/bootstrap-runtime.ts` restores the initial runtime, and
  `state/environment-connections.ts` validates fresh descriptors before connecting each machine.
  Connection state and identity checks live in `packages/client-core/src/environments/`.
- `apps/web/src/state/application-runtime.ts` retains editor runtimes and mounted QueryClients
  across switches. The keyed consumers live in `components/active-environment-application.tsx`.
  Queued mutations remain able to resume on their owning client after those consumers unmount.
- `apps/web/src/features/editor/state/runtime.ts` owns buffers, views, history, workspace edits,
  Git drafts, and save services. `state/save-service.ts` keeps every save in a batch on that
  runtime's client. The application guard checks dirty documents across all retained runtimes. The active editor
  root also updates the shared project pointer, including when cached-root validation clears it.
- `apps/web/src/keymap/providers/bus-provider.tsx` mounts one command bus above the keyed consumers.
  `keymap/state/command-bus.ts` captures the bound runtime once per dispatch. Pending commands keep
  that runtime when the visible environment changes.
- `apps/web/src/features/chat/transport/create-chat-transport.ts` owns a closeable RPC client,
  detail-subscription cache, earlier-page loader, and abortable HTTP snapshots. Closing a transport
  releases those resources and rejects pending work. `state/environment-connections.ts` retains
  one transport per confirmed identity through `features/chat/state/active-transports.ts`,
  independently of the active workbench.
- `apps/web/src/lib/environments/state/scoped-storage.ts` captures each environment namespace.
  `state/environment-persistence.ts` initializes its stores, and
  `features/chat/state/chat-projection-cache.ts` records projection and descriptor bindings for
  cold startup.
- `apps/server/src/machines/launcher.ts` owns SSH forwards and remote process records.
  `apps/web/src/features/settings/providers/owner-provider.tsx` keeps client settings on the
  primary environment above the keyed workbench.
- `apps/server/src/orchestration/ws-rpc.ts` sends code `1008` for authentication refusal.
  `apps/web/src/features/chat/transport/orchestration-rpc-client.ts` treats that code as blocked;
  an ordinary clean close remains reconnectable.
