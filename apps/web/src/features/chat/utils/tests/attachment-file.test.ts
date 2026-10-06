import { http, HttpResponse } from 'msw'
import { server as transport } from '../../../../../test/msw/server'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import {
  createDraftSessionSubmission,
  createWorkspaceProjectCommand,
} from '@workspace/client-core/chat/commands'
import { projectRegistrationResult } from '@workspace/client-core/chat/registration'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  orchestrationDispatchResultSchema,
} from '@workspace/contracts'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { QueryClient } from '@tanstack/react-query'
import { chatAttachmentSchema, attachmentUploadTicketSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { acquireAttachmentText, attachmentFileUrl, attachmentTextOptions } from '../attachment-file'
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
  const ticket = v.parse(attachmentUploadTicketSchema, await issued.json())
  const uploaded = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: content,
  })
  const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  const input = {
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin: server.origin,
    provenance: 'staged' as const,
  }
  const url = attachmentFileUrl(attachment, server.origin)
  const queryClient = new QueryClient()
  try {
    const capture = await queryClient.query(attachmentTextOptions(input, fetcher))
    expect(capture.kind).toBe('attachment')
    if (capture.kind !== 'attachment') return expect.fail('Expected text capture')
    expect(capture.reader.readRange(0, capture.reader.length)).toBe(content)
    expect(capture.bytes).toEqual(new TextEncoder().encode(content))
    expect(capture).toMatchObject({
      environmentId: TEST_ENVIRONMENT_ID,
      origin: server.origin,
      provenance: 'staged',
      attachment,
    })
    expect(Object.isFrozen(capture)).toBe(true)
    expect(Object.isFrozen(capture.attachment)).toBe(true)
    expect(Object.isFrozen(capture.decoded)).toBe(true)
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
          {
            attachment: {
              type: 'file',
              id: 'missing',
              name: 'missing.txt',
              mimeType: 'text/plain',
              sizeBytes: 1,
            },
            environmentId: TEST_ENVIRONMENT_ID,
            origin: server.origin,
            provenance: 'staged',
          },
          directInProcessFetcher(server),
        ),
      ),
    ).rejects.toThrow('Attachment preview could not be loaded.')
  } finally {
    queryClient.clear()
  }
})

