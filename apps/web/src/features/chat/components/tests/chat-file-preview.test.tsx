import { attachmentPreviewMutationOptions } from '@/lib/file-preview/utils/source'
import { runMutation } from '@/lib/mutations/run'
import { createAddressTestRuntime } from '../../../../../test/factories/address-runtime'
import { chatMutationKeys } from '../../utils/mutation-keys'
import { attachmentUploadTicketSchema } from '@workspace/contracts'
import { directInProcessFetcher } from '../../../../../test/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { serverEndpoint } from '@/lib/client'
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
  const ownedRead = queryClient.getQueryCache().find({ queryKey: options.queryKey })
  expect(ownedRead?.getObserversCount()).toBe(0)
  expect(ownedRead?.isActive()).toBe(false)
  await act(async () => {
    complete()
  })
  await waitFor(() =>
    expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('new'),
  )
  const held = queryClient.getQueryData(options.queryKey)
  expect(ownedRead?.getObserversCount()).toBe(0)
  expect(
    queryClient.getMutationCache().find({
      mutationKey: chatMutationKeys.attachmentPreview(options.queryKey),
      status: 'success',
    })?.state.data,
  ).toBe(held)
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

test('unmount ends local acquisition wait and late Query transport cannot restore the view', async () => {
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
  const options = attachmentTextOptions(input)
  const mutationKey = chatMutationKeys.attachmentPreview(options.queryKey)
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
  expect(queryClient.isMutating({ mutationKey })).toBe(1)
  view.unmount()
  await waitFor(() => expect(queryClient.isMutating({ mutationKey })).toBe(0))
  expect(requestSignal?.aborted).toBe(false)
  expect(queryClient.getQueryState(options.queryKey)?.fetchStatus).toBe('fetching')
  await act(async () => {
    complete()
    await reply
  })
  await waitFor(() => expect(queryClient.getQueryState(options.queryKey)?.status).toBe('success'))
  expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
  expect(requestSignal?.aborted).toBe(false)
  expect(queryClient.getMutationCache().findAll({ mutationKey, status: 'success' })).toHaveLength(0)
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: attachmentTextOptions(input).queryKey })
  expect(query?.getObserversCount()).toBe(0)
  expect(queryClient.getQueryData(options.queryKey)?.kind).toBe('attachment')
  queryClient.clear()
})

