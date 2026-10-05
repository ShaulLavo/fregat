import { http, HttpResponse } from 'msw'
import { server as transport } from '../../../../../test/msw/server'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { act, screen, waitFor } from '@testing-library/react'
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
  const input = {
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin,
    provenance: 'sent' as const,
  }
  const url = attachmentFileUrl(attachment, origin)
  const queryClient = createTestQueryClient()
  await queryClient.query(attachmentTextOptions(input, async () => new Response(content)))
  renderWithProviders(
    <ChatFilePreview input={input} queryClient={queryClient} onClose={() => {}} />,
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
    id: 'archive',
    name: 'report.zip',
    mimeType: 'application/zip',
    sizeBytes: 100,
  })
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  expect(chatAttachmentImages([attachment], 'http://owner')).toEqual([])
  expect(unrenderableChatAttachments([attachment])).toEqual([])
  expect(
    canPreviewAttachmentText({ ...attachment, mimeType: 'text/plain', sizeBytes: 300_000 }),
  ).toBe(false)
  let closed = false
  const queryClient = createTestQueryClient()
  renderWithProviders(
    <ChatFilePreview
      input={{
        attachment,
        environmentId: TEST_ENVIRONMENT_ID,
        origin: 'http://owner',
        provenance: 'sent',
      }}
      queryClient={queryClient}
      onClose={() => {
        closed = true
      }}
    />,
  )
  expect(screen.getByText('Download this file to view its contents.')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  expect(closed).toBe(true)
})

test('text-labelled binary bytes show the download fallback without decoded content', async () => {
  const attachment = v.parse(chatAttachmentSchema, {
    type: 'file',
    id: 'binary-text',
    name: 'data.txt',
    mimeType: 'text/plain',
    sizeBytes: 6,
  })
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  const origin = 'http://attachment-owner'
  const input = {
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin,
    provenance: 'sent' as const,
  }
  const url = attachmentFileUrl(attachment, origin)
  const queryClient = createTestQueryClient()
  await queryClient.query(
    attachmentTextOptions(input, async () => new Response(new Uint8Array([0, 1, 2, 255, 0, 7]))),
  )
  renderWithProviders(
    <ChatFilePreview input={input} queryClient={queryClient} onClose={() => {}} />,
    { queryClient },
  )
  expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
  expect(screen.getByText('Download this file to view its contents.')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Download data.txt' })).toHaveAttribute('href', url)
})

test('a staged view waits for this completed acquisition, then holds it across another refetch', async () => {
  const attachment = {
    type: 'file' as const,
    id: 'staged',
    name: 'staged.txt',
    mimeType: 'text/plain',
    sizeBytes: 3,
  }
  const input = {
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin: 'http://attachment-owner',
    provenance: 'staged' as const,
  }
  const queryClient = createTestQueryClient()
  const options = attachmentTextOptions(input)
  const old = await queryClient.query(attachmentTextOptions(input, async () => new Response('old')))
  let complete: () => void = () => undefined
  let requested: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    requested = resolve
  })
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      complete = () => {
        controller.enqueue(new TextEncoder().encode('new'))
        controller.close()
      }
    },
  })
  transport.use(
    http.get(attachmentFileUrl(attachment, input.origin), () => {
      requested()
      return new HttpResponse(body, {
        headers: { 'content-length': '3', 'content-type': 'text/plain' },
      })
    }),
  )
  const view = renderWithProviders(
    <ChatFilePreview input={input} queryClient={queryClient} onClose={() => {}} />,
    { queryClient },
  )
  await started
  expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
  expect(queryClient.getQueryState(options.queryKey)?.fetchStatus).toBe('fetching')
  await act(async () => {
    complete()
  })
  await waitFor(() =>
    expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('new'),
  )
  const held = queryClient.getQueryData(options.queryKey)
  transport.use(
    http.get(
      attachmentFileUrl(attachment, input.origin),
      () =>
        new HttpResponse('two', {
          headers: { 'content-length': '3', 'content-type': 'text/plain' },
        }),
    ),
  )
  await act(async () => {
    await queryClient.query(options)
  })
  expect(queryClient.getQueryData(options.queryKey)).not.toBe(held)
  expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('new')
  if (old.kind !== 'attachment') return expect.fail('Expected old capture')
  expect(old.reader.readRange(0, old.reader.length)).toBe('old')
  view.unmount()
  expect(
    queryClient.getQueryCache().find({ queryKey: options.queryKey })?.getObserversCount(),
  ).toBe(0)
  queryClient.clear()
})

test('unmount cancels a pending query interest and late transport cannot restore the view', async () => {
  const input = {
    attachment: {
      type: 'file' as const,
      id: 'late',
      name: 'late.txt',
      mimeType: 'text/plain',
      sizeBytes: 3,
    },
    environmentId: TEST_ENVIRONMENT_ID,
    origin: 'http://attachment-owner',
    provenance: 'staged' as const,
  }
  const queryClient = createTestQueryClient()
  let complete: () => void = () => undefined
  let requested: () => void = () => undefined
  let requestSignal: AbortSignal | undefined
  const started = new Promise<void>((resolve) => {
    requested = resolve
  })
  const reply = new Promise<Response>((resolve) => {
    complete = () => resolve(new HttpResponse('new'))
  })
  transport.use(
    http.get(attachmentFileUrl(input.attachment, input.origin), ({ request }) => {
      requestSignal = request.signal
      requested()
      return reply
    }),
  )
  const view = renderWithProviders(
    <ChatFilePreview input={input} queryClient={queryClient} onClose={() => {}} />,
    { queryClient },
  )
  await started
  view.unmount()
  expect(requestSignal?.aborted).toBe(true)
  await act(async () => {
    complete()
    await reply
  })
  expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: attachmentTextOptions(input).queryKey })
  expect(query?.getObserversCount()).toBe(0)
  expect(query?.state.data).toBeUndefined()
  queryClient.clear()
})
