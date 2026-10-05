import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Client } from '@/lib/client'
import { createClientInvariantError } from '@/lib/structured-errors'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { createWorkspaceTextChanges, textChangePreview } from './workspace-text-changes'

export async function createOperationComparisonFixture(root: string, client: Client) {
  const harness = createWorkspaceTextChanges(client)
  await writeFile(join(root, 'first.ts'), 'export const before = 1\n')
  const file = await fetchFile(filesystemPath('first.ts'), new AbortController().signal, client)
  const document = harness.store.getState().ensureLiveEditorDocument(file)
  createEditorBufferSession(document.buffer).applyEdits([{ from: 24, to: 24, text: '// dirty\n' }])
  const pending = harness.service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace captured text',
      requireConfirmation: true,
      targets: [
        {
          source: await operation.readText(filesystemPath('first.ts')),
          edits: [{ from: 13, to: 19, text: 'after' }],
        },
      ],
    }),
  })
  const operationId = await textChangePreview(harness.service)
  const row = harness.service.getSnapshot().preview?.rows[0]
  const read = row?.comparison
  if (!row || !read || read.kind !== 'ready' || read.input.kind !== 'operation' || !row.file)
    throw createClientInvariantError('Actual operation fixture requires an admitted text capture')
  return {
    ...harness,
    row,
    read,
    input: read.input,
    file: row.file,
    document,
    operationId,
    pending,
  }
}
