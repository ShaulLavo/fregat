import type { GitPublishResult } from '@workspace/contracts'

/** What a publish did, in the words a toast shows. */
export function publishOutcome(result: GitPublishResult) {
  if (result.status === 'pushed')
    return {
      tone: 'success' as const,
      title: 'Repository published',
      detail: `${result.branch ?? 'HEAD'} is on ${result.url}`,
    }
  if (result.status === 'remote-added')
    return {
      tone: 'success' as const,
      title: 'Repository created',
      detail: `Remote ${result.remoteName} is set up. Commit, then push.`,
    }
  return {
    tone: 'error' as const,
    title: 'Repository created, push failed',
    detail: result.pushError ?? `Push to ${result.remoteName} failed.`,
  }
}
