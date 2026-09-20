import { afterEach, expect, test } from 'vitest'
import {
  createOrchestrationFixture,
  executeGit,
  FIXTURE_SESSION_ID,
  mockRuntime,
  sessionFrom,
} from '../../../test/factories/orchestration'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import { createInternalError } from '../../observability/structured-errors'

const fixtures: Awaited<ReturnType<typeof createOrchestrationFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

test.each(['complete', 'fail'] as const)(
  'reserves rewind until native %s and permits retry of a conflicting send',
  async (outcome) => {
    const fixture = await createOrchestrationFixture()
    fixtures.push(fixture)
    await executeGit(fixture.checkout, 'init')
    await executeGit(
      fixture.checkout,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    )
    const adapter = new MockProviderAdapter()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const prepare = adapter.prepareRollbackSession.bind(adapter)
    adapter.prepareRollbackSession = async (input) => {
      const commit = await prepare(input)
      return async () => {
        entered.resolve()
        await release.promise
        if (outcome === 'fail') throw createInternalError('Native rewind failed')
        await commit()
      }
    }
    await fixture.restart({ ...mockRuntime(adapter), checkpointGit: fixture.registration.git })
    const registration = await fixture.register()
    await fixture.createSession(registration.result!.worktreeId)
    await fixture.startTurn()
    await fixture.engine.providerRuntimeIdle()
    const rewind = {
      type: 'session.checkpoint.revert',
      commandId: 'reserved-rewind',
      sessionId: FIXTURE_SESSION_ID,
      turnCount: 0,
      restoreFiles: false,
    }
    const send = {
      type: 'session.turn.start',
      commandId: 'send-during-rewind',
      sessionId: FIXTURE_SESSION_ID,
      turnId: 'new-turn',
      message: { messageId: 'new-prompt', role: 'user', text: 'Keep this prompt', attachments: [] },
    }
    try {
      await fixture.command(rewind)
      await entered.promise
      expect((await sessionFrom(fixture)).pendingRewindCommandId).toBe('reserved-rewind')
      const createdAt = new Date().toISOString()
      await fixture.command({
        type: 'session.activity.append',
        commandId: 'late-async-question',
        sessionId: FIXTURE_SESSION_ID,
        createdAt,
        activity: {
          id: 'late-async-question',
          sessionId: FIXTURE_SESSION_ID,
          createdAt,
          turnId: null,
          tone: 'info',
          kind: 'user-input.requested',
          summary: 'Late optional question',
          payload: {
            requestId: 'codex-async:late-question',
            responseMode: 'message',
            questions: [
              {
                id: '0',
                prompt: 'Continue?',
                answerKind: 'text',
                options: [],
                allowOther: true,
                secret: false,
              },
            ],
          },
        },
      })
      await expect(
        fixture.command({
          type: 'session.user-input.respond',
          commandId: 'answer-during-rewind',
          sessionId: FIXTURE_SESSION_ID,
          requestId: 'codex-async:late-question',
          answers: { '0': 'yes' },
        }),
      ).rejects.toMatchObject({ code: 'orchestration.SESSION_REWIND_PENDING' })
      expect(
        (await sessionFrom(fixture)).messages.some(
          (message) => message.id === 'async-answer:codex-async:late-question',
        ),
      ).toBe(false)

      await expect(fixture.command(send)).rejects.toMatchObject({
        code: 'orchestration.SESSION_REWIND_PENDING',
      })
      await expect(
        fixture.command({ ...rewind, commandId: 'second-rewind' }),
      ).rejects.toMatchObject({ code: 'orchestration.SESSION_REWIND_PENDING' })
      await expect(
        fixture.command({
          type: 'session.archive',
          commandId: 'archive-during-rewind',
          sessionId: FIXTURE_SESSION_ID,
        }),
      ).rejects.toMatchObject({ code: 'orchestration.SESSION_REWIND_PENDING' })
      release.resolve()
      await fixture.engine.providerRuntimeIdle()
      expect((await sessionFrom(fixture)).pendingRewindCommandId).toBeNull()
      await fixture.command(send)
      await fixture.engine.providerRuntimeIdle()
      expect(
        (await sessionFrom(fixture)).messages.some((message) => message.id === 'new-prompt'),
      ).toBe(true)
    } finally {
      release.resolve()
    }
  },
)

test('restart reports an interrupted durable rewind once and clears its reservation', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.command({
    type: 'session.checkpoint.revert',
    commandId: 'rewind-before-crash',
    sessionId: FIXTURE_SESSION_ID,
    turnCount: 0,
    restoreFiles: false,
  })
  expect((await sessionFrom(fixture)).pendingRewindCommandId).toBe('rewind-before-crash')
  await fixture.restart()
  expect((await sessionFrom(fixture)).pendingRewindCommandId).toBeNull()
  const failures = (await sessionFrom(fixture)).activities.filter(
    (activity) => activity.kind === 'checkpoint.revert.failed',
  )
  expect(failures).toHaveLength(1)
  expect(failures[0]!.payload).toMatchObject({ commandId: 'rewind-before-crash' })
  await fixture.restart()
  expect(
    (await sessionFrom(fixture)).activities.filter(
      (activity) => activity.kind === 'checkpoint.revert.failed',
    ),
  ).toHaveLength(1)
  await fixture.startTurn()
})

test('a late failure cannot release a newer rewind reservation', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.command({
    type: 'session.checkpoint.revert',
    commandId: 'new-rewind',
    sessionId: FIXTURE_SESSION_ID,
    turnCount: 0,
    restoreFiles: false,
  })
  const createdAt = new Date().toISOString()
  await fixture.command({
    type: 'session.activity.append',
    commandId: 'old-failure',
    sessionId: FIXTURE_SESSION_ID,
    createdAt,
    activity: {
      id: 'old-rewind-failure',
      sessionId: FIXTURE_SESSION_ID,
      createdAt,
      turnId: null,
      tone: 'error',
      kind: 'checkpoint.revert.failed',
      summary: 'Old failure',
      payload: { commandId: 'old-rewind', detail: 'old failure' },
    },
  })
  expect((await sessionFrom(fixture)).pendingRewindCommandId).toBe('new-rewind')
})

test.each([false, true])(
  'reserves the worktree only for a file-restoring rewind: %s',
  async (restoreFiles) => {
    const fixture = await createOrchestrationFixture()
    fixtures.push(fixture)
    const registration = await fixture.register()
    const worktreeId = registration.result!.worktreeId
    await fixture.createSession(worktreeId)
    await fixture.command({
      type: 'session.checkpoint.revert',
      commandId: 'reserve-worktree',
      sessionId: FIXTURE_SESSION_ID,
      turnCount: 0,
      restoreFiles,
    })
    const creation = fixture.createSession(worktreeId, 'a0000000-0000-4000-8000-000000000012')
    if (!restoreFiles) {
      await expect(creation).resolves.toBeDefined()
      return
    }
    await expect(creation).rejects.toMatchObject({ code: 'orchestration.SESSION_REWIND_PENDING' })
    await expect(
      fixture.command({
        type: 'worktree.cleanup',
        commandId: 'cleanup-during-rewind',
        worktreeId,
      }),
    ).rejects.toMatchObject({ code: 'orchestration.SESSION_REWIND_PENDING' })
  },
)
