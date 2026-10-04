import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Client } from '@/lib/client'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import { testScopedStorage } from './scoped-storage'

export async function createSavedComparisonFixture(root: string, client: Client) {
  const path = filesystemPath('repo/source.ts')
  await mkdir(join(root, 'repo'), { recursive: true })
  await writeFile(join(root, path), 'export const saved = 1\n')
  const saved = await fetchFile(path, new AbortController().signal, client)
  const scope = { environmentId: testScopedStorage.environmentId, rootPath: filesystemPath('repo') }
  const service = new WorkspaceDocumentService(() => undefined, scope.environmentId)
  const document = service.ensureLiveDocument(saved)
  return {
    service,
    document,
    saved,
    scope,
    path,
    acquire: (signal = new AbortController().signal) =>
      service.acquireSavedComparison({ scope, saved, signal }),
    async readSavedFile(path: FilesystemPath, content: string) {
      await writeFile(join(root, path), content)
      return fetchFile(path, new AbortController().signal, client)
    },
    async refresh(content: string) {
      await writeFile(join(root, path), content)
      return fetchFile(path, new AbortController().signal, client)
    },
  }
}
