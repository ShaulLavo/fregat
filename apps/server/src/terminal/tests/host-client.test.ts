import { afterEach, expect, test } from 'vitest'

import { existsSync } from 'node:fs'
import { HOST_CONNECT_TIMEOUT_MS } from '../../terminal-host/protocol'
import { createFakeTerminalHost } from '../../../test/factories/fake-terminal-host'

const hosts: Awaited<ReturnType<typeof createFakeTerminalHost>>[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()))
})

async function fakeHost() {
  const host = await createFakeTerminalHost()
  hosts.push(host)
  return host
}

function collect() {
  const chunks: { offset: number; text: string }[] = []
  return {
    chunks,
    text: () => chunks.map((chunk) => chunk.text).join(''),
    onData: (bytes: Uint8Array, offset: number) =>
      chunks.push({ offset, text: new TextDecoder().decode(bytes) }),
  }
}

test('reattaches a live shell from its offset after the connection drops', async () => {
  const host = await fakeHost()
  const session = host.add('live', 'before;')
  const output = collect()
  const client = host.connect()
  const pty = await client.attach({ key: 'live', from: 0, onData: output.onData })
  await expect.poll(() => output.text()).toBe('before;')

  host.drop()
  host.write(session.session, 'while-away;')
  await expect.poll(() => output.text()).toBe('before;while-away;')
  host.write(session.session, 'after;')

  await expect.poll(() => output.text()).toBe('before;while-away;after;')
  const resumes = host.received.filter((control) => control.type === 'attach')
  expect(resumes.at(-1)).toMatchObject({ key: 'live', session: session.session, from: 7 })
  expect(output.chunks.map((chunk) => chunk.offset)).toEqual([0, 7, 18])
  host.exit(session.session, 0)
  await expect(pty.exited).resolves.toEqual({ exitCode: 0, signal: null })
})

test('resends a kill that was sent while the connection was down', async () => {
  const host = await fakeHost()
  const session = host.add('killed')
  const pty = await host.connect().attach({ key: 'killed', from: 0, onData: () => {} })
  host.drop()
  pty.kill()

  await expect(pty.exited).resolves.toMatchObject({ exitCode: 129 })
  expect(host.sessions.has(session.session)).toBe(false)
})

test('reports a shell the reconnected host no longer lists as exited', async () => {
  const host = await fakeHost()
  const session = host.add('gone')
  const pty = await host.connect().attach({ key: 'gone', from: 0, onData: () => {} })
  host.sessions.delete(session.session)
  host.drop()

  await expect(pty.exited).resolves.toEqual({ exitCode: 1, signal: null })
})

test('fails a shell with an unreachable host when reconnecting fails', async () => {
  const host = await fakeHost()
  host.add('stranded')
  const pty = await host.connect().attach({ key: 'stranded', from: 0, onData: () => {} })
  await host.stop()

  await expect(pty.exited).rejects.toMatchObject({
    code: 'terminal.HOST_UNREACHABLE',
    internal: { reason: 'reconnect-failed', key: 'stranded' },
  })
})

test('leaves a detached shell pending when the client closes', async () => {
  const host = await fakeHost()
  host.add('detached')
  const client = host.connect()
  const pty = await client.attach({ key: 'detached', from: 0, onData: () => {} })
  client.close()
  const settled = await Promise.race([
    pty.exited.then(
      () => 'settled',
      () => 'settled',
    ),
    Bun.sleep(100).then(() => 'pending'),
  ])
  expect(settled).toBe('pending')
})

test('fails a request the host never answers and drops the connection', async () => {
  const host = await fakeHost()
  const client = host.connect({ requestTimeoutMs: 50 })
  await client.host()
  host.unanswered.add('list')

  await expect(client.list()).rejects.toMatchObject({
    code: 'terminal.HOST_UNREACHABLE',
    internal: { reason: 'request-timeout', operation: 'list' },
  })
  host.unanswered.clear()
  await expect(client.list()).resolves.toEqual([])
})

