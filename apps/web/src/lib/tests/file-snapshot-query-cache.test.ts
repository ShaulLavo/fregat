import { filesystemPath } from '@/lib/documents/utils/identity'
import { QueryClient } from '@tanstack/react-query'
import { describe } from 'vitest'
import { expect, test as it } from '../../../test/fixtures'

import {
  FILE_SNAPSHOT_QUERY_GC_TIME_MS,
  ensureFileSnapshotQuery,
  pruneFileSnapshotQueryCache,
  setFileSnapshotQueryData,
} from '@/lib/file-snapshot-query-cache'
import type { FileResult } from '@/lib/file-system-types'
import { fileSystemKeys } from '@/lib/query-keys'

describe('file snapshot query cache policy', () => {
  it('applies a shorter gc time to file snapshot queries', () => {
    const client = new QueryClient()

    setFileSnapshotQueryData(client, file('repo/a.ts'))

    const query = client
      .getQueryCache()
      .find({ queryKey: fileSystemKeys.fileSnapshot('repo/a.ts') })
    expect(query?.gcTime).toBe(FILE_SNAPSHOT_QUERY_GC_TIME_MS)
  })

  it('evicts the oldest inactive file snapshot queries above the limit', () => {
    const client = new QueryClient()
    setFileSnapshotQueryData(client, file('repo/a.ts'), { updatedAt: 1 })
    setFileSnapshotQueryData(client, file('repo/b.ts'), { updatedAt: 2 })
    setFileSnapshotQueryData(client, file('repo/c.ts'), { updatedAt: 3 })
    client.setQueryData(fileSystemKeys.quickOpenFiles('repo', 'a'), ['repo/a.ts'])

    expect(pruneFileSnapshotQueryCache(client, 2)).toBe(1)
    expect(client.getQueryData(fileSystemKeys.fileSnapshot('repo/a.ts'))).toBeUndefined()
    expect(client.getQueryData(fileSystemKeys.fileSnapshot('repo/b.ts'))).toEqual(file('repo/b.ts'))
    expect(client.getQueryData(fileSystemKeys.fileSnapshot('repo/c.ts'))).toEqual(file('repo/c.ts'))
    expect(client.getQueryData(fileSystemKeys.quickOpenFiles('repo', 'a'))).toEqual(['repo/a.ts'])
  })

  it('does not re-read a file snapshot that is already fresh in the cache', async () => {
    const client = new QueryClient()
    let fetchCount = 0

    setFileSnapshotQueryData(client, file('repo/a.ts'))
    await ensureFileSnapshotQuery(client, filesystemPath('repo/a.ts'), {
      fetcher: async (path) => {
        fetchCount += 1
        return file(path)
      },
    })

    expect(fetchCount).toBe(0)
  })

  it('joins an in-flight read instead of starting a second one', async () => {
    const client = new QueryClient()
    let fetchCount = 0
    let resolveFetch!: () => void
    const fetchWait = new Promise<void>((resolve) => {
      resolveFetch = resolve
    })

    const firstRead = ensureFileSnapshotQuery(client, filesystemPath('repo/a.ts'), {
      fetcher: async (path) => {
        fetchCount += 1
        await fetchWait
        return file(path)
      },
    })
    const secondRead = ensureFileSnapshotQuery(client, filesystemPath('repo/a.ts'), {
      fetcher: async (path) => {
        fetchCount += 1
        return file(path)
      },
    })

    expect(fetchCount).toBe(1)
    resolveFetch()
    await Promise.all([firstRead, secondRead])
  })
})

function file(path: string): FileResult {
  return {
    content: path,
    mtimeMs: 1,
    path: filesystemPath(path),
    size: path.length,
    version: `test:1:${path.length}`,
  }
}
