# Federated environments

Machines are configured in `environments.machines` on the primary server. Settings → Machines
accepts SSH targets, or HTTPS and loopback HTTP URLs. SSH needs only a host or `user@host`;
the server port is optional under Options. Add any number of projects after connecting.
The local machine is implicit. SSH runs on the primary backend using that user's SSH configuration,
keys, and available agent. SSH discovers the remote user's Platform server installation.
Browser and desktop clients use the same connection API and authentication prompts.
The retained-machine notice can reconnect SSH directly from either client.
The add-project folder picker validates typed paths through the selected machine's client.

Connect machine lists explicit `Host` aliases from the primary backend user's `~/.ssh/config`
and `/etc/ssh/ssh_config`. Discovery follows relative, absolute, `~/` and glob `Include` paths,
including nested files, without executing SSH or `Match exec` commands. Wildcard and negated
host patterns are omitted. Includes that require a target host are skipped. Missing config files
produce an empty list; unreadable or malformed files report an error. Entering an SSH address
manually remains available.

The same form lists tailnet peers using `tailscale status --json` on the primary backend, matching
Mesh's discovery source. It omits the local machine, marks offline peers, and uses MagicDNS names
when enabled with an IP fallback otherwise. Selecting a peer fills the SSH target; it does not
assume Platform is installed or try to connect during discovery. The target remains editable,
including adding `user@` when the remote login differs.

Both lists load independently and refresh when the form reopens. Missing or stopped Tailscale
does not prevent SSH config selection or manual entry. The status command has a three-second
deadline and a bounded output size; source availability and counts enrich the request log.

Connecting a machine is equivalent to handing it a root shell as your user, in both directions.
The Machines page states this trust boundary.

## Install the remote server

The current installer registers a prepared source checkout. On the remote machine, as the SSH
user, run this once from the Platform checkout after installing its dependencies:

```sh
bun run server:install
```

This writes a small executable to `~/.local/bin/platform-server`. It records the absolute checkout
directory and the Bun executable used to install it. It does not copy the checkout, download
dependencies, or start another server. Only the launcher goes in the user's home directory; the checkout and runtime can live anywhere.

Connect machine discovers `platform-server` on the remote PATH, then tries
`~/.local/bin/platform-server` when SSH's noninteractive PATH omits it. `platform-server --describe`
returns a validated installation descriptor; normal invocation starts the server. Bun does not
need to be on SSH's PATH. A missing or moved installation reports the installation command.
Rerunning it atomically replaces the launcher. Disconnect before selecting a different checkout;
its database may identify a different environment. Existing connections retain the discovered
directory and executable for cleanup.

This is a source installation, not a downloadable standalone distribution. The checkout retains
its dependencies, database and lifecycle records. A future packaged installer must provide the
same discoverable launcher and define its own installation descriptor and launch implementation;
machine settings stay independent of installation paths and project paths.

## Ownership

The server's persisted `EnvironmentId` owns its retained editor runtime, chat transport, browser
storage, and query cache. An endpoint is a route to that identity. Endpoint replacement is accepted
only after descriptor validation; it preserves the QueryClient and Client objects. A request
captures its endpoint when invoked, so a later switch cannot redirect work already in flight.

Each connected environment retains a shell subscription outside the keyed workbench subtree.
Switching suspends the outgoing editor's activity and subscriptions, while its documents, saves,
Git drafts, and chat connection survive. One command bus captures the current runtime for each
invocation. The rail groups repositories across environments and keeps each session's machine and
checkout identity.

Application setting commands read and write the primary settings owner even while another machine
is active. A successful Git commit clears its captured draft after a switch, unless the user has
edited that draft since submitting it.

Browser storage uses `env:<environmentId>|`. Registered checkout caches use confirmed `WorktreeId`
values. Ordinary folders have explicit folder locations until the server registers a checkout.
Workspace cache version 21 and chat projection cache version 3 replace the old caches without a
migration. Clear the old development site data once when adopting this change.

Cached descriptors supply expected identity and stale display data. Fresh health responses and
WebSocket handshakes validate identity and protocol before accepting current server data. Cached
machine configuration comes from the existing settings mirror; the primary settings document
remains authoritative. Connected machine names use `platform.environments.connected.v1`.

Unreachable machines keep readable cached rows and buffers. Tree and Git show a stale notice;
terminal and editor controls refuse unavailable operations. Recovery runs independently for each
machine. Identity drift and blocked connections require an explicit retry.
Editing a disconnected machine keeps it disconnected.

## Backend SSH lifecycle

The primary backend resolves machine names from its settings and owns the launcher in
`apps/server/src/machines/`. Connect and disconnect use `/machines/:name/connect` and
`/machines/:name/disconnect`; `/machines/events` streams state and authentication prompts.
Password, key-passphrase, and host-confirmation answers pass through a private SSH_ASKPASS helper.
Answers are never stored in settings. An SSH control connection shares authentication between
probe, launch, and forwarding operations.

Both the remote server and the backend's forwarding port bind to loopback. Clients reach the
forward through `/machines/:name/proxy`, under the primary backend's existing URL and origin guard.
The relay preserves HTTP streams and WebSocket frames, including terminal binary data. A browser
on another device therefore uses the backend's tunnel without needing access to its loopback port.

