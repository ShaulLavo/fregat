# @workspace/pty

runs a program in a pseudo-terminal from bun. you get its output as bytes, and you can type into it, resize it and kill it

it wraps bun's native terminal support and waits for every last byte before reporting exit. linux and macos, bun 1.3.14 or newer

## in fregat

private to this repo. every shell in the app's terminal panel is a `spawnPty` call in the terminal host (`apps/server/src/terminal-host/session.ts`). the host keeps a replay buffer of the bytes and forwards them to the server, which streams them to the browser. [terminal service](../../docs/terminal.md) and [terminal host](../../docs/terminal-host.md) cover that side

## the api

one function. `onData` is set at spawn, so no startup output is missed

```ts
import { spawnPty } from '@workspace/pty'

const decoder = new TextDecoder()
await using pty = spawnPty({
  command: ['/bin/sh', '-i'],
  cwd: process.cwd(),
  env: { ...process.env, TERM: 'xterm-256color' },
  cols: 100,
  rows: 30,
  onData(bytes) {
    process.stdout.write(decoder.decode(bytes, { stream: true }))
  },
})

pty.resize(120, 40)
pty.write('printf "hello\\n"\nexit\n')
const { exitCode, signal } = await pty.exited
process.stdout.write(decoder.decode())
```

`pty.kill()` sends `SIGHUP` and escalates to `SIGKILL` after 250 ms. `await using` (or `pty[Symbol.asyncDispose]()`) kills and waits for cleanup. `pty.pid` is the direct child

## check it

```sh
bun run --cwd packages/pty test
bun packages/pty/test/nvim-smoke.ts
```

the tests spawn real programs and need posix `sh` and `stty`. the smoke check needs `nvim`

## more

- [contract](docs/contract.md), defaults, ordering, exit, kill and disposal rules, platform support
- [design](docs/design.md), why a spawn-time callback and one owner for process and terminal
