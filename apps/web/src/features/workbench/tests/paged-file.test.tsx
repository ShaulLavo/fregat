import { truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { waitFor } from '@testing-library/react'
import { beforeAll } from 'vitest'
import { getClient, type Client } from '@/lib/client'
import { test, expect } from '../../../../test/fixtures'
import { installTestClient } from '../../../../test/factories/client-binding'
import { createDeferredReadSessionClient } from '../../../../test/factories/deferred-read-session-client'
import { createTestQueryClient, renderHookWithProviders } from '../../../../test/render'
import { usePagedFile } from '@/features/workbench/hooks/use-paged-file'

let fileClient: Client
beforeAll(() => {
  fileClient = getClient()
})

test('each view owns its handle and unmount releases only that handle', async ({
  server,
  client,
}) => {
  await writeFile(
    path.join(server.root, 'paged.txt'),
    Array.from({ length: 300 }, (_, i) => `row ${i}\n`).join(''),
  )
  const queryClient = createTestQueryClient()
  const first = renderHookWithProviders(() => usePagedFile('paged.txt', 0, 0), { queryClient })
  const second = renderHookWithProviders(() => usePagedFile('paged.txt', 128, 0), { queryClient })
  await waitFor(() => expect(first.result.current.page.isSuccess).toBe(true))
  await waitFor(() => expect(second.result.current.page.isSuccess).toBe(true))
  const firstResource = first.result.current.resource.data!
  const secondResource = second.result.current.resource.data!
  expect(firstResource.source.id).not.toBe(secondResource.source.id)
  expect(second.result.current.page.data?.rows[0]?.text).toBe('row 128')
  first.unmount()
  await waitFor(() => expect(firstResource.document.stats.state).toBe('disposed'))
  const alive = await secondResource.source.readBytes(0, 5, new AbortController().signal)
  expect(new TextDecoder().decode(alive.bytes)).toBe('row 0')
  await waitFor(async () => {
    const closed = await client.fs['read-session']({ id: firstResource.source.id }).get({
      query: { start: 0, end: 5 },
    })
    expect(closed.error?.status).toBe(410)
  })
  second.unmount()
  await waitFor(() => expect(secondResource.document.stats.state).toBe('disposed'))
})

test('a refetched resource releases the handle it replaced', async ({ server, client }) => {
  await writeFile(path.join(server.root, 'refetch.txt'), 'row 0\nrow 1\n')
  const queryClient = createTestQueryClient()
  const view = renderHookWithProviders(() => usePagedFile('refetch.txt', 0, 0), { queryClient })
  await waitFor(() => expect(view.result.current.page.isSuccess).toBe(true))
  const before = view.result.current.resource.data!
  await queryClient.invalidateQueries()
  await waitFor(() => expect(view.result.current.resource.data).not.toBe(before))
  const after = view.result.current.resource.data!
  await waitFor(() => expect(before.document.stats.state).toBe('disposed'))
  expect(after.document.stats.state).not.toBe('disposed')
  await waitFor(async () => {
    const closed = await client.fs['read-session']({ id: before.source.id }).get({
      query: { start: 0, end: 5 },
    })
    expect(closed.error?.status).toBe(410)
  })
  view.unmount()
  await waitFor(() => expect(after.document.stats.state).toBe('disposed'))
})

test('UTF-16 is refused explicitly and changed files require a new session', async ({
  server,
  client,
}) => {
  void client
  await writeFile(path.join(server.root, 'utf16.txt'), Buffer.from([0xff, 0xfe, 65, 0]))
  const utf16 = renderHookWithProviders(() => usePagedFile('utf16.txt', 0, 0))
  await waitFor(() => expect(utf16.result.current.page.isError).toBe(true))
  expect(utf16.result.current.page.error).toMatchObject({ code: 'PAGED_ENCODING_UNSUPPORTED' })
  utf16.unmount()
  const deferred = createDeferredReadSessionClient(server)
  const restore = installTestClient(deferred.client)
  try {
    const target = path.join(server.root, 'mutable.txt')
    await writeFile(target, 'before\n')
    const mutable = renderHookWithProviders(() => usePagedFile('mutable.txt', 0, 0))
    await waitFor(() => expect(mutable.result.current.page.isSuccess).toBe(true))
    const resource = mutable.result.current.resource.data!
    await deferred.entered
    expect(mutable.result.current.index.isPending).toBe(true)
    expect(resource.document.stats.inFlight).toBe(1)
    expect(deferred.requests).toHaveLength(2)
    deferred.release()
    await waitFor(() => expect(mutable.result.current.index.isSuccess).toBe(true))
    expect(resource.document.stats.inFlight).toBe(0)
    await writeFile(target, 'after\n')
    await expect(
      resource.source.readBytes(0, 4, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'FILE_CHANGED' })
    mutable.unmount()
  } finally {
    deferred.release()
    restore()
  }
})

test('a background index invalidation closes the read session before a later direct read', async ({
  server,
  client,
}) => {
  void client
  const deferred = createDeferredReadSessionClient(server)
  const restore = installTestClient(deferred.client)
  try {
    const target = path.join(server.root, 'index-first.txt')
    await writeFile(target, 'before\n')
    const view = renderHookWithProviders(() => usePagedFile('index-first.txt', 0, 0))
    await waitFor(() => expect(view.result.current.page.isSuccess).toBe(true))
    await deferred.entered
    const resource = view.result.current.resource.data!
    expect(view.result.current.index.isPending).toBe(true)
    expect(resource.document.stats.inFlight).toBe(1)
    expect(deferred.requests).toHaveLength(2)
    await writeFile(target, 'after\n')
    deferred.release()
    await waitFor(() => expect(view.result.current.index.isError).toBe(true))
    expect(resource.document.stats.state).toBe('stale')
    expect(resource.document.stats.cachedBytes).toBe(0)
    await expect(
      resource.source.readBytes(0, 4, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'READ_SESSION_EXPIRED',
    })
    await expect(resource.view.readLines(0, 1)).rejects.toMatchObject({
      code: 'PAGED_DOCUMENT_INVALID',
    })
    view.unmount()
  } finally {
    deferred.release()
    restore()
  }
})

test('a changed source invalidates cached pages and every view', async ({ server, client }) => {
  void client
  const target = path.join(server.root, 'changing-pages.txt')
  await writeFile(target, 'line\n'.repeat(2 * 1024 * 1024))
  const opened = renderHookWithProviders(() => usePagedFile('changing-pages.txt', 0, 0))
  await waitFor(() => expect(opened.result.current.index.isSuccess).toBe(true), { timeout: 10_000 })
  await waitFor(() => expect(opened.result.current.page.isSuccess).toBe(true))
  const resource = opened.result.current.resource.data!
  const secondView = resource.document.createView()
  // A foreground reply can retain page zero after the index has evicted its earlier copy.
  expect((await resource.view.readLines(0, 1)).rows[0]?.text).toBe('line')
  expect(resource.document.stats.cachedBytes).toBeGreaterThan(0)
  await writeFile(target, 'changed\n')
  await expect(resource.view.readLines(0, 1)).rejects.toMatchObject({
    code: 'PAGED_DOCUMENT_STALE',
  })
  expect(resource.document.stats.state).toBe('stale')
  expect(resource.document.stats.cachedBytes).toBe(0)
  await expect(secondView.readLines(2 * 1024 * 1024 - 1, 1)).rejects.toThrow()
  secondView.dispose()
  opened.unmount()
})

test('completed paged-file tests restore the file client after fixture teardown', () => {
  expect(getClient() === fileClient).toBe(true)
})

test('oversized binary byte sources fail before publishing indexed text rows', async ({
  server,
  client,
}) => {
  const binaryPath = path.join(server.root, 'binary.txt')
  await writeFile(binaryPath, Buffer.from([0, 1, 255, 0, 7]))
  await truncate(binaryPath, 200 * 1024 * 1024 + 1)
  const read = await client.fs.read.get({ query: { path: 'binary.txt' } })
  expect(read.error?.status).toBe(413)
  const opened = renderHookWithProviders(() => usePagedFile('binary.txt', 0, 0))
  await waitFor(() => expect(opened.result.current.page.isError).toBe(true))
  expect(opened.result.current.page.error).toMatchObject({ code: 'client.BINARY_TEXT_UNAVAILABLE' })
  expect(opened.result.current.page.data).toBeUndefined()
  const resource = opened.result.current.resource.data!
  expect(resource.source.byteLength).toBe(200 * 1024 * 1024 + 1)
  expect(resource.document.stats.utf16Length).toBe(0)
  expect(resource.document.stats.cachedBytes).toBe(0)
  opened.unmount()
  await waitFor(() => expect(resource.document.stats.state).toBe('disposed'))
  await waitFor(async () => {
    const closed = await client.fs['read-session']({ id: resource.source.id }).get({
      query: { start: 0, end: 1 },
    })
    expect(closed.error?.status).toBe(410)
  })
})
