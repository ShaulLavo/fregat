import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ChatAttachmentUpload } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { readAttachmentBytes, writeAttachmentFromDataUrl } from '../store'

const roots: string[] = []

// A real 1x1 PNG header + payload; bytes are compared verbatim after round-trip.
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
])

async function createAttachmentsDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-attachments-'))
  roots.push(root)
  return path.join(root, 'attachments')
}

function pngUpload(overrides: Partial<ChatAttachmentUpload> = {}): ChatAttachmentUpload {
  return {
    type: 'image',
    id: 'thread-1-0000',
    name: 'shot.png',
    mimeType: 'image/png',
    sizeBytes: pngBytes.byteLength,
    dataUrl: `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`,
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('writeAttachmentFromDataUrl', () => {
  it('round-trips identical bytes through the store', async () => {
    const attachmentsDir = await createAttachmentsDir()
    const attachment = pngUpload()

    const written = await writeAttachmentFromDataUrl({ attachmentsDir, attachment })
    expect(written.bytesWritten).toBe(pngBytes.byteLength)
    expect(written.filePath).toBe(path.join(attachmentsDir, 'thread-1-0000.png'))

    const read = await readAttachmentBytes({ attachmentsDir, attachment })
    expect(read).not.toBeNull()
    expect(Array.from(read ?? [])).toEqual(Array.from(pngBytes))
  })

  it('rejects a data URL whose type disagrees with the declared mime type', async () => {
    const attachmentsDir = await createAttachmentsDir()
    const attachment = pngUpload({ mimeType: 'image/webp' })

    await expect(writeAttachmentFromDataUrl({ attachmentsDir, attachment })).rejects.toThrow(
      /disagrees with declared/,
    )
  })

  it('rejects a mime type outside the Anthropic allowlist', async () => {
    const attachmentsDir = await createAttachmentsDir()
    const attachment = pngUpload({
      mimeType: 'image/svg+xml',
      dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
    })

    await expect(writeAttachmentFromDataUrl({ attachmentsDir, attachment })).rejects.toThrow(
      /unsupported image type/,
    )
  })

  it('rejects a malformed data URL', async () => {
    const attachmentsDir = await createAttachmentsDir()
    const attachment = pngUpload({ dataUrl: 'data:image/png,not-base64' })

    await expect(writeAttachmentFromDataUrl({ attachmentsDir, attachment })).rejects.toThrow(
      /malformed base64 data URL/,
    )
  })

  it('rejects an attachment with no bytes to persist', async () => {
    const attachmentsDir = await createAttachmentsDir()
    const attachment = pngUpload({ dataUrl: undefined })

    await expect(writeAttachmentFromDataUrl({ attachmentsDir, attachment })).rejects.toThrow(
      /carries no dataUrl/,
    )
  })

  it('rejects an id that escapes the attachments root', async () => {
    const attachmentsDir = await createAttachmentsDir()
    const attachment = pngUpload({ id: '../../etc/passwd' })

    await expect(writeAttachmentFromDataUrl({ attachmentsDir, attachment })).rejects.toThrow(
      /resolves outside the attachments root/,
    )
  })
})

describe('readAttachmentBytes', () => {
  it('returns null when the blob was never written', async () => {
    const attachmentsDir = await createAttachmentsDir()

    expect(await readAttachmentBytes({ attachmentsDir, attachment: pngUpload() })).toBeNull()
  })

  it('returns null when the blob was deleted after the write', async () => {
    const attachmentsDir = await createAttachmentsDir()
    const attachment = pngUpload()

    const written = await writeAttachmentFromDataUrl({ attachmentsDir, attachment })
    await unlink(written.filePath)

    expect(await readAttachmentBytes({ attachmentsDir, attachment })).toBeNull()
  })

  it('returns null for an unsupported mime type instead of throwing', async () => {
    const attachmentsDir = await createAttachmentsDir()

    expect(
      await readAttachmentBytes({
        attachmentsDir,
        attachment: pngUpload({ mimeType: 'image/svg+xml' }),
      }),
    ).toBeNull()
  })

  it('returns null for an id that escapes the attachments root', async () => {
    const attachmentsDir = await createAttachmentsDir()

    expect(
      await readAttachmentBytes({
        attachmentsDir,
        attachment: pngUpload({ id: '../../etc/passwd' }),
      }),
    ).toBeNull()
  })
})
