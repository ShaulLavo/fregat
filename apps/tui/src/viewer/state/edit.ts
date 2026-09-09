import type { Client } from '@workspace/client-core/transport/client'
import { commitWorkspaceEdits } from '@workspace/client-core/files/write'
import { toWorkspaceRelative } from '@workspace/client-core/files/path'
import type { WorkspacePersistenceOperation } from '@workspace/contracts'
import { createTuiError } from '@/host/utils/structured-errors'

export async function commitFileEdit({
  client,
  rootPath,
  path,
  content,
  snapshot,
  signal,
}: {
  readonly client: Client
  readonly rootPath: string
  readonly path: string
  readonly content: string
  readonly snapshot: { readonly mtimeMs: number; readonly version: string }
  readonly signal: AbortSignal
}) {
  const relativePath = toWorkspaceRelative(rootPath, path)
  if (relativePath === null)
    throw createTuiError(
      'The file is outside the current workspace.',
      'Open the file’s folder as a workbench before saving it.',
    )
  const operations: WorkspacePersistenceOperation[] = [
    {
      kind: 'write',
      index: 0,
      path: relativePath,
      text: content,
      expected: { kind: 'snapshot', mtimeMs: snapshot.mtimeMs, version: snapshot.version },
    },
  ]
  return commitWorkspaceEdits({ client, rootPath, operations, signal })
}