for (const primed of [true, false]) {
  test(`F1 staged open waits past an earlier request (primed cache: ${primed})`, async ({
    server,
    client: _client,
  }) => {
    const fetcher = directInProcessFetcher(server)
    const issued = await fetcher(`${server.origin}/attachments/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'file',
        name: 'race.txt',
        mimeType: 'text/plain',
        sizeBytes: 3,
      }),
    })
    expect(issued.status).toBe(200)
    const ticket = v.parse(attachmentUploadTicketSchema, await issued.json())
    const uploaded = await fetcher(`${server.origin}${ticket.uploadPath}`, {
      method: 'PUT',
      body: 'old',
    })
    expect(uploaded.status).toBe(200)
    const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
    if (attachment.type !== 'file') return expect.fail('Expected uploaded file')
    const queryClient = createTestQueryClient()
    const origin = serverEndpoint(originForQueryClient(queryClient))
    const input = {
      attachment,
      environmentId: TEST_ENVIRONMENT_ID,
      origin,
      provenance: 'staged' as const,
    }
    const options = attachmentTextOptions(input)
    if (primed)
      await queryClient.query(attachmentTextOptions(input, async () => new Response('old')))
    expect(queryClient.getQueryData(options.queryKey) === undefined).toBe(!primed)
    let reads = 0
    let releaseOld: () => void = () => undefined
    let releaseFresh: () => void = () => undefined
    let requestStarted: () => void = () => undefined
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    const freshGate = new Promise<void>((resolve) => {
      releaseFresh = resolve
    })
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve
    })
    let downloadText = 'old'
    transport.use(
      http.get(attachmentFileUrl(attachment, origin), async () => {
        const text = downloadText
        const request = ++reads
        if (request === 1) requestStarted()
        await (request === 1 ? oldGate : freshGate)
        return new HttpResponse(text, {
          headers: { 'content-length': '3', 'content-type': 'text/plain' },
        })
      }),
    )
    const earlier = queryClient.query(options)
    await started
    expect(reads).toBe(1)
    const replacement = await fetcher(`${server.origin}${ticket.uploadPath}`, {
      method: 'PUT',
      body: 'new',
    })
    expect(replacement.status).toBe(200)
    downloadText = 'new'
    const view = renderWithProviders(
      <ChatFilePreview input={input} queryClient={queryClient} onClose={() => {}} />,
      { queryClient },
    )
    try {
      expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
      await act(async () => {
        releaseOld()
        await earlier
      })
      await waitFor(() => expect(reads).toBe(2))
      expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
      await act(async () => {
        releaseFresh()
      })
      await waitFor(() =>
        expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('new'),
      )
      expect(reads).toBe(2)
    } finally {
      releaseOld()
      releaseFresh()
      view.unmount()
      queryClient.clear()
    }
  })
}

test('F1 StrictMode close while waiting preserves the earlier request and prevents a late fresh read', async () => {
  const input = {
    attachment: {
      type: 'file' as const,
      id: 'waiting-close',
      name: 'waiting.txt',
      mimeType: 'text/plain',
      sizeBytes: 3,
    },
    environmentId: TEST_ENVIRONMENT_ID,
    origin: 'http://attachment-owner',
    provenance: 'staged' as const,
  }
  const queryClient = createTestQueryClient()
  const options = attachmentTextOptions(input)
  const mutationKey = chatMutationKeys.attachmentPreview(options.queryKey)
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  let requestSignal: AbortSignal | undefined
  let reads = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  transport.use(
    http.get(attachmentFileUrl(input.attachment, input.origin), async ({ request }) => {
      reads++
      requestSignal = request.signal
      entered()
      await gate
      return new HttpResponse('old', {
        headers: { 'content-length': '3', 'content-type': 'text/plain' },
      })
    }),
  )
  const earlier = queryClient.query(options)
  await started
  const view = renderWithProviders(
    <ChatFilePreview input={input} queryClient={queryClient} onClose={() => {}} />,
    { queryClient, reactStrictMode: true },
  )
  try {
    await waitFor(() =>
      expect(queryClient.getMutationCache().findAll({ mutationKey }).length).toBe(2),
    )
    expect(
      queryClient.getQueryCache().find({ queryKey: options.queryKey })?.getObserversCount(),
    ).toBe(0)
    expect(requestSignal?.aborted).toBe(false)
    view.unmount()
    await waitFor(() => expect(queryClient.isMutating({ mutationKey })).toBe(0))
    expect(requestSignal?.aborted).toBe(false)
    expect(queryClient.getQueryState(options.queryKey)?.fetchStatus).toBe('fetching')
    expect(reads).toBe(1)
    await act(async () => {
      release()
      await earlier
    })
    expect(reads).toBe(1)
    expect(queryClient.getQueryData(options.queryKey)?.kind).toBe('attachment')
    expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
  } finally {
    release()
    view.unmount()
    queryClient.clear()
  }
})

test('F1 closing a joined later peer read releases only local interest', async () => {
  const input = {
    attachment: {
      type: 'file' as const,
      id: 'peer-close',
      name: 'peer.txt',
      mimeType: 'text/plain',
      sizeBytes: 4,
    },
    environmentId: TEST_ENVIRONMENT_ID,
    origin: 'http://attachment-owner',
    provenance: 'staged' as const,
  }
  const queryClient = createTestQueryClient()
  const options = attachmentTextOptions(input)
  const mutationKey = chatMutationKeys.attachmentPreview(options.queryKey)
  let releaseOld: () => void = () => undefined
  let releasePeer: () => void = () => undefined
  let entered: () => void = () => undefined
  let peerSignal: AbortSignal | undefined
  let reads = 0
  let peer: Promise<unknown> | undefined
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve
  })
  const peerGate = new Promise<void>((resolve) => {
    releasePeer = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  transport.use(
    http.get(attachmentFileUrl(input.attachment, input.origin), async ({ request }) => {
      const sequence = ++reads
      if (sequence === 1) entered()
      if (sequence === 2) peerSignal = request.signal
      await (sequence === 1 ? oldGate : peerGate)
      return new HttpResponse(sequence === 1 ? 'old!' : 'peer', {
        headers: { 'content-length': '4', 'content-type': 'text/plain' },
      })
    }),
  )
  const earlier = queryClient.query(options)
  await started
  const detachPeer = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || peer) return
    if (event.query !== queryClient.getQueryCache().find({ queryKey: options.queryKey })) return
    peer = queryClient.query(options)
  })
  const view = renderWithProviders(
    <ChatFilePreview input={input} queryClient={queryClient} onClose={() => {}} />,
    { queryClient },
  )
  try {
    await waitFor(() => expect(queryClient.isMutating({ mutationKey })).toBe(1))
    await act(async () => {
      releaseOld()
      await earlier
    })
    await waitFor(() => expect(reads).toBe(2))
    expect(
      queryClient.getQueryCache().find({ queryKey: options.queryKey })?.getObserversCount(),
    ).toBe(0)
    expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
    view.unmount()
    await waitFor(() => expect(queryClient.isMutating({ mutationKey })).toBe(0))
    expect(peerSignal?.aborted).toBe(false)
    expect(queryClient.getQueryState(options.queryKey)?.fetchStatus).toBe('fetching')
    await act(async () => {
      releasePeer()
      await peer
    })
    expect(reads).toBe(2)
    const capture = queryClient.getQueryData(options.queryKey)
    if (capture?.kind !== 'attachment') return expect.fail('Expected preserved peer capture')
    expect(capture.reader.readRange(0, capture.reader.length)).toBe('peer')
    expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
  } finally {
    releaseOld()
    releasePeer()
    detachPeer()
    view.unmount()
    queryClient.clear()
  }
})

test('F1 staged Retry starts a new acquisition after an actual transport failure', async () => {
  const input = {
    attachment: {
      type: 'file' as const,
      id: 'acquisition-retry',
      name: 'retry.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
    },
    environmentId: TEST_ENVIRONMENT_ID,
    origin: 'http://attachment-owner',
    provenance: 'staged' as const,
  }
  const queryClient = createTestQueryClient()
  const options = attachmentTextOptions(input)
  let reads = 0
  transport.use(
    http.get(attachmentFileUrl(input.attachment, input.origin), () => {
      if (++reads === 1) return new HttpResponse(null, { status: 503 })
      return new HttpResponse('retry', {
        headers: { 'content-length': '5', 'content-type': 'text/plain' },
      })
    }),
  )
  const view = renderWithProviders(
    <ChatFilePreview input={input} queryClient={queryClient} onClose={() => {}} />,
    { queryClient },
  )
  try {
    await screen.findByRole('alert')
    expect(document.querySelector('[data-chat-file-preview]')).toBeNull()
    expect(reads).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: /^Retry$/u }))
    await waitFor(() =>
      expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('retry'),
    )
    expect(reads).toBe(2)
    expect(queryClient.getQueryState(options.queryKey)?.status).toBe('success')
    const operations = queryClient
      .getMutationCache()
      .findAll({ mutationKey: chatMutationKeys.attachmentPreview(options.queryKey) })
    expect(operations.map((operation) => operation.state.status)).toEqual(['error', 'success'])
  } finally {
    view.unmount()
    queryClient.clear()
  }
})

test.for(['sent', 'staged'] as const)(
  'common attachment source admits the actual $0 capture and ends only its view interest',
  async (provenance, { server, client }) => {
    const f = await createAddressTestRuntime(client)
    const queryClient = f.application.getSnapshot().queryClient
    const upload = await client.attachments.uploads.post({
      type: 'file',
      name: 'shared.txt',
      mimeType: 'text/plain',
      sizeBytes: 3,
    })
    const ticket = v.parse(attachmentUploadTicketSchema, upload.data)
    const fetcher = directInProcessFetcher(server)
    const uploaded = await fetcher(new URL(ticket.uploadPath, server.origin), {
      method: 'PUT',
      body: 'one',
    })
    const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
    if (attachment.type !== 'file') return expect.fail('Actual file capture required')
    const input = {
      attachment,
      environmentId: f.environmentId,
      origin: serverEndpoint(originForQueryClient(queryClient)),
      provenance,
    }
    const capture = await queryClient.query(
      attachmentTextOptions(input, async () => new Response('one')),
    )
    if (capture.kind !== 'attachment') return expect.fail('Actual reader capture required')
    transport.use(
      http.get(
        capture.url,
        () =>
          new HttpResponse('one', {
            headers: { 'content-length': '3', 'content-type': 'text/plain' },
          }),
      ),
    )
    const view = renderWithProviders(
      <ChatFilePreview input={input} queryClient={queryClient} onClose={() => {}} />,
      { application: f.application, queryClient },
    )
    await waitFor(() =>
      expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('one'),
    )
    expect(capture.reader.readRange(0, capture.reader.length)).toBe('one')
    await waitFor(() => expect(f.editor.documentStore.getState().previewSources.size).toBe(1))
    const shown = Array.from(f.editor.documentStore.getState().previewSources.values())[0]
    if (shown?.kind !== 'attachment') return expect.fail('Actual adopted source required')
    const options = attachmentTextOptions(input)
    expect(shown.input).toBe(queryClient.getQueryData(options.queryKey))
    expect(shown.input.reader.readRange(0, shown.input.reader.length)).toBe('one')
    const peer = await runMutation(
      queryClient,
      attachmentPreviewMutationOptions(f.editor.previewSource, queryClient),
      { input: shown.input, expected: shown.input, signal: new AbortController().signal },
    )
    expect(peer.lease).not.toBeNull()
    expect(f.editor.documentStore.getState().previewSources.size).toBe(2)
    transport.use(
      http.get(
        capture.url,
        () =>
          new HttpResponse('two', {
            headers: { 'content-length': '3', 'content-type': 'text/plain' },
          }),
      ),
    )
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: options.queryKey, refetchType: 'none' })
      await queryClient.query(options)
    })
    expect(queryClient.getQueryData(options.queryKey)).not.toBe(shown.input)
    expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe('one')
    expect(peer.lease?.read()).toBe(peer.read)
    expect(shown.input.bytes).toEqual(new TextEncoder().encode('one'))
    view.unmount()
    expect(f.editor.documentStore.getState().previewSources.size).toBe(1)
    expect(peer.lease?.read()).toBe(peer.read)
    peer.lease?.release()
    expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
  },
)
