# contract

## options

- `command` is a nonempty, readonly argv tuple. the package starts that executable directly
- `cwd` and `env` default to the caller's directory and environment. an explicit `env` replaces inheritance. a missing `TERM` defaults to `xterm-256color`
- `cols` and `rows` default to 80 and 24. both must be integers from 1 to 65535

## output and input

- `onData` is registered before the process starts. it receives ordered `Uint8Array` chunks synchronously, stderr included. chunks can be retained. the callback consumes them synchronously or owns its buffering. the package keeps no replay buffer and applies no output backpressure
- `write` accepts strings or bytes. bun owns input buffering and preserves write order. it can buffer large pastes, so callers bound the input they accept from outside the process

## exit

- `exited` resolves with `{ exitCode, signal }` after the direct child exits, terminal output ends, and the native handle closes. the result is the subprocess status, never bun's pty eof status
- on linux, descendants can hold the terminal open after the direct child exits. macos revokes the controlling terminal when its session leader exits, and later descendant writes fail with `EIO`

## kill and disposal

- `kill()` sends `SIGHUP`. `kill(signal)` sends that signal. if completion takes more than 250 ms, cleanup sends `SIGKILL` to the direct child and closes the terminal. repeated calls share the deadline. an explicit `SIGKILL` goes out immediately. forced closure may discard unread bytes
- `await pty[Symbol.asyncDispose]()` terminates the process and waits for cleanup. repeated disposal is safe. writes and resizes after the terminal closes do nothing, though dimensions are still validated

disposal cleans up the direct child and the package's descriptors. interactive shells put foreground jobs in separate process groups, and a descendant that ignores hangup can outlive the shell. the package supervises the direct child only

## errors

spawn failures throw structured `pty.*` errors (`UNSUPPORTED_RUNTIME`, `INVALID_OPTIONS`, `SPAWN_FAILED`). a throwing output callback terminates the process, closes the terminal, and rejects `exited` with an `OPERATION_FAILED` error whose cause is the original

## platforms

linux and macos are verified. the platform guard rejects everything else, and windows is untested

bun 1.3.14 or later is required. bun 1.3.10 segfaults on failed spawns when a terminal exit callback is installed, so older runtimes are rejected before the native api is called

## tests

```sh
bun run --cwd packages/pty test
bun run --cwd packages/pty typecheck
bun packages/pty/test/nvim-smoke.ts
bun apps/server/scripts/pty-benchmark.ts
```

the tests run vitest under bun because they exercise the native runtime. they spawn real programs and need posix `sh` and `stty`. descriptor checks use `/proc/self/fd` on linux and `/usr/sbin/lsof` on macos, with a live pty as a positive control. the neovim check needs `nvim`

the benchmark measures the production `TerminalService` through its routes without opening a server socket. `apps/server/scripts/pty-smoke.ts` checks the full service with neovim
