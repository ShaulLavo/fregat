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

const replacementPlanBrand = Symbol('ReplacementPlan')
export type ReplacementPlan = {
  readonly [replacementPlanBrand]: true
  readonly operations: readonly WorkspacePersistenceOperation[]
  readonly count: number
}
type ReplacementOwner = {
  readonly client: Client
  readonly rootPath: string
  readonly signal: AbortSignal
  submission?: ReturnType<typeof commitWorkspaceEdits>
}
const owners = new WeakMap<ReplacementPlan, ReplacementOwner>()
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
  const capturedQuery = { ...query }
  const owner = { client, rootPath: capturedQuery.path, signal }
  const operations: WorkspacePersistenceOperation[] = []
  let count = 0
  for (const path of new Set(
    matches.filter((match) => match.kind === 'content').map((match) => match.path),
  )) {
    const relativePath = toWorkspaceRelative(capturedQuery.path, path)
    if (relativePath === null)
      throw createTuiError(
        'Replacement file is outside the selected workspace.',
        'Refresh search results before preparing the replacement.',
      )
    const file = await readFilePreview({ client, path, signal })
    const result = replacementText(file.content, capturedQuery, replacement)
    if (!result.count || result.content === file.content) continue
    count += result.count
    operations.push(
      Object.freeze({
        kind: 'write',
        index: operations.length,
        path: relativePath,
        text: result.content,
        expected: Object.freeze({ kind: 'snapshot', mtimeMs: file.mtimeMs, version: file.version }),
      }),
    )
  }
  signal.throwIfAborted()
  const plan = Object.freeze({
    [replacementPlanBrand]: true,
    operations: Object.freeze(operations),
    count,
  } satisfies ReplacementPlan)
  owners.set(plan, owner)
  return plan
}
export function applyReplacement(plan: ReplacementPlan) {
  const owner = owners.get(plan)
  if (!owner) throw createTuiError('Replacement plan is invalid.', 'Prepare the replacement again.')
  owner.submission ??= commitWorkspaceEdits({ ...owner, operations: plan.operations })
  return owner.submission
}
