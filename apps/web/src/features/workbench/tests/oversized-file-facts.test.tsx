import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { useQuery } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { renderHookWithProviders } from '../../../../test/render'
import { createDeferredReadSessionClient } from '../../../../test/factories/deferred-read-session-client'
import { installTestClient } from '../../../../test/factories/client-binding'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { oversizedFileFactsOptions } from '@/features/workbench/utils/oversized-file-facts'

for (const outcome of ['success', 'cancel', 'changed'] as const) {
  test(`file-facts prefix session releases on ${outcome}`, async ({ server, client }) => {
    const path = filesystemPath('binary.txt')
    await writeFile(join(server.root, path), Buffer.from([0, 1, 255, 0, 7]))
    const deferred = createDeferredReadSessionClient(server)
    const restore = installTestClient(deferred.client)
    try {
      const opened = renderHookWithProviders(() => useQuery(oversizedFileFactsOptions(path, null)))
      await deferred.entered
      if (outcome === 'cancel') opened.unmount()
      if (outcome === 'changed') await writeFile(join(server.root, path), 'changed bytes')
      deferred.release()
      if (outcome === 'success') {
        await waitFor(() => expect(opened.result.current.isSuccess).toBe(true))
        expect(opened.result.current.data).toEqual({ path, size: 5 })
      }
      if (outcome === 'changed') {
        await waitFor(() => expect(opened.result.current.isError).toBe(true))
        expect(opened.result.current.data).toBeUndefined()
      }
      const id = new URL(deferred.requests[0]!).pathname.split('/').at(-1)!
      await waitFor(async () => {
        const closed = await client.fs['read-session']({ id }).get({ query: { start: 0, end: 1 } })
        expect(closed.error?.status).toBe(410)
      })
      opened.unmount()
    } finally {
      deferred.release()
      restore()
    }
  })
}
