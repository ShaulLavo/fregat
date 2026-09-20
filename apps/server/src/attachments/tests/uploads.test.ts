import { createAttachmentTestOwnership } from '../../../test/factories/attachment-ownership'
import { withAttachmentLanes } from '../lanes'
import type { AttachmentOwnership } from '../ownership'
import type { ChatAttachment } from '@workspace/contracts'
import { deleteAttachmentBlobs } from '../store'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { Elysia } from 'elysia'
import { attachmentRoutes } from '../routes'
import {
  collectSessionUploadAttachments,
  validateAttachmentUpload,
  createAttachmentUpload,
  storeAttachmentUpload,
  deletePendingAttachmentUpload,
} from '../uploads'

const roots: string[] = []
const handles: Array<() => void> = []
afterEach(async () => {
  handles.splice(0).forEach((close) => close())
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function setup() {
  const root = await mkdtemp('/work/tmp/platform-file-uploads-')
  roots.push(root)
  const attachmentsDir = join(root, 'attachments')
  const { ownership, close } = createAttachmentTestOwnership()
  handles.push(close)
  return {
    attachmentsDir,
    ownership,
    app: new Elysia().use(attachmentRoutes({ attachmentsDir, ownership })),
  }
}
const input = { type: 'file' as const, name: 'notes.txt', mimeType: 'text/plain', sizeBytes: 5 }
const body = () => new Blob(['hello']).stream()

test('streams a file, serves exact bytes as a download, and claims it for one session', async () => {
  const { app, attachmentsDir, ownership } = await setup()
  const issued = await app.handle(
    new Request('http://local/attachments/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
  expect(issued.status).toBe(200)
  const ticket = await issued.json()
  const uploaded = await app.handle(
    new Request(`http://local${ticket.uploadPath}`, { method: 'PUT', body: 'hello' }),
  )
  expect(uploaded.status).toBe(200)
  const attachment = await uploaded.json()
  const downloaded = await app.handle(new Request(`http://local/attachments/${attachment.id}.bin`))
  expect(await downloaded.text()).toBe('hello')
  expect(downloaded.headers.get('content-disposition')).toContain('notes.txt')
  expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff')
  await expect(commitUpload(ownership, attachmentsDir, attachment, 'session-one')).resolves.toEqual(
    attachment,
  )
  await expect(commitUpload(ownership, attachmentsDir, attachment, 'session-one')).resolves.toEqual(
    attachment,
  )
  await expect(commitUpload(ownership, attachmentsDir, attachment, 'session-two')).rejects.toThrow(
    'another session',
  )
})

test('rejects overlong and incomplete bodies without publishing a ready reference', async () => {
  const { attachmentsDir, ownership } = await setup()
  const ticket = await createAttachmentUpload(attachmentsDir, input, ownership)
  await expect(
    storeAttachmentUpload(
      attachmentsDir,
      ticket.attachment.id,
      new Blob(['toolong']).stream(),
      ownership,
    ),
  ).rejects.toThrow('declared size')
  await expect(
    storeAttachmentUpload(
      attachmentsDir,
      ticket.attachment.id,
      new Blob(['hi']).stream(),
      ownership,
    ),
  ).rejects.toThrow('all bytes')
  await expect(
    commitUpload(ownership, attachmentsDir, ticket.attachment, 'session'),
  ).rejects.toThrow('fully uploaded')
  await storeAttachmentUpload(attachmentsDir, ticket.attachment.id, body(), ownership)
  await expect(
    commitUpload(ownership, attachmentsDir, ticket.attachment, 'session'),
  ).resolves.toEqual(ticket.attachment)
})

test('rejects tampered metadata and prevents rewriting bytes after claim', async () => {
  const { attachmentsDir, ownership } = await setup()
  const ticket = await createAttachmentUpload(attachmentsDir, input, ownership)
  await storeAttachmentUpload(attachmentsDir, ticket.attachment.id, body(), ownership)
  await expect(
    commitUpload(
      ownership,
      attachmentsDir,
      { ...ticket.attachment, name: 'different.txt' },
      'session',
    ),
  ).rejects.toThrow('metadata')
  await commitUpload(ownership, attachmentsDir, ticket.attachment, 'session')
  const replacement = body()
  const reader = vi.spyOn(replacement, 'getReader')
  await expect(
    storeAttachmentUpload(attachmentsDir, ticket.attachment.id, replacement, ownership),
  ).rejects.toThrow('already sent')
  expect(reader).not.toHaveBeenCalled()
})

test('rejects traversal and file limits at the route boundary', async () => {
  const { app, attachmentsDir, ownership } = await setup()
  await expect(
    storeAttachmentUpload(attachmentsDir, '../outside', body(), ownership),
  ).rejects.toThrow('Invalid attachment')
  const response = await app.handle(
    new Request('http://local/attachments/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, sizeBytes: 51 * 1024 * 1024 }),
    }),
  )
  expect(response.status).toBeGreaterThanOrEqual(400)
})

test('claim queued behind a streaming upload protects the blob from pending deletion', async () => {
  const { attachmentsDir, ownership } = await setup()
  const ticket = await createAttachmentUpload(attachmentsDir, input, ownership)
  let streamController!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
  })
  const storing = storeAttachmentUpload(attachmentsDir, ticket.attachment.id, stream, ownership)
  const claiming = commitUpload(ownership, attachmentsDir, ticket.attachment, 'owner')
  const deleting = deletePendingAttachmentUpload(attachmentsDir, ticket.attachment.id, ownership)
  streamController.enqueue(new TextEncoder().encode('hello'))
  streamController.close()
  await Promise.all([storing, claiming, deleting])
  expect(await Bun.file(join(attachmentsDir, `${ticket.attachment.id}.bin`)).text()).toBe('hello')
})

test('deletion queued behind a streaming upload removes completed bytes and all metadata', async () => {
  const { attachmentsDir, ownership } = await setup()
  const ticket = await createAttachmentUpload(attachmentsDir, input, ownership)
  let streamController!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
  })
  const storing = storeAttachmentUpload(attachmentsDir, ticket.attachment.id, stream, ownership)
  const deleting = deletePendingAttachmentUpload(attachmentsDir, ticket.attachment.id, ownership)
  const claiming = commitUpload(ownership, attachmentsDir, ticket.attachment, 'owner')
  const rejectedClaim = expect(claiming).rejects.toThrow('expired or was removed')
  streamController.enqueue(new TextEncoder().encode('hello'))
  streamController.close()
  await Promise.all([storing, deleting, rejectedClaim])
  expect(await readdir(attachmentsDir)).toEqual([])
  await expect(
    storeAttachmentUpload(attachmentsDir, ticket.attachment.id, body(), ownership),
  ).rejects.toThrow('expired or was removed')
})

