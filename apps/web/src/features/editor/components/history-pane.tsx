import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { emptySubscription } from '@workspace/utils/subscriptions'
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
import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from 'react'

import { DiffEditor } from '@/features/editor/components/diff-editor'
import { HistoryClearDialog } from '@/features/editor/components/history-clear-dialog'
import { HistoryGraphStrip } from '@/features/editor/components/history-graph-strip'
import { useHistoryViewer } from '@/features/editor/hooks/use-history-viewer'
import { useTabPresentation } from '@/features/editor/hooks/use-tab-presentation'
import { useOptionalWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import type { HistoryBarrierGroup } from '@/features/editor/state/workspace-edit-service'
import { basename } from '@/lib/path-formatters'
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
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

const CLOCK_TICK_MS = 30_000
const MAX_LISTED_FILES = 6

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
  const snapshot = useHistoryViewer(buffer, path, tabId)
  const presentation = useTabPresentation(tabId)
  const viewer = snapshot?.viewer ?? null
  const state = snapshot?.state ?? null
  const restore = useMutation(historyRestoreMutationOptions(documentKey, buffer))
  const clear = useMutation(historyClearMutationOptions(documentKey, buffer))
  const restoring =
    useIsMutating({ mutationKey: editorMutationKeys.historyRestore(documentKey) }) > 0
  const [clearOpen, setClearOpen] = useState(false)
  const [barrierFocused, setBarrierFocusedState] = useState(presentation.history.barrierFocused)
  const now = useClock()
  const workspaceEdits = useOptionalWorkspaceEditService()
  const barrierGroup = useSyncExternalStore(
    workspaceEdits ? workspaceEdits.subscribe : emptySubscription,
    () => workspaceEdits?.historyBarrierGroup(buffer) ?? null,
  )
  const undoingWorkspaceEdit = useSyncExternalStore(
    workspaceEdits ? workspaceEdits.subscribe : emptySubscription,
    () => workspaceEdits?.getSnapshot().phase === 'undoing',
  )

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
  const selectedComparison = state?.comparison?.status === 'ready' ? state.comparison.result : null
  const focusedComparison = state?.lostIds.length ? null : focusedDiff
  const displayedDiff = state?.selectedIds.length === 2 ? selectedComparison : focusedComparison
  const hasDiffEditor =
    !(barrierFocused && graph?.barrier) &&
    displayedDiff !== null &&
    displayedDiff !== 'too-large' &&
    displayedDiff.hunks.length > 0
  const { ref: focusRef } = useFocusTarget<HTMLDivElement>(
    {
      area: 'editor',
      id: { kind: 'editor', key: path, surface: 'history', tabId },
      onIntent: (intent, element) => {
        if (intent !== 'focus') return false
        const graph = element.querySelector<SVGSVGElement>('[role="listbox"]')
        if (!graph) return false
        graph.focus()
        return true
      },
    },
    !hasDiffEditor,
  )

  if (!viewer || !state || !graph) return null

  const barrier = graph.barrier
  const barrierActive = barrierFocused && barrier !== null
  const barrierLabel = barrierAriaLabel(barrierGroup)
  const canRestore = focused !== null && !focused.isCurrent && !restoring && !barrierActive
  const twoSelected = state.selectedIds.length === 2

  function setBarrierFocused(value: boolean) {
    presentation.setBarrierFocused(value)
    setBarrierFocusedState(value)
  }

  function focusNode(id: HistoryNodeId) {
    setBarrierFocused(false)
    viewer?.focus(id)
  }

  function undoBarrierGroup() {
    if (!workspaceEdits || !barrierGroup?.undoable) return
    void workspaceEdits.undo()
  }

  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!viewer || !state) return
    if (
      barrierActive &&
      barrierKeyAction(event, undoBarrierGroup, () => setBarrierFocused(false))
    ) {
      event.preventDefault()
      return
    }
    const handled = historyKeyAction(event, viewer, {
      restore: () => {
        if (canRestore && focused) restore.mutate(focused.id)
      },
      leave: () => onLeave?.(),
      // Left from the root reaches the barrier, the state before the workspace edit.
      reachBarrier: () => {
        if (!barrier) return false
        setBarrierFocused(true)
        return true
      },
    })
    if (handled) event.preventDefault()
  }

  return (
    <ToolPane
      className='h-full'
      header={null}
      bodyClassName='flex flex-col overflow-hidden'
      data-history-pane={documentKey}
      ref={focusRef}
      subheader={
        <>
          <div className='overflow-x-auto px-(--bar-padding-x) py-1'>
            <HistoryGraphStrip
              barrierFocused={barrierActive}
              barrierLabel={barrierLabel}
              focusedId={state.focusedId}
              graph={graph}
              now={now}
              selectedIds={state.selectedIds}
              onFocus={focusNode}
              onFocusBarrier={() => setBarrierFocused(true)}
              onKeyDown={handleKeyDown}
              onToggleSelect={(id) => {
                setBarrierFocused(false)
                viewer.toggleSelection(id)
              }}
            />
          </div>
          <PaneBar className='justify-between gap-(--density-control-gap)'>
            {barrierActive ? (
              <div className='flex min-w-0 flex-1 items-center gap-(--density-control-gap) text-xs'>
                <span className='shrink-0 font-medium'>Workspace edit</span>
                <span className='text-muted-foreground shrink-0 tabular-nums'>
                  {affectedFilesLabel(barrierGroup)}
                </span>
              </div>
            ) : focused ? (
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
        </>
      }
    >
      <div className='min-h-0 flex-1'>
        {barrierActive ? (
          <BarrierBody
            group={barrierGroup}
            undoing={undoingWorkspaceEdit}
            onUndo={workspaceEdits ? undoBarrierGroup : null}
          />
        ) : twoSelected ? (
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
    </ToolPane>
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

function BarrierBody({
  group,
  undoing,
  onUndo,
}: {
  group: HistoryBarrierGroup | null
  undoing: boolean
  onUndo: (() => void) | null
}) {
  const hint = barrierHint(group)
  const action =
    onUndo && group ? (
      <Button disabled={!group.undoable || undoing} size='sm' type='button' onClick={onUndo}>
        {undoing ? <Spinner /> : <ArrowCounterClockwiseIcon data-icon='inline-start' />}
        Undo workspace edit
      </Button>
    ) : null
  return (
    <EmptyState
      action={action}
      className='h-full'
      hint={hint}
      title='Earlier history is behind a workspace edit.'
    />
  )
}

function barrierHint(group: HistoryBarrierGroup | null): string {
  if (!group) return 'Undoing that edit restores it; the undo also touches its other files.'
  const files = group.affectedPaths.slice(0, MAX_LISTED_FILES).map((path) => basename(path))
  const more = group.affectedPaths.length - files.length
  const listed = more > 0 ? `${files.join(', ')} and ${more} more` : files.join(', ')
  if (group.laterGroupCount > 0) {
    return `It changed ${listed}. Undo the ${group.laterGroupCount} later workspace edits first.`
  }
  if (!group.undoable) return `It changed ${listed}. Workspace undo is busy right now.`
  return `It changed ${listed}. Undoing it restores every one of them.`
}

function affectedFilesLabel(group: HistoryBarrierGroup | null): string {
  if (!group) return ''
  return group.affectedPaths.length === 1 ? '1 file' : `${group.affectedPaths.length} files`
}

function barrierAriaLabel(group: HistoryBarrierGroup | null): string {
  const base = 'Workspace edit, earlier history behind it'
  return group ? `${base}, ${affectedFilesLabel(group)}` : base
}

function barrierKeyAction(
  event: KeyboardEvent<SVGSVGElement>,
  undo: () => void,
  leave: () => void,
): boolean {
  if (event.key === 'Enter') {
    undo()
    return true
  }
  if (event.key === 'ArrowRight' || event.key === 'Escape') {
    leave()
    return true
  }
  return event.key === 'ArrowLeft'
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
  actions: { restore: () => void; leave: () => void; reachBarrier: () => boolean },
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
      return extend(viewer.focusPrevious()) || actions.reachBarrier()
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
