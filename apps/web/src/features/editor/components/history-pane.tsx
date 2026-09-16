import type { DocumentKey, FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react'
import type {
  EditorHistoryGraphNode,
  EditorTextBuffer,
  HistoryComparison,
  HistoryNodeId,
  HistoryViewer,
} from '@singapore-editor/core'
import { useIsMutating, useMutation } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Spinner } from '@workspace/ui/components/spinner'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'

import { DiffEditor } from '@/features/editor/components/diff-editor'
import { HistoryClearDialog } from '@/features/editor/components/history-clear-dialog'
import { HistoryGraphStrip } from '@/features/editor/components/history-graph-strip'
import { useHistoryViewer } from '@/features/editor/hooks/use-history-viewer'
import {
  historyClearMutationOptions,
  historyRestoreMutationOptions,
} from '@/features/editor/state/history-mutations'
import {
  compareHistoryStates,
  type HistoryComparisonResult,
} from '@/features/editor/utils/history-compare'
import {
  historyStateExcerpt,
  historyStateLabel,
  historyStateSource,
  historyStateSummary,
  relativeTimeLabel,
} from '@/features/editor/utils/history-state-label'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'

const CLOCK_TICK_MS = 30_000

export function HistoryPane({
  buffer,
  documentKey,
  path,
  tabId,
  onLeave,
}: {
  buffer: EditorTextBuffer
  documentKey: DocumentKey
  path: FilesystemPath
  tabId: TabId
  /** Escape with nothing selected: hand focus back to the file's own editor. */
  onLeave?: () => void
}) {
  const mode = useSettingValue('editor.diff.viewMode')
  const snapshot = useHistoryViewer(buffer, path)
  const viewer = snapshot?.viewer ?? null
  const state = snapshot?.state ?? null
  const restore = useMutation(historyRestoreMutationOptions(documentKey, buffer))
  const clear = useMutation(historyClearMutationOptions(documentKey, buffer))
  const restoring =
    useIsMutating({ mutationKey: editorMutationKeys.historyRestore(documentKey) }) > 0
  const [clearOpen, setClearOpen] = useState(false)
  const now = useClock()

  const graph = state?.graph ?? null
  const focused = state && viewer && state.focusedId !== null ? viewer.node(state.focusedId) : null
  const current = graph && viewer ? viewer.node(graph.currentId) : null
  // A full-text diff of two states is real work; only the focused state, its revision and the
  // graph revision can change its answer.
  const focusedDiff = useMemo(
    () =>
      focused && current && !focused.isCurrent
        ? compareHistoryStates(current, focused, path)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focused?.id, focused?.revision, graph?.revision, path],
  )

  if (!viewer || !state || !graph) return null

  const canRestore = focused !== null && !focused.isCurrent && !restoring
  const twoSelected = state.selectedIds.length === 2

  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!viewer || !state) return
    const handled = historyKeyAction(event, viewer, {
      restore: () => {
        if (canRestore && focused) restore.mutate(focused.id)
      },
      leave: () => onLeave?.(),
    })
    if (handled) event.preventDefault()
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='border-border overflow-x-auto border-b px-(--bar-padding-x) py-1'>
        <HistoryGraphStrip
          focusedId={state.focusedId}
          graph={graph}
          now={now}
          selectedIds={state.selectedIds}
          onFocus={(id) => viewer.focus(id)}
          onKeyDown={handleKeyDown}
          onToggleSelect={(id) => viewer.toggleSelection(id)}
        />
      </div>
      <PaneBar border='bottom' className='justify-between gap-(--density-control-gap)'>
        {focused ? (
          <HistoryStateRow node={focused} now={now} />
        ) : (
          <span className='text-muted-foreground text-xs'>No state focused</span>
        )}
        <div className='flex shrink-0 items-center gap-(--density-control-gap)'>
          <Button
            disabled={!canRestore}
            size='sm'
            type='button'
            variant='outline'
            onClick={() => focused && restore.mutate(focused.id)}
          >
            {restoring ? <Spinner /> : <ArrowCounterClockwiseIcon data-icon='inline-start' />}
            Restore
          </Button>
          <Button
            disabled={graph.nodes.length < 2}
            size='sm'
            type='button'
            variant='ghost'
            onClick={() => setClearOpen(true)}
          >
            Clear history
          </Button>
        </div>
      </PaneBar>
      <div className='min-h-0 flex-1'>
        {twoSelected ? (
          <ComparisonBody comparison={state.comparison} mode={mode} tabId={tabId} />
        ) : (
          <FocusedBody
            diff={focusedDiff}
            focused={focused}
            lostIds={state.lostIds}
            mode={mode}
            tabId={tabId}
          />
        )}
      </div>
      <HistoryClearDialog
        documentKey={documentKey}
        open={clearOpen}
        stateCount={graph.nodes.length - 1}
        onConfirm={() => clear.mutate(undefined, { onSettled: () => setClearOpen(false) })}
        onOpenChange={setClearOpen}
      />
    </div>
  )
}

