import { QueryClient } from '@tanstack/react-query'
import { chatAttachmentSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { attachmentFileUrl, attachmentTextOptions } from '../attachment-file'
import { expect, test } from '../../../../../test/fixtures'
import { directInProcessFetcher } from '../../../../../test/client'

test('preview query reads exact uploaded bytes from the real owner route', async ({ server }) => {
  const fetcher = directInProcessFetcher(server)
  const content = '<script>literal</script>\nOwner attachment'
  const issued = await fetcher(`${server.origin}/attachments/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'file',
      name: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: content.length,
    }),
  })
  expect(issued.status).toBe(200)
  const ticket = await issued.json()
  const uploaded = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: content,
  })
  const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
  const url = attachmentFileUrl(attachment, server.origin)
  const queryClient = new QueryClient()
  try {
    expect(await queryClient.query(attachmentTextOptions(url, fetcher))).toBe(content)
    const response = await fetcher(url)
    expect(response.headers.get('content-disposition')).toContain('notes.txt')
    expect(await response.text()).toBe(content)
  } finally {
    queryClient.clear()
  }
})

test('missing attachment rejects the preview query instead of showing empty content', async ({
  server,
}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await expect(
      queryClient.query(
        attachmentTextOptions(
          `${server.origin}/attachments/missing.bin`,
          directInProcessFetcher(server),
        ),
      ),
    ).rejects.toThrow('Attachment preview could not be loaded.')
  } finally {
    queryClient.clear()
  }
})
