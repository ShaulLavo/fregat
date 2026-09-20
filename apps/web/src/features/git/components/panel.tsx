import { disabledDiffQueryKey } from '@/features/git/utils/query-keys'
import type { GitFileStatus } from '@workspace/contracts'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { cn } from '@workspace/ui/lib/utils'
import { Activity, useMemo, type ComponentProps } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { GitBranchIcon, GitDiffIcon } from '@phosphor-icons/react'
import { History } from '@/features/git/components/history'
import { useNavigation } from '@/hooks/use-navigation'

import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { errorMessage } from '@/lib/file-server'
import { useStatus } from '@/features/git/hooks/use-status'

import { changeRows } from '@/features/git/utils/change-rows'
import { ChangesList } from '@/features/git/components/changes-list'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { CommitControls } from '@/features/git/components/commit-controls'
import { PanelLoading } from '@/features/git/components/panel-loading'
import { diffDocumentQueryKey } from '@/features/git/utils/diff-document-query'
import { FocusablePanel } from '@/components/focusable-panel'
import { queryHasNoData } from '@/lib/query-state'
import { StaleNotice } from '@/lib/environments/components/stale-notice'

const EMPTY_FILES: readonly GitFileStatus[] = []

export function Panel({ className, rootPath }: ComponentProps<'section'> & { rootPath: string }) {
  const navigation = useNavigation()
  const panels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const view = panels.activeGitTab

  function setView(activeGitTab: typeof view) {
    void navigation.setWorkbenchPanels({ ...panels, activeGitTab })
  }
  const status = useStatus(rootPath)
  const files = status.data?.files ?? EMPTY_FILES
  const repository = status.data?.repository ?? null
  const rows = useMemo(() => changeRows(files), [files])
  const hasLocalChanges = rows.staged.length > 0 || rows.worktree.length > 0

  const selectedContent = useEditorWorkspaceState((state) => state.selectedTabContent)
  const selectedDiff =
    selectedContent?.kind === 'document' && selectedContent.document.kind === 'git-diff'
      ? selectedContent.document.source
      : null
  const selectedDiffQueryKey = selectedDiff
    ? diffDocumentQueryKey(selectedDiff)
    : disabledDiffQueryKey
  const selectedDiffPending =
    useIsFetching({
      exact: true,
      predicate: queryHasNoData,
      queryKey: selectedDiffQueryKey,
    }) > 0
  const loadingDiff = selectedDiffPending && selectedDiff?.kind === 'snapshot' ? selectedDiff : null

  return (
    <FocusablePanel
      area='git'
      target={{ kind: 'git', rootPath }}
      aria-label='Git panel'
      className={cn('flex h-full min-h-0 flex-col text-foreground', className)}
    >
      <StaleNotice />
      <ToolPane
        bodyClassName='flex flex-col overflow-hidden'
        state={{
          pending: status.isPending,
          error: status.isError && !status.data,
          empty: !repository,
        }}
        loading={<PanelLoading />}
        errorState={
          <EmptyState
            align='start'
            className='min-h-0 flex-1'
            description={errorMessage(status.error)}
            title='Git is unavailable'
            tone='error'
          />
        }
        emptyState={
          <EmptyState align='start' className='min-h-0 flex-1' title='No Git repository' />
        }
        header={
          <PaneBar border='bottom'>
            <Button
              size='sm'
              variant='ghost'
              aria-pressed={view === 'changes'}
              className='aria-pressed:bg-accent'
              onClick={() => setView('changes')}
            >
              <GitDiffIcon />
              Changes
              <span className='text-muted-foreground text-2xs tabular-nums'>{files.length}</span>
            </Button>
            <Button
              size='sm'
              variant='ghost'
              aria-pressed={view === 'graph'}
              className='aria-pressed:bg-accent'
              onClick={() => setView('graph')}
            >
              <GitBranchIcon />
              Graph
            </Button>
          </PaneBar>
        }
      >
        <Activity mode={view === 'graph' ? 'visible' : 'hidden'}>
          <History key={rootPath} rootPath={rootPath} />
        </Activity>
        <Activity mode={view === 'changes' ? 'visible' : 'hidden'}>
          {repository ? (
            <CommitControls
              hasLocalChanges={hasLocalChanges}
              repository={repository}
              rootPath={rootPath}
            />
          ) : null}
          <ChangesList
            rootPath={rootPath}
            staged={rows.staged}
            worktree={rows.worktree}
            loadingPath={loadingDiff?.path}
            loadingSection={loadingDiff?.source}
          />
        </Activity>
      </ToolPane>
    </FocusablePanel>
  )
}
