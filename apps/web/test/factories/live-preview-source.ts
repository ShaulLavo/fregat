import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchFile, statPath } from '@/lib/file-server'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { Client } from '@/lib/client'
import type { TestServer } from '../server'
import { createAddressTestRuntime } from './address-runtime'
import { registerTestWorkspaceAddress } from './workspace-address'

type AddressTestRuntime = Awaited<ReturnType<typeof createAddressTestRuntime>>

export async function switchToRootWorkspace(client: Client, editor: AddressTestRuntime['editor']) {
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  return root
}

/** A real runtime on the server's root with `path` open as a live document. */
export async function createLivePreviewSource(
  client: Client,
  server: TestServer,
  { path, text }: { readonly path: string; readonly text: string },
) {
  await writeFile(join(server.root, path), text)
  const runtime = await createAddressTestRuntime(client)
  await switchToRootWorkspace(client, runtime.editor)
  const docs = runtime.editor.documentStore.getState()
  const file = await fetchFile(filesystemPath(path), new AbortController().signal, client)
  const document = docs.ensureLiveEditorDocument(file)
  const scope = docs.previewScope
  if (!scope) throw new RangeError('Actual root namespace required')
  const acquire = (maxBytes = 1024) => {
    const lease = docs.acquireLivePreview({
      key: document.key,
      scope,
      maxBytes,
      signal: new AbortController().signal,
    })
    if (!lease) throw new RangeError('Actual live lease required')
    return lease
  }
  return { runtime, docs, file, document, acquire }
}
