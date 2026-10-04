import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { QueryClient } from '@tanstack/react-query'

import { activeServerOrigin, setActiveServerOrigin } from '@/lib/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'
import { createInProcessClient, createObservedInProcessClient } from '../../../../test/client'
import { createRequestGate } from '../../../../test/factories/request-gate'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'

test.for([
  {
    content: 'é\r\n😀\n',
    budget: 64,
    text: 'é\r\n😀\n',
    kind: 'complete',
    bytesRead: 9,
    decodedBytes: 9,
    lossy: false,
  },
  {
    content: 'line\nrest\n',
    budget: 7,
    text: 'line\n',
    kind: 'partial',
    bytesRead: 7,
    decodedBytes: 5,
    lossy: false,
  },
  {
    content: new Uint8Array([0x61, 0xff]),
    budget: 64,
    text: 'a�',
    kind: 'lossy',
    bytesRead: 2,
    decodedBytes: 2,
    lossy: true,
  },
])(
  'adapts captured $kind head coverage through the real query',
  async (sample, { server, client }) => {
    await writeFile(path.join(server.root, 'source.txt'), sample.content)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const origin = 'http://preview-owner.invalid'
    registerEnvironmentQueryClient(queryClient, origin, client)
    try {
      const preview = await queryClient.query(previewQueryOptions('source.txt', sample.budget))
      expect(preview).toMatchObject({
        kind: 'text',
        text: sample.text,
        source: {
          origin,
          path: 'source.txt',
          capture: {
            device: expect.any(String),
            inode: expect.any(String),
            mtimeNs: expect.any(String),
            ctimeNs: expect.any(String),
          },
        },
        coverage: {
          kind: sample.kind,
          bytesRead: sample.bytesRead,
          decodedBytes: sample.decodedBytes,
          utf16Length: sample.text.length,
          lossy: sample.lossy,
        },
      })
      if (preview.kind !== 'text') return expect.unreachable('Expected captured text')
      if (preview.coverage.kind === 'complete')
        expect(preview.coverage.version).toMatch(/^sha256:[a-f0-9]{64}$/u)
      if (preview.coverage.kind !== 'complete')
        expect(preview.coverage).not.toHaveProperty('version')
    } finally {
      queryClient.clear()
    }
  },
)

test('binary refusal stays an explicit query outcome', async ({ server, client }) => {
  await writeFile(path.join(server.root, 'binary'), new Uint8Array([0, 1, 2, 0, 255, 0, 0, 7]))
  const owner = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  registerEnvironmentQueryClient(owner, 'http://preview-binary.invalid', client)
  try {
    expect(await owner.query(previewQueryOptions('binary', 64))).toEqual({ kind: 'binary' })
  } finally {
    owner.clear()
  }
})

test('a delayed head retains its query environment through active selection changes', async ({
  server,
}) => {
  const other = await makeTestServer({ filesystemWatch: false })
  const gate = createRequestGate((request) => new URL(request.url).pathname === '/fs/head')
  const ownerA = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const ownerB = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const originA = 'http://preview-a.invalid'
  const originB = 'http://preview-b.invalid'
  registerEnvironmentQueryClient(
    ownerA,
    originA,
    createObservedInProcessClient(server, gate.beforeRequest),
  )
  registerEnvironmentQueryClient(ownerB, originB, createInProcessClient(other))
  const previous = activeServerOrigin()
  try {
    await writeFile(path.join(server.root, 'same.txt'), 'owner A')
    await writeFile(path.join(other.root, 'same.txt'), 'owner B')
    const pendingA = ownerA.query(previewQueryOptions('same.txt', 64))
    await gate.entered
    setActiveServerOrigin(originB)
    const previewB = await ownerB.query(previewQueryOptions('same.txt', 64))
    gate.release()
    const previewA = await pendingA
    expect(previewA).toMatchObject({
      text: 'owner A',
      source: { origin: originA, path: 'same.txt' },
      coverage: { kind: 'complete' },
    })
    expect(previewB).toMatchObject({
      text: 'owner B',
      source: { origin: originB, path: 'same.txt' },
      coverage: { kind: 'complete' },
    })
    expect(previewA).not.toEqual(previewB)
  } finally {
    gate.release()
    setActiveServerOrigin(previous)
    ownerA.clear()
    ownerB.clear()
    await other.cleanup()
  }
})
