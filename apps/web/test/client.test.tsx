import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chatAttachmentSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { directInProcessFetcher } from './client'
import { expect, test } from './fixtures'

test('DOM transport rejects stringified binary bodies from the real attachment route', async ({
  server,
}) => {
  const fetcher = directInProcessFetcher(server)
  const bytes = new Uint8Array([0, 1, 2, 255, 0, 7])
  const issued = await fetcher(`${server.origin}/attachments/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'file',
      name: 'data.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: bytes.length,
    }),
  })
  expect(issued.status).toBe(200)
  const ticket = await issued.json()
  const uploaded = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: bytes,
  })
  expect(uploaded.status).toBe(200)
  const attachment = v.parse(chatAttachmentSchema, await uploaded.json())

  await expect(fetcher(`${server.origin}/attachments/${attachment.id}.bin`)).rejects.toMatchObject({
    message: 'Binary bodies need the node test project.',
    data: {
      code: 'test-fixture.BINARY_BODY_UNSUPPORTED',
      why: 'Happy DOM stringified the native Blob or File returned by the real server route.',
      fix: 'Move the binary response assertion to a .test.ts file in the node test project.',
    },
  })
})

test.for(['[object File]', '[object Blob]', 'Ordinary response bytes remain unread.'])(
  'DOM transport preserves real file page bytes for %s',
  async (content, { server }) => {
    await writeFile(path.join(server.root, 'page.txt'), content)
    const fetcher = directInProcessFetcher(server)
    const opened = await fetcher(`${server.origin}/fs/read-session?path=page.txt`, {
      method: 'POST',
    })
    expect(opened.status).toBe(200)
    const session = await opened.json()
    const response = await fetcher(
      `${server.origin}/fs/read-session/${session.id}?start=0&end=${content.length}`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(content.length))
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.bodyUsed).toBe(false)
    expect(await response.text()).toBe(content)
  },
)

test('DOM transport preserves real JSON responses', async ({ server }) => {
  const response = await directInProcessFetcher(server)(`${server.origin}/attachments/capabilities`)
  expect(response.status).toBe(200)
  expect(response.bodyUsed).toBe(false)
  expect(await response.json()).toMatchObject({ files: true })
})