test('binary bytes with a text MIME type return the download fallback from the owning server', async ({
  server,
}) => {
  const fetcher = directInProcessFetcher(server)
  const bytes = new Uint8Array([0, 1, 2, 255, 0, 7])
  const issued = await fetcher(`${server.origin}/attachments/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'file',
      name: 'data.txt',
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
    }),
  })
  const ticket = v.parse(attachmentUploadTicketSchema, await issued.json())
  const uploaded = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: bytes,
  })
  const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  const input = {
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin: server.origin,
    provenance: 'staged' as const,
  }
  const url = attachmentFileUrl(attachment, server.origin)
  const queryClient = new QueryClient()
  try {
    expect(await queryClient.query(attachmentTextOptions(input, fetcher))).toMatchObject({
      kind: 'binary',
      bytes,
      decoded: { seemsBinary: true },
    })
    expect(new Uint8Array(await (await fetcher(url)).arrayBuffer())).toEqual(bytes)
  } finally {
    queryClient.clear()
  }
})

test('capture retains actual bytes, decode facts and an immutable text reader', async () => {
  const bytes = new Uint8Array([0x61, 0xff, 0x62])
  const fetcher: NonNullable<Parameters<typeof attachmentTextOptions>[1]> = async () =>
    new Response(bytes, {
      headers: { 'content-length': '3', 'content-type': 'text/plain' },
    })
  const queryClient = new QueryClient()
  try {
    const capture = await queryClient.query(
      attachmentTextOptions(
        {
          attachment: {
            type: 'file',
            id: 'capture',
            name: 'lossy.txt',
            mimeType: 'text/plain',
            sizeBytes: 3,
          },
          environmentId: TEST_ENVIRONMENT_ID,
          origin: 'http://owner',
          provenance: 'staged',
        },
        fetcher,
      ),
    )
    expect(capture).toMatchObject({
      kind: 'attachment',
      bytes,
      decoded: { encoding: 'utf8', lossy: true },
    })
  } finally {
    queryClient.clear()
  }
})

test.each([
  { name: 'early EOF', size: 4, bytes: new Uint8Array([97, 98]) },
  { name: 'excess bytes', size: 1, bytes: new Uint8Array([97, 98]) },
])('bounded transport rejects $name', async ({ size, bytes }) => {
  const fetcher: NonNullable<Parameters<typeof attachmentTextOptions>[1]> = async () =>
    new Response(bytes, {
      headers: { 'content-length': String(size), 'content-type': 'text/plain' },
    })
  const queryClient = new QueryClient()
  try {
    await expect(
      queryClient.query(
        attachmentTextOptions(
          {
            attachment: {
              type: 'file',
              id: 'bounded',
              name: 'bounded.txt',
              mimeType: 'text/plain',
              sizeBytes: size,
            },
            environmentId: TEST_ENVIRONMENT_ID,
            origin: 'http://owner',
            provenance: 'staged',
          },
          fetcher,
        ),
      ),
    ).rejects.toThrow()
  } finally {
    queryClient.clear()
  }
})

test('staged acquisition refreshes repeated same URL bytes', async ({ server }) => {
  const fetcher = directInProcessFetcher(server)
  const issued = await fetcher(`${server.origin}/attachments/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'file',
      name: 'replace.txt',
      mimeType: 'text/plain',
      sizeBytes: 3,
    }),
  })
  const ticket = v.parse(attachmentUploadTicketSchema, await issued.json())
  const uploaded = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: 'old',
  })
  const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  const input = {
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin: server.origin,
    provenance: 'staged' as const,
  }
  const queryClient = new QueryClient()
  try {
    const old = await queryClient.query(attachmentTextOptions(input, fetcher))
    expect(old.kind).toBe('attachment')
    if (old.kind !== 'attachment') return expect.fail('Expected text capture')
    expect(old.reader.readRange(0, old.reader.length)).toBe('old')
    const replaced = await fetcher(`${server.origin}${ticket.uploadPath}`, {
      method: 'PUT',
      body: 'new',
    })
    expect(replaced.status).toBe(200)
    const fresh = await queryClient.query(attachmentTextOptions(input, fetcher))
    expect(fresh).not.toBe(old)
    expect(fresh.kind).toBe('attachment')
    if (fresh.kind !== 'attachment') return expect.fail('Expected text capture')
    expect(fresh.reader).not.toBe(old.reader)
    expect(fresh.bytes).not.toBe(old.bytes)
    expect(fresh.reader.readRange(0, fresh.reader.length)).toBe('new')
    expect(old.reader.readRange(0, old.reader.length)).toBe('old')
    expect(old.bytes).toEqual(new TextEncoder().encode('old'))
    const equalReplacement = await fetcher(`${server.origin}${ticket.uploadPath}`, {
      method: 'PUT',
      body: 'new',
    })
    expect(equalReplacement.status).toBe(200)
    const sameText = await queryClient.query(attachmentTextOptions(input, fetcher))
    expect(sameText).not.toBe(fresh)
    if (sameText.kind !== 'attachment') return expect.fail('Expected new capture')
    expect(sameText.bytes).not.toBe(fresh.bytes)
    expect(sameText.reader).not.toBe(fresh.reader)
    expect(sameText.reader.readRange(0, sameText.reader.length)).toBe('new')
  } finally {
    queryClient.clear()
  }
})

