import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
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
} from '@singapore-editor/core/document'
import { useIsMutating, useMutation } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Spinner } from '@workspace/ui/components/spinner'
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from 'react'

import { historyDiffAttachment, type DiffAttachment } from '@/lib/diff-attachment'
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
import { type HistoryComparisonResult } from '@/features/editor/utils/history-compare'
import {
  historyStateExcerpt,
  historyStateLabel,
  historyStateSource,
  historyStateSummary,
  relativeTimeLabel,
} from '@/features/editor/utils/history-state-label'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

const CLOCK_TICK_MS = 30_000
const MAX_LISTED_FILES = 6

export function HistoryPane({
  buffer,
  documentKey,
  path,
  rootPath,
  tabId,
  onLeave,
}: {
  buffer: EditorTextBuffer
  documentKey: DocumentKey
  path: FilesystemPath
  rootPath: FilesystemPath
  tabId: TabId
  /** Escape with nothing selected: hand focus back to the file's own editor. */
  onLeave?: () => void
}) {
  const mode = useSettingValue('editor.diff.viewMode')
  const snapshot = useHistoryViewer(buffer, path, rootPath, tabId)
  const presentation = useTabPresentation(tabId)
  const viewer = snapshot?.viewer ?? null
  const nextState = snapshot?.state ?? null
  const restore = useMutation(historyRestoreMutationOptions(documentKey, buffer))
  const clear = useMutation(historyClearMutationOptions(documentKey, buffer))
  const restoring =
    useIsMutating({ mutationKey: editorMutationKeys.historyRestore(documentKey) }) > 0
  const [clearOpen, setClearOpen] = useState(false)
  const [barrierFocused, setBarrierFocusedState] = useState(presentation.history.barrierFocused)
  const comparisonPending =
    nextState?.selectedIds.length === 2 &&
    (!nextState.comparison || nextState.comparison.status === 'pending')
  const shown = useHeldUntilReady(snapshot, !comparisonPending || barrierFocused)
  const state = shown?.state ?? null
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
  const focused = graph?.nodes.find((node) => node.id === state?.focusedId) ?? null
  const restoreTarget =
    state && viewer && state.focusedId !== null ? viewer.node(state.focusedId) : null
  const focusedDiff = shown?.focusedComparison ?? null
  const selectedComparison = state?.comparison?.status === 'ready' ? state.comparison.result : null
  const focusedComparison = state?.lostIds.length ? null : focusedDiff
  const displayedDiff = state?.selectedIds.length === 2 ? selectedComparison : focusedComparison
  const attachment = historyDiffAttachment(
    shown?.displayedRead ?? null,
    displayedDiff === 'too-large' ? null : displayedDiff,
    state?.selectedIds.length === 2 ? 'selected' : 'focused',
  )
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
  const canRestore =
    restoreTarget !== null && !restoreTarget.isCurrent && !restoring && !barrierActive
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
        if (canRestore && restoreTarget) restore.mutate(restoreTarget.id)
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
      bodyClassName='flex flex-col'
      scroll={false}
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
                <span className='shrink-0 font-medium'>Multi-file edit</span>
                <span className='text-muted-foreground shrink-0 tabular-nums'>
                  {affectedFilesLabel(barrierGroup)}
                </span>
              </div>
            ) : focused ? (
              <HistoryStateRow node={focused} now={now} />
            ) : (
              <span className='text-muted-foreground text-xs'>No version selected</span>
            )}
            <div className='flex shrink-0 items-center gap-(--density-control-gap)'>
              {comparisonPending ? <Spinner size='xs' label='Comparing versions' /> : null}
              <Button
                disabled={!canRestore}
                size='sm'
                type='button'
                variant='outline'
                onClick={() => canRestore && restoreTarget && restore.mutate(restoreTarget.id)}
              >
                {restoring ? <Spinner /> : <ArrowCounterClockwiseIcon data-icon='inline-start' />}
                Use this version
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
        ) : (
          <HistoryComparisonBody
            attachment={attachment}
            comparison={twoSelected ? state.comparison : undefined}
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
        Undo multi-file edit
      </Button>
    ) : null
  return (
    <EmptyState
      action={action}
      className='h-full'
      hint={hint}
      title='A multi-file edit blocks earlier versions.'
    />
  )
}

