import type { GitPullRequestCreateResult } from '@workspace/contracts'
import { createTuiError } from '@/host/utils/structured-errors'

export type GitDialog = 'commit' | 'discard' | 'pull-request'
export const actionTitles = {
  commit: 'Commit staged changes',
  discard: 'Discard file changes',
  'pull-request': 'Create draft pull request',
}
export const actionLabels = {
  commit: 'Commit message',
  discard: 'Type discard to permanently discard the selected file changes.',
  'pull-request': 'Pull request title. The current branch must already be pushed.',
}
export function pullRequestMessage(result: GitPullRequestCreateResult) {
  if (result.kind === 'unsupported')
    throw createTuiError(
      'Pull requests are unavailable for this repository.',
      'Configure a supported remote and authenticate the GitHub CLI.',
    )
  return `${result.kind === 'created' ? 'Created' : 'Existing'} pull request: ${result.pullRequest.url}`
}
