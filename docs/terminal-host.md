# Terminal host

Each state root has one authenticated Unix-socket host that owns its PTYs. A server restart
closes its connection. The next server adopts the leases and replays output from each saved
byte offset before admitting terminal operations. The host keeps a 1 MiB ring per shell;
missing bytes produce one gap message. Closing or restarting a terminal ends that shell.
Clearing scrollback preserves the live stream cursor; replacement shells start a new cursor.
Lease adoption and stream recovery use one host snapshot. A failed attachment is logged per
session while the remaining sessions recover. Each key retains one lease owner; exited host
sessions are forgotten once their recovery evidence has been consumed.

Linux uses a transient `platform-pty-<id>.scope` when the systemd user manager is reachable.
Other systems use a detached process. The host reports its actual cgroup, build, and protocol
in `GET /release` as `terminalHost`. The source build has null release metadata.

The host exits after 30 seconds without a live shell or client. A standalone desktop owns a
separate state root and leases the host PID. Desktop quit sends `shutdown` after stopping its
server, waits for shell cleanup, and releases the lease. Shared-dev desktop windows leave the
shared server's host to its owner. Relaunch cleanup verifies the saved process identity.

Socket adoption checks the authenticated PID against the manifest and process start identity.
An exclusive SQLite transaction elects one host before it publishes its manifest and socket.
The manifest lives beside the socket. Isolated browser runs stop their host before deleting
their temporary home. Host launch, adoption, attach replay and orphan cleanup each log one
structured event; command lines and terminal output stay out of those events.

A worktree's shells outlive the sessions that use it, with one exception (LIFE-04): once the last live session on a worktree settles or archives, its shells whose foreground is the shell itself close, and their saved output stays. A shell running
a program stays open.

Restart check: two real server processes on a spare loopback port and a temporary state root. The host and shell PIDs survive the restart, terminal output advances (byte 124 to 198), and systemd reports the host's own active scope. A reconnect regression test fails if recovery is not awaited. Production restart verification and
the 24-hour log census are not done yet.
