# Contract

## Options

- `command` is a nonempty, readonly argv tuple. The package starts that executable directly.
- `cwd` and `env` default to the caller's directory and environment. An explicit `env` replaces inheritance. A missing `TERM` defaults to `xterm-256color`.
- `cols` and `rows` default to 80 and 24. Both must be integers from 1 to 65535.

## Output and input

- `onData` is registered before the process starts. It receives ordered `Uint8Array` chunks synchronously, stderr included. Chunks can be retained. The callback consumes them synchronously or owns its buffering. The package keeps no replay buffer and applies no output backpressure.
- `write` accepts strings or bytes. Bun owns input buffering and preserves write order. It can buffer large pastes, so callers bound the input they accept from outside the process.

## Exit

- `exited` resolves with `{ exitCode, signal }` after the direct child exits, terminal output ends, and the native handle closes. The result is the subprocess status, never Bun's pty EOF status.
- On Linux, descendants can hold the terminal open after the direct child exits. macOS revokes the controlling terminal when its session leader exits, and later descendant writes fail with `EIO`.

## Kill and disposal

- `kill()` sends `SIGHUP`. `kill(signal)` sends that signal. If completion takes more than 250 ms, cleanup sends `SIGKILL` to the direct child and closes the terminal. Repeated calls share the deadline. An explicit `SIGKILL` goes out immediately. Forced closure may discard unread bytes.
- `await pty[Symbol.asyncDispose]()` terminates the process and waits for cleanup. Repeated disposal is safe. Writes and resizes after the terminal closes do nothing, though dimensions are still validated.

Disposal cleans up the direct child and the package's descriptors. Interactive shells put foreground jobs in separate process groups, and a descendant that ignores hangup can outlive the shell. The package supervises the direct child only.

## Errors

Spawn failures throw structured `pty.*` errors (`UNSUPPORTED_RUNTIME`, `INVALID_OPTIONS`, `SPAWN_FAILED`). A throwing output callback terminates the process, closes the terminal, and rejects `exited` with an `OPERATION_FAILED` error whose cause is the original.

## Platforms

Linux and macOS are verified. The platform guard rejects everything else, and Windows is untested.

Bun 1.3.14 or later is required. Bun 1.3.10 segfaults on failed spawns when a terminal exit callback is installed, so older runtimes are rejected before the native API is called. The repository builds with the Bun version in its root `packageManager` field.

## Tests

```sh
bun run --cwd packages/pty test
bun run --cwd packages/pty typecheck
bun packages/pty/test/nvim-smoke.ts
bun apps/server/scripts/pty-benchmark.ts
```

The tests run Vitest under Bun because they exercise the native runtime. They spawn real programs and need POSIX `sh` and `stty`. Descriptor checks use `/proc/self/fd` on Linux and `/usr/sbin/lsof` on macOS, with a live pty as a positive control. The Neovim check needs `nvim`.

The benchmark measures the production `TerminalService` through its routes without opening a server socket. `apps/server/scripts/pty-smoke.ts` checks the full service with Neovim.
