import { ToolPane as PaneShell } from '@workspace/ui/patterns/tool-pane'
import type { GitFileStatus } from '@workspace/contracts'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { cn } from '@workspace/ui/lib/utils'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'

import { SearchPane } from '@/features/workspace/components/search-pane'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import { TurnFiles } from '@/features/chat-mode/components/turn-files'
import { CheckpointLoading } from '@/features/chat-mode/components/checkpoint-loading'
import { SessionTerminals } from '@/features/chat-mode/components/session-terminals'
import { useOpenedTerminals } from '@/features/chat-mode/hooks/use-opened-terminals'
import { useSessionTerminalId } from '@/features/chat-mode/hooks/use-session-terminal-id'
import { useSessionToolRoot } from '@/features/chat-mode/hooks/use-session-tool-root'
import { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import { Panel as GitPanel } from '@/features/git/components/panel'

import { LogsPanel } from '@/features/logs/components/panel'
import { CodePanel } from '@/features/workbench/components/code-panel'
import { DiagnosticsPanel } from '@/features/workbench/components/diagnostics-panel'
import { FileNavigatorPanel } from '@/features/workbench/components/file-navigator-panel'
import { GitPaneHeader } from '@/features/workbench/components/git-pane-header'
import { ToolPaneHeader } from '@/components/tool-pane-header'
import type { WorkbenchPanels } from '@/features/workbench/utils/panels'
import { chatModeToolTabLabel, type ChatModeToolTab } from '@/features/chat-mode/utils/panels'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

type SessionDiffScopeState = ReturnType<typeof useSessionDiffScope>

export function ToolPane({
  conflicts,

  gitFiles,
  rootPath,
  tab,
  visible,
  workbenchPanels,
}: {
  readonly conflicts: EditorTabConflictMap

  readonly gitFiles: readonly GitFileStatus[]
  /** The project root. Individual tools act on the session's checkout below. */
  readonly rootPath: string
  readonly tab: ChatModeToolTab
  /** False while the pane is collapsed and only kept mounted for its terminals. */
  readonly visible: boolean
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
  const terminalShowing = tab === 'terminal'
  const terminals = useOpenedTerminals(
    { id: terminalSessionId, rootPath: toolRoot },
    visible && terminalShowing,
  )

  return (
    <div className='relative h-full min-w-0'>
      {terminals.length > 0 ? (
        <div
          className={cn('absolute inset-0', !terminalShowing && 'invisible')}
          inert={!terminalShowing}
        >
          <SessionTerminals
            activeId={terminalSessionId}
            terminals={terminals}
            visible={visible && terminalShowing}
          />
        </div>
      ) : null}
      {terminalShowing ? null : (
        <div className='absolute inset-0'>
          {/* Below the terminals, so a crashing tool cannot detach them. */}
          <RenderErrorBoundary label={chatModeToolTabLabel(tab)} resetKeys={[tab]}>
            {toolBody({ conflicts, diffScope, gitFiles, rootPath, tab, toolRoot, workbenchPanels })}
          </RenderErrorBoundary>
        </div>
      )}
    </div>
  )
}

function toolBody({
  conflicts,
  diffScope,
  gitFiles,
  rootPath,
  tab,
  toolRoot,
  workbenchPanels,
}: {
  readonly conflicts: EditorTabConflictMap
  readonly diffScope: SessionDiffScopeState
  readonly gitFiles: readonly GitFileStatus[]
  readonly rootPath: string
  readonly tab: Exclude<ChatModeToolTab, 'terminal'>
  readonly toolRoot: string
  readonly workbenchPanels: WorkbenchPanels
}) {
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
  if (tab === 'logs') return <LogsPanel active />
  if (tab === 'search') return <SearchPane rootPath={toolRoot} />

  return (
    <PaneShell
      className='h-full min-w-0 overflow-hidden'
      bodyClassName='overflow-hidden'
      header={<ToolPaneHeader tab='problems' />}
    >
      <DiagnosticsPanel />
    </PaneShell>
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
    <PaneShell
      className='h-full min-w-0 overflow-hidden'
      bodyClassName='overflow-hidden'
      header={<GitPaneHeader rootPath={rootPath} />}
      subheader={
        <PaneBar aria-label='Diff scope' role='group'>
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
        </PaneBar>
      }
    >
      {scope.kind === 'turn' ? (
        turnScopeBody(diffScope)
      ) : (
        <GitPanel rootPath={filesystemPath(rootPath)} />
      )}
    </PaneShell>
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
      className='text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground'
      disabled={disabled}
      size='xs'
      type='button'
      variant='ghost'
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
      <p className='text-muted-foreground text-2xs px-(--density-control-padding-x) py-(--density-section-gap)'>
        No checkpoint diff for turn {turnSummary.checkpointTurnCount}.
      </p>
    )
  }

  return <TurnFiles summary={turnSummary} onOpenFile={openTurnFile} />
}
