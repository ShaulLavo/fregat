import {
  CircleDashedIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import type { PullRequestBadgeState } from '@workspace/client-core/chat/worktrees/pull-request'

/** One glyph per state, so the state reads without its tone. */
export const PULL_REQUEST_BADGE_LOOK = {
  open: { Icon: GitPullRequestIcon, tone: 'text-success' },
  draft: { Icon: CircleDashedIcon, tone: 'text-muted-foreground' },
  merged: { Icon: GitMergeIcon, tone: 'text-info' },
  closed: { Icon: XCircleIcon, tone: 'text-destructive' },
  unknown: { Icon: GitPullRequestIcon, tone: 'text-muted-foreground' },
} as const satisfies Record<PullRequestBadgeState, { Icon: unknown; tone: string }>
