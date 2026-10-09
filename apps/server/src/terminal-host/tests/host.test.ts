import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  type FSWatcher,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, onTestFinished } from 'vitest'

import { createTestTerminalHost } from '../testing'
import { ensureSocketDirectory, ensureToken, hostPaths, RING_BYTES } from '../protocol'

const hosts: Awaited<ReturnType<typeof createTestTerminalHost>>[] = []
const children: Bun.Subprocess[] = []
const watchers: FSWatcher[] = []
const roots: string[] = []

afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.close()
  const launched = children.splice(0)
  for (const child of launched) child.kill('SIGKILL')
  try {
    const exited = Promise.all(launched.map((child) => child.exited)).then(() => 'exited')
    expect(await Promise.race([exited, Bun.sleep(5_000).then(() => 'timed out')])).toBe('exited')
    await Promise.all(hosts.splice(0).map((host) => host.close()))
  } finally {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
  }
})

async function testHost() {
  const host = await createTestTerminalHost()
  hosts.push(host)
  return host
}

const LOOP = [
  '/bin/sh',
  '-c',
  'i=0; while :; do i=$((i+1)); echo "tick $i"; sleep 0.05; done',
] as const

it('keeps a shell running across a client reconnect, with contiguous offsets and the same pid', async () => {
  const host = await testHost()
  const received: { offset: number; length: number }[] = []
  const first = await host.client.spawn({
    key: 'loop',
    command: LOOP,
    onData: (bytes) => received.push({ offset: 0, length: bytes.byteLength }),
  })
  await expect.poll(() => received.length).toBeGreaterThan(2)
  const resumeAt = first.offset
  host.client.close()

  const chunks: { offset: number; length: number }[] = []
  const again = await host.connect().attach({
    key: 'loop',
    from: resumeAt,
    onData: (bytes, offset) => chunks.push({ offset, length: bytes.byteLength }),
  })

  expect(again.pid).toBe(first.pid)
  await expect.poll(() => chunks.length).toBeGreaterThan(2)
  expect(chunks[0]?.offset).toBe(resumeAt)
  for (let index = 1; index < chunks.length; index++) {
    const previous = chunks[index - 1]!
    expect(chunks[index]?.offset).toBe(previous.offset + previous.length)
  }
})

it('reports one gap when the ring dropped output while no client was attached', async () => {
  const host = await testHost()
  // Well past the ring while detached: 3 MiB of output.
  const burst = [
    '/bin/sh',
    '-c',
    'sleep 0.3; head -c 3145728 /dev/zero | tr "\\0" x; sleep 30',
  ] as const
  await host.client.spawn({ key: 'burst', command: burst, onData: () => {} })
  host.client.close()
  await Bun.sleep(1_500)

  const gaps: { from: number; to: number }[] = []
  const pty = await host.connect().attach({
    key: 'burst',
    from: 0,
    onData: () => {},
    onGap: (from, to) => gaps.push({ from, to }),
  })

  await expect.poll(() => pty.offset).toBeGreaterThanOrEqual(3 * 1024 * 1024)
  expect(gaps).toHaveLength(1)
  expect(gaps[0]?.from).toBe(0)
  expect(gaps[0]!.to).toBeGreaterThanOrEqual(3 * 1024 * 1024 - RING_BYTES)
})

it('refuses a client that holds a different token', async () => {
  const host = await testHost()
  await host.client.host()
  host.client.close()
  writeFileSync(host.paths.token, 'not-the-host-token')

  await expect(host.connect().host()).rejects.toMatchObject({ code: 'terminal.HOST_REFUSED' })
})

it('refuses adoption when the manifest identifies a reused pid', async () => {
  const host = await testHost()
  const hello = await host.client.host()
  host.client.close()
  const original = readFileSync(host.paths.manifest, 'utf8')
  writeFileSync(host.paths.manifest, JSON.stringify({ hostPid: hello.pid, processStart: 'stale' }))
  try {
    await expect(host.connect().host()).rejects.toMatchObject({
      code: 'terminal.HOST_UNREACHABLE',
      internal: { reason: 'host-identity-mismatch' },
    })
    expect(host.hosts[0]?.exitCode).toBeNull()
  } finally {
    writeFileSync(host.paths.manifest, original)
  }
})

it('exits after its last client leaves when there are no live sessions', async () => {
  const host = await createTestTerminalHost({ idleMs: 50 })
  hosts.push(host)
  await host.client.host()
  host.client.close()
  await expect.poll(() => host.hosts[0]?.exitCode).toBe(0)
})

it('concurrent clients adopt one host for the same state root', async () => {
  const host = await testHost()
  const clients = [host.client].concat(Array.from({ length: 9 }, () => host.connect()))
  const greetings = await Promise.all(clients.map((client) => client.host()))
  const pid = greetings[0]!.pid
  expect(greetings.every((hello) => hello.pid === pid)).toBe(true)
  const competitors = host.hosts.filter((child) => child.pid !== pid)
  expect(await Promise.all(competitors.map((child) => child.exited))).toEqual(
    competitors.map(() => 0),
  )
})

