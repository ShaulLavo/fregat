import { useSettingValue } from '@/hooks/use-setting-value'
import { SessionTitleStatus } from '@/features/chat-mode/components/session-title-status'
import { WorktreeChip } from '@/features/chat-mode/components/worktree-chip'
import { SessionAttentionIndicator } from '@/features/chat-mode/components/session-attention-indicator'
import { CaretRightIcon } from '@phosphor-icons/react'

import { BackgroundTasksButton } from '@/features/chat/components/background-tasks-button'
import { SessionAgentChip } from '@/features/chat/components/session-agent-chip'
import { SessionToolsButton } from '@/features/chat/components/session-tools-button'
import { ContextUsageRing } from '@/features/chat/components/context-usage-ring'
import type { ContextUsage } from '@workspace/client-core/chat/context-usage'
import {
  sessionStatusLabel,
  sessionStatusTextClass,
} from '@/features/chat-mode/utils/attention-state'
import { BranchActions } from '@/features/git/components/branch-actions'
import { SessionRename } from '@/components/session-rename'
import { SessionActionsButton } from '@/components/session-actions-button'
import { useChatModeSession } from '@/features/chat-mode/providers/session-context'
import { useSessionRenaming } from '@/hooks/use-session-renaming'
import { stageTitle } from '@/features/chat-mode/utils/stage-title'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { ToolPaneHeader } from '@workspace/ui/patterns/tool-pane-header'
import { cn } from '@workspace/ui/lib/utils'

export function StageHeader({
  contextUsage,
  projectTitle,
  session,
}: {
  readonly contextUsage: ContextUsage | null
  readonly projectTitle: string | null
  /** Null while the stage is on the composer — there is no session to name or act on. */
  readonly session: SessionRailItem | null
}) {
  const contextMeterEnabled = useSettingValue('chat.contextWindowMeterEnabled')
  const { rootPath } = useChatModeSession()
  const editing = useSessionRenaming(session, 'header')

  return (
    <ToolPaneHeader
      actions={
        <>
          {session?.branch && session.worktree.lifecycle.state === 'ready' ? (
            <BranchActions
              pullRequestTitle={session.title}
              // The session's worktree is its own checkout with its own HEAD, so the
              // project root would push whatever branch the main tree happens to be on.
              rootPath={session.worktreePath ?? rootPath}
            />
          ) : null}
          {session && session.status !== 'ready' ? (
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 text-2xs',
                sessionStatusTextClass(session.status),
              )}
            >
              <SessionAttentionIndicator status={session.status} />
              {sessionStatusLabel(session.status)}
            </span>
          ) : null}
          {session ? <SessionTitleStatus sessionRef={session.ref} /> : null}
          {contextMeterEnabled && contextUsage ? (
            <ContextUsageRing sessionRef={session?.ref ?? null} usage={contextUsage} />
          ) : null}
          {session ? <SessionAgentChip sessionRef={session.ref} /> : null}
          {session ? <BackgroundTasksButton sessionRef={session.ref} /> : null}
          {session ? <SessionToolsButton sessionRef={session.ref} /> : null}
          {session ? <SessionActionsButton session={session} surface='header' /> : null}
        </>
      }
    >
      {/* No title while renaming: it would hover over the input the user is typing in. */}
      <nav
        aria-label='Session'
        className='flex min-w-0 flex-1 items-center gap-1.5 text-xs'
        title={editing ? undefined : stageTitle(projectTitle, session)}
      >
        {projectTitle ? (
          <>
            <span className='text-muted-foreground max-w-[9rem] shrink-0 truncate'>
              {projectTitle}
            </span>
            <CaretRightIcon className='text-muted-foreground size-(--icon-size-sm) shrink-0' />
          </>
        ) : null}
        {session ? (
          <>
            <WorktreeChip worktree={session.worktree} repositoryKind={session.repositoryKind} />
            <CaretRightIcon className='text-muted-foreground size-(--icon-size-sm) shrink-0' />
          </>
        ) : null}
        {session && editing ? (
          <SessionRename
            className='text-foreground h-(--density-control-height-sm) min-w-0 flex-1 px-(--density-row-padding-x) text-xs font-medium'
            session={session}
          />
        ) : (
          <h1 className='min-w-0 flex-1 truncate font-medium'>{session?.title ?? 'New session'}</h1>
        )}
      </nav>
    </ToolPaneHeader>
  )
}