function barrierHint(group: HistoryBarrierGroup | null): string {
  if (!group) return 'Undo that edit to reach them. The undo also changes its other files.'
  const files = group.affectedPaths.slice(0, MAX_LISTED_FILES).map((path) => basename(path))
  const more = group.affectedPaths.length - files.length
  const listed = more > 0 ? `${files.join(', ')} and ${more} more` : files.join(', ')
  if (group.laterGroupCount > 0) {
    return `It changed ${listed}. Undo the ${group.laterGroupCount} later multi-file edits first.`
  }
  if (!group.undoable)
    return `It changed ${listed}. Another undo is running. Try again in a moment.`
  return `It changed ${listed}. Undoing it puts all of them back.`
}

function affectedFilesLabel(group: HistoryBarrierGroup | null): string {
  if (!group) return ''
  return group.affectedPaths.length === 1 ? '1 file' : `${group.affectedPaths.length} files`
}

function barrierAriaLabel(group: HistoryBarrierGroup | null): string {
  const base = 'Multi-file edit, earlier versions behind it'
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

function HistoryComparisonBody({
  attachment,
  comparison,
  diff,
  focused,
  lostIds,
  mode,
  tabId,
}: {
  attachment: DiffAttachment | null
  comparison: HistoryComparison<HistoryComparisonResult> | null | undefined
  diff: HistoryComparisonResult | null
  focused: EditorHistoryGraphNode | null
  lostIds: readonly HistoryNodeId[]
  mode: 'split' | 'stacked'
  tabId: TabId
}) {
  if (comparison === null || comparison?.status === 'pending') {
    return (
      <LoadingState className='flex h-full flex-col gap-3 p-4' label='Comparing versions'>
        <div className='skeleton-sweep h-4 w-3/4 rounded-md' />
        <div className='skeleton-sweep h-4 w-1/2 rounded-md' />
        <div className='skeleton-sweep h-4 w-2/3 rounded-md' />
      </LoadingState>
    )
  }
  if (comparison?.status === 'failed') {
    return <EmptyState className='h-full' title='Could not compare these versions.' tone='error' />
  }
  if (comparison?.status === 'ready') {
    return (
      <DiffBody
        attachment={attachment}
        file={comparison.result}
        mode={mode}
        sameText='These versions have the same text.'
        tabId={tabId}
      />
    )
  }
  if (lostIds.length > 0) {
    return (
      <EmptyState
        className='h-full'
        hint='History keeps a limited number of versions. Pick another one.'
        title='That version was deleted.'
      />
    )
  }
  if (!focused || focused.isCurrent) {
    return (
      <EmptyState
        className='h-full'
        hint='Pick an earlier version to see what changed. Shift+click or Shift+arrow selects two versions to compare.'
        title='This is the current version.'
      />
    )
  }
  return (
    <DiffBody
      attachment={attachment}
      file={diff}
      mode={mode}
      sameText='Same text as the current version.'
      tabId={tabId}
    />
  )
}

function DiffBody({
  attachment,
  file,
  mode,
  sameText,
  tabId,
}: {
  attachment: DiffAttachment | null
  file: HistoryComparisonResult | null
  mode: 'split' | 'stacked'
  sameText: string
  tabId: TabId
}) {
  if (file === 'too-large') {
    return <EmptyState className='h-full' title='Too large to compare here.' />
  }
  if (file && file.hunks.length === 0) return <EmptyState className='h-full' title={sameText} />
  return <DiffEditor attachment={attachment} mode={mode} tabId={tabId} />
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
