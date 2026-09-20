import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { expect, onTestFinished, test } from 'vitest'
import {
  createOrchestrationFixture,
  FIXTURE_SESSION_ID,
} from '../../../test/factories/orchestration'
import { createAttachmentOwnership } from '../../attachments/ownership'
import {
  createAttachmentUpload,
  storeAttachmentUpload,
  deletePendingAttachmentUpload,
} from '../../attachments/uploads'

test('rejected admission leaves uploads pending; accepted ownership survives rewind and is reclaimed on delete', async () => {
  const fixture = await createOrchestrationFixture()
  onTestFinished(() => fixture.close())
  const ownership = createAttachmentOwnership(fixture.database)
  const directory = join(fixture.root, 'attachments')
  const ticket = await createAttachmentUpload(
    directory,
    { type: 'file', name: 'notes.txt', mimeType: 'text/plain', sizeBytes: 5 },
    ownership,
  )
  await storeAttachmentUpload(
    directory,
    ticket.attachment.id,
    new Blob(['hello']).stream(),
    ownership,
  )
  const send = (sessionId: string, commandId: string) =>
    fixture.engine.dispatchClientCommand({
      type: 'session.turn.start',
      sessionId,
      commandId,
      turnId: `turn-${commandId}`,
      message: {
        messageId: `message-${commandId}`,
        role: 'user',
        text: 'Use the notes',
        attachments: [ticket.attachment],
      },
    })
  await expect(send(FIXTURE_SESSION_ID, 'missing')).rejects.toThrow()
  expect(ownership.owner(ticket.attachment.id)).toBeNull()
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await send(FIXTURE_SESSION_ID, 'accepted')
  expect(ownership.owner(ticket.attachment.id)).toBe(FIXTURE_SESSION_ID)
  await deletePendingAttachmentUpload(directory, ticket.attachment.id, ownership)
  expect(await stat(join(directory, `${ticket.attachment.id}.bin`))).toBeTruthy()
  await fixture.command({
    type: 'session.revert.complete',
    commandId: 'rewind',
    revertCommandId: 'rewind-request',
    sessionId: FIXTURE_SESSION_ID,
    turnCount: 0,
    createdAt: new Date().toISOString(),
  })
  expect(
    (await fixture.engine.sessionDetailSnapshot(FIXTURE_SESSION_ID)).session.messages,
  ).toHaveLength(0)
  await fixture.restart()
  expect(ownership.attachmentsForSession(FIXTURE_SESSION_ID)).toEqual([ticket.attachment])
  await fixture.command({
    type: 'session.delete',
    commandId: 'delete',
    sessionId: FIXTURE_SESSION_ID,
  })
  await fixture.engine.providerRuntimeIdle()
  expect(ownership.owner(ticket.attachment.id)).toBeNull()
  expect(await stat(join(directory, `${ticket.attachment.id}.bin`)).catch(() => null)).toBeNull()
  expect(await stat(join(directory, `${ticket.attachment.id}.json`)).catch(() => null)).toBeNull()
})

test('event commit failure rolls back the attachment claim in the same transaction', async () => {
  const fixture = await createOrchestrationFixture()
  onTestFinished(() => fixture.close())
  const ownership = createAttachmentOwnership(fixture.database)
  const directory = join(fixture.root, 'attachments')
  const ticket = await createAttachmentUpload(
    directory,
    { type: 'file', name: 'notes.txt', mimeType: 'text/plain', sizeBytes: 5 },
    ownership,
  )
  await storeAttachmentUpload(
    directory,
    ticket.attachment.id,
    new Blob(['hello']).stream(),
    ownership,
  )
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  fixture.sqlite.exec(
    "CREATE TRIGGER reject_upload_message BEFORE INSERT ON projection_session_messages BEGIN SELECT RAISE(ABORT, 'injected projection failure'); END",
  )
  await expect(
    fixture.engine.dispatchClientCommand({
      type: 'session.turn.start',
      commandId: 'rejected-transaction',
      sessionId: FIXTURE_SESSION_ID,
      turnId: 'rejected-turn',
      message: {
        messageId: 'rejected-message',
        role: 'user',
        text: 'Hello',
        attachments: [ticket.attachment],
      },
    }),
  ).rejects.toThrow('injected projection failure')
  expect(ownership.owner(ticket.attachment.id)).toBeNull()
  expect(
    (await fixture.engine.sessionDetailSnapshot(FIXTURE_SESSION_ID)).session.messages,
  ).toHaveLength(0)
  await deletePendingAttachmentUpload(directory, ticket.attachment.id, ownership)
  expect(await stat(join(directory, `${ticket.attachment.id}.bin`)).catch(() => null)).toBeNull()
})
