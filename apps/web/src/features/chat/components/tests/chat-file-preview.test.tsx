import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { chatAttachmentSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { ChatFilePreview } from '../chat-file-preview'
import {
  attachmentFileUrl,
  attachmentTextOptions,
  canPreviewAttachmentText,
} from '../../utils/attachment-file'
import { chatAttachmentImages, unrenderableChatAttachments } from '../../utils/attachment-image'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

test('previews text literally and downloads from its owner', async () => {
  const content = '<script>do not execute</script>\nFile preview content'
  const origin = 'http://attachment-owner'
  const attachment = v.parse(chatAttachmentSchema, {
    type: 'file',
    id: 'text',
    name: 'notes.txt',
    mimeType: 'text/plain',
    sizeBytes: content.length,
  })
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  const url = attachmentFileUrl(attachment, origin)
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(attachmentTextOptions(url).queryKey, content)
  renderWithProviders(
    <ChatFilePreview attachment={attachment} origin={origin} onClose={() => {}} />,
    { queryClient },
  )
  expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe(content)
  expect(document.querySelector('[data-chat-file-preview] script')).toBeNull()
  const download = screen.getByRole('link', { name: 'Download notes.txt' })
  expect(download).toHaveAttribute('href', url)
  expect(download).toHaveAttribute('download', 'notes.txt')
})

test('binary files stay outside the image lightbox and show a download fallback', async () => {
  const attachment = v.parse(chatAttachmentSchema, {
    type: 'file',
    id: 'pdf',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
  })
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  expect(chatAttachmentImages([attachment], 'http://owner')).toEqual([])
  expect(unrenderableChatAttachments([attachment])).toEqual([])
  expect(
    canPreviewAttachmentText({ ...attachment, mimeType: 'text/plain', sizeBytes: 300_000 }),
  ).toBe(false)
  let closed = false
  renderWithProviders(
    <ChatFilePreview
      attachment={attachment}
      origin='http://owner'
      onClose={() => {
        closed = true
      }}
    />,
  )
  expect(screen.getByText('Download this file to view its contents.')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  expect(closed).toBe(true)
})