test.each([
  { mimeType: 'text/plain', sizeBytes: 256 * 1024 + 1, reason: 'size' },
  { mimeType: 'application/zip', sizeBytes: 2, reason: 'unsupported' },
  { mimeType: 'application/pdf', sizeBytes: 2, reason: 'unsupported' },
])(
  'producer policy fetches zero bytes for $mimeType/$sizeBytes',
  async ({ mimeType, sizeBytes, reason }) => {
    let calls = 0
    const fetcher: NonNullable<Parameters<typeof attachmentTextOptions>[1]> = async () => {
      calls++
      return new Response('unexpected')
    }
    const owner = new QueryClient()
    try {
      const capture = await owner.query(
        attachmentTextOptions(
          {
            attachment: { type: 'file', id: 'policy', name: 'policy', mimeType, sizeBytes },
            environmentId: TEST_ENVIRONMENT_ID,
            origin: 'http://owner',
            provenance: 'staged',
          },
          fetcher,
        ),
      )
      expect(capture).toMatchObject({ kind: 'no-text', reason })
      expect(calls).toBe(0)
    } finally {
      owner.clear()
    }
  },
)

test.each([
  { headers: { 'content-length': '4', 'content-type': 'text/plain' }, reason: 'advertised-length' },
  {
    headers: { 'content-length': 'invalid', 'content-type': 'text/plain' },
    reason: 'advertised-length',
  },
  {
    headers: { 'content-length': '3', 'content-type': 'application/zip' },
    reason: 'advertised-type',
  },
])(
  'advertised metadata mismatch cancels the reader before reading ($reason)',
  async ({ headers, reason }) => {
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true
      },
    })
    const fetcher: NonNullable<Parameters<typeof attachmentTextOptions>[1]> = async () =>
      new Response(body, { headers })
    const owner = new QueryClient()
    try {
      await expect(
        owner.query(
          attachmentTextOptions(
            {
              attachment: {
                type: 'file',
                id: 'metadata',
                name: 'notes.txt',
                mimeType: 'text/plain',
                sizeBytes: 3,
              },
              environmentId: TEST_ENVIRONMENT_ID,
              origin: 'http://owner',
              provenance: 'staged',
            },
            fetcher,
          ),
        ),
      ).rejects.toMatchObject({
        code: 'ATTACHMENT_PREVIEW_FAILED',
        internal: { reason, receivedBytes: 0 },
      })
      expect(canceled).toBe(true)
      expect(body.locked).toBe(false)
    } finally {
      owner.clear()
    }
  },
)

test('external stream calibration is bounded, authenticated, and uncached when staged', async () => {
  let canceled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([97]))
      controller.enqueue(new Uint8Array([98, 99]))
    },
    cancel() {
      canceled = true
    },
  })
  const input = {
    attachment: {
      type: 'file' as const,
      id: 'stream',
      name: 'stream.txt',
      mimeType: 'text/plain',
      sizeBytes: 2,
    },
    environmentId: TEST_ENVIRONMENT_ID,
    origin: 'http://owner',
    provenance: 'staged' as const,
  }
  const fetcher: NonNullable<Parameters<typeof attachmentTextOptions>[1]> = async (url, init) => {
    expect(url).toBe(attachmentFileUrl(input.attachment, input.origin))
    expect(init?.credentials).toBe('include')
    expect(init?.cache).toBe('no-store')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    return new Response(body)
  }
  const owner = new QueryClient()
  try {
    await expect(owner.query(attachmentTextOptions(input, fetcher))).rejects.toMatchObject({
      internal: { reason: 'excess', receivedBytes: 3, expectedBytes: 2 },
    })
    expect(canceled).toBe(true)
    expect(body.locked).toBe(false)
  } finally {
    owner.clear()
  }
})

test('abort during a stalled external body cancels and releases its reader', async () => {
  let requested: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    requested = resolve
  })
  let canceled = false
  const body = new ReadableStream<Uint8Array>({
    pull() {
      requested()
    },
    cancel() {
      canceled = true
    },
  })
  const owner = new QueryClient()
  const options = attachmentTextOptions(
    {
      attachment: {
        type: 'file',
        id: 'abort',
        name: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
      },
      environmentId: TEST_ENVIRONMENT_ID,
      origin: 'http://owner',
      provenance: 'staged',
    },
    async () => new Response(body),
  )
  try {
    const pending = owner.query(options)
    const rejected = expect(pending).rejects.toThrow()
    await started
    await owner.cancelQueries({ queryKey: options.queryKey })
    await rejected
    expect(canceled).toBe(true)
    expect(body.locked).toBe(false)
    expect(owner.getQueryData(options.queryKey)).toBeUndefined()
  } finally {
    owner.clear()
  }
})

