# Terminal host

Each state root has one authenticated Unix-socket host that owns its PTYs. A server restart
closes its connection. The next server adopts the leases and replays output from each saved
byte offset before admitting terminal operations. The host keeps a 1 MiB ring per shell;
missing bytes produce one gap message. Closing or restarting a terminal ends that shell.

Linux uses a transient `platform-pty-<id>.scope` when the systemd user manager is reachable.
Other systems use a detached process. The host reports its actual cgroup, build, and protocol
in `GET /release` as `terminalHost`. The source build has null release metadata.

The host exits after 30 seconds without a live shell or client. A standalone desktop owns a
separate state root and leases the host PID. Desktop quit sends `shutdown` after stopping its
server, waits for shell cleanup, and releases the lease. Shared-dev desktop windows leave the
shared server's host to its owner. Relaunch cleanup verifies the saved process identity.

Socket adoption checks the authenticated PID against the manifest and process start identity.
The manifest lives beside the socket. Isolated browser runs stop their host before deleting
their temporary home. Host launch, adoption, attach replay and orphan cleanup each log one
structured event; command lines and terminal output stay out of those events.

Plan 149's D1–D7 recommendations were accepted for the 2026-09-25 completion wave. The owner
explicitly chose desktop-quit shutdown. The macOS fallback remains an owner check.

Verification on 2026-09-25 used two real server processes on a spare loopback port and a
temporary state root. Host PID 3976551 and shell PID 3976577 survived the restart, output
advanced from byte 124 to 198, and systemd reported the host's own active scope. Evidence:
`/work/tmp/L4-completion/live-restart.json` and `live-logs/`. A concurrent reconnect regression
failed before recovery was awaited and passed after it. Production restart verification and
the 24-hour log census run after the owner deploys.
