import type { WorktreePullRequest } from '@workspace/contracts'

export type PullRequestBadgeState = 'open' | 'draft' | 'merged' | 'closed' | 'unknown'

export type PullRequestBadge = {
  readonly state: PullRequestBadgeState
  /** What the badge prints beside its glyph. */
  readonly text: string
  /** The badge's accessible name and hover text: number, state and title. */
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
  return {
    state,
    text: `#${pullRequest.number}`,
    label: `Pull request #${pullRequest.number} · ${stateLabel}: ${pullRequest.title}`,
    summary: `PR #${pullRequest.number} ${stateLabel.toLowerCase()}`,
    url: pullRequest.url,
  }
}