test('a failed external reader releases its lock and records the actual bytes consumed', async () => {
  let reads = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads++ === 0) return controller.enqueue(new Uint8Array([97]))
      controller.error(new TypeError('external stream failure'))
    },
  })
  const owner = new QueryClient()
  try {
    await expect(
      owner.query(
        attachmentTextOptions(
          {
            attachment: {
              type: 'file',
              id: 'failure',
              name: 'notes.txt',
              mimeType: 'text/plain',
              sizeBytes: 2,
            },
            environmentId: TEST_ENVIRONMENT_ID,
            origin: 'http://owner',
            provenance: 'staged',
          },
          async () => new Response(body),
        ),
      ),
    ).rejects.toMatchObject({ internal: { reason: 'stream', receivedBytes: 1, expectedBytes: 2 } })
    expect(body.locked).toBe(false)
  } finally {
    owner.clear()
  }
})

test.each([
  { bytes: new Uint8Array(), content: '', encoding: 'utf8', lossy: false },
  {
    bytes: new Uint8Array([0xff, 0xfe, 97, 0]),
    content: '\ufeffa',
    encoding: 'utf16le',
    lossy: true,
  },
  { bytes: new TextEncoder().encode('exact'), content: 'exact', encoding: 'utf8', lossy: false },
])(
  'empty and lossless/lossy text keep actual decode facts ($encoding/$lossy)',
  async ({ bytes, content, encoding, lossy }) => {
    const owner = new QueryClient()
    try {
      const result = await owner.query(
        attachmentTextOptions(
          {
            attachment: {
              type: 'file',
              id: 'decode',
              name: 'notes.txt',
              mimeType: 'text/plain',
              sizeBytes: bytes.length,
            },
            environmentId: TEST_ENVIRONMENT_ID,
            origin: 'http://owner',
            provenance: 'staged',
          },
          async () => new Response(bytes),
        ),
      )
      expect(result).toMatchObject({ kind: 'attachment', bytes, decoded: { encoding, lossy } })
      if (result.kind !== 'attachment') return expect.fail('Expected text capture')
      expect(result.reader.readRange(0, result.reader.length)).toBe(content)
    } finally {
      owner.clear()
    }
  },
)

test('full app auth denial is a structured status and cannot become empty text', async ({
  server,
}) => {
  const owner = new QueryClient()
  const fetcher: NonNullable<Parameters<typeof attachmentTextOptions>[1]> = async (url, init) =>
    server.app.handle(
      new Request(url, {
        ...init,
        headers: { host: new URL(server.origin).host, origin: 'http://untrusted.example' },
      }),
    )
  try {
    await expect(
      owner.query(
        attachmentTextOptions(
          {
            attachment: {
              type: 'file',
              id: 'denied',
              name: 'denied.txt',
              mimeType: 'text/plain',
              sizeBytes: 1,
            },
            environmentId: TEST_ENVIRONMENT_ID,
            origin: server.origin,
            provenance: 'staged',
          },
          fetcher,
        ),
      ),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_PREVIEW_FAILED',
      internal: { reason: 'status', status: 403, receivedBytes: 0 },
    })
  } finally {
    owner.clear()
  }
})

