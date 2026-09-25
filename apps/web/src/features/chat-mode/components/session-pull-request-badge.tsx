import type { WorktreePullRequest } from '@workspace/contracts'
import { pullRequestBadge } from '@workspace/client-core/chat/worktrees/pull-request'
import { cn } from '@workspace/ui/lib/utils'
import type { MouseEvent, PointerEvent } from 'react'
import { PULL_REQUEST_BADGE_LOOK } from '@/features/chat-mode/utils/pull-request-badge'

// The session menu exposes the same action to keyboard and screen-reader users.
export function SessionPullRequestBadge({
  pullRequest,
}: {
  readonly pullRequest: WorktreePullRequest | null
}) {
  const badge = pullRequestBadge(pullRequest)
  if (!badge) return null
  const { Icon, tone } = PULL_REQUEST_BADGE_LOOK[badge.state]
  const url = badge.url

  function keepFromRow(event: PointerEvent<HTMLSpanElement>) {
    event.stopPropagation()
  }

  function open(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation()
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <span
      aria-label={badge.label}
      className={cn(
        'text-3xs inline-flex shrink-0 items-center gap-0.5 font-mono tabular-nums',
        tone,
        url && 'cursor-pointer hover:underline',
      )}
      data-pull-request-state={badge.state}
      role='img'
      title={badge.label}
      onClick={url ? open : undefined}
      onPointerDown={url ? keepFromRow : undefined}
    >
      <Icon aria-hidden className='size-(--icon-size-sm) shrink-0' />
      {badge.text}
    </span>
  )
}
