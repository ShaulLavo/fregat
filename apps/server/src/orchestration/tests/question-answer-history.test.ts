import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import {
  createOrchestrationFixture,
  FIXTURE_SESSION_ID,
  sessionFrom,
} from '../../../test/factories/orchestration'

test('native attachment answers retain question ownership without prematurely resolving the callback', async () => {
  const fixture = await createOrchestrationFixture()
  onTestFinished(() => fixture.close())
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.command({
    type: 'session.activity.append',
    createdAt: new Date().toISOString(),
    commandId: 'request',
    sessionId: FIXTURE_SESSION_ID,
    activity: {
      id: 'native-question',
      sessionId: FIXTURE_SESSION_ID,
      kind: 'user-input.requested',
      summary: 'A question',
      tone: 'info',
      turnId: null,
      createdAt: new Date().toISOString(),
      payload: {
        requestId: 'native-request',
        questions: [
          {
            id: 'language',
            prompt: 'Which language?',
            answerKind: 'text',
            options: [],
            allowOther: true,
            secret: false,
          },
        ],
      },
    },
  })
  const attachments = [
    {
      id: 'answer-file',
      type: 'file',
      name: 'requirements.md',
      mimeType: 'text/markdown',
      sizeBytes: 25,
    },
  ]
  await fixture.command({
    type: 'session.user-input.respond',
    commandId: 'answer',
    sessionId: FIXTURE_SESSION_ID,
    requestId: 'native-request',
    answers: { language: 'Rust' },
    attachmentsByQuestionId: { language: attachments },
  })
  const session = await sessionFrom(fixture)
  expect(session.pendingUserInputCount).toBe(1)
  expect(
    session.activities.find((activity) => activity.kind === 'user-input.answer-submitted')?.payload,
  ).toEqual({
    requestId: 'native-request',
    answers: { language: 'Rust' },
    questionTextById: { language: 'Which language?' },
    attachmentsByQuestionId: { language: attachments },
    detail: 'requirements.md',
  })
  const attachmentsDir = join(fixture.root, 'attachments')
  await mkdir(attachmentsDir, { recursive: true })
  const blob = join(attachmentsDir, 'answer-file.bin')
  await writeFile(blob, 'native answer bytes')
  await fixture.restart()
  expect(
    (await sessionFrom(fixture)).activities.some(
      (activity) => activity.kind === 'user-input.answer-submitted',
    ),
  ).toBe(true)
  await fixture.command({
    type: 'session.delete',
    commandId: 'delete',
    sessionId: FIXTURE_SESSION_ID,
  })
  await fixture.engine.providerRuntimeIdle()
  expect(await stat(blob).catch(() => null)).toBeNull()
  expect((await sessionFrom(fixture)).deletion?.blobCleanup).toBe('completed')
})
