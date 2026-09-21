import { decodedAsText } from '@workspace/contracts'
import { QueryClient } from '@tanstack/react-query'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { describe } from 'vitest'

import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { FileSyncService } from '@/features/editor/state/file-sync-service'
import { EditorSaveService } from '@/features/editor/state/save-service'
import type { SettingsSyncService } from '@/features/settings/state/sync-service'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FileResult, TreeEntry } from '@/lib/file-system-types'
import { expect, test as it } from '../../../../test/fixtures'

describe('EditorSaveService', () => {
  it('serializes overlapping saves and writes a buffer once', async ({ client }) => {
    expect(client).toBeDefined()
    const store = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const document = store.getState().ensureLiveEditorDocument(file('src/app.ts', 'old', 100))
    createEditorBufferSession(document.buffer).applyText('!')
    const writes: string[] = []
    const fileSync = new FileSyncService(store, queryClient, {
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: async () => file('unused', '', 0),
      writeFileContent: async (path, content) => {
        writes.push(content)
        await new Promise((resolve) => setTimeout(resolve, 5))
        return entry(path, content, 200)
      },
    })
    const service = new EditorSaveService(
      store,
      queryClient,
      fileSync,
      {} as SettingsSyncService,
      null,
    )

    const results = await Promise.all([
      service.save(document.key),
      service.save(document.key),
      service.save(document.key),
    ])

    expect(results).toEqual([true, true, true])
    expect(writes).toEqual(['old!'])
    expect(store.getState().dirtyDocumentKeys.has(document.key)).toBe(false)
    expect(
      queryClient
        .getMutationCache()
        .findAll({ mutationKey: editorMutationKeys.save(document.key) }),
    ).toHaveLength(3)
  })

  it('writes again when an edit lands between two queued saves', async ({ client }) => {
    expect(client).toBeDefined()
    const store = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const document = store.getState().ensureLiveEditorDocument(file('src/app.ts', 'old', 100))
    const session = createEditorBufferSession(document.buffer)
    session.applyText('!')
    const writes: string[] = []
    let mtime = 100
    const fileSync = new FileSyncService(store, queryClient, {
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: async () => file('unused', '', 0),
      writeFileContent: async (path, content) => {
        writes.push(content)
        // The edit lands while the first write is on the wire.
        if (writes.length === 1) session.applyText('?')
        mtime += 100
        return entry(path, content, mtime)
      },
    })
    const service = new EditorSaveService(
      store,
      queryClient,
      fileSync,
      {} as SettingsSyncService,
      null,
    )

    await Promise.all([service.save(document.key), service.save(document.key)])

    expect(writes).toEqual(['old!', 'old!?'])
    expect(store.getState().dirtyDocumentKeys.has(document.key)).toBe(false)
  })
})

function file(path: string, content: string, mtimeMs: number): FileResult {
  return {
    ...decodedAsText,
    content,
    mtimeMs,
    path: filesystemPath(path),
    size: content.length,
    version: `test:${mtimeMs}:${content.length}`,
  }
}

function entry(path: string, content: string, mtimeMs: number): TreeEntry {
  return {
    birthtimeMs: mtimeMs,
    mtimeMs,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: content.length,
    type: 'file',
    version: `test:${mtimeMs}:${content.length}`,
  }
}
