import { useEffect, useState } from 'react'
import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'
import { useHistoryView } from '@/features/git/hooks/use-history-view'
import { useQueryClient } from '@tanstack/react-query'
import type { GitCommitFile } from '@workspace/contracts'
import { GitBranchIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@workspace/ui/components/dialog'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'
import { useHistory } from '@/features/git/hooks/use-history'
import { useOpenHistoricalDiff } from '@/features/git/hooks/use-open-historical-diff'
import { historyKeys } from '@/features/git/utils/query-keys'
import { layoutHistory, layoutHistoryMatches } from '@/features/git/utils/history-layout'
import { historyCountLabel, historyRefLabels } from '@/features/git/utils/history-presentation'
import { HistoryToolbar } from '@/features/git/components/history-toolbar'
import { HistoryList } from '@/features/git/components/history-list'
import { CommitDetails } from '@/features/git/components/commit-details'
import { errorMessage } from '@/lib/file-server'

export function History({ rootPath }: { rootPath: string }) {
  const { view, updateView } = useHistoryView()
  const { refName, search, selected, expanded } = view
  const [revealRevision, setRevealRevision] = useState(0)
  const [settledSearch] = useDebouncedValue(search.trim(), { wait: 200 })
  const searching = settledSearch !== search.trim()
  const queryClient = useQueryClient()
  const history = useHistory(rootPath, refName, settledSearch, view.pageCount)
  const openDiff = useOpenHistoricalDiff()
  const commits = history.data?.pages.flatMap((page) => page.commits) ?? []
  const refs = history.data?.pages[0]?.refs ?? []
  const labels = historyRefLabels(refs)
  const rows = history.shownSearch ? layoutHistoryMatches(commits) : layoutHistory(commits)
  const loadedPages = history.data?.pages.length ?? 0

  useEffect(() => {
    if (searching || history.isPlaceholderData || loadedPages <= view.pageCount) return
    void updateView({ pageCount: loadedPages })
  }, [loadedPages, searching, history.isPlaceholderData, view.pageCount, updateView])

  function selectCommit(selected: string | null) {
    setRevealRevision((revision) => revision + 1)
    void updateView({ selected, detailsScrollTop: 0 })
  }

  function changeRef(refName: string) {
    setRevealRevision((revision) => revision + 1)
    void updateView({
      refName,
      pageCount: 1,
      scrollTop: 0,
      detailsScrollTop: 0,
      selected:
        refName === 'HEAD' ? (refs.find((ref) => ref.kind === 'head')?.commitId ?? null) : null,
    })
  }

  function changeSearch(search: string) {
    void updateView({ search, pageCount: 1, scrollTop: 0 })
  }

  function setExpanded(expanded: boolean) {
    void updateView({ expanded })
  }

  async function openFile(file: GitCommitFile) {
    const result = await openDiff(file)
    if (result.status === 'applied') setExpanded(false)
  }

  const content = (
    <div className='flex h-full min-h-0 flex-col' data-git-history>
      <HistoryToolbar
        refs={refs}
        refName={refName}
        search={search}
        busy={history.isFetching || searching}
        expanded={expanded}
        onRefChange={changeRef}
        onSearchChange={changeSearch}
        onExpand={() => setExpanded(true)}
        onRefresh={() => {
          void queryClient.resetQueries({
            queryKey: historyKeys.page(rootPath, refName, settledSearch),
            exact: true,
          })
        }}
      />
      <div className={cn('flex min-h-0 flex-1', expanded ? 'flex-row' : 'flex-col')}>
        {selected ? (
          <div className={cn('min-h-0 shrink-0', expanded ? 'order-last w-80' : 'h-1/2')}>
            <CommitDetails
              key={selected}
              rootPath={rootPath}
              commit={selected}
              onClose={() => selectCommit(null)}
              onOpen={(file) => {
                void openFile(file)
              }}
            />
          </div>
        ) : null}
        <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
          {history.isPending || history.isRestoring ? (
            <LoadingState label='Loading commit history' className='space-y-3 p-3'>
              <div className='skeleton-sweep h-3 w-3/4 rounded-md' />
              <div className='skeleton-sweep h-3 w-1/2 rounded-md' />
              <div className='skeleton-sweep h-3 w-2/3 rounded-md' />
            </LoadingState>
          ) : null}
          {history.isError ? (
            <div className='p-3' role='alert'>
              <EmptyState
                title='Could not load history'
                tone='error'
                description={errorMessage(history.error)}
              />
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  void history.refetch()
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {!history.isPending && !history.isError && rows.length === 0 ? (
            <EmptyState
              className='flex-1'
              title={history.shownSearch ? 'No matching commits' : 'No commits yet'}
              description={
                history.shownSearch
                  ? 'Try another search or choose All branches & tags.'
                  : 'Commits will appear here after the first commit.'
              }
            />
          ) : null}
          {rows.length > 0 && !history.isRestoring ? (
            <HistoryList
              key={`${refName}:${history.shownSearch}`}
              revealRevision={revealRevision}
              rows={rows}
              refs={labels}
              selected={selected}
              expanded={expanded}
              onSelect={selectCommit}
              scrollTop={view.scrollTop}
              onScrollEnd={(scrollTop) => {
                void updateView({ scrollTop })
              }}
            />
          ) : null}
          <PaneBar>
            <span className='text-muted-foreground text-2xs min-w-0 flex-1 tabular-nums'>
              {historyCountLabel(commits.length, history.shownSearch)}
              {!history.hasNextPage && commits.length > 0 ? ' · All results loaded' : ''}
            </span>
            {history.isFetching ? <OrbitLoader className='size-3' /> : null}
            {history.hasNextPage ? (
              <Button
                size='sm'
                variant='ghost'
                disabled={history.isFetching || searching || history.isPlaceholderData}
                onClick={() => {
                  void history.fetchNextPage()
                }}
              >
                Load more
              </Button>
            ) : null}
          </PaneBar>
        </div>
      </div>
    </div>
  )

  if (!expanded) return content
  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <DialogContent className='flex h-[85dvh] w-[94vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none'>
        <PaneBar>
          <GitBranchIcon className='size-(--icon-size)' />
          <DialogTitle className='text-xs font-medium'>Commit graph</DialogTitle>
        </PaneBar>
        <DialogDescription className='sr-only'>
          Browse commit history, follow branches and merges, and open changed files.
        </DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  )
}
