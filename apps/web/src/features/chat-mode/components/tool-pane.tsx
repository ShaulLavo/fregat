import { ToolPane as PaneShell } from '@workspace/ui/patterns/tool-pane'
import type { GitFileStatus } from '@workspace/contracts'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { PaneBar } from '@workspace/ui/components/pane-bar'

import { SearchPane } from '@/features/workspace/components/search-pane'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import { TurnFiles } from '@/features/chat-mode/components/turn-files'
import { CheckpointLoading } from '@/features/chat-mode/components/checkpoint-loading'
import { CheckpointState } from '@/features/chat-mode/components/checkpoint-state'
import { checkpointAvailability } from '@/lib/checkpoint-availability'
import { useSessionTerminalId } from '@/features/chat-mode/hooks/use-session-terminal-id'
import { useSessionToolRoot } from '@/features/chat-mode/hooks/use-session-tool-root'
import { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import { Panel as GitPanel } from '@/features/git/components/panel'

import { LogsPanel } from '@/features/logs/components/panel'
import { DeferredTerminalPanel } from '@/features/terminal/components/deferred-panel'
import { KeepAliveSlot } from '@/lib/keep-alive/components/keep-alive-slot'
import { CodePanel } from '@/features/workbench/components/code-panel'
import { DiagnosticsPanel } from '@/features/workbench/components/diagnostics-panel'
import { FileNavigatorPanel } from '@/features/workbench/components/file-navigator-panel'
import { GitPaneHeader } from '@/features/workbench/components/git-pane-header'
import { ToolPaneHeader } from '@/components/tool-pane-header'
import type { WorkbenchPanels } from '@/features/workbench/utils/panels'
import type { ChatModeToolTab } from '@/features/chat-mode/utils/panels'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

type SessionDiffScopeState = ReturnType<typeof useSessionDiffScope>

export function ToolPane({
  conflicts,

  gitFiles,
  rootPath,
  tab,
  workbenchPanels,
}: {
  readonly conflicts: EditorTabConflictMap

  readonly gitFiles: readonly GitFileStatus[]
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
  if (tab !== 'terminal') {
    return toolBody({ conflicts, diffScope, gitFiles, rootPath, tab, toolRoot, workbenchPanels })
  }

  return (
    <PaneShell
      className='h-full min-w-0 overflow-hidden'
      bodyClassName='bg-content-well'
      scroll={false}
      header={<ToolPaneHeader tab='terminal' />}
    >
      {/* Kept, so another tool, a collapsed pane or another session never ends this shell. */}
      <KeepAliveSlot id={`chat-terminals:${terminalSessionId}`} scope='chat-terminals'>
        {(attached) => (
          <RenderErrorBoundary label='Terminal'>
            <DeferredTerminalPanel
              active={attached}
              className='h-full'
              rootPath={toolRoot}
              sessionId={terminalSessionId}
            />
          </RenderErrorBoundary>
        )}
      </KeepAliveSlot>
    </PaneShell>
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
      scroll={false}
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
      scroll={false}
      header={<GitPaneHeader rootPath={rootPath} />}
      subheader={
        <PaneBar>
          <Tabs
            value={scope.kind}
            onValueChange={(next: typeof scope.kind) => {
              if (next === 'working-tree') return selectWorkingTreeScope()
              if (latestTurnId) selectTurnScope(latestTurnId)
            }}
          >
            <TabsList aria-label='Diff scope' variant='segmented'>
              <TabsTab value='working-tree'>Working tree</TabsTab>
              {/* A session with no checkpoint has no turn to show; an inert tab says so. */}
              <TabsTab disabled={!latestTurnId} value='turn'>
                Turn
              </TabsTab>
            </TabsList>
          </Tabs>
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

function turnScopeBody({ openTurnFile, turnSummary }: SessionDiffScopeState) {
  const availability = checkpointAvailability(turnSummary)
  if (availability.kind === 'pending') return <CheckpointLoading />
  if (availability.kind !== 'available') return <CheckpointState availability={availability} />

  return <TurnFiles summary={availability.summary} onOpenFile={openTurnFile} />
}
