import { matchNoun } from '@/features/search/utils/match-noun'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { TextChangeTarget, WorkspaceTextChanges } from '@/lib/workspace-edits/utils/types'
import { workspaceSearchReplacePlan } from '@/features/search/utils/replace'
import type { ApplyWorkspaceEditResult } from '@singapore-editor/lsp-plugin'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'

export type AppliedWorkspaceSearchReplaceResult = {
  readonly changedFiles: number
  readonly replacedMatches: number
  readonly skippedMatches: number
  readonly status: 'applied'
}

export type WorkspaceSearchReplaceResult =
  | AppliedWorkspaceSearchReplaceResult
  | Exclude<ApplyWorkspaceEditResult, { readonly status: 'applied' }>

export async function replaceWorkspaceSearchMatches({
  workspaceEdits,
  signal,
  matches,
  query,
  replaceText,
}: {
  workspaceEdits: WorkspaceTextChanges
  signal: AbortSignal
  matches: readonly WorkspaceSearchMatch[]
  query: WorkspaceSearchQuery
  replaceText: string
}): Promise<WorkspaceSearchReplaceResult> {
  let changedFiles = 0
  let replacedMatches = 0
  let skippedMatches = 0
  const groups = contentMatchesByPath(structuredClone(matches))
  const capturedQuery = structuredClone(query)
  const result = await workspaceEdits.applyTextChange({
    source: 'search-replace',
    signal,
    prepare: async (operation) => {
      const targets: TextChangeTarget[] = []
      for (const [path, pathMatches] of groups) {
        const source = await operation.readText(filesystemPath(path))
        const plan = workspaceSearchReplacePlan({
          matches: pathMatches,
          query: capturedQuery,
          replaceText,
          text: source.textSnapshot,
        })
        skippedMatches += plan.skippedCount
        if (plan.edits.length === 0) continue
        changedFiles += 1
        replacedMatches += plan.appliedCount
        targets.push({ source, edits: plan.edits })
      }
      return { label: replaceLabel(replacedMatches), requireConfirmation: true, targets }
    },
  })
  if (result.status !== 'applied') return result
  return { changedFiles, replacedMatches, skippedMatches, status: 'applied' }
}

export function workspaceSearchReplaceSummary(result: AppliedWorkspaceSearchReplaceResult) {
  const replaced = `${result.replacedMatches.toLocaleString()} ${matchNoun(
    result.replacedMatches,
  )} replaced`
  const skipped =
    result.skippedMatches > 0 ? `, ${result.skippedMatches.toLocaleString()} skipped` : ''

  return `${replaced}${skipped}.`
}

function contentMatchesByPath(matches: readonly WorkspaceSearchMatch[]) {
  const groups = new Map<string, WorkspaceSearchMatch[]>()

  for (const match of matches) {
    if (match.kind !== 'content') continue

    const group = groups.get(match.path)
    if (group) {
      group.push(match)
      continue
    }

    groups.set(match.path, [match])
  }

  return groups
}

function replaceLabel(count: number) {
  return `Replace ${count.toLocaleString()} ${matchNoun(count)}`
}
