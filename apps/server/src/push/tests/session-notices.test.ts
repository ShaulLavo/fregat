import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeApp } from '../../app'
import { closeTestApps, createTestDatabase } from '../../../test/server'
import { createInProcessOrchestrationSocket } from '../../../test/orchestration-socket'
import {
  createPushSessionFixture,
  PUSH_SESSION_ID,
  PUSH_SESSION_ORIGIN,
} from '../../../test/factories/push-sessions'
import type { MetadataDatabaseHandle } from '../../db/client'

const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('session notices over push', () => {
  it('pushes a completed turn to every device with its title, tag and session path', async () => {
    const fixture = await pushFixture({ pushNotifications: true })
    const subscriber = await fixture.register()
    await fixture.createSession()

    await fixture.runTurn('turn-1')

    await expect.poll(() => fixture.pushed.length).toBe(1)
    const notice = JSON.parse(subscriber.decrypt(fixture.pushed[0]!.body))
    expect(notice).toMatchObject({
      title: 'Session completed',
      body: 'Fixture session',
      tag: `${fixture.environmentId}:${PUSH_SESSION_ID}`,
    })
    expect(notice.path).toMatch(
      new RegExp(`^~checkout\\.[A-Za-z0-9_-]+/chat/t/${PUSH_SESSION_ID}$`),
    )
    const workspaceId = notice.path.split('/')[0].slice('~checkout.'.length)
    const resolved = await fixture.get(`/fs/workspace-address/${workspaceId}`)
    expect(resolved.status).toBe(200)
    expect(await resolved.json()).toMatchObject({ path: 'checkout' })
  })

  it('sends nothing while the setting is off, and starts from a fresh baseline when it turns on', async () => {
    const fixture = await pushFixture({ pushNotifications: false })
    await fixture.register()
    await fixture.createSession()

    await fixture.runTurn('turn-1')
    await fixture.settle()
    expect(fixture.pushed).toHaveLength(0)

    await fixture.setPush(true)
    await fixture.settle()
    expect(fixture.pushed).toHaveLength(0)
    await fixture.runTurn('turn-2')
    await expect.poll(() => fixture.pushed.length).toBe(1)
  })

  it('holds the push while a connected window is focused, and not after it disconnects', async () => {
    const fixture = await pushFixture({ pushNotifications: true })
    await fixture.register()
    await fixture.createSession()
    const socket = createInProcessOrchestrationSocket(fixture.app, PUSH_SESSION_ORIGIN)
    socket.receive({ kind: 'presence', focused: true })

    await fixture.runTurn('turn-1')
    await fixture.settle()
    expect(fixture.pushed).toHaveLength(0)

    socket.receive({ kind: 'presence', focused: false })
    socket.receive({ kind: 'presence', focused: true })
    socket.disconnect()
    await fixture.runTurn('turn-2')
    await expect.poll(() => fixture.pushed.length).toBe(1)
  })

  it('announces nothing for the history a restarted server boots with', async () => {
    const database = createTestDatabase()
    const first = await pushFixture({ pushNotifications: false, database })
    await first.register()
    await first.createSession()
    await first.runTurn('turn-1')
    await closeApp(first.app)

    const restarted = await pushFixture({ pushNotifications: true, database, root: first.root })
    await restarted.settle()
    expect(restarted.pushed).toHaveLength(0)
    await restarted.runTurn('turn-2')
    await expect.poll(() => restarted.pushed.length).toBe(1)
  })

  it('removes a device whose push service answers 410', async () => {
    const fixture = await pushFixture({ pushNotifications: true, answer: 410 })
    await fixture.register()
    await fixture.createSession()

    await fixture.runTurn('turn-1')

    await expect.poll(() => fixture.pushed.length).toBe(1)
    await expect.poll(async () => (await fixture.devices()).devices).toEqual([])
  })
})

async function pushFixture(options: {
  readonly pushNotifications: boolean
  readonly answer?: number
  readonly database?: MetadataDatabaseHandle
  readonly root?: string
}) {
  return createPushSessionFixture({ ...options, root: options.root ?? (await tempRoot()) })
}

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'push-session-notices-'))
  roots.push(root)
  return root
}