The launcher discovers the installation, starts or reuses a server, forwards a local port, and
checks health. Each connection retry checks the forwarded health endpoint, even when the SSH
process is still alive. A dropped chat connection schedules this retry so a crashed managed server
can restart. A healthy managed server keeps its PTYs.

Each machine entry owns a lease in the remote checkout's `.platform-ssh-launch/` directory. Aliases
that use the same managed server hold separate leases on one process record. Disconnect releases
that machine's lease. The final release stops the managed process only if its saved start stamp
still matches. A checkout-local SQLite lock serializes launch and stop operations. Restart replaces
the shared process record, so existing leases follow the replacement process. External servers
remain running. The launcher retains the local port for reconnection during its lifetime.

Both ends of the launch check the orchestration protocol. The launch script compares a reused
server's descriptor with the protocol it was sent. A stale managed server is stopped and relaunched
when the checkout's own `ORCHESTRATION_WS_PROTOCOL_VERSION` already matches and no other lease holds
it; otherwise the launch fails with `machines.SSH_PROTOCOL`. A server another lease holds, or an
external server, keeps running; when this connection held the only lease, releasing it after the
failure stops the server, the same as any failed first connection. External servers are never
restarted. The fix names the side to update: this Platform server when the remote checkout is
newer, the remote checkout when it is older. The launcher repeats the check between readiness and identity, so a
server swapped behind a live forward is caught too. The machine state carries the catalog error as
`{ code, message, why, fix }`, and the notice, the picker and Settings › Machines read it as
"Server out of date" with the fix.

Browser instances hold the shared connection independently. Disconnecting one instance releases
its hold; the final release closes the forward and remote lease. Event-stream reconnections have
a grace period before abandoned holds are released. Renewing a hold invalidates cleanup already
in progress. Connections opened without an event stream still expire if that stream never returns.
Removing or replacing a machine definition revokes its backend connection without depending on a
browser to disconnect it. Backend shutdown cancels prompts and closes launchers, SSH control
connections, and helper sockets. Desktop has no separate SSH bridge.

Cancelling authentication stops the pending attempt and dismisses the dialog even if the backend
cannot be reached. An edited connection form waits for the replacement attempt to finish before
reporting success. Dismissing a pending form cancels its attempt.

## Verification

Run `bash scripts/verify-federated-environments.sh` for the focused automated checks. The two-server
integration exercises real Elysia apps and filesystem roots through injected socket boundaries.
It covers repository grouping, independent buffers and saves, recovery, alias ownership, identity
drift, and restart lifetimes. Separate tests cover the machine picker, settings scope, cache
namespaces, cold rendering, retained checkout state, and delayed log attribution. Review
regressions cover synchronous quit cancellation, a remote crash with a live forward, concurrent
alias disconnects, interrupted lease publication, primary settings commands, disconnected-machine
edits, and commits that finish after switching machines.

The SSH checks must also exercise real OpenSSH with an isolated SSH daemon and temporary keys.
Verify unknown-host confirmation, encrypted-key authentication, forwarding, release of the actual
listening port, and reconnection with reused authentication. Process substitutes alone cannot
prove these behaviors because OpenSSH's control master owns forwarded listeners independently of
the command that requests them.

The live browser verifier uses the running app and an existing SSH machine:

```sh
node apps/web/scripts/verify-federated-environments.mjs \
  --app-url <running-web-url> --server-url <running-api-url> \
  --machine <configured-machine-name> \
  --primary-root <disposable-local-checkout> --remote-root <disposable-remote-checkout> \
  --output-dir <report-directory>
```

Both disposable checkouts need the same unique Git origin and a `federation.txt` file with
different contents. The verifier rejects already registered checkout paths and refuses deletion
ownership for pre-existing project IDs. It saves an edit in the remote file, closes its browser
before deleting its own project/session registrations, and leaves the supplied checkout files
for the caller to remove. Browser verifiers run serially because the primary filesystem index
has one active root.

The verifier passes eight live checks against Linux and an SSH-connected Mac: distinct machine
identities, grouped repository rows and machine filtering, remote folder input, retained unsaved
text with saves confined to the selected machine, terminal commands on both machines, an
unavailable terminal state with the forwarded listener released, and reconnect from the browser
without reloading. The report, reached state, terminal output and cleanup receipts go to the
output directory.

Typed remote paths use the client of the picker's own QueryClient, not the active machine's HTTP
client. Retained SSH connection notices keep their Connect button enabled in browsers; the shared
backend connection API handles that action. Focused tests cover both alongside the two-server
ownership and cold-cache checks. Real OpenSSH checks cover host confirmation, encrypted-key
prompts, reused authentication, forwarded listener release, cancellation, and connection
ownership transfer.

A live SSH lifecycle check has nine gates. Two aliases reuse the active Mac server with
independent leases and local forwards, and releasing them leaves its existing user connection
intact. A separate managed process on a remote port keeps its remaining alias on first release
and stops on final release; reconnecting starts a new process with the same durable environment
ID. All tested local forwards close and the remote launch records return to their baseline.

A production primary now installs its own release on a machine through **Update server** (or
**Install server** when none is installed): it copies `server/` over SSH into
`~/.platform/server/releases/<name>`, installs the runtime packages once per manifest, swaps
`current`, rewrites `~/.local/bin/platform-server` and restarts the managed server. The design is
in [remote-server-releases.md](remote-server-releases.md). Live update verification is pending
against an authorized remote installation. Confirm that the remote uses the primary's release
and that an existing source rig remains on disk.
