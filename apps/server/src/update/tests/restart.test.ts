import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { updateForApp } from '../../app'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import { closeTestApps } from '../../../test/server'
import { heldTurnAdapter, restartFixture } from '../../../test/factories/server-update'

const BUSY = v.parse(sessionIdSchema, '00000000-0000-4000-8000-00000000000a')
const IDLE = v.parse(sessionIdSchema, '00000000-0000-4000-8000-00000000000b')
const finishers: Array<() => void> = []

// Held turns end before the apps close, or the provider reactor never drains.
afterEach(async () => {
  for (const finish of finishers.splice(0)) finish()
  await closeTestApps()
})

function held() {
  const turns = heldTurnAdapter()
  finishers.push(turns.finish)
  return turns
}

describe('POST /server/restart', () => {
  it('restarts an idle server at once, and only once', async () => {
    const fixture = await restartFixture(new MockProviderAdapter())
    await fixture.createSession(await fixture.register(), IDLE, 'Idle session')

    expect((await fixture.restart([])).result).toEqual({ restarting: true })
    expect((await fixture.restart([])).result).toEqual({ restarting: true })

    expect(fixture.exits).toEqual([
      expect.objectContaining({ trigger: 'route', to: 'staged-release', interrupted: [] }),
    ])
    expect(updateForApp(fixture.app).state().phase).toBe('restarting')
    expect(
      JSON.parse(readFileSync(path.join(fixture.production, 'restart-approved.json'), 'utf8')),
    ).toEqual({
      release: 'staged-release',
      stagedAt: fixture.exits[0]!.stagedAt,
    })
    await expect(
      fixture.engine.dispatchClientCommand({
        type: 'session.checkpoint.revert',
        commandId: 'rewind-after-restart',
        sessionId: IDLE,
        turnCount: 0,
        restoreFiles: false,
      }),
    ).rejects.toMatchObject({ code: 'orchestration.SERVER_RESTARTING' })
  })

  it.each([
    ['no Origin', null, 401, 'UNAUTHORIZED'],
    ['a foreign Origin', 'https://example.com', 403, 'FORBIDDEN_ORIGIN'],
  ] as const)('refuses a request with %s', async (_, from, status, code) => {
    const fixture = await restartFixture(new MockProviderAdapter())

    const answer = await fixture.restart([], from)

    expect(answer.status).toBe(status)
    expect(answer.body).toMatchObject({ error: { code } })
    expect(fixture.exits).toEqual([])
    expect(updateForApp(fixture.app).state().phase).toBe('serving')
    expect(existsSync(path.join(fixture.production, 'restart-approved.json'))).toBe(false)
  })

  it('answers NO_UPDATE_STAGED with a fix when nothing is staged', async () => {
    const fixture = await restartFixture(new MockProviderAdapter(), { staged: false })

    const answer = await fixture.restart([])

    expect(answer.status).toBe(409)
    expect(answer.body).toMatchObject({
      error: { code: 'update.NO_UPDATE_STAGED', fix: expect.any(String) },
    })
    expect(fixture.exits).toEqual([])
  })

  it('names a running turn, restarts once it is named, and leaves a later send queued', async () => {
    const turns = held()
    const fixture = await restartFixture(turns.adapter)
    const worktreeId = await fixture.register()
    await fixture.createSession(worktreeId, BUSY, 'Busy session')
    await fixture.createSession(worktreeId, IDLE, 'Idle session')
    await fixture.send(BUSY, 'running-turn')
    await turns.started()

    const first = await fixture.restart([])
    expect(first.result).toEqual({
      restarting: false,
      busy: [
        { sessionId: BUSY, title: 'Busy session', projectTitle: 'Platform', state: 'running' },
      ],
    })
    expect(fixture.exits).toEqual([])
    expect(updateForApp(fixture.app).state().phase).toBe('serving')

    expect(existsSync(path.join(fixture.production, 'restart-approved.json'))).toBe(false)
    expect((await fixture.restart([BUSY])).result).toEqual({ restarting: true })
    expect(fixture.exits).toEqual([
      expect.objectContaining({ interrupted: [{ sessionId: BUSY, state: 'running' }] }),
    ])

    await fixture.send(IDLE, 'queued-turn')
    turns.finish()
    await fixture.engine.providerRuntimeIdle()
    expect(await fixture.latestTurn(IDLE)).toMatchObject({ providerStartState: 'queued' })
    expect(turns.adapter.startedTurns.map((turn) => turn.turnId)).toEqual(['running-turn'])

    const next = new MockProviderAdapter()
    await fixture.reopen(next)
    await expect.poll(() => next.startedTurns.map((turn) => turn.turnId)).toEqual(['queued-turn'])
  })

  it('counts an unanswered approval as busy', async () => {
    const fixture = await restartFixture(new MockProviderAdapter())
    await fixture.createSession(await fixture.register(), IDLE, 'Asking session')
    await fixture.openApproval(IDLE, 'request-1')

    expect((await fixture.restart([])).result).toEqual({
      restarting: false,
      busy: [
        { sessionId: IDLE, title: 'Asking session', projectTitle: 'Platform', state: 'waiting' },
      ],
    })
    expect(fixture.exits).toEqual([])
  })

  it('refuses a restart while a session that became busy after the answer is unnamed', async () => {
    const turns = held()
    const fixture = await restartFixture(turns.adapter)
    const worktreeId = await fixture.register()
    await fixture.createSession(worktreeId, BUSY, 'Busy session')
    await fixture.createSession(worktreeId, IDLE, 'Later session')
    await fixture.send(BUSY, 'first-turn')
    await turns.started(1)
    const first = await fixture.restart([])
    expect(first.result).toMatchObject({ restarting: false, busy: [{ sessionId: BUSY }] })

    await fixture.send(IDLE, 'second-turn')
    await turns.started(2)

    expect((await fixture.restart([BUSY])).result).toMatchObject({
      restarting: false,
      busy: [{ sessionId: BUSY }, { sessionId: IDLE }],
    })
    expect(fixture.exits).toEqual([])
    expect((await fixture.restart([BUSY, IDLE])).result).toEqual({ restarting: true })
  })

  it('holds a claim that was mid-flight when the restart was accepted', async () => {
    const adapter = new MockProviderAdapter()
    const fixture = await restartFixture(adapter)
    await fixture.createSession(await fixture.register(), BUSY, 'Racing session')
    await fixture.send(BUSY, 'first-turn')
    await fixture.engine.providerRuntimeIdle()

    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    finishers.push(release.resolve)
    const hasRuntime = adapter.hasRuntime.bind(adapter)
    adapter.hasRuntime = async (input) => {
      entered.resolve()
      await release.promise
      return hasRuntime(input)
    }
    await fixture.send(BUSY, 'second-turn')
    await entered.promise

    expect((await fixture.restart([])).result).toEqual({ restarting: true })
    release.resolve()
    await fixture.engine.providerRuntimeIdle()

    expect(await fixture.latestTurn(BUSY)).toMatchObject({
      turnId: 'second-turn',
      providerStartState: 'queued',
    })
    expect(adapter.startedTurns.map((turn) => turn.turnId)).toEqual(['first-turn'])
    // A refused claim is not an abandoned start, so the reusable runtime survives it.
    expect(await hasRuntime({ sessionId: BUSY })).toBe(true)
  })
})
