import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { waitFor } from '@testing-library/react'
import { test, expect } from '../../../../test/fixtures'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { makePdf } from '../../../../test/factories/pdf'
import { QueryObserver } from '@tanstack/react-query'
import { statPath } from '@/lib/file-server'
import { applyWorkspaceReady } from '@/features/workspace/hooks/use-events'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fileSystemKeys } from '@/lib/query-keys'
import { createWideEventScope } from '@/lib/wide-event-scope'

test('watch-ready refreshes its PDF subset after missed changes with no live text document', async ({
  server,
  client,
}) => {
  const path = filesystemPath('missed.pdf')
  const other = filesystemPath('other.pdf')
  await writeFile(join(server.root, path), makePdf(['old']))
  await writeFile(join(server.root, other), makePdf(['other']))
  const { application, commands, editor } = await createAddressTestRuntime(client)
  const queryClient = application.getSnapshot().queryClient
  const view = new QueryObserver(queryClient, {
    queryKey: fileSystemKeys.fileMetadata(path),
    queryFn: ({ signal }) => statPath(path, signal, client),
  })
  const otherView = new QueryObserver(queryClient, {
    queryKey: fileSystemKeys.fileMetadata(other),
    queryFn: ({ signal }) => statPath(other, signal, client),
  })
  const unsubscribe = view.subscribe(() => undefined)
  const unsubscribeOther = otherView.subscribe(() => undefined)
  const scope = createWideEventScope({ action: 'test.pdf-watch-ready', area: 'fs' })
  try {
    await waitFor(() => expect(view.getCurrentResult().data?.version).toBeDefined())
    await waitFor(() => expect(otherView.getCurrentResult().data?.version).toBeDefined())
    const old = view.getCurrentResult().data
    const untouched = otherView.getCurrentResult().data
    expect(editor.documentStore.getState().liveDocumentsByKey).toEqual({})
    await writeFile(join(server.root, path), makePdf(['changed while disconnected']))
    await writeFile(join(server.root, other), makePdf(['outside ready subset']))
    await applyWorkspaceReady({
      ...commands,
      ...editor.documentStore.getState(),
      conflictStore: editor.conflictStore,
      queryClient,
      openFilePaths: [path],
      rootPath: '',
      scope,
      signal: new AbortController().signal,
      scheduleGitInvalidation: () => undefined,
    })
    await waitFor(() => expect(view.getCurrentResult().data).not.toEqual(old))
    expect(otherView.getCurrentResult().data).toEqual(untouched)
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toBeUndefined()
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(other))).toBeUndefined()
    expect(editor.documentStore.getState().liveDocumentsByKey).toEqual({})
  } finally {
    unsubscribe()
    unsubscribeOther()
    scope.end()
  }
})
