import { truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { act, waitFor } from '@testing-library/react'
import {
  PAGED_PROOF_OPTIONS,
  PagedSourceError,
  PagedSourceInvalidatedError,
} from '@singapore-editor/paged'
import { beforeAll } from 'vitest'
import { getClient, type Client } from '@/lib/client'
import { test, expect } from '../../../../test/fixtures'
import { installTestClient } from '../../../../test/factories/client-binding'
import { createDeferredReadSessionClient } from '../../../../test/factories/deferred-read-session-client'
import { createTestQueryClient } from '../../../../test/providers'
import { renderHookWithProviders } from '../../../../test/render'
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
  const first = renderHookWithProviders(() => usePagedFile('paged.txt', 0), { queryClient })
  const second = renderHookWithProviders(() => usePagedFile('paged.txt', 0), { queryClient })
  await waitFor(() => expect(first.result.current.page.isSuccess).toBe(true))
  await waitFor(() => expect(second.result.current.page.isSuccess).toBe(true))
  const firstResource = first.result.current.resource.data!
  const secondResource = second.result.current.resource.data!
  expect(firstResource.source.id).not.toBe(secondResource.source.id)
  const shown = second.result.current.page.data
  if (shown?.kind === 'window' && shown.next) {
    const cursor = shown.next
    act(() => second.result.current.navigate({ kind: 'next', cursor }))
  }
  await waitFor(() =>
    expect(second.result.current.page.data).toHaveProperty('fragments.0.text', 'row 128'),
  )

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
  const view = renderHookWithProviders(() => usePagedFile('refetch.txt', 0), { queryClient })
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

test('UTF-16 is refused explicitly', async ({ server, client }) => {
  void client
  await writeFile(path.join(server.root, 'utf16.txt'), Buffer.from([0xff, 0xfe, 65, 0]))
  const utf16 = renderHookWithProviders(() => usePagedFile('utf16.txt', 0))
  await waitFor(() => expect(utf16.result.current.page.isError).toBe(true))
  expect(utf16.result.current.page.error).toBeInstanceOf(PagedSourceError)
  expect(utf16.result.current.page.error?.message).toContain('UTF-16')
  utf16.unmount()
})

test('opening a large file reads one bounded window', async ({ server, client }) => {
  void client
  const deferred = createDeferredReadSessionClient(server)
  const restore = installTestClient(deferred.client)
  try {
    const target = path.join(server.root, 'large-paged.txt')
    await writeFile(target, 'line\n'.repeat(PAGED_PROOF_OPTIONS.pageBytes))
    const opened = renderHookWithProviders(() => usePagedFile('large-paged.txt', 0))
    await deferred.entered
    expect(deferred.requests).toHaveLength(1)
    deferred.release()
    await waitFor(() => expect(opened.result.current.page.isSuccess).toBe(true))
    const resource = opened.result.current.resource.data!
    expect(resource.document.stats.inFlight).toBe(0)
    expect(deferred.requests).toHaveLength(1)
    expect(opened.result.current.page.data).toHaveProperty('fragments.0.text', 'line')
    opened.unmount()
  } finally {
    deferred.release()
    restore()
  }
})

test('a changed file invalidates the first demand and closes its read session', async ({
  server,
  client,
}) => {
  void client
  const deferred = createDeferredReadSessionClient(server)
  const restore = installTestClient(deferred.client)
  try {
    const target = path.join(server.root, 'changed-first.txt')
    await writeFile(target, 'before\n')
    const view = renderHookWithProviders(() => usePagedFile('changed-first.txt', 0))
    await deferred.entered
    const resource = view.result.current.resource.data!
    expect(deferred.requests).toHaveLength(1)
    expect(resource.document.stats.inFlight).toBe(1)
    await writeFile(target, 'after\n')
    deferred.release()
    await waitFor(() => expect(view.result.current.page.isError).toBe(true))
    expect(view.result.current.page.error).toBeInstanceOf(PagedSourceInvalidatedError)
    expect(resource.document.stats.state).toBe('stale')
    expect(resource.document.stats.cachedBytes).toBe(0)
    await expect(
      resource.source.readBytes(0, 4, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'READ_SESSION_EXPIRED' })
    await expect(resource.view.first(1)).rejects.toBeInstanceOf(PagedSourceInvalidatedError)
    view.unmount()
  } finally {
    deferred.release()
    restore()
  }
})

test('a changed source invalidates cached pages and every view', async ({ server, client }) => {
  void client
  const target = path.join(server.root, 'changing-pages.txt')
  await writeFile(target, 'line\n'.repeat(PAGED_PROOF_OPTIONS.pageBytes))
  const opened = renderHookWithProviders(() => usePagedFile('changing-pages.txt', 0))
  await waitFor(() => expect(opened.result.current.page.isSuccess).toBe(true))
  const resource = opened.result.current.resource.data!
  const secondView = resource.document.createView()
  expect((await resource.view.first(1)).fragments[0]?.text).toBe('line')
  expect(resource.document.stats.cachedBytes).toBeGreaterThan(0)
  await writeFile(target, 'changed\n')
  await expect(resource.view.seekByte(PAGED_PROOF_OPTIONS.pageBytes * 2, 1)).rejects.toBeInstanceOf(
    PagedSourceInvalidatedError,
  )
  expect(resource.document.stats.state).toBe('stale')
  expect(resource.document.stats.cachedBytes).toBe(0)
  await expect(secondView.first(1)).rejects.toBeInstanceOf(PagedSourceInvalidatedError)
  secondView.dispose()
  opened.unmount()
})

test('completed paged-file tests restore the file client after fixture teardown', () => {
  expect(getClient() === fileClient).toBe(true)
})

test('oversized binary byte sources fail before publishing text fragments', async ({
  server,
  client,
}) => {
  const binaryPath = path.join(server.root, 'binary.txt')
  await writeFile(binaryPath, Buffer.from([0, 1, 255, 0, 7]))
  await truncate(binaryPath, 200 * 1024 * 1024 + 1)
  const read = await client.fs.read.get({ query: { path: 'binary.txt' } })
  expect(read.error?.status).toBe(413)
  const opened = renderHookWithProviders(() => usePagedFile('binary.txt', 0))
  await waitFor(() => expect(opened.result.current.page.isError).toBe(true))
  expect(opened.result.current.page.error).toMatchObject({ code: 'client.BINARY_TEXT_UNAVAILABLE' })
  expect(opened.result.current.page.data).toBeUndefined()
  const resource = opened.result.current.resource.data!
  expect(resource.source.byteLength).toBe(200 * 1024 * 1024 + 1)
  expect(resource.document.stats.totals.utf16Length).toBeUndefined()
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
