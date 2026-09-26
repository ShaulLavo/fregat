import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { agentTerminalHandoffs } from '../../db/schema'
import { createAgentTerminalFixture } from '../../../test/factories/agent-terminal'
import { createTestTerminalHost } from '../../terminal-host/testing'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close().catch(() => {})
})

async function fixtureWithHost() {
  const host = await createTestTerminalHost()
  cleanups.push(() => host.close())
  await host.client.host()
  const binary = path.join(host.stateRoot, 'agent')
  await writeFile(binary, '#!/bin/sh\nwhile :; do sleep 0.1; done\n')
  await chmod(binary, 0o700)
  const fixture = await createAgentTerminalFixture({ hostClient: host.client, binaryPath: binary })
  cleanups.push(() => fixture.close())
  const socket = fixture.socket()
  await socket.open()
  expect((await host.client.list()).filter((session) => !session.exited)).toHaveLength(1)
  return { host, fixture }
}

test('adopts a live agent terminal over two consecutive server restarts', async () => {
  const { fixture } = await fixtureWithHost()
  await fixture.restart()
  await expect(fixture.restart()).resolves.toBeUndefined()
  await expect(fixture.turn()).rejects.toMatchObject({ code: 'provider.SESSION_IN_TERMINAL' })
})

test('imports history and releases ownership when a restored agent exits', async () => {
  const { host, fixture } = await fixtureWithHost()
  await fixture.restart()
  fixture.adapter.history = [
    { sourceId: 'after-restart', role: 'assistant', text: 'CLI result', createdAt: null },
  ]
  const [session] = await host.client.list()
  await host.client.killSession(session!.session)
  await expect.poll(() => fixture.database.select().from(agentTerminalHandoffs).all()).toEqual([])
  expect(
    (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session.messages,
  ).toContainEqual(expect.objectContaining({ text: 'CLI result' }))
  await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
})

test('imports a host-confirmed agent exit during server downtime', async () => {
  const { host, fixture } = await fixtureWithHost()
  fixture.adapter.history = [
    { sourceId: 'while-down', role: 'assistant', text: 'Finished offline', createdAt: null },
  ]
  host.client.close()
  const observer = host.connect()
  const [session] = await observer.list()
  await observer.killSession(session!.session)
  await expect
    .poll(
      async () => (await observer.list()).find((row) => row.session === session!.session)?.exited,
    )
    .toBe(true)
  await fixture.restart()
  expect(fixture.database.select().from(agentTerminalHandoffs).all()).toEqual([])
  expect(
    (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session.messages,
  ).toContainEqual(expect.objectContaining({ text: 'Finished offline' }))
  await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
})
