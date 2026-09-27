import { usePanelRoot } from '@/features/git/hooks/use-panel-root'
import { ToolPane as PaneShell } from '@workspace/ui/patterns/tool-pane'
import type { GitFileStatus } from '@workspace/contracts'
import { filesystemPath } from '@/lib/documents/utils/identity'

import { SearchPane } from '@/features/workspace/components/search-pane'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import { useSessionToolRoot } from '@/features/chat-mode/hooks/use-session-tool-root'
import { useSessionCheckoutRefresh } from '@/features/chat-mode/hooks/use-session-checkout-refresh'
import { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'

import { DeferredLogsPanel } from '@/features/logs/components/deferred-panel'
import { CodePanel } from '@/features/workbench/components/code-panel'
import { DiagnosticsPanel } from '@/features/workbench/components/diagnostics-panel'
import { FileNavigatorPanel } from '@/features/workbench/components/file-navigator-panel'
import { GitPaneHeader } from '@/features/workbench/components/git-pane-header'
import { GitToolPane } from '@/features/chat-mode/components/git-tool-pane'
import { SessionTerminal } from '@/features/chat-mode/components/session-terminal'
import { ToolPaneHeader } from '@/components/tool-pane-header'
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
  const holdsGit = tab === 'git' && diffScope.scope.kind === 'working-tree'
  const shownGitRoot = usePanelRoot(toolRoot, holdsGit)
  useSessionCheckoutRefresh()
  if (tab !== 'terminal') {
    return toolBody({
      conflicts,
      diffScope,
      gitFiles,
      rootPath,
      tab,
      toolRoot: holdsGit ? shownGitRoot : toolRoot,
      gitLoading: holdsGit && shownGitRoot !== toolRoot,
      workbenchPanels,
    })
  }

  return (
    <PaneShell
      className='h-full min-w-0 overflow-hidden'
      bodyClassName='bg-content-well'
      scroll={false}
      header={<ToolPaneHeader tab='terminal' />}
    >
      <SessionTerminal />
    </PaneShell>
  )
}

function toolBody({
  gitLoading,
  conflicts,
  diffScope,
  gitFiles,
  rootPath,
  tab,
  toolRoot,
  workbenchPanels,
}: {
  readonly gitLoading: boolean
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
  if (tab === 'git')
    return (
      <GitToolPane
        diffScope={diffScope}
        header={<GitPaneHeader rootPath={toolRoot} loading={gitLoading} />}
        rootPath={toolRoot}
      />
    )
  if (tab === 'logs') return <DeferredLogsPanel active />
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
