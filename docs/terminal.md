# Terminal processes and transport

Platform's terminal service uses [`@workspace/pty`](../packages/pty/README.md) directly. Each
terminal shell is a child of the Bun server process. The Node bridge, embedded bridge script,
and `@lydell/node-pty` dependency have been removed.

## Ownership

[`TerminalService`](../apps/server/src/terminal/service.ts) owns one session per worktree and
terminal ID. It keeps shell selection, environment, dimensions, reconnect policy, session logs,
and the worktree execution lease. The package owns the native subprocess and PTY descriptors.

The service installs the output callback during spawn and observes the package's `exited`
promise. That promise waits for the direct child and terminal output to finish. Shutdown first
records the termination request, then asks the package to terminate, and waits for completion
and the durable lease to end. The package escalates to `SIGKILL` after 250 ms when necessary.

A rejected completion promise does not prove process exit. The service records
`terminal.session.ownership_unconfirmed`, closes the client, and retains the execution lease.
Successful completion releases ownership only after the lease end transaction succeeds.
Neither the package nor the service supervises a whole descendant process tree.

## Tabs

The workbench bottom panel holds one terminal per tab. Tabs live in the workspace's
`WorkbenchPanels` next to the editor tabs (`terminalTabs`, `activeTerminalTabId`) and persist with
the rest of the workspace slice, so a reload reattaches every still-live session. Ids are chosen by
the client from a per-workspace sequence (`terminalTabSequence`), never by the server and never
reused: the server keeps a killed session under its id until the PTY is gone, and a reused id would
attach to that dying shell. Only the title reuses the lowest free "Terminal N". The id is the
session id the PTY is keyed by, which is what lets a tab outlive the page.

Open terminals are listed beside the active one, VS Code style, once there is more than one; the bottom bar keeps only the new and kill actions. Every tab stays mounted. Inactive ones are hidden with `visibility` rather than unmounted, so the
emulator is not rebuilt and the host stays measurable while hidden. Only the active tab registers a
focus target, takes commands from the palette's script inbox, and is matched by the focus commands.
A tab's label is the user's rename, else the foreground command, else the title the shell set
through OSC 0/2 (the emulator's `title` event), else `Terminal N`. The server polls the PTY's
foreground process group once a second while a viewer is attached (`/proc` on Linux, `ps`
elsewhere) and sends a `process` control message when it changes; the name is null while the shell
itself is in the foreground. Only the rename persists.
A tab's label is the user's rename, else the title the shell set through OSC 0/2 (the emulator's
`title` event), else the foreground process name, else `Terminal N`. The server polls the PTY's
foreground process group once a second while a viewer is attached (`/proc` on Linux, `ps`
elsewhere) and sends a `process` control message when the name changes. Only the rename persists.
A shell that exits with status 0 takes its tab with it; any other exit keeps the tab so the message can be read. Closing a tab sends `dispose` over that panel's socket before the unmount, so the shell ends at
once instead of waiting out the detach timeout. With no panel mounted (the bottom panel closed, or
Problems showing) the client posts `/terminal/kill` with the worktree and terminal id instead. Commands: `workspace.newTerminal` (`Mod+\``),
`workspace.killTerminal`, `workspace.focusNextTerminal`and`workspace.focusPreviousTerminal`
(`Mod+PageDown`/`Mod+PageUp` while a terminal is focused).

## Wire format

The `/terminal` WebSocket uses binary frames for input and output. Text frames carry JSON
controls: client `resize` and `dispose`, server `ready`, `exit`, and `error`. The
[contract parsers](../packages/contracts/src/terminal.ts) distinguish these by frame type, so
binary content that looks like JSON remains terminal data.

The web client forwards Ghostty's byte input directly and feeds received bytes to
`Terminal.write`. Deliberate text commands are UTF-8 encoded at the command boundary. Terminal
sockets use `binaryType = 'arraybuffer'`. Binary input bypasses Eden's JSON encoder; server
output uses a Buffer view because Elysia would JSON-encode a plain Uint8Array.

Detached sessions stay alive for ten minutes. A session accepts multiple viewers and broadcasts
live output to each. Input is accepted from any viewer, and the latest resize sets the shared
dimensions. A failed send detaches that viewer without terminating the PTY.

Reconnection sends `ready` and replays the final 256 KiB only to the joining viewer. The cap
also applies to an oversized output chunk, and truncation removes partial leading UTF-8 bytes.
A resize nudge requests a repaint from full-screen programs after replay. The server tracks
negotiated mode 2048 and sends in-band dimension reports when enabled, since those applications
may ignore SIGWINCH. The requested size is restored after repaint output or a quiet-shell timeout.

## Verification

On 2026-09-06, the production service passed the same integration smoke check on Linux x64 and
macOS 26.4 arm64 with Bun 1.4.0. It verifies three shells directly parented by Bun, Ctrl-C/D,
resize, an exact 2 MiB binary echo, the final 256 KiB replay, and Neovim alternate-screen entry,
resize to 117 × 37, edit/save/exit. Disposal leaves no direct children and ends all three leases.

The smoke check drives the real service routes in-process with an isolated workspace and an
in-memory lease boundary. Focused server tests separately drive the real orchestration database
to verify durable ownership, exit ordering, and persistence retries. Client tests exercise the
binary protocol and the existing socket adapters.

```sh
bun run --cwd apps/server test src/terminal/tests/service.test.ts
bun apps/server/scripts/pty-smoke.ts
bun apps/server/scripts/pty-benchmark.ts
```

The smoke check requires `nvim`, POSIX `sh`, and `stty`. The benchmark measures the production
service without opening a socket. It excludes network transport, rendering, and orchestration
persistence. Before and after measurements on the same Linux Intel Core i7-14700K host were:

| Measurement                | Node bridge | Native service |
| -------------------------- | ----------: | -------------: |
| Startup median, 20 samples |   17.228 ms |       0.736 ms |
| Startup p95                |   19.505 ms |       0.792 ms |
| Echo median, 100 samples   |  0.05523 ms |     0.01447 ms |
| Echo p95                   |  0.08169 ms |     0.02224 ms |

Both returned all 6,400 measured payload bytes. The native service carries those bytes without
JSON envelopes. On the Mac, native startup median was 20.674 ms and echo median was 0.01850 ms;
no Mac Node baseline was measured. These are service measurements, not end-to-end UI timings.

The package requires Bun 1.3.14 or later; the repository pins 1.4.0. Windows is completely
untested, with compatibility unknown. The current package guard permits Linux and macOS only.