test('actual session admission seals sent bytes and Infinity reuses the exact capture', async ({
  server,
  client,
}) => {
  const fetcher = directInProcessFetcher(server)
  const issued = await fetcher(`${server.origin}/attachments/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'file',
      name: 'sealed.txt',
      mimeType: 'text/plain',
      sizeBytes: 6,
    }),
  })
  const ticket = v.parse(attachmentUploadTicketSchema, await issued.json())
  const uploaded = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: 'sealed',
  })
  const attachment = v.parse(chatAttachmentSchema, await uploaded.json())
  if (attachment.type !== 'file') return expect.fail('Expected file attachment')
  const response = await client.orchestration.commands.post(
    createWorkspaceProjectCommand({ rootPath: server.root }),
  )
  const registration = projectRegistrationResult(
    v.parse(
      orchestrationDispatchResultSchema,
      unwrapEdenResponse(response, { requireData: true, normalizeDates: true }),
    ),
  )
  const submission = createDraftSessionSubmission({
    createdAt: new Date().toISOString(),
    modelSelection: { model: 'mock-model', providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID },
    worktreeTarget: { kind: 'current', worktreeId: registration.worktreeId },
    text: 'Read the attachment',
    attachments: [attachment],
  })
  const sent = await client.orchestration.commands.post(submission.command)
  expect(sent.error).toBeNull()
  const replaced = await fetcher(`${server.origin}${ticket.uploadPath}`, {
    method: 'PUT',
    body: 'mutate',
  })
  expect(replaced.ok).toBe(false)
  let calls = 0
  const observed: NonNullable<Parameters<typeof attachmentTextOptions>[1]> = async (...args) => {
    calls++
    return fetcher(...args)
  }
  const input = {
    attachment,
    environmentId: TEST_ENVIRONMENT_ID,
    origin: server.origin,
    provenance: 'sent' as const,
  }
  const owner = new QueryClient()
  try {
    const first = await owner.query(attachmentTextOptions(input, observed))
    expect(first.kind).toBe('attachment')
    if (first.kind !== 'attachment') return expect.fail('Expected sealed text')
    expect(first.reader.readRange(0, first.reader.length)).toBe('sealed')
    expect(await owner.query(attachmentTextOptions(input, observed))).toBe(first)
    expect(calls).toBe(1)
    const download = await fetcher(first.url)
    expect(download.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(download.headers.get('content-type')).toBe('text/plain')
    expect(download.headers.get('content-length')).toBe('6')
    expect(download.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(first.bytes)
    const newTicket = v.parse(
      attachmentUploadTicketSchema,
      await (
        await fetcher(`${server.origin}/attachments/uploads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'file',
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          }),
        })
      ).json(),
    )
    expect(newTicket.attachment.id).not.toBe(attachment.id)
    expect(attachmentFileUrl(newTicket.attachment, server.origin)).not.toBe(first.url)
  } finally {
    owner.clear()
  }
})

test.each([
  { encoding: 'gzip', compress: gzipSync },
  { encoding: 'br', compress: brotliCompressSync },
])('F2 decoded $encoding body accepts its encoded HTTP length', async ({ encoding, compress }) => {
  const bytes = new TextEncoder().encode('a'.repeat(512))
  const wireLength = compress(bytes).byteLength
  expect(wireLength).not.toBe(bytes.byteLength)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const owner = new QueryClient()
  try {
    const capture = await owner.query(
      attachmentTextOptions(
        {
          attachment: {
            type: 'file',
            id: 'encoded',
            name: 'encoded.txt',
            mimeType: 'text/plain',
            sizeBytes: bytes.length,
          },
          environmentId: TEST_ENVIRONMENT_ID,
          origin: 'http://external-transport.invalid',
          provenance: 'staged',
        },
        async () =>
          new Response(body, {
            headers: {
              'content-encoding': encoding,
              'content-length': String(wireLength),
              'content-type': 'text/plain; charset=utf-8',
            },
          }),
      ),
    )
    expect(capture.kind).toBe('attachment')
    if (capture.kind !== 'attachment') return expect.fail('Expected decoded text capture')
    expect(capture.bytes).toEqual(bytes)
    expect(capture.reader.readRange(0, capture.reader.length)).toBe('a'.repeat(512))
    expect(capture.decoded).toMatchObject({ encoding: 'utf8', lossy: false })
    expect(body.locked).toBe(false)
  } finally {
    owner.clear()
  }
})