it('replacing an unseen exited shell leaves one session for its key', async () => {
  const host = await testHost()
  const exitFile = path.join(host.paths.directory, 'exit')
  await host.client.spawn({
    key: 'replace',
    command: ['/bin/sh', '-c', 'while [ ! -f "$1" ]; do sleep 0.01; done', 'sh', exitFile],
    onData: () => {},
  })
  host.client.close()
  const client = host.connect()
  await client.list()
  writeFileSync(exitFile, '')
  await expect.poll(async () => (await client.list())[0]?.exited).toBe(true)
  const retired = (await client.list())[0]!
  const live = await client.spawn({ key: 'replace', command: LOOP, onData: () => {} })
  expect(await client.list()).toMatchObject([{ key: 'replace', pid: live.pid, exited: false }])
  expect(await client.list()).toHaveLength(1)
  await expect(
    client.attach({ key: 'replace', session: retired.session, from: 0, onData: () => {} }),
  ).rejects.toMatchObject({ code: 'terminal.HOST_REQUEST_FAILED' })
})

it('retries a socket closed during the shutdown handshake and launches the next host', async () => {
  const host = await testHost()
  mkdirSync(host.paths.directory, { recursive: true })
  const stopping = net.createServer((socket) => {
    socket.destroy()
    stopping.close()
  })
  await new Promise<void>((resolve) => stopping.listen(host.paths.socket, resolve))
  try {
    const hello = await host.client.host()
    expect(hello.pid).toBe(host.hosts[0]?.pid)
    expect(await host.client.list()).toEqual([])
  } finally {
    stopping.close()
  }
})

it('keeps the running shell for a key when its replacement fails to spawn', async () => {
  const host = await testHost()
  const live = await host.client.spawn({ key: 'kept', command: LOOP, onData: () => {} })

  await expect(
    host.client.spawn({ key: 'kept', command: ['/nonexistent/shell'], onData: () => {} }),
  ).rejects.toMatchObject({ code: 'terminal.HOST_REQUEST_FAILED' })

  await Bun.sleep(100)
  expect(await host.client.list()).toMatchObject([{ key: 'kept', pid: live.pid, exited: false }])
})

it('reports a shell as exited when its host dies and a fresh host no longer lists it', async () => {
  const host = await testHost()
  const pty = await host.client.spawn({ key: 'orphaned', command: LOOP, onData: () => {} })
  host.hosts[0]?.kill('SIGKILL')

  await expect(pty.exited).resolves.toEqual({ exitCode: 1, signal: null })
  expect(host.hosts).toHaveLength(2)
})

// Two launchers can race; the loser may start after the isolated server's entire directory is gone.
it.each(['host', 'stalled child'] as const)(
  'a removed state root stays absent after %s startup',
  async (kind) => {
    const root = mkdtempSync(path.join(tmpdir(), 'platform-pty-removed-'))
    roots.push(root)
    const directory = path.join(root, 'server')
    const stateRoot = path.join(directory, 'home')
    mkdirSync(stateRoot, { recursive: true })
    rmSync(directory, { recursive: true })
    const { XDG_RUNTIME_DIR: _runtime, ...inherited } = process.env
    const env = {
      ...inherited,
      OBSERVABILITY_ENABLED: 'true',
      OBSERVABILITY_CONSOLE: 'false',
      OBSERVABILITY_POSTHOG_ENABLED: 'false',
      OBSERVABILITY_DIR: path.join(directory, 'logs'),
    }
    const watcher = watch(root)
    watchers.push(watcher)
    let watcherClosed = false
    watcher.on('close', () => {
      watcherClosed = true
    })
    const recreated = new Promise<string>((resolve) =>
      watcher.on('change', (_event, name) => {
        if (name === 'server') resolve('recreated the directory')
      }),
    )
    const command =
      kind === 'host'
        ? [path.join(import.meta.dirname, '../main.ts'), `--state-root=${stateRoot}`]
        : ['-e', 'setInterval(() => {}, 1000)']
    const child = Bun.spawn([process.execPath].concat(command), {
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    children.push(child)
    onTestFinished(async () => {
      await expect.poll(() => watcherClosed).toBe(true)
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
      expect(existsSync(root)).toBe(false)
    })
    const outcome = await Promise.race([
      child.exited.then((code) => `exited ${code}`),
      recreated,
      Bun.sleep(kind === 'host' ? 5_000 : 50).then(() => 'timed out'),
    ])
    expect(outcome).toBe(kind === 'host' ? 'exited 0' : 'timed out')
    expect(existsSync(directory)).toBe(false)
    if (kind === 'stalled child') {
      expect(child.exitCode).toBeNull()
      expect(child.signalCode).toBeNull()
    }

    const paths = hostPaths(stateRoot, env)
    expect(() => ensureToken(paths)).toThrow()
    expect(() => ensureSocketDirectory(paths)).toThrow()
    expect(existsSync(directory)).toBe(false)
  },
)
