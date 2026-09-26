import type { WorktreePullRequest } from '@workspace/contracts'

export type PullRequestBadgeState = 'open' | 'draft' | 'merged' | 'closed' | 'unknown'

export type PullRequestBadge = {
  readonly state: PullRequestBadgeState
  /** What the badge prints beside its glyph. */
  readonly text: string
  /** The badge's accessible name and hover text: repository, number, state and title. */
  readonly label: string
  /** The text-only rail's form, such as `PR #12 draft`. */
  readonly summary: string
  readonly url: string | null
}

const STATE_LABEL: Record<Exclude<PullRequestBadgeState, 'unknown'>, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
}

/**
 * The rail's pull request badge for a worktree. Nothing when there is no pull request or the
 * forge cannot be asked; a failed lookup is its own `unknown` badge.
 */
export function pullRequestBadge(pullRequest: WorktreePullRequest | null): PullRequestBadge | null {
  if (pullRequest?.status === 'unknown')
    return {
      state: 'unknown',
      text: '?',
      label: 'Pull request unknown. The last lookup failed.',
      summary: 'PR unknown',
      url: null,
    }
  if (pullRequest?.status !== 'found') return null
  const state = pullRequest.state === 'open' && pullRequest.draft ? 'draft' : pullRequest.state
  const stateLabel = STATE_LABEL[state]
  const repository = pullRequestRepository(pullRequest.url)
  const reference = `${repository ?? ''}#${pullRequest.number}`
  return {
    state,
    text: `#${pullRequest.number}`,
    label: `Pull request ${reference} · ${stateLabel}: ${pullRequest.title}`,
    summary: `PR #${pullRequest.number} ${stateLabel.toLowerCase()}`,
    url: pullRequest.url,
  }
}

// GitHub `/o/r/pull/1`, Forgejo `/o/r/pulls/1`, GitLab `/g/r/-/merge_requests/1`,
// Bitbucket `/w/r/pull-requests/1`.
const PULL_REQUEST_PATH = /^\/(.+?)\/(?:-\/)?(?:pulls?|merge_requests|pull-requests)\/\d+/u
// Azure DevOps `/org/project/_git/repo/pullrequest/1`, named `org/project/repo`.
const AZURE_PULL_REQUEST_PATH = /^\/(.+?)\/_git\/([^/]+)\/pullrequest\/\d+/u

/** The repository a pull request lives in, which differs from the worktree's for a fork. */
export function pullRequestRepository(url: string): string | null {
  if (!URL.canParse(url)) return null
  const pathname = new URL(url).pathname
  const azure = AZURE_PULL_REQUEST_PATH.exec(pathname)
  if (azure) return `${azure[1]}/${azure[2]}`
  return PULL_REQUEST_PATH.exec(pathname)?.[1] ?? null
}
