import { afterEach, expect, test } from 'vitest'

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