test('fails the boot listing of a host that answers hello but not list', async () => {
  const host = await fakeHost()
  host.unanswered.add('list')

  await expect(host.connect({ requestTimeoutMs: 50 }).host()).rejects.toMatchObject({
    code: 'terminal.HOST_UNREACHABLE',
    internal: { reason: 'request-timeout' },
  })
})

test('connects after a cold launch when the socket becomes ready', async () => {
  const host = await fakeHost()
  await host.stop()
  let launches = 0
  const client = host.connect({
    launch: async () => {
      launches += 1
      await host.listen()
    },
  })

  await expect(client.host()).resolves.toMatchObject({ pid: process.pid })
  await expect(client.list()).resolves.toEqual([])
  expect(host.received.map((control) => control.type)).toEqual(['hello', 'list', 'list'])
  expect(launches).toBe(1)
})

test('waits for socket readiness after the launcher consumes the connection window', async () => {
  const host = await fakeHost()
  await host.stop()
  const launching = Promise.withResolvers<void>()
  const releaseLaunch = Promise.withResolvers<void>()
  const launched = Promise.withResolvers<void>()
  let launches = 0
  const client = host.connect({
    launch: async () => {
      launches += 1
      launching.resolve()
      await releaseLaunch.promise
      launched.resolve()
    },
  })
  const opening = client.host().then(
    (hello) => ({ hello }),
    (error: unknown) => ({ error }),
  )

  try {
    await launching.promise
    await Bun.sleep(HOST_CONNECT_TIMEOUT_MS + 25)
    releaseLaunch.resolve()
    await launched.promise
    await Bun.sleep(25)
    expect(host.received).toEqual([])
    expect(existsSync(host.paths.socket)).toBe(false)
    await host.listen()
    expect(await opening).toMatchObject({ hello: { pid: process.pid } })
    await expect(client.list()).resolves.toEqual([])
    expect(launches).toBe(1)
  } finally {
    releaseLaunch.resolve()
    client.close()
    await opening
  }
})

test('gives up on an absent socket after one launch and the readiness window', async () => {
  const host = await fakeHost()
  await host.stop()
  let launches = 0
  const client = host.connect({
    launch: () => {
      launches += 1
    },
  })
  const startedAt = performance.now()

  await expect(client.host()).rejects.toMatchObject({
    code: 'terminal.HOST_UNREACHABLE',
    internal: {
      launched: true,
      socketExists: false,
      readinessElapsedMs: expect.any(Number),
    },
  })
  expect(performance.now() - startedAt).toBeLessThan(2 * HOST_CONNECT_TIMEOUT_MS)
  expect(launches).toBe(1)
  expect(host.received).toEqual([])
  await expect(client.probe()).rejects.toMatchObject({
    internal: { reason: 'no-retained-connection' },
  })
})

test('keeps a reopened connection when a retired launch completes late', async () => {
  const host = await fakeHost()
  await host.stop()
  const launching = Promise.withResolvers<void>()
  const releaseLaunch = Promise.withResolvers<void>()
  let launches = 0
  const client = host.connect({
    launch: async () => {
      launches += 1
      launching.resolve()
      await releaseLaunch.promise
    },
  })
  const opening = client.host().catch((error: unknown) => error)

  try {
    await launching.promise
    client.close()
    expect(client.info()).toBeNull()
    await host.listen()
    const fresh = await client.host()
    releaseLaunch.resolve()
    expect(await opening).toMatchObject({
      code: 'terminal.HOST_UNREACHABLE',
      internal: { reason: 'retired-opening' },
    })
    expect(client.info()).toEqual(fresh)
    await expect(client.probe()).resolves.toEqual(fresh)
    await expect(client.list()).resolves.toEqual([])
    expect(launches).toBe(1)
  } finally {
    releaseLaunch.resolve()
    client.close()
    await opening
  }
})