test('session cleanup removes uploaded bytes and ownership metadata', async () => {
  const { attachmentsDir, ownership } = await setup()
  const ticket = await createAttachmentUpload(attachmentsDir, input, ownership)
  await storeAttachmentUpload(attachmentsDir, ticket.attachment.id, body(), ownership)
  await commitUpload(ownership, attachmentsDir, ticket.attachment, 'owner')
  expect(
    await deleteAttachmentBlobs({ attachmentsDir, ownership, attachments: [ticket.attachment] }),
  ).toBe(1)
  expect(await readdir(attachmentsDir)).toEqual([])
})

test('owned upload collection survives pruned projection references and isolates sessions', async () => {
  const { attachmentsDir, ownership } = await setup()
  const ours = await createAttachmentUpload(attachmentsDir, input, ownership)
  const theirs = await createAttachmentUpload(attachmentsDir, input, ownership)
  await storeAttachmentUpload(attachmentsDir, ours.attachment.id, body(), ownership)
  await storeAttachmentUpload(attachmentsDir, theirs.attachment.id, body(), ownership)
  await commitUpload(ownership, attachmentsDir, ours.attachment, 'rewound-session')
  await commitUpload(ownership, attachmentsDir, theirs.attachment, 'other-session')
  const survivingOwnership = await collectSessionUploadAttachments(
    attachmentsDir,
    'rewound-session',
    ownership,
  )
  expect(survivingOwnership).toEqual([ours.attachment])
  await deleteAttachmentBlobs({ attachmentsDir, ownership, attachments: survivingOwnership })
  expect(
    await collectSessionUploadAttachments(attachmentsDir, 'rewound-session', ownership),
  ).toEqual([])
  expect(await Bun.file(join(attachmentsDir, `${theirs.attachment.id}.bin`)).text()).toBe('hello')
})

async function commitUpload(
  ownership: AttachmentOwnership,
  directory: string,
  attachment: ChatAttachment,
  sessionId: string,
) {
  return withAttachmentLanes(directory, [attachment.id], async () => {
    const validated = await validateAttachmentUpload(directory, attachment, sessionId, ownership)
    ownership.claim(validated, sessionId)
    return validated
  })
}
