import { filesystemPath } from '@/lib/documents/utils/identity'
import { Button } from '@workspace/ui/components/button'

import { SearchPane } from '@/features/workspace/components/search-pane'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import { ChatDiffStatLabel } from '@/features/chat/components/chat-diff-stat-label'
import { CheckpointLoading } from '@/features/chat-mode/components/checkpoint-loading'
import { useSessionTerminalId } from '@/features/chat-mode/hooks/use-session-terminal-id'
import { useSessionToolRoot } from '@/features/chat-mode/hooks/use-session-tool-root'
import { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import { Panel as GitPanel } from '@/features/git/components/panel'
import type { FileStatus } from '@/features/git/utils/types'
import { LogsPanel } from '@/features/logs/components/panel'
import { TerminalPanel } from '@/features/terminal/components/panel'
import { CodePanel } from '@/features/workbench/components/code-panel'
import { DiagnosticsPanel } from '@/features/workbench/components/diagnostics-panel'
import { FileNavigatorPanel } from '@/features/workbench/components/file-navigator-panel'
import { ToolPaneHeader } from '@/features/workbench/components/tool-pane-header'
import type { WorkbenchPanels } from '@/features/workbench/utils/panels'
import type { ChatModeToolTab } from '@/features/chat-mode/utils/panels'

type SessionDiffScopeState = ReturnType<typeof useSessionDiffScope>

export function ToolPane({
  conflicts,

  gitFiles,
  rootPath,
  tab,
  workbenchPanels,
}: {
  readonly conflicts: EditorTabConflictMap

  readonly gitFiles: readonly FileStatus[]
  /** The project root. Individual tools act on the session's checkout below. */
  readonly rootPath: string
  readonly tab: ChatModeToolTab
  readonly workbenchPanels: WorkbenchPanels
}) {
  // Read for every tab, not just the git one: the hook is what moves a pick off a
  // turn a revert deleted, and it can only do that while it is mounted. Tying it
  // to the git tab would leave a dangling turn in storage until the tab is opened.
  const diffScope = useSessionDiffScope()
  // These are *this session's* tools, so every one of them follows the session's
  // checkout rather than the project root. Same value for a session with no
  // worktree; the difference only appears once one has its own.
  const toolRoot = useSessionToolRoot()
  const terminalSessionId = useSessionTerminalId()

  if (tab === 'editor') {
    return (
      <CodePanel
        conflicts={conflicts}
        gitFiles={gitFiles}
        panels={workbenchPanels}
        rootPath={filesystemPath(rootPath)}
      />
    )
  }
  if (tab === 'files') return <FileNavigatorPanel rootPath={filesystemPath(toolRoot)} />
  if (tab === 'git') return gitToolPane(toolRoot, diffScope)
  if (tab === 'logs') {
    return (
      <section className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
        <ToolPaneHeader tab='logs' />
        <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
          <LogsPanel active />
        </div>
      </section>
    )
  }
  if (tab === 'problems') {
    return (
      <section className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
        <ToolPaneHeader tab='problems' />
        <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
          <DiagnosticsPanel />
        </div>
      </section>
    )
  }
  if (tab === 'search') {
    return <SearchPane rootPath={toolRoot} />
  }

  return (
    <section className='bg-content-well flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <ToolPaneHeader tab='terminal' />
      <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
        <TerminalPanel
          active
          className='h-full'
          rootPath={toolRoot}
          sessionId={terminalSessionId}
        />
      </div>
    </section>
  )
}

/**
 * Mounts the header itself rather than reusing `GitChangesPanel`, which carries
 * its own: the scope bar has to sit between the header and the panel body, and
 * that panel belongs to the workbench sidebar too.
 */
function gitToolPane(rootPath: string, diffScope: SessionDiffScopeState) {
  const { latestTurnId, scope, selectTurnScope, selectWorkingTreeScope } = diffScope

  return (
    <section className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <ToolPaneHeader tab='git' />
      <div
        aria-label='Diff scope'
        className='border-border compact:py-0.5 flex shrink-0 items-center gap-1 border-b px-2 py-1'
        role='group'
      >
        {scopeButton({
          active: scope.kind === 'working-tree',
          label: 'Working tree',
          onSelect: selectWorkingTreeScope,
        })}
        {scopeButton({
          active: scope.kind === 'turn',
          // A session that has not produced a checkpoint has no turn to show, and
          // an inert button is worse than one that says so.
          disabled: !latestTurnId,
          label: 'Turn',
          onSelect: () => {
            if (!latestTurnId) return

            selectTurnScope(latestTurnId)
          },
        })}
      </div>
      <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
        {scope.kind === 'turn' ? (
          turnScopeBody(diffScope)
        ) : (
          <GitPanel rootPath={filesystemPath(rootPath)} />
        )}
      </div>
    </section>
  )
}

function scopeButton({
  active,
  disabled = false,
  label,
  onSelect,
}: {
  readonly active: boolean
  readonly disabled?: boolean
  readonly label: string
  readonly onSelect: () => void
}) {
  return (
    <Button
      aria-pressed={active}
      disabled={disabled}
      size='xs'
      type='button'
      variant={active ? 'secondary' : 'ghost'}
      onClick={onSelect}
    >
      {label}
    </Button>
  )
}

function turnScopeBody({ openTurnFile, turnSummary }: SessionDiffScopeState) {
  // No summary yet means the checkpoint has not streamed in — pending, not
  // absent. 'missing' below is the state that means there is nothing to show.
  if (!turnSummary) {
    return <CheckpointLoading />
  }
  if (turnSummary.status !== 'ready' || turnSummary.files.length === 0) {
    return (
      <p className='text-muted-foreground compact:px-2 compact:py-1.5 px-3 py-2 text-[11px]'>
        No checkpoint diff for turn {turnSummary.checkpointTurnCount}.
      </p>
    )
  }

  return (
    <div className='app-scrollbar-thin compact:py-0.5 h-full min-h-0 overflow-auto py-1'>
      <p className='text-muted-foreground compact:px-2 compact:pb-0.5 px-3 pb-1 text-[11px] tabular-nums'>
        Turn {turnSummary.checkpointTurnCount} · {turnSummary.files.length} files
      </p>
      {turnSummary.files.map((file) => (
        <Button
          className='compact:gap-1.5 compact:px-2 w-full justify-between gap-2 px-3 font-normal'
          key={file.path}
          size='sm'
          type='button'
          variant='ghost'
          onClick={() => openTurnFile(file.path)}
        >
          <span className='min-w-0 truncate text-left'>{file.path}</span>
          <ChatDiffStatLabel additions={file.additions} deletions={file.deletions} />
        </Button>
      ))}
    </div>
  )
}
