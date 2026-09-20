import { afterEach, expect, test } from 'vitest'
import { join } from 'node:path'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import {
  createOrchestrationFixture,
  FIXTURE_SESSION_ID,
  mockRuntime,
} from '../../../test/factories/orchestration'

const fixtures: Awaited<ReturnType<typeof createOrchestrationFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

test('native question attachments persist and become quoted server paths without altering callback protocol', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const adapter = new MockProviderAdapter()
  await fixture.restart(mockRuntime(adapter))
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.startTurn()
  await fixture.engine.providerRuntimeIdle()
  await fixture.engine.dispatchClientCommand({
    type: 'session.user-input.respond',
    commandId: 'native-question-images',
    sessionId: FIXTURE_SESSION_ID,
    requestId: 'native-question',
    answers: { first: 'Look here', second: ['Selected'] },
    attachmentsByQuestionId: {
      first: [
        {
          type: 'image',
          id: 'first-image',
          name: 'first "image".png',
          mimeType: 'image/png',
          sizeBytes: 3,
          dataUrl: 'data:image/png;base64,YWJj',
        },
      ],
      second: [
        {
          type: 'image',
          id: 'second-image',
          name: 'second.png',
          mimeType: 'image/png',
          sizeBytes: 3,
          dataUrl: 'data:image/png;base64,ZGVm',
        },
      ],
    },
  })
  await fixture.engine.providerRuntimeIdle()
  expect(adapter.userInputResponses).toHaveLength(1)
  expect(adapter.userInputResponses[0]?.answers).toEqual({
    first: `Look here\n\nAttached image "first \\"image\\".png": ${JSON.stringify(join(fixture.root, 'attachments', 'first-image.png'))}`,
    second: [
      'Selected',
      `Attached image "second.png": ${JSON.stringify(join(fixture.root, 'attachments', 'second-image.png'))}`,
    ],
  })
  const replay = await fixture.engine.replay({ afterSequence: 0 })
  expect(JSON.stringify(replay)).not.toContain('data:image')
})