function HistoryStateRow({ node, now }: { node: EditorHistoryGraphNode; now: number }) {
  const source = historyStateSource(node)
  const excerpt = historyStateExcerpt(node)
  return (
    <div
      className='flex min-w-0 flex-1 items-center gap-(--density-control-gap) text-xs'
      title={excerpt ? `${historyStateLabel(node, now)}: ${excerpt}` : historyStateLabel(node, now)}
    >
      <span className='shrink-0 font-medium'>{historyStateSummary(node)}</span>
      {source ? <span className='text-muted-foreground shrink-0'>{source}</span> : null}
      <span className='text-muted-foreground shrink-0 tabular-nums'>
        {relativeTimeLabel(node.committedAt, now)}
      </span>
      {excerpt ? <span className='text-muted-foreground truncate font-mono'>{excerpt}</span> : null}
    </div>
  )
}

function ComparisonBody({
  comparison,
  mode,
  tabId,
}: {
  comparison: HistoryComparison<HistoryComparisonResult> | null
  mode: 'split' | 'stacked'
  tabId: TabId
}) {
  if (!comparison || comparison.status === 'pending') {
    return (
      <LoadingState className='flex h-full flex-col gap-3 p-4' label='Comparing states'>
        <div className='skeleton-sweep h-4 w-3/4 rounded-md' />
        <div className='skeleton-sweep h-4 w-1/2 rounded-md' />
        <div className='skeleton-sweep h-4 w-2/3 rounded-md' />
      </LoadingState>
    )
  }
  if (comparison.status === 'failed') {
    return <EmptyState className='h-full' title='Could not compare these states.' tone='error' />
  }
  return (
    <DiffBody
      file={comparison.result}
      mode={mode}
      sameText='These states have the same text.'
      tabId={tabId}
    />
  )
}

function FocusedBody({
  diff,
  focused,
  lostIds,
  mode,
  tabId,
}: {
  diff: HistoryComparisonResult | null
  focused: EditorHistoryGraphNode | null
  lostIds: readonly HistoryNodeId[]
  mode: 'split' | 'stacked'
  tabId: TabId
}) {
  if (lostIds.length > 0) {
    return (
      <EmptyState
        className='h-full'
        hint='Retention pruned it. Pick another state.'
        title='That state is no longer retained.'
      />
    )
  }
  if (!focused || focused.isCurrent) {
    return (
      <EmptyState
        className='h-full'
        hint='Pick an earlier state to see what changed. Shift+click or Shift+arrow selects two states to compare.'
        title='This is the current state.'
      />
    )
  }
  return (
    <DiffBody file={diff} mode={mode} sameText='Same text as the current state.' tabId={tabId} />
  )
}

function DiffBody({
  file,
  mode,
  sameText,
  tabId,
}: {
  file: HistoryComparisonResult | null
  mode: 'split' | 'stacked'
  sameText: string
  tabId: TabId
}) {
  if (file === 'too-large') {
    return <EmptyState className='h-full' title='Too large to compare here.' />
  }
  if (file && file.hunks.length === 0) return <EmptyState className='h-full' title={sameText} />
  return <DiffEditor file={file} mode={mode} tabId={tabId} />
}

function useClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

// Arrows walk sequence order, Shift extends to a second selection, Up and Down follow the tree.
function historyKeyAction(
  event: KeyboardEvent<SVGSVGElement>,
  viewer: HistoryViewer<HistoryComparisonResult>,
  actions: { restore: () => void; leave: () => void },
): boolean {
  const before = viewer.getState().focusedId
  const extend = (moved: boolean) => {
    if (!moved || !event.shiftKey || before === null) return moved
    const after = viewer.getState().focusedId
    viewer.clearSelection()
    viewer.toggleSelection(before)
    if (after !== null) viewer.toggleSelection(after)
    return true
  }
  switch (event.key) {
    case 'ArrowLeft':
      return extend(viewer.focusPrevious())
    case 'ArrowRight':
      return extend(viewer.focusNext())
    case 'ArrowUp':
      return viewer.focusParent()
    case 'ArrowDown':
      return viewer.focusChild()
    case 'Home':
      return viewer.focusCurrent()
    case ' ':
      return before === null ? false : viewer.toggleSelection(before)
    case 'Enter':
      actions.restore()
      return true
    case 'Escape':
      if (viewer.getState().selectedIds.length > 0) {
        viewer.clearSelection()
        return true
      }
      actions.leave()
      return true
    default:
      return false
  }
}
