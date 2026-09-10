# Federated environments

Machines are configured in `environments.machines` on the primary server. Settings → Machines
accepts SSH targets, or HTTPS and loopback HTTP URLs. SSH needs only a host or `user@host`;
the server port is optional under Options. Add any number of projects after connecting.
The local machine is implicit. SSH runs on the primary backend using that user's SSH configuration,
keys, and available agent. SSH discovers the remote user's Platform server installation.
Browser and desktop clients use the same connection API and authentication prompts.

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
dependencies, or start another server. Keep the checkout and runtime on the data drive, such as
`/work/projects/platform`; only the launcher goes in the user's home directory.

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
Workspace cache version 20 and chat projection cache version 3 replace the old caches without a
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
