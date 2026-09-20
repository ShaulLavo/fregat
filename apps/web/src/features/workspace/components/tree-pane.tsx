import { disabledFileQueryKey } from '@/features/workspace/utils/query-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type {
  FileTreeDropContext,
  FileTreeDropResult,
  FileTreeRenameEvent,
  FileTreeRowDecorationContext,
} from '@workspace/tree'
import { FileTree } from '@workspace/tree'
import { useFileTree } from '@workspace/tree'
import type { GitStatusEntry } from '@workspace/tree'
import type { FileTreeModel } from '@workspace/tree'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { EmptyState } from '@workspace/ui/components/empty-state'

import { containerTreePath, workspacePathForTreePath } from '@/features/workspace/utils/entry-paths'
import { fileTreeIndentGuideVariables } from '@/features/workspace/utils/indent-guide-style'
import {
  loadExpandedDirectories,
  syncTreePaneState,
  visibleTreeItemCount,
} from '@/features/workspace/utils/tree-pane-state'
import { selectedFileEntryForTreeSelection } from '@/features/workspace/utils/tree-selection'
import { DeleteEntryDialog } from '@/features/workspace/components/delete-entry-dialog'
import { TreeLoading } from '@/features/workspace/components/tree-loading'
import { useFileTreeActions } from '@/features/workspace/hooks/use-file-tree-actions'
import { useFileTreeIntentPrefetch } from '@/features/workspace/hooks/use-file-tree-intent-prefetch'
import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { useRowHeight } from '@workspace/ui/patterns/use-row-height'
import { useFileTreeMutationEvents } from '@/features/workspace/hooks/use-file-tree-mutation-events'
import { useOptionalWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import { useFsActions } from '@/features/workspace/hooks/use-fs-actions'
import { useProjectedTreeModel } from '@/features/workspace/hooks/use-projected-tree-model'
import { hasPendingTreeMove, runTreeIntent } from '@/features/workspace/state/tree-intents'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { preparedTreeInputForPaths } from '@/features/workspace/state/prepared-tree-input-cache'
import { treeCommandFocusCandidate } from '@/features/workspace/utils/tree-commands'
import { treeGitStatusPatch } from '@/features/workspace/utils/tree-git-status-patch'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { fileTreeIconsForPaths } from '@/lib/file-icons'
import { TreeRowMenu } from '@/features/workspace/components/row-menu'
import { renamePath } from '@/lib/file-server'
import { isDirectoryEntry } from '@/lib/file-system-types'
import type { LoadState } from '@/lib/load-state'
import { canonicalTreePath } from '@/lib/path-formatters'
import { fileSystemKeys } from '@/lib/query-keys'
import { queryHasNoData } from '@/lib/query-state'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { treePathForSelectedPath, type TreePathMove, type TreeModel } from '@/lib/tree-model'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import {
  useEffectEvent,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'

export const TreePane = memo(
  ({
    gitStatus,
    rootPath,
    state,
  }: {
    gitStatus?: readonly GitStatusEntry[]
    rootPath: FilesystemPath
    state: LoadState<TreeModel>
  }) => {
    if (state.status === 'loading') return <TreeLoading />
    // No retry: LoadState exposes no refetch; reloading the workspace is the way out.
    if (state.status === 'error') {
      return (
        <EmptyState
          description={state.message}
          icon={<WarningCircleIcon />}
          title='Unable to load files'
          tone='error'
        />
      )
    }
    if (state.status !== 'ready') return <EmptyState title='No files' />

    return <ReadyTreePane confirmed={state.data} gitStatus={gitStatus} rootPath={rootPath} />
  },
)

function ReadyTreePane({
  confirmed,
  gitStatus,
  rootPath,
}: {
  confirmed: TreeModel
  gitStatus?: readonly GitStatusEntry[]
  rootPath: FilesystemPath
}) {
  // Confirmed entries plus this root's pending intents: what the rows should show.
  const model = useProjectedTreeModel(confirmed, rootPath)
  const { editorTheme } = useEditorColorTheme()
  const rowHeight = useRowHeight()
  const selectedFilePath = useEditorWorkspaceState(
    (store) => tabFileResource(store.selectedTabContent)?.path ?? null,
  )
  const selectedDiskPath = selectedFilePath
  const selectedFileQueryKey = selectedDiskPath
    ? fileSystemKeys.fileSnapshot(selectedDiskPath)
    : disabledFileQueryKey
  const selectedFilePending =
    useIsFetching({
      exact: true,
      predicate: queryHasNoData,
      queryKey: selectedFileQueryKey,
    }) > 0
  const loadingTreePath =
    selectedFilePending && selectedDiskPath
      ? canonicalTreePath(treePathForSelectedPath(rootPath, selectedDiskPath))
      : null
  const { selectFile } = useEditorCommands()
  const {
    loadDirectory,
    publishToolbar,
    publishVisibleItemCount: publishVisibleItemCountAction,
  } = useFileTreeActions()
  const queryClient = useQueryClient()
  const workspaceEdits = useOptionalWorkspaceEditService()
  const expandedDirectoryPathsRef = useRef<ReadonlySet<string> | undefined>(undefined)
  const modelRef = useRef(model)
  const selectedFilePathRef = useRef(selectedFilePath)
  const selectFileRef = useRef(selectFile)
  const pathsRef = useRef(model.paths)
  const selectionSyncRef = useRef<SelectionSyncState>({
    rootPath: null,
    selectedFilePath: undefined,
  })
  const treeRef = useRef<FileTreeModel | null>(null)
  const [initialGitStatus] = useState(() => gitStatus ?? EMPTY_GIT_STATUS)
  const previousGitStatusRef = useRef(initialGitStatus)
  const [initialPreparedInput] = useState(() => preparedTreeInputForPaths(model.paths))
  const icons = useMemo(() => fileTreeIconsForPaths(model.paths), [model.paths])
  function moveDroppedPaths(moves: readonly TreePathMove[]) {
    void runTreeIntent({
      patch: { kind: 'move', rootPath, moves },
      queryClient,
      perform: () =>
        runTreeDropMoveMutation(
          { moves, rootPath },
          {
            model: modelRef.current,
            rename: (from, to) =>
              renamePath(
                filesystemPath(from),
                filesystemPath(to),
                clientForQueryClient(queryClient),
              ),
            runWorkspaceMutation: workspaceEdits
              ? (affectedPaths, operation) =>
                  workspaceEdits.runWorkspaceMutation(
                    affectedPaths === 'all' ? 'all' : affectedPaths.map(filesystemPath),
                    (report) =>
                      operation((paths) =>
                        report(paths === 'all' ? 'all' : paths.map(filesystemPath)),
                      ),
                  )
              : null,
          },
        ),
    })
  }
  const fsActions = useFsActions({ modelRef, rootPath, treeRef })
  const completeRenameRef = useRef(fsActions.completeRename)
  const createEntryRef = useRef(fsActions.actions.createEntry)
  const revealActiveFileRef = useRef<() => boolean>(() => false)
  const loadExpandedDirectoriesForCurrentModel = useEffectEvent((currentTree: FileTreeModel) => {
    expandedDirectoryPathsRef.current = loadExpandedDirectories(
      currentTree,
      model,
      loadDirectory,
      expandedDirectoryPathsRef.current,
    )
  })
  const publishVisibleTreeItemCount = useEffectEvent((currentTree: FileTreeModel) => {
    publishVisibleItemCountAction(visibleTreeItemCount(currentTree, modelRef.current))
  })
  const resumeDeferredCreate = useEffectEvent(() => fsActions.resumeDeferredCreate())

  const initialSelectedPaths = selectedFilePath
    ? [treePathForSelectedPath(rootPath, selectedFilePath)]
    : undefined
  const { model: tree } = useFileTree({
    density: 'compact',
    itemHeight: rowHeight,
    flattenEmptyDirectories: true,
    gitStatus: initialGitStatus,
    icons,
    initialExpansion: 'closed',
    initialSelectedPaths,
    preparedInput: initialPreparedInput,
    search: true,
    searchBlurBehavior: 'retain',
    searchPlaceholder: 'Filter files',
    stickyFolders: true,
    dragAndDrop: {
      canDrag: (paths) =>
        fsActions.actions.mutationsEnabled &&
        canDragTreePaths(modelRef.current, paths, hasPendingTreeMove(rootPath)),
      canDrop: (context) =>
        fsActions.actions.mutationsEnabled && canDropTreePaths(modelRef.current, context),
      onDropComplete: (event) => {
        if (!fsActions.actions.mutationsEnabled) return
        const moves = treePathMovesForDrop(event)
        if (moves.length === 0) return

        moveDroppedPaths(moves)
      },
      onDropError: (error) => {
        reportError(toClientError({ code: 'INVALID_PATH', error }))
      },
    },
    // Callbacks are constructor-owned, so read live app state from refs at call
    // time — the same pattern as the drag/drop and row-decoration callbacks.
    onSelectionChange: (selectedPaths) =>
      openSelectedTreeFile({
        model: modelRef.current,
        selectedFilePath: selectedFilePathRef.current,
        selectedPaths,
        selectFile: (path) => selectFileRef.current(path === null ? null : filesystemPath(path)),
      }),
    renaming: {
      onError: (error) => reportError(toClientError({ code: 'INVALID_PATH', error })),
      onRename: (event: FileTreeRenameEvent) => completeRenameRef.current(event),
    },
    renderRowDecoration: (context) => treeRowDecoration(modelRef.current, context),
    unsafeCSS: treeUnsafeCss,
  })

  useLayoutEffect(() => {
    tree.setLoadingPaths(loadingTreePath ? [loadingTreePath] : [])
  }, [loadingTreePath, tree])
  useFileTreeMutationEvents({ rootPath, tree })

  useFileTreeIntentPrefetch({
    model,
    rootPath,
    tree,
  })

  function focusTreeForCommand(revealActive: boolean) {
    const activeTreePath = selectedTreePath(rootPath, selectedFilePath)
    if (revealActive && !activeTreePath) return false
    if (revealActive) tree.closeSearch()

    const candidate = treeCommandFocusCandidate({
      activeTreePath,
      firstPath: model.paths[0] ?? null,
      focusedPath: tree.getFocusedPath(),
      selectedPaths: tree.getSelectedPaths(),
    })
    const focusedPath = tree.focusNearestPath(candidate)
    if (!focusedPath) return false

    tree.focus()
    return true
  }

  const { ref: treeFocusTargetRef } = useFocusTarget<HTMLDivElement>({
    area: 'file-tree',
    id: { kind: 'file-tree', rootPath },
    onIntent: (intent) => {
      if (intent === 'create-file' || intent === 'create-folder') {
        if (!fsActions.actions.mutationsEnabled) return false

        const path = tree.getFocusedPath() ?? tree.getSelectedPaths()[0] ?? ''
        const entry = model.entriesByTreePath.get(canonicalTreePath(path))
        const container = containerTreePath(path, entry ? isDirectoryEntry(entry) : false)
        tree.closeSearch()
        fsActions.actions.createEntry(container, intent === 'create-folder')
        return true
      }

      if (intent === 'open-search') {
        tree.openSearch()
        return true
      }

      return focusTreeForCommand(intent === 'reveal-active')
    },
  })

  // No dependency list: every value here is a fresh identity per render, and
  // the body only mirrors the latest render into refs that captured-once tree
  // callbacks read at call time.
  useLayoutEffect(() => {
    completeRenameRef.current = fsActions.completeRename
    createEntryRef.current = fsActions.actions.createEntry
    modelRef.current = model
    revealActiveFileRef.current = () => focusTreeForCommand(true)
    selectedFilePathRef.current = selectedFilePath
    selectFileRef.current = selectFile
    treeRef.current = tree
  })

  const mutationsEnabled = fsActions.actions.mutationsEnabled
  useLayoutEffect(() => {
    publishToolbar({
      createFile: () => createEntryRef.current('', false),
      createFolder: () => createEntryRef.current('', true),
      mutationsEnabled,
      revealActiveFile: () => revealActiveFileRef.current(),
    })

    return () => publishToolbar(null)
  }, [mutationsEnabled, publishToolbar])

  useEffect(() => {
    const selectionSync = selectionSyncPlan({
      rootPath,
      selectedFilePath,
      state: selectionSyncRef.current,
      tree,
    })
    pathsRef.current = syncTreePaneState({
      loadExpandedDirectoriesForCurrentModel,
      model,
      previousPaths: pathsRef.current,
      prepareInputForPaths: preparedTreeInputForPaths,
      rootPath,
      scrollBehavior: selectionSync.reason === 'root-changed' ? 'auto' : 'smooth',
      syncSelection: selectionSync.shouldSync,
      selectedFilePath,
      tree,
    })
    updateSelectionSyncState(selectionSyncRef.current, selectionSync, rootPath, selectedFilePath)
    publishVisibleTreeItemCount(tree)
    // Strictly after the path sync: a create deferred on a loading directory
    // must plant its placeholder into an already-settled tree.
    resumeDeferredCreate()
  }, [model, rootPath, selectedFilePath, tree])

  useEffect(() => {
    const nextGitStatus = gitStatus ?? EMPTY_GIT_STATUS
    const patch = treeGitStatusPatch(previousGitStatusRef.current, nextGitStatus)
    previousGitStatusRef.current = nextGitStatus
    if (!patch) return

    tree.applyGitStatusPatch(patch)
  }, [gitStatus, tree])

  useEffect(() => {
    return tree.subscribe(() => {
      loadExpandedDirectoriesForCurrentModel(tree)
      publishVisibleTreeItemCount(tree)
    })
  }, [tree])

  return (
    <div className='h-full' ref={treeFocusTargetRef}>
      <FileTree
        aria-label='Folder tree'
        className='block h-full'
        model={tree}
        renderContextMenu={(item, menuContext) => (
          <TreeRowMenu
            actions={fsActions.actions}
            item={item}
            menuContext={menuContext}
            model={model}
            rootPath={rootPath}
          />
        )}
        style={fileTreeStyle(editorTheme)}
      />
      {/* Owned here, not by the menu: the menu unmounts the instant it closes. */}
      <DeleteEntryDialog {...fsActions.deleteDialog} />
    </div>
  )
}

const EMPTY_GIT_STATUS: readonly GitStatusEntry[] = []

function openSelectedTreeFile({
  model,
  selectedFilePath,
  selectedPaths,
  selectFile,
}: {
  model: TreeModel
  selectedFilePath: string | null
  selectedPaths: readonly string[]
  selectFile: (path: string | null) => void
}) {
  const entry = selectedFileEntryForTreeSelection(model, selectedPaths)
  if (!entry) return
  if (entry.path === selectedFilePath) return

  selectFile(entry.path)
}

type SelectionSyncState = {
  rootPath: FilesystemPath | null
  selectedFilePath: string | null | undefined
}

type SelectionSyncPlan = {
  canComplete: boolean
  reason: 'already-synced' | 'pending-selected-file' | 'root-changed' | 'selected-file-changed'
  shouldSync: boolean
  treePath: string | null
}

function selectionSyncPlan({
  rootPath,
  selectedFilePath,
  state,
  tree,
}: {
  rootPath: FilesystemPath
  selectedFilePath: string | null
  state: SelectionSyncState
  tree: FileTreeModel
}): SelectionSyncPlan {
  const treePath = selectedTreePath(rootPath, selectedFilePath)
  const canComplete = selectedFilePathCanCompleteSync(tree, treePath, selectedFilePath)
  if (state.rootPath !== rootPath) {
    return { canComplete, reason: 'root-changed', shouldSync: true, treePath }
  }
  if (state.selectedFilePath !== selectedFilePath) {
    const reason = canComplete ? 'selected-file-changed' : 'pending-selected-file'
    return { canComplete, reason, shouldSync: true, treePath }
  }

  return { canComplete, reason: 'already-synced', shouldSync: false, treePath }
}

function selectedTreePath(rootPath: FilesystemPath, selectedFilePath: string | null) {
  if (!selectedFilePath) return null

  return canonicalTreePath(treePathForSelectedPath(rootPath, selectedFilePath))
}

function selectedFilePathCanCompleteSync(
  tree: FileTreeModel,
  treePath: string | null,
  selectedFilePath: string | null,
) {
  if (!selectedFilePath) return true
  if (!treePath) return true

  const item = tree.getItem(treePath)
  return item?.isDirectory() === false
}

function updateSelectionSyncState(
  state: SelectionSyncState,
  plan: SelectionSyncPlan,
  rootPath: FilesystemPath,
  selectedFilePath: string | null,
) {
  if (!plan.canComplete) return

  state.rootPath = rootPath
  state.selectedFilePath = selectedFilePath
}

function treeRowDecoration(model: TreeModel, context: FileTreeRowDecorationContext) {
  const treePath = canonicalTreePath(context.item.path)
  const error = model.errorByDirectoryPath.get(treePath)
  if (error) return { text: 'error', title: error }
  if (model.loadingDirectoryPaths.has(treePath)) return { text: 'loading' }

  return null
}

export type TreeDropMoveRequest = {
  moves: readonly TreePathMove[]
  rootPath: FilesystemPath
}

type ReportTreeDropAffectedPaths = (affectedPaths: readonly string[] | 'all') => void

type RunTreeDropWorkspaceMutation = (
  affectedPaths: readonly string[] | 'all',
  operation: (reportAffectedPaths?: ReportTreeDropAffectedPaths) => Promise<void>,
) => Promise<void>

export type TreeDropMoveMutationOptions = {
  model: TreeModel
  rename: (from: string, to: string) => Promise<unknown>
  runWorkspaceMutation: RunTreeDropWorkspaceMutation | null
}

export async function runTreeDropMoveMutation(
  request: TreeDropMoveRequest,
  options: TreeDropMoveMutationOptions,
) {
  const operation = (reportAffectedPaths?: ReportTreeDropAffectedPaths) =>
    moveDroppedTreePaths(request, options.model, options.rename, reportAffectedPaths)
  if (!options.runWorkspaceMutation) return operation()

  return options.runWorkspaceMutation(treeDropAffectedPaths(request, options.model), operation)
}

async function moveDroppedTreePaths(
  request: TreeDropMoveRequest,
  model: TreeModel,
  rename: TreeDropMoveMutationOptions['rename'],
  reportAffectedPaths?: ReportTreeDropAffectedPaths,
) {
  for (const move of request.moves) {
    const from = workspacePathForTreePath(request.rootPath, move.fromTreePath)
    const to = workspacePathForTreePath(request.rootPath, move.toTreePath)
    await rename(from, to)
    reportAffectedPaths?.([from, to])
    if (treeDropMoveIsDirectory(move, model)) reportAffectedPaths?.('all')
  }
}

function treeDropAffectedPaths(
  request: TreeDropMoveRequest,
  model: TreeModel,
): readonly string[] | 'all' {
  if (treeDropMovesDirectory(request.moves, model)) return 'all'

  return request.moves.flatMap((move) => [
    workspacePathForTreePath(request.rootPath, move.fromTreePath),
    workspacePathForTreePath(request.rootPath, move.toTreePath),
  ])
}

function treeDropMovesDirectory(moves: readonly TreePathMove[], model: TreeModel) {
  return moves.some((move) => treeDropMoveIsDirectory(move, model))
}

function treeDropMoveIsDirectory(move: TreePathMove, model: TreeModel) {
  const entry = model.entriesByTreePath.get(move.fromTreePath)
  return entry ? isDirectoryEntry(entry) : false
}

function canDragTreePaths(model: TreeModel, paths: readonly string[], movePending: boolean) {
  if (movePending) return false
  if (paths.length === 0) return false

  return paths.every((path) => model.entriesByTreePath.has(canonicalTreePath(path)))
}

function canDropTreePaths(model: TreeModel, context: FileTreeDropContext) {
  const moves = treePathMovesForDrop(context)
  if (moves.length === 0) return false
  if (hasDuplicateDestinations(moves)) return false

  return moves.every((move) => canDropTreePath(model, move))
}

function canDropTreePath(model: TreeModel, move: TreePathMove) {
  if (!model.entriesByTreePath.has(move.fromTreePath)) return false
  if (model.entriesByTreePath.has(move.toTreePath)) return false

  return !move.toTreePath.startsWith(`${move.fromTreePath}/`)
}

function hasDuplicateDestinations(moves: readonly TreePathMove[]) {
  const destinations = new Set<string>()

  for (const move of moves) {
    if (destinations.has(move.toTreePath)) return true

    destinations.add(move.toTreePath)
  }

  return false
}

function treePathMovesForDrop(context: FileTreeDropContext | FileTreeDropResult) {
  const targetTreePath = dropTargetTreePath(context)
  const moves: TreePathMove[] = []

  for (const draggedPath of context.draggedPaths) {
    const fromTreePath = canonicalTreePath(draggedPath)
    const toTreePath = dropDestinationTreePath(fromTreePath, targetTreePath)
    if (!fromTreePath) continue
    if (!toTreePath) continue
    if (fromTreePath === toTreePath) continue

    moves.push({ fromTreePath, toTreePath })
  }

  return moves
}

function dropTargetTreePath(context: FileTreeDropContext | FileTreeDropResult) {
  if (context.target.kind === 'root') return ''
  if (!context.target.directoryPath) return ''

  return canonicalTreePath(context.target.directoryPath)
}

function dropDestinationTreePath(fromTreePath: string, targetTreePath: string) {
  const basename = treePathBasename(fromTreePath)
  if (!basename) return ''
  if (!targetTreePath) return basename

  return `${targetTreePath}/${basename}`
}

function treePathBasename(treePath: string) {
  const segments = canonicalTreePath(treePath).split('/').filter(Boolean)

  return segments.at(-1) ?? ''
}

const treeStyle = {
  '--trees-bg-muted-override': 'var(--row-hover)',
  '--trees-bg-override': 'transparent',
  // The tree package's built-in accent (#009fff) and git palette are raw hexes that
  // bypass the theme; point every override at tokens so selection and git status
  // track light/dark and never go neon against the wallpaper.
  '--trees-accent-override': 'var(--ring)',
  '--trees-status-added-override': 'var(--success)',
  '--trees-status-untracked-override': 'var(--success)',
  '--trees-status-modified-override': 'var(--warning)',
  '--trees-status-renamed-override': 'var(--warning)',
  '--trees-status-deleted-override': 'var(--destructive)',
  '--trees-status-ignored-override': 'var(--muted-foreground)',
  '--trees-selected-bg-override': 'var(--row-selected)',
  '--trees-item-margin-x-override': '0px',
  '--trees-border-color-override': 'var(--border)',
  '--trees-indent-guide-bg-override': 'var(--border)',
  '--trees-fg-override': 'var(--foreground)',
  // The tree defines its own font variables inside the shadow root, so host
  // inheritance alone cannot reach the rows.
  '--trees-font-family-override': 'var(--workbench-tree-font-family)',
  '--trees-font-size-override': 'var(--workbench-tree-font-size)',
  '--trees-level-gap-override': 'var(--workbench-tree-level-gap)',
  height: '100%',
} as CSSProperties

function fileTreeStyle(
  editorTheme: Parameters<typeof fileTreeIndentGuideVariables>[0],
): CSSProperties {
  return {
    ...treeStyle,
    ...fileTreeIndentGuideVariables(editorTheme),
  } as CSSProperties
}

const treeUnsafeCss = `
  :host {
    color: var(--foreground);
    background: transparent;
    font-family: var(--workbench-tree-font-family);
    font-size: var(--workbench-tree-font-size);
  }

  button[data-type='item'] {
    border-radius: 0;
  }

  button[data-type='item'][data-item-selected='true']::after {
    content: '';
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 2px;
    background: var(--foreground);
    pointer-events: none;
  }

  /* The tree's own focus ring only while the tree actually has focus. The
   * package paints it for its remembered focus row even when the editor owns
   * the keyboard, which read as a second, stray selection. */
  :host(:not(:focus-within)) button[data-type='item'][data-item-focused='true']::before {
    outline-color: transparent;
  }

  [data-file-tree-search-container] {
    align-items: center;
    height: var(--bar-height);
    margin: 0;
    padding-inline: var(--bar-padding-x);
  }

  [data-file-tree-search-input] {
    height: var(--density-control-height-sm);
    line-height: normal;
    margin-block: 0;
    padding-inline: var(--density-control-padding-x);
    border-radius: var(--radius-md);
    border-color: var(--input);
    background-color: color-mix(in oklch, var(--input) 30%, transparent);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  :host(:hover) [data-item-section='spacing-item'] {
    border-left-color: var(--trees-indent-guide-current-bg);
  }

  [data-item-section='spacing-item'] {
    border-left-color: var(--border);
  }

  button[data-item-loading='true'] [data-item-section='content'] {
    background-image:
      linear-gradient(90deg, transparent 0%, var(--foreground) 50%, transparent 100%),
      linear-gradient(var(--muted-foreground), var(--muted-foreground));
    background-repeat: no-repeat;
    background-size: 45% 100%, auto;
    background-clip: text;
    color: transparent;
    animation: file-tree-loading-shimmer 2s linear infinite;
  }

  @keyframes file-tree-loading-shimmer {
    from { background-position: -100% 0, 0 0; }
    to { background-position: 250% 0, 0 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    button[data-item-loading='true'] [data-item-section='content'] {
      animation: none;
      background-image: none;
      color: var(--muted-foreground);
    }
  }
`
