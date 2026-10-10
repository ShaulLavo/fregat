import { QueryClient } from '@tanstack/query-core'
import {
  fetchRepositoryRef,
  fetchRepositorySource,
  fetchSourceFile,
  type SourceEntry,
  type SourceFile,
  type SourceSnapshot,
} from './githubSource.ts'
import {
  loadCachedSourceFile,
  loadCachedSourceSnapshot,
  saveSourceFileToCache,
  saveSourceSnapshotToCache,
} from './sourceCache.ts'

const snapshotKey = ['demo', 'source', 'cached-tree'] as const
const fileKey = (sha: string) => ['demo', 'source', 'file', sha] as const

export class SourceLoader {
  private readonly client = new QueryClient()

  constructor() {
    this.client.mount()
  }

  dispose(): void {
    this.client.unmount()
    this.client.clear()
  }

  cachedSnapshot(): Promise<SourceSnapshot | null> {
    return this.client.query({
      queryKey: snapshotKey,
      queryFn: () => loadCachedSourceSnapshot(),
      networkMode: 'always',
    })
  }

  async refreshSnapshot(current: SourceSnapshot | null): Promise<SourceSnapshot> {
    const ref = await this.client.query({
      queryKey: ['demo', 'source', 'main'],
      queryFn: ({ signal }) => fetchRepositoryRef(signal),
      retry: 1,
    })
    if (current?.commitSha === ref.commitSha) return current

    const snapshot = await this.client.query({
      queryKey: ['demo', 'source', 'tree', ref.commitSha],
      queryFn: ({ signal }) => fetchRepositorySource(ref, signal),
      staleTime: Infinity,
      retry: 1,
    })
    void this.persistSnapshot(snapshot)
    return snapshot
  }

  preloadsBusy(): boolean {
    return this.client.isFetching({ queryKey: ['demo', 'source', 'file'] }) >= 4
  }

  loadFile(snapshot: SourceSnapshot, entry: SourceEntry): Promise<SourceFile> {
    return this.client.query({
      queryKey: fileKey(entry.sha),
      staleTime: Infinity,
      gcTime: Infinity,
      networkMode: 'always',
      retry: 1,
      queryFn: async ({ signal }) => {
        const cached = await loadCachedSourceFile(entry.sha)
        if (cached !== null) return { ...entry, text: cached }
        const file = await fetchSourceFile(snapshot.commitSha, entry, signal)
        void this.persistFile(file)
        return file
      },
      // One blob can appear at multiple paths; its text is shared, its identity belongs to the row.
      select: (file) => ({ ...entry, text: file.text }),
    })
  }

  private async persistSnapshot(snapshot: SourceSnapshot): Promise<void> {
    try {
      await this.client
        .getMutationCache()
        .build(this.client, {
          mutationKey: ['demo', 'source', 'save-tree'],
          scope: { id: 'source-tree' },
          networkMode: 'always',
          mutationFn: (value: SourceSnapshot) => saveSourceSnapshotToCache(value),
          onSuccess: () => {
            this.client.setQueryData(snapshotKey, snapshot)
          },
        })
        .execute(snapshot)
    } catch {
      // Storage is optional; downloaded source stays available for this visit.
    }
  }

  private async persistFile(file: SourceFile): Promise<void> {
    try {
      await this.client
        .getMutationCache()
        .build(this.client, {
          mutationKey: ['demo', 'source', 'save-file', file.sha],
          scope: { id: file.sha },
          networkMode: 'always',
          mutationFn: (value: SourceFile) => saveSourceFileToCache(value),
          onSuccess: () => {
            this.client.setQueryData(fileKey(file.sha), file)
          },
        })
        .execute(file)
    } catch {
      // Storage is optional; downloaded source stays available for this visit.
    }
  }
}
