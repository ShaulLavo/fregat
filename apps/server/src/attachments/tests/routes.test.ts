import { createAttachmentTestOwnership } from '../../../test/factories/attachment-ownership'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chatAttachmentUrlPath, type ChatAttachmentUpload } from '@workspace/contracts'
import { Elysia } from 'elysia'
import { afterEach, describe, expect, it } from 'vitest'

import { attachmentRoutes } from '../routes'
import { writeAttachmentFromDataUrl } from '../store'

const roots: string[] = []
const handles: Array<() => void> = []

// A real 1x1 PNG header + payload; the route must hand these bytes back verbatim.
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
])

function pngUpload(overrides: Partial<ChatAttachmentUpload> = {}): ChatAttachmentUpload {
  return {
    type: 'image',
    id: 'image-a1b2c3',
    name: 'shot.png',
    mimeType: 'image/png',
    sizeBytes: pngBytes.byteLength,
    dataUrl: `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`,
    ...overrides,
  }
}

async function createAttachmentsDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-attachment-routes-'))
  roots.push(root)
  return path.join(root, 'attachments')
}

function testApp(attachmentsDir: string) {
  const { ownership, close } = createAttachmentTestOwnership()
  handles.push(close)
  return new Elysia().use(attachmentRoutes({ attachmentsDir, ownership }))
}

function attachmentRequest(attachment: ChatAttachmentUpload) {
  return new Request(`http://local${chatAttachmentUrlPath(attachment)}`)
}

afterEach(async () => {
  handles.splice(0).forEach((close) => close())
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('attachmentRoutes', () => {
  it('serves the bytes the store wrote at the url the contract derives', async () => {
    const attachmentsDir = await createAttachmentsDir()
    const attachment = pngUpload()
    await writeAttachmentFromDataUrl({ attachmentsDir, attachment })

    const response = await testApp(attachmentsDir).handle(attachmentRequest(attachment))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe(String(pngBytes.byteLength))
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(pngBytes))
  })

  it('404s for a blob that was never written', async () => {
    const attachmentsDir = await createAttachmentsDir()

    const response = await testApp(attachmentsDir).handle(attachmentRequest(pngUpload()))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { message: 'attachment unavailable' } })
  })

  it('404s for an extension outside the stored allowlist', async () => {
    const attachmentsDir = await createAttachmentsDir()

    const response = await testApp(attachmentsDir).handle(
      new Request('http://local/attachments/shot.svg'),
    )

    expect(response.status).toBe(404)
  })

  it('refuses to serve anything outside the attachments root', async () => {
    const attachmentsDir = await createAttachmentsDir()
    const app = testApp(attachmentsDir)

    for (const fileName of ['..%2F..%2Fetc%2Fpasswd.png', '%2Fetc%2Fpasswd.png']) {
      const response = await app.handle(new Request(`http://local/attachments/${fileName}`))
      expect(response.status).toBe(404)
    }
  })
})
