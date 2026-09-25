import type { GitPullRequestSupport, GitShipResult } from '@workspace/contracts'

const SUPPORT_DETAIL: Record<GitPullRequestSupport, string> = {
  ready: 'The forge did not answer.',
  'cli-missing': "The forge's command-line tool is not installed.",
  unauthenticated: 'Sign in to the forge from a terminal.',
  'no-forge': 'No remote points at a known forge.',
}

/** A push-and-open in toast words: the push can land while the pull request does not. */
export function shipOutcome(result: GitShipResult, label: string) {
  if (!result.push.ok)
    return { tone: 'error' as const, title: 'Push failed', detail: result.push.message }
  const pullRequest = result.pullRequest
  if (!pullRequest || pullRequest.kind === 'failed')
    return {
      tone: 'error' as const,
      title: `Pushed, ${label.toLowerCase()} failed`,
      detail: pullRequest?.message ?? 'The forge did not answer.',
    }
  if (pullRequest.kind === 'unsupported')
    return {
      tone: 'error' as const,
      title: `Pushed, ${label.toLowerCase()} unavailable`,
      detail: SUPPORT_DETAIL[pullRequest.support],
    }
  return {
    tone: 'success' as const,
    title: pullRequest.kind === 'created' ? 'Pushed and opened' : 'Pushed',
    detail: `#${pullRequest.pullRequest.number} ${pullRequest.pullRequest.title}`,
  }
}
