import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import * as v from 'valibot'
import { attachmentUploadTicketSchema, chatAttachmentSchema } from '@workspace/contracts'
import { activeServerOrigin, serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { directInProcessFetcher } from '../../../../../test/client'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'
import { server as transport } from '../../../../../test/msw/server'
import { attachmentFileUrl, attachmentTextOptions } from '../../utils/attachment-file'
import { ChatInputAttachmentList } from '../chat-input-attachment-list'
import { ChatAttachmentThumbnails } from '../chat-attachment-thumbnails'

test('actual staged entry uses uploaded identity, holds old bytes and waits on a fresh reopen', async ({
  server,
  client: _client,
}) => {
  const fetcher = directInProcessFetcher(server)
  const issued = await fetcher(`${server.origin}/attachments/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'file', name: 'notes.txt', mimeType: 'text/plain', sizeBytes: 3 }),
  })
  const ticket = v.parse(attachmentUploadTicketSchema, await issued.json())
  const uploaded = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: 'old',
  })
  expect(uploaded.status).toBe(200)
  const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  const queryClient = createTestQueryClient()
  const origin = serverEndpoint(originForQueryClient(queryClient))
  const url = attachmentFileUrl(attachment, origin)
  const input = {
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin,
    provenance: 'staged' as const,
  }
  const draft = {
    ...attachment,
    id: 'draft-local-identity',
    previewUrl: url,
    upload: { status: 'ready' as const, attachment, expiresAt: ticket.expiresAt },
  }
  let reads = 0
  transport.use(
    http.get(url, () => {
      reads++
      return new HttpResponse('old', {
        headers: { 'content-type': 'text/plain', 'content-length': '3' },
      })
    }),
  )
  const view = renderWithProviders(
    <ChatInputAttachmentList attachments={[draft]} disabled={false} onRemove={() => {}} />,
    { queryClient },
  )
  await userEvent.click(screen.getByRole('button', { name: 'Open notes.txt' }))
  await waitFor(() =>
    expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('old'),
  )
  expect(screen.getByRole('link', { name: 'Download notes.txt' })).toHaveAttribute('href', url)
  const held = queryClient.getQueryData(attachmentTextOptions(input).queryKey)
  expect(held).toMatchObject({
    attachment: { id: attachment.id },
    environmentId: TEST_ENVIRONMENT_ID,
    origin,
    provenance: 'staged',
  })
  expect(reads).toBe(1)
  const replaced = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: 'new',
  })
  expect(replaced.status).toBe(200)
  transport.use(
    http.get(url, () => {
      reads++
      return new HttpResponse('new', {
        headers: { 'content-type': 'text/plain', 'content-length': '3' },
      })
    }),
  )
  await act(async () => {
    await queryClient.query(attachmentTextOptions(input))
  })
  expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('old')
  if (held?.kind !== 'attachment') return expect.fail('Expected held capture')
  expect(held.bytes).toEqual(new TextEncoder().encode('old'))
  expect(held.reader.readRange(0, held.reader.length)).toBe('old')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
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
    http.get(url, () => {
      reads++
      requested()
      return new HttpResponse(body, {
        headers: { 'content-type': 'text/plain', 'content-length': '3' },
      })
    }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Open notes.txt' }))
  await started
  expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
  expect(queryClient.getQueryState(attachmentTextOptions(input).queryKey)?.fetchStatus).toBe(
    'fetching',
  )
  await act(async () => {
    complete()
  })
  await waitFor(() =>
    expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('new'),
  )
  expect(reads).toBe(3)
  view.unmount()
  expect(
    queryClient
      .getQueryCache()
      .find({ queryKey: attachmentTextOptions(input).queryKey })
      ?.getObserversCount(),
  ).toBe(0)
  queryClient.clear()
})

test('actual sent entry captures its registered owner and reuses its sealed-meaning query', async ({
  server,
  client: _client,
}) => {
  const fetcher = directInProcessFetcher(server)
  const issued = await fetcher(`${server.origin}/attachments/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'file', name: 'sent.txt', mimeType: 'text/plain', sizeBytes: 4 }),
  })
  const ticket = v.parse(attachmentUploadTicketSchema, await issued.json())
  const uploaded = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: 'sent',
  })
  const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  const queryClient = createTestQueryClient()
  const origin = serverEndpoint(originForQueryClient(queryClient))
  const url = attachmentFileUrl(attachment, origin)
  let reads = 0
  transport.use(
    http.get(url, () => {
      reads++
      return new HttpResponse('sent', {
        headers: { 'content-type': 'text/plain', 'content-length': '4' },
      })
    }),
  )
  const view = renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ChatAttachmentThumbnails attachments={[attachment]} />
    </QueryClientProvider>,
    {
      queryClient,
    },
  )
  await userEvent.click(screen.getByRole('button', { name: 'sent.txt' }))
  await waitFor(() =>
    expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('sent'),
  )
  const input = {
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin,
    provenance: 'sent' as const,
  }
  const capture = queryClient.getQueryData(attachmentTextOptions(input).queryKey)
  expect(capture).toMatchObject({
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin,
    provenance: 'sent',
  })
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await userEvent.click(screen.getByRole('button', { name: 'sent.txt' }))
  await waitFor(() =>
    expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('sent'),
  )
  expect(reads).toBe(1)
  expect(queryClient.getQueryData(attachmentTextOptions(input).queryKey)).toBe(capture)
  expect(screen.getByRole('link', { name: 'Download sent.txt' })).toHaveAttribute('href', url)
  const nextOwner = createTestQueryClient()
  view.rerender(
    <QueryClientProvider client={nextOwner}>
      <ChatAttachmentThumbnails attachments={[attachment]} />
    </QueryClientProvider>,
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(
    queryClient
      .getQueryCache()
      .find({ queryKey: attachmentTextOptions(input).queryKey })
      ?.getObserversCount(),
  ).toBe(0)
  expect(activeServerOrigin()).toBe(originForQueryClient(nextOwner))
  view.unmount()
  queryClient.clear()
  nextOwner.clear()
})

test('a staged preview URL from another owner cannot open under the current query owner', async () => {
  const attachment = {
    type: 'file' as const,
    id: 'foreign',
    name: 'foreign.txt',
    mimeType: 'text/plain',
    sizeBytes: 3,
  }
  const draft = {
    ...attachment,
    previewUrl: 'http://foreign-owner/attachments/foreign.bin',
    upload: {
      status: 'ready' as const,
      attachment,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  }
  const queryClient = createTestQueryClient()
  renderWithProviders(
    <ChatInputAttachmentList attachments={[draft]} disabled={false} onRemove={() => {}} />,
    { queryClient },
  )
  await userEvent.click(screen.getByRole('button', { name: 'Open foreign.txt' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(queryClient.getQueryCache().findAll({ queryKey: ['chat-attachment-text'] })).toHaveLength(
    0,
  )
})