test('F2 identity transfer keeps MIME parameters and valid zero chunks', async () => {
  const bytes = new TextEncoder().encode('valid')
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array())
      controller.enqueue(bytes.subarray(0, 2))
      controller.enqueue(new Uint8Array())
      controller.enqueue(bytes.subarray(2))
      controller.close()
    },
  })
  const owner = new QueryClient()
  try {
    const capture = await owner.query(
      attachmentTextOptions(
        {
          attachment: {
            type: 'file',
            id: 'identity',
            name: 'identity.txt',
            mimeType: 'text/plain',
            sizeBytes: bytes.length,
          },
          environmentId: TEST_ENVIRONMENT_ID,
          origin: 'http://external-transport.invalid',
          provenance: 'staged',
        },
        async () =>
          new Response(body, {
            headers: {
              'content-encoding': 'identity',
              'content-length': String(bytes.length),
              'content-type': 'text/plain; charset=utf-8',
            },
          }),
      ),
    )
    expect(capture.kind).toBe('attachment')
    if (capture.kind !== 'attachment') return expect.fail('Expected identity text')
    expect(capture.bytes).toEqual(bytes)
    expect(capture.reader.readRange(0, capture.reader.length)).toBe('valid')
    expect(body.locked).toBe(false)
  } finally {
    owner.clear()
  }
})

test('F2 mismatched identity length still refuses before reading and releases the body', async () => {
  let canceled = false
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true
    },
  })
  const owner = new QueryClient()
  try {
    await expect(
      owner.query(
        attachmentTextOptions(
          {
            attachment: {
              type: 'file',
              id: 'identity-mismatch',
              name: 'identity.txt',
              mimeType: 'text/plain',
              sizeBytes: 3,
            },
            environmentId: TEST_ENVIRONMENT_ID,
            origin: 'http://external-transport.invalid',
            provenance: 'staged',
          },
          async () =>
            new Response(body, {
              headers: {
                'content-encoding': 'identity',
                'content-length': '4',
                'content-type': 'text/plain',
              },
            }),
        ),
      ),
    ).rejects.toMatchObject({
      internal: {
        reason: 'advertised-length',
        receivedBytes: 0,
        expectedBytes: 3,
        advertisedBytes: 4,
      },
    })
    expect(canceled).toBe(true)
    expect(body.locked).toBe(false)
  } finally {
    owner.clear()
  }
})

test.each([
  { bytes: new TextEncoder().encode('ab'), reason: 'length', receivedBytes: 2 },
  { bytes: new TextEncoder().encode('abcd'), reason: 'excess', receivedBytes: 4 },
])(
  'F2 encoded transport still rejects actual-body $reason',
  async ({ bytes, reason, receivedBytes }) => {
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        if (reason === 'length') controller.close()
      },
      cancel() {
        canceled = true
      },
    })
    const owner = new QueryClient()
    try {
      await expect(
        owner.query(
          attachmentTextOptions(
            {
              attachment: {
                type: 'file',
                id: 'encoded-bound',
                name: 'encoded.txt',
                mimeType: 'text/plain',
                sizeBytes: 3,
              },
              environmentId: TEST_ENVIRONMENT_ID,
              origin: 'http://external-transport.invalid',
              provenance: 'staged',
            },
            async () =>
              new Response(body, {
                headers: {
                  'content-encoding': 'gzip',
                  'content-length': String(gzipSync(bytes).byteLength),
                  'content-type': 'text/plain',
                },
              }),
          ),
        ),
      ).rejects.toMatchObject({ internal: { reason, receivedBytes, expectedBytes: 3 } })
      expect(body.locked).toBe(false)
      if (reason === 'excess') expect(canceled).toBe(true)
    } finally {
      owner.clear()
    }
  },
)

