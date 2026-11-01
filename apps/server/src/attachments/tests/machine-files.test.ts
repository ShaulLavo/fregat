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
  type FileHandle,
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

async function copyFixture(bytes: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), 'platform-machine-copy-'))
  roots.push(root)
  const sourcePath = join(root, 'source.bin')
  const copyPath = join(root, 'copy.part')
  await writeFile(sourcePath, bytes)
  const source = await open(sourcePath, 'r')
  handles.push(() => source.close())
  const writer = await open(copyPath, 'wx')
  handles.push(() => writer.close())
  return { source, writer, copyPath }
}

function patternedBytes(length: number) {
  const bytes = Buffer.alloc(length)
  for (let index = 0; index < length; index++)
    bytes[index] = (index * 17 + Math.floor(index / 251) + Math.floor(index / 65_536) * 31) % 256
  return bytes
}

function boundedWriter(writer: FileHandle, maxBytes: number) {
  const writes: Array<{ offset: number; length: number; bytesWritten: number; bytes: Buffer }> = []
  return {
    writes,
    async write(buffer: Buffer, offset: number, length: number) {
      const { bytesWritten } = await writer.write(buffer, offset, Math.min(length, maxBytes))
      writes.push({
        offset,
        length,
        bytesWritten,
        bytes: Buffer.from(buffer.subarray(offset, offset + bytesWritten)),
      })
      return { bytesWritten }
    },
  }
}

test('copies exact bytes through an ordinary file writer', async () => {
  const bytes = patternedBytes(97)
  const { source, writer, copyPath } = await copyFixture(bytes)

  await copyExactly(source, writer, bytes.byteLength)

  expect(await readFile(copyPath)).toEqual(bytes)
})

test.each([40_097, 2 * 65_536 + 173])(
  'finishes short writes for a %i-byte source',
  async (length) => {
    const bytes = patternedBytes(length)
    const { source, writer, copyPath } = await copyFixture(bytes)
    const output = boundedWriter(writer, 10_007)

    await expect(copyExactly(source, output, bytes.byteLength)).resolves.toBeUndefined()

    const actual = await readFile(copyPath)
    expect(actual.byteLength).toBe(bytes.byteLength)
    expect(actual).toEqual(bytes)
    let written = 0
    for (const write of output.writes) {
      expect(write.offset).toBe(written % 65_536)
      expect(write.length).toBe(Math.min(65_536 - write.offset, bytes.byteLength - written))
      expect(write.bytesWritten).toBe(Math.min(write.length, 10_007))
      expect(write.bytes).toEqual(bytes.subarray(written, written + write.bytesWritten))
      written += write.bytesWritten
    }
    expect(written).toBe(bytes.byteLength)
  },
)

test('refuses a zero-progress write after a prefix', { timeout: 1_000 }, async () => {
  const bytes = patternedBytes(2 * 65_536 + 173)
  const { source, writer, copyPath } = await copyFixture(bytes)
  let calls = 0
  const output = {
    async write(buffer: Buffer, offset: number, length: number) {
      calls += 1
      expect(calls).toBeLessThanOrEqual(2)
      return writer.write(buffer, offset, calls === 1 ? Math.min(length, 7) : 0)
    },
  }

  await expect(copyExactly(source, output, bytes.byteLength)).rejects.toMatchObject({
    code: 'attachments.MACHINE_FILE_WRITE_STALLED',
    status: 500,
    internal: { chunkBytes: 65_536, writtenBytes: 7 },
  })

  expect(calls).toBe(2)
  expect(await readFile(copyPath)).toEqual(bytes.subarray(0, 7))
})

test(
  'propagates a writer failure after a prefix without retrying',
  { timeout: 1_000 },
  async () => {
    const bytes = patternedBytes(2 * 65_536 + 173)
    const { source, writer, copyPath } = await copyFixture(bytes)
    let calls = 0
    let writeError: unknown
    const output = {
      async write(buffer: Buffer, offset: number, length: number) {
        calls += 1
        if (calls === 1) {
          const result = await writer.write(buffer, offset, Math.min(length, 7))
          await writer.close()
          return result
        }
        return writer.write(buffer, offset, length).catch((error: unknown) => {
          writeError = error
          throw error
        })
      },
    }

    const failure = await copyExactly(source, output, bytes.byteLength).catch(
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({ code: 'EBADF' })
    expect(failure).toBe(writeError)
    expect(calls).toBe(2)
    expect(await readFile(copyPath)).toEqual(bytes.subarray(0, 7))
  },
)

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
