import type { Client } from '@workspace/client-core/transport/client'
import { readFilePreview } from '@workspace/client-core/files/read'
import { commitWorkspaceEdits } from '@workspace/client-core/files/write'
import { toWorkspaceRelative } from '@workspace/client-core/files/path'
import type {
  WorkspaceSearchMatch,
  WorkspaceSearchQuery,
  WorkspacePersistenceOperation,
} from '@workspace/contracts'
import { replacementText } from '@/search/utils/replacement'
import { createTuiError } from '@/host/utils/structured-errors'

export type ReplacementPlan = { operations: WorkspacePersistenceOperation[]; count: number }
export async function prepareReplacement({
  client,
  query,
  matches,
  replacement,
  signal,
}: {
  client: Client
  query: WorkspaceSearchQuery
  matches: readonly WorkspaceSearchMatch[]
  replacement: string
  signal: AbortSignal
}): Promise<ReplacementPlan> {
  const operations: WorkspacePersistenceOperation[] = []
  let count = 0
  for (const path of new Set(
    matches.filter((match) => match.kind === 'content').map((match) => match.path),
  )) {
    const relativePath = toWorkspaceRelative(query.path, path)
    if (relativePath === null)
      throw createTuiError(
        'Replacement file is outside the selected workspace.',
        'Refresh search results before preparing the replacement.',
      )
    const file = await readFilePreview({ client, path, signal })
    const result = replacementText(file.content, query, replacement)
    if (!result.count || result.content === file.content) continue
    count += result.count
    operations.push({
      kind: 'write',
      index: operations.length,
      path: relativePath,
      text: result.content,
      expected: { kind: 'snapshot', mtimeMs: file.mtimeMs, version: file.version },
    })
  }
  return { operations, count }
}
export function applyReplacement(
  client: Client,
  rootPath: string,
  plan: ReplacementPlan,
  signal: AbortSignal,
) {
  return commitWorkspaceEdits({ client, rootPath, operations: plan.operations, signal })
}