test.each([false, true])(
  'F1 later imperative peer keeps the actual shared request (local close: %s)',
  async (closeView) => {
    const input = {
      attachment: {
        type: 'file' as const,
        id: 'later-imperative-peer',
        name: 'peer.txt',
        mimeType: 'text/plain',
        sizeBytes: 4,
      },
      environmentId: TEST_ENVIRONMENT_ID,
      origin: 'http://attachment-owner',
      provenance: 'staged' as const,
    }
    const owner = new QueryClient()
    const options = attachmentTextOptions(input)
    const view = new AbortController()
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    let requestSignal: AbortSignal | undefined
    let requests = 0
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    transport.use(
      http.get(attachmentFileUrl(input.attachment, input.origin), async ({ request }) => {
        requests++
        requestSignal = request.signal
        entered()
        await gate
        return new HttpResponse('peer', {
          headers: { 'content-length': '4', 'content-type': 'text/plain' },
        })
      }),
    )
    const local = acquireAttachmentText(input, owner, view.signal).then(
      (value) => ({ status: 'success' as const, value }),
      (cause: unknown) => ({ status: 'error' as const, cause }),
    )
    await started
    const query = owner.getQueryCache().find({ queryKey: options.queryKey })
    if (!query) return expect.fail('Expected the actual in-flight Query')
    const events: string[] = []
    const detach = owner.getQueryCache().subscribe((event) => {
      events.push(event.type)
    })
    const originalPromise = query.promise
    const originalOptions = query.options
    try {
      expect(query.getObserversCount()).toBe(0)
      expect(query.isActive()).toBe(false)
      expect(query.state.fetchStatus).toBe('fetching')
      const peer = owner.query(options).then(
        (value) => ({ status: 'success' as const, value }),
        (cause: unknown) => ({ status: 'error' as const, cause }),
      )
      expect(requests).toBe(1)
      expect(query.promise).toBe(originalPromise)
      expect(query.options).toBe(originalOptions)
      expect(query.getObserversCount()).toBe(0)
      expect(query.state.fetchStatus).toBe('fetching')
      expect(events).toEqual([])
      if (closeView) view.abort()
      release()
      const [localResult, peerResult] = await Promise.all([local, peer])
      expect({
        requests,
        aborted: requestSignal?.aborted,
        localStatus: localResult.status,
        peerStatus: peerResult.status,
        observers: query.getObserversCount(),
      }).toEqual({
        requests: 1,
        aborted: false,
        localStatus: closeView ? 'error' : 'success',
        peerStatus: 'success',
        observers: 0,
      })
      if (peerResult.status !== 'success' || peerResult.value.kind !== 'attachment')
        return expect.fail('Expected a real peer capture')
      expect(peerResult.value.reader.readRange(0, peerResult.value.reader.length)).toBe('peer')
      if (!closeView && localResult.status === 'success')
        expect(localResult.value).toBe(peerResult.value)
    } finally {
      release()
      detach()
      owner.clear()
    }
  },
)

test('F1 explicit Query-owner cancellation aborts a shared acquisition and its later imperative peer', async () => {
  const input = {
    attachment: {
      type: 'file' as const,
      id: 'query-owner-cancel',
      name: 'peer.txt',
      mimeType: 'text/plain',
      sizeBytes: 4,
    },
    environmentId: TEST_ENVIRONMENT_ID,
    origin: 'http://attachment-owner',
    provenance: 'staged' as const,
  }
  const owner = new QueryClient()
  const options = attachmentTextOptions(input)
  const view = new AbortController()
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  let requestSignal: AbortSignal | undefined
  let requests = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  transport.use(
    http.get(attachmentFileUrl(input.attachment, input.origin), async ({ request }) => {
      requests++
      requestSignal = request.signal
      entered()
      await gate
      return new HttpResponse('peer', {
        headers: { 'content-length': '4', 'content-type': 'text/plain' },
      })
    }),
  )
  const local = acquireAttachmentText(input, owner, view.signal).then(
    (value) => ({ status: 'success' as const, value }),
    (cause: unknown) => ({ status: 'error' as const, cause }),
  )
  await started
  const peer = owner.query(options).then(
    (value) => ({ status: 'success' as const, value }),
    (cause: unknown) => ({ status: 'error' as const, cause }),
  )
  try {
    await owner.cancelQueries({ queryKey: options.queryKey })
    expect(requestSignal?.aborted).toBe(true)
    expect(view.signal.aborted).toBe(false)
    const [localResult, peerResult] = await Promise.all([local, peer])
    expect(localResult.status).toBe('error')
    expect(peerResult.status).toBe('error')
    expect(requests).toBe(1)
    expect(owner.getQueryData(options.queryKey)).toBeUndefined()
    release()
  } finally {
    release()
    owner.clear()
  }
})
