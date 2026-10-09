import { createAttachmentTestOwnership } from '../../../test/factories/attachment-ownership'
import { createTestMachineFiles } from '../../../test/factories/machine-files'
import {
  appendFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import * as v from 'valibot'
import { afterEach, expect, test } from 'vitest'
import { MAX_CHAT_FILE_ATTACHMENT_BYTES, machineFileAttachmentSchema } from '@workspace/contracts'

import { copyExactly } from '../machine-files'
import { attachmentRoutes } from '../routes'
import { validateAttachmentUpload } from '../uploads'

const roots: string[] = []
const handles: Array<() => unknown> = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((close) => close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// A real 1x1 PNG, small enough to go to the provider inline.
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'platform-machine-files-'))
  roots.push(root)
  const attachmentsDir = join(root, 'state', 'attachments')
  await mkdir(join(root, 'project'), { recursive: true })
  const { ownership, close } = createAttachmentTestOwnership()
  handles.push(close)
  const machine = createTestMachineFiles(root)
  handles.push(machine.close)
  const app = new Elysia().use(
    attachmentRoutes({ attachmentsDir, files: machine.files, ownership }),
  )
  const attach = (path: string) =>
    app.handle(
      new Request('http://local/attachments/uploads/from-machine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
    )
  return { app, attach, attachmentsDir, ownership, root }
}

test('stages a text file from disk as a ready file attachment with the same bytes', async () => {
  const { app, attach, attachmentsDir, ownership, root } = await setup()
  await writeFile(join(root, 'project', 'notes.md'), '# Notes\n')

  const response = await attach('project/notes.md')

  expect(response.status).toBe(200)
  const staged = v.parse(machineFileAttachmentSchema, await response.json())
  expect(staged.attachment).toMatchObject({ type: 'file', name: 'notes.md', sizeBytes: 8 })
  expect(staged.attachment.mimeType).toMatch(/^text\/markdown/)
  const served = await app.handle(
    new Request(`http://local/attachments/${staged.attachment.id}.bin`),
  )
  expect(await served.text()).toBe('# Notes\n')
  // Ready to send: the same check a turn runs before it claims the upload.
  await expect(
    validateAttachmentUpload(attachmentsDir, staged.attachment, 'session', ownership),
  ).resolves.toEqual(staged.attachment)
})

test('stages a supported image as an image the provider receives inline', async () => {
  const { app, attach, root } = await setup()
  await writeFile(join(root, 'project', 'shot.png'), pngBytes)

  const response = await attach('project/shot.png')

  const staged = v.parse(machineFileAttachmentSchema, await response.json())
  expect(staged.attachment).toMatchObject({
    type: 'image',
    name: 'shot.png',
    mimeType: 'image/png',
    sizeBytes: pngBytes.byteLength,
  })
  const served = await app.handle(
    new Request(`http://local/attachments/${staged.attachment.id}.png`),
  )
  expect(Buffer.from(await served.arrayBuffer())).toEqual(pngBytes)
})

test('refuses empty, oversized, missing and folder paths without staging anything', async () => {
  const { attach, attachmentsDir, root } = await setup()
  await writeFile(join(root, 'project', 'empty.txt'), '')
  await writeFile(join(root, 'project', 'huge.log'), '')
  await truncate(join(root, 'project', 'huge.log'), MAX_CHAT_FILE_ATTACHMENT_BYTES + 1)

  const empty = await attach('project/empty.txt')
  const huge = await attach('project/huge.log')
  const missing = await attach('project/gone.txt')
  const folder = await attach('project')

  expect(empty.status).toBe(422)
  expect(huge.status).toBe(413)
  expect(missing.status).toBeGreaterThanOrEqual(400)
  expect(folder.status).toBeGreaterThanOrEqual(400)
  const leftovers = await Array.fromAsync(new Bun.Glob('upload-*').scan(attachmentsDir)).catch(
    () => [],
  )
  expect(leftovers).toEqual([])
})

test('a file that grows after its size was checked is refused, reading one byte past it', async () => {
  const { root } = await setup()
  const sourcePath = join(root, 'project', 'growing.log')
  const copyPath = join(root, 'copy.part')
  await writeFile(sourcePath, '0123456789')
  const source = await open(sourcePath, 'r')
  const writer = await open(copyPath, 'w')
  try {
    // The size was checked at 10 bytes; the file then grows well past it before the copy.
    await appendFile(sourcePath, 'x'.repeat(1024 * 1024))
    await expect(copyExactly(source, writer, 10)).rejects.toThrow(
      'changed while it was being attached',
    )
  } finally {
    await source.close()
    await writer.close()
  }
  expect((await readFile(copyPath)).byteLength).toBe(0)
})

test('a file that shrinks after its size was checked is refused', async () => {
  const { root } = await setup()
  const sourcePath = join(root, 'project', 'shrinking.log')
  await writeFile(sourcePath, '0123456789')
  const source = await open(sourcePath, 'r')
  const writer = await open(join(root, 'copy.part'), 'w')
  try {
    await truncate(sourcePath, 4)
    await expect(copyExactly(source, writer, 10)).rejects.toThrow(
      'changed while it was being attached',
    )
  } finally {
    await source.close()
    await writer.close()
  }
})

// Windows has no mkfifo; the check needs a named pipe on disk.
test.skipIf(Bun.which('mkfifo') === null)(
  'a FIFO at the path is refused without waiting for a writer',
  async () => {
    const { attach, root } = await setup()
    expect(Bun.spawnSync(['mkfifo', join(root, 'project', 'pipe')]).exitCode).toBe(0)
    const response = await attach('project/pipe')
    expect(response.status).toBeGreaterThanOrEqual(400)
  },
)
