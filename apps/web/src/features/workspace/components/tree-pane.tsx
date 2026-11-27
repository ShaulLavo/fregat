import '@/features/workspace/components/tree-pane.css'

import { WarningCircleIcon } from '@phosphor-icons/react'
import { ancestorsOf, FileTreeModel } from '@shaulavo/workbench-tree'
import { FileTreeView, type FileTreeViewHandle } from '@shaulavo/workbench-tree/react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { useRowHeight } from '@workspace/ui/patterns/use-row-height'
import {
  memo,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import {
  selectedTabContentForRoot,
  useEditorWorkspaceState,
} from '@/features/editor/state/workspace-state'
import type { TreeGitStatusEntry } from '@/features/git/utils/status-entries-for-tree'
import { DeleteEntryDialog } from '@/features/workspace/components/delete-entry-dialog'
import { TreeRowMenu } from '@/features/workspace/components/row-menu'
import { TreeLoading } from '@/features/workspace/components/tree-loading'
import { useFileOperationHistory } from '@/features/workspace/hooks/use-file-operation-history'
import { useFileTreeActions } from '@/features/workspace/hooks/use-file-tree-actions'
import { useFileTreeIntentPrefetch } from '@/features/workspace/hooks/use-file-tree-intent-prefetch'
import { useFsActions } from '@/features/workspace/hooks/use-fs-actions'
import { useProjectedTreeModel } from '@/features/workspace/hooks/use-projected-tree-model'
import type { TreeContextMenuItem } from '@/features/workspace/hooks/use-row-menu'
import { preparedTreeInputForPaths } from '@/features/workspace/state/prepared-tree-input-cache'
import { hasPendingTreeMove } from '@/features/workspace/state/tree-intents'
import { captureTree, savedTree } from '@/features/workspace/state/tree-reload'
import { TreeRowElements } from '@/features/workspace/state/tree-row-elements'
import { containerTreePath, entryName } from '@/features/workspace/utils/entry-paths'
import { fileTreeGitState } from '@/features/workspace/utils/git-state-for-tree'
import { fileTreeIndentGuideVariables } from '@/features/workspace/utils/indent-guide-style'
import { disabledFileQueryKey } from '@/features/workspace/utils/query-keys'
import { treeCommandFocusCandidate } from '@/features/workspace/utils/tree-commands'
import {
  treeRowDecoration,
  type TreeRowDecoration,
} from '@/features/workspace/utils/tree-decoration'
import {
  loadExpandedDirectories,
  syncTreePaneState,
  visibleTreeItemCount,
} from '@/features/workspace/utils/tree-pane-state'
import { useWatchCoverage } from '@/hooks/use-watch-coverage'
import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { fixWithAgent } from '@/lib/fix-with-agent'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'
import type { LoadState } from '@/lib/load-state'
import { canonicalTreePath } from '@/lib/path-formatters'
import { fileSystemKeys } from '@/lib/query-keys'
import { queryHasNoData } from '@/lib/query-state'
import { treePathForSelectedPath, type TreeModel, type TreePathMove } from '@/lib/tree-model'

const EMPTY_GIT_STATUS: readonly TreeGitStatusEntry[] = []
const EMPTY_LOADING_PATHS: ReadonlySet<string> = new Set()

export const TreePane = memo(
  ({
    gitStatus,
    rootPath,
    state,
  }: {
    gitStatus?: readonly TreeGitStatusEntry[]
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
  gitStatus?: readonly TreeGitStatusEntry[]
  rootPath: FilesystemPath
}) {
  // Confirmed entries plus this root's pending intents: what the rows should show.
  const model = useProjectedTreeModel(confirmed, rootPath)
  const { editorTheme } = useEditorColorTheme()
  const rowHeight = useRowHeight()
  const selectedFilePath = useEditorWorkspaceState(
    (store) => tabFileResource(selectedTabContentForRoot(store, rootPath))?.path ?? null,
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
  const activeTreePath = selectedTreePath(rootPath, selectedFilePath)
  const { selectFile } = useEditorCommands()
  const {
    loadDirectory,
    publishToolbar,
    publishVisibleItemCount: publishVisibleItemCountAction,
  } = useFileTreeActions()
  const queryClient = useQueryClient()
  const worktree = useEditorWorkspaceState((store) => store.worktreeIdByRootPath[rootPath] ?? null)
  const [restored] = useState(() => {
    const observation = savedTree(queryClient, rootPath, worktree)
    return observation?.record.activeFile === selectedFilePath ? observation : null
  })
  const scrollTopRef = useRef(restored?.record.scrollTop ?? 0)
  useFileOperationHistory(rootPath)
  const expandedDirectoryPathsRef = useRef<ReadonlySet<string> | undefined>(undefined)
  const modelRef = useRef(model)
  const confirmedRef = useRef(confirmed)
  const selectedFilePathRef = useRef(selectedFilePath)
  const selectFileRef = useRef(selectFile)
  const pathsRef = useRef(model.paths)
  const selectionSyncRef = useRef<SelectionSyncState>({
    rootPath: restored ? rootPath : null,
    selectedFilePath: restored ? selectedFilePath : undefined,
  })
  const treeHandleRef = useRef<FileTreeViewHandle | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const observedGit = useRef(savedTree(queryClient, rootPath, worktree)?.record.git)
  const [initialGitStatus] = useState(
    () =>
      gitStatus ??
      savedTree(queryClient, rootPath, worktree)?.record.git?.entries ??
      EMPTY_GIT_STATUS,
  )
  useLayoutEffect(() => {
    if (gitStatus) observedGit.current = { entries: [...gitStatus], observedAt: Date.now() }
  }, [gitStatus])
  const [rowElements] = useState(() => new TreeRowElements())
  const [tree] = useState(() => {
    const initialPreparedInput = preparedTreeInputForPaths(model.paths)
    const initialExpanded = restored?.record.expanded.map(canonicalTreePath).filter(Boolean)
    const instance = new FileTreeModel({
      compactFolders: true,
      initialExpanded,
      preparedInput: initialPreparedInput,
    })
    const initialSelected = restored?.record.selected ?? (activeTreePath ? [activeTreePath] : [])
    const normalizedSelected = initialSelected.map(canonicalTreePath).filter(Boolean)
    if (normalizedSelected.length > 0) {
      instance.setSelectedPaths(normalizedSelected)
    }
    if (initialGitStatus.length > 0) {
      instance.setGitState(fileTreeGitState(initialGitStatus))
    }
    return instance
  })
  const treeRef = useRef<FileTreeModel | null>(tree)
  const fsActions = useFsActions({ modelRef, rootPath, treeHandleRef, treeRef })
  const actionsRef = useRef(fsActions.actions)
  const createEntryRef = useRef(fsActions.actions.createEntry)
  const revealActiveFileRef = useRef<() => boolean>(() => false)
  const limited = useWatchCoverage(rootPath)?.mode === 'limited'
  const contextMenu = useContextMenu()
  const [menuTarget, setMenuTarget] = useState<TreeContextMenuItem | null>(null)

  const loadExpandedDirectoriesForCurrentModel = useEffectEvent((currentTree: FileTreeModel) => {
    expandedDirectoryPathsRef.current = loadExpandedDirectories(
      currentTree,
      model,
      loadDirectory,
      expandedDirectoryPathsRef.current,
      limited,
    )
  })
  const publishVisibleTreeItemCount = useEffectEvent((currentTree: FileTreeModel) => {
    publishVisibleItemCountAction(visibleTreeItemCount(currentTree))
  })
  const resumeDeferredCreate = useEffectEvent(() => fsActions.resumeDeferredCreate())

  useFileTreeIntentPrefetch({
    model,
    rootPath,
    rowElements,
    tree,
  })

  function focusTreeForCommand(revealActive: boolean) {
    const active = selectedTreePath(rootPath, selectedFilePath)
    if (revealActive && !active) return false
    if (revealActive) treeHandleRef.current?.clearFilter()

    const firstCanonical = model.paths[0] ? canonicalTreePath(model.paths[0]) : null
    const candidate = treeCommandFocusCandidate({
      activeTreePath: active,
      firstPath: firstCanonical,
      focusedPath: tree.getSnapshot().focusedPath ?? null,
      selectedPaths: tree.getSelectedPaths(),
    })
    const target = nearestExistingTreePath(tree, candidate)
    if (!target) return false

    tree.expandAllAncestors(target)
    if (!treeHandleRef.current?.focusPath(target, { behavior: 'auto' })) {
      tree.setFocusedPath(target)
      treeHandleRef.current?.focus()
    }
    return true
  }

  const { ref: treeFocusTargetRef } = useFocusTarget<HTMLDivElement>({
    area: 'file-tree',
    id: { kind: 'file-tree', rootPath },
    onIntent: (intent) => {
      if (intent === 'create-file' || intent === 'create-folder') {
        if (!actionsRef.current.mutationsEnabled) return false

        const path = tree.getSnapshot().focusedPath ?? tree.getSelectedPaths()[0] ?? ''
        const entry = model.entriesByTreePath.get(canonicalTreePath(path))
        const container = containerTreePath(path, entry ? isDirectoryEntry(entry) : false)
        treeHandleRef.current?.clearFilter()
        fsActions.actions.createEntry(container, intent === 'create-folder')
        return true
      }

      if (intent === 'open-search') {
        treeHandleRef.current?.openFilter()
        return true
      }

      return focusTreeForCommand(intent === 'reveal-active')
    },
  })

  // No dependency list: every value here is a fresh identity per render, and
  // the body only mirrors the latest render into refs read by imperative callbacks.
  useLayoutEffect(() => {
    actionsRef.current = fsActions.actions
    createEntryRef.current = fsActions.actions.createEntry
    modelRef.current = model
    confirmedRef.current = confirmed
    revealActiveFileRef.current = () => focusTreeForCommand(true)
    selectedFilePathRef.current = selectedFilePath
    selectFileRef.current = selectFile
    treeRef.current = tree
  })

  useEffect(() => {
    const capture = () => {
      const live = queryClient.getQueryData<TreeModel>(fileSystemKeys.tree(rootPath))
      const saved = savedTree(queryClient, rootPath, worktree)
      // Root navigation can evict the query before the held tree unmounts.
      const displayed = live ?? confirmedRef.current
      const expanded = tree.getExpandedPaths().map((path) => `${canonicalTreePath(path)}/`)
      captureTree(
        queryClient,
        displayed,
        {
          root: rootPath,
          worktree,
          activeFile: selectedFilePathRef.current,
          git: observedGit.current,
          expanded,
          selected: tree.getSelectedPaths(),
          scrollTop: scrollTopRef.current,
        },
        live ? Date.now() : saved?.record.observedAt,
      )
    }
    const removeFlush = addLifecycleFlush(capture)
    return () => {
      capture()
      removeFlush()
    }
  }, [queryClient, rootPath, tree, worktree])

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
    const behavior = selectionSync.reason === 'root-changed' ? 'auto' : 'smooth'
    pathsRef.current = syncTreePaneState({
      loadExpandedDirectoriesForCurrentModel,
      model,
      onRevealPath: (path) => {
        treeHandleRef.current?.scrollToPath(path, { align: 'auto', behavior })
      },
      previousPaths: pathsRef.current,
      prepareInputForPaths: preparedTreeInputForPaths,
      rootPath,
      selectedFilePath,
      syncSelection: selectionSync.shouldSync,
      tree,
    })
    updateSelectionSyncState(selectionSyncRef.current, selectionSync, rootPath, selectedFilePath)
    publishVisibleTreeItemCount(tree)
    // Strictly after the path sync: a create deferred on a loading directory
    // must plant its placeholder into an already-settled tree.
    resumeDeferredCreate()
  }, [model, rootPath, selectedFilePath, tree])

  useEffect(() => {
    tree.setGitState(fileTreeGitState(gitStatus ?? initialGitStatus))
  }, [gitStatus, initialGitStatus, tree])

  useEffect(() => {
    return tree.subscribe(() => {
      loadExpandedDirectoriesForCurrentModel(tree)
      publishVisibleTreeItemCount(tree)
    })
  }, [tree])

  const menuPath = menuTarget?.path ?? null
  const closeMenuIfGone = useEffectEvent(() => {
    if (menuPath === null || tree.index.hasPath(menuPath)) return
    contextMenu.onOpenChange(false)
    setMenuTarget(null)
  })
  useEffect(() => {
    if (menuPath === null) return
    return tree.subscribe(closeMenuIfGone)
  }, [menuPath, tree])

  function handleMenuOpenChange(open: boolean) {
    contextMenu.onOpenChange(open)
    if (!open) setMenuTarget(null)
  }

  function returnMenuFocusTo(): HTMLElement | null {
    if (menuTarget) {
      const targetElement = rowElements.element(menuTarget.path)
      if (targetElement) return targetElement
    }
    const focused = tree.getSnapshot().focusedPath
    if (focused) {
      const focusedElement = rowElements.element(focused)
      if (focusedElement) return focusedElement
    }
    return hostRef.current
  }

  const loadingPaths = loadingTreePath ? new Set([loadingTreePath]) : EMPTY_LOADING_PATHS

  return (
    <div
      className='h-full'
      data-file-tree=''
      ref={(node) => {
        hostRef.current = node
        treeFocusTargetRef(node)
      }}
    >
      <FileTreeView
        activePath={activeTreePath}
        canDrag={(paths) =>
          actionsRef.current.mutationsEnabled &&
          canDragTreePaths(modelRef.current, paths, hasPendingTreeMove(rootPath))
        }
        canDrop={(sources, destinationDir) =>
          actionsRef.current.mutationsEnabled &&
          canDropTreePaths(modelRef.current, sources, destinationDir)
        }
        className='h-full'
        filterPlaceholder='Filter files'
        handleRef={treeHandleRef}
        iconPreset='rich'
        initialScrollTop={restored?.record.scrollTop}
        label='Folder tree'
        loadingPaths={loadingPaths}
        model={tree}
        onCreate={(parent, kind, name) => fsActions.commitCreate(parent, kind, name)}
        onError={(_message, error) => reportError(toClientError({ code: 'INVALID_PATH', error }))}
        onMove={(moves) => {
          if (!actionsRef.current.mutationsEnabled) return
          const normalized = moves.map((move) => ({
            fromTreePath: canonicalTreePath(move.from),
            toTreePath: canonicalTreePath(move.to),
          }))
          if (normalized.length > 0) actionsRef.current.moveEntries(normalized)
        }}
        onOpenFile={(path) => {
          const entry = modelRef.current.entriesByTreePath.get(canonicalTreePath(path))
          if (!entry || isDirectoryEntry(entry)) return
          if (entry.path === selectedFilePathRef.current) return
          selectFileRef.current(entry.path)
        }}
        onRename={(fromPath, toPath) => fsActions.commitRename(fromPath, toPath)}
        onRequestContextMenu={(row, anchor) => {
          if (!row) return
          const item: TreeContextMenuItem = { kind: row.kind, path: row.path }
          setMenuTarget(item)
          if (anchor instanceof HTMLElement) {
            contextMenu.openAtElement(anchor)
            return
          }
          contextMenu.openAtEvent(
            { clientX: anchor.x, clientY: anchor.y, preventDefault: () => {} },
            rowElements.element(row.path) ?? hostRef.current ?? undefined,
          )
        }}
        onRequestDelete={(paths) => {
          const first = paths[0]
          if (!first) return
          const canonical = canonicalTreePath(first)
          const entry = modelRef.current.entriesByTreePath.get(canonical)
          if (!entry) return
          fsActions.actions.requestDelete({
            isDirectory: isDirectoryEntry(entry),
            name: entryName(canonical),
            path: entry.path,
          })
        }}
        onRowElementChange={(path, element) => rowElements.register(path, element)}
        onScrollTopChange={(top) => {
          scrollTopRef.current = top
        }}
        readOnly={!mutationsEnabled}
        renderRowDecoration={(row) =>
          renderRowDecorationNode(
            treeRowDecoration(model, row.path, (error) => void fixWithAgent(error)),
          )
        }
        rowHeight={rowHeight}
        showFilter
        style={fileTreeStyle(editorTheme)}
      />
      {contextMenu.anchor !== null && menuTarget !== null ? (
        <TreeRowMenu
          actions={fsActions.actions}
          item={menuTarget}
          menu={{
            anchor: contextMenu.anchor,
            onOpenChange: handleMenuOpenChange,
            returnFocusTo: returnMenuFocusTo,
          }}
          model={model}
          rootPath={rootPath}
        />
      ) : null}
      {/* Owned here, not by the menu: the menu unmounts the instant it closes. */}
      <DeleteEntryDialog {...fsActions.deleteDialog} />
    </div>
  )
}

function renderRowDecorationNode(decoration: TreeRowDecoration | null): ReactNode {
  if (!decoration) return null
  return (
    <span className='wb-tree-decoration-group'>
      <span title={decoration.title}>{decoration.text}</span>
      {decoration.action ? (
        <Button
          className='h-auto px-1.5 py-0 text-xs'
          onClick={(event) => {
            event.stopPropagation()
            decoration.action?.onActivate()
          }}
          size='xs'
          type='button'
          variant='outline'
        >
          {decoration.action.label}
        </Button>
      ) : null}
    </span>
  )
}

function nearestExistingTreePath(tree: FileTreeModel, candidate: string | null): string | null {
  if (!candidate) return null
  const canonical = canonicalTreePath(candidate)
  if (!canonical) return null
  if (tree.index.hasPath(canonical)) return canonical

  for (const ancestor of ancestorsOf(canonical).toReversed()) {
    if (tree.index.hasPath(ancestor)) return ancestor
  }
  return null
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

  return tree.index.getKind(treePath) === 'file'
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

function canDragTreePaths(model: TreeModel, paths: readonly string[], movePending: boolean) {
  if (movePending) return false
  if (paths.length === 0) return false

  return paths.every((path) => model.entriesByTreePath.has(canonicalTreePath(path)))
}

function canDropTreePaths(model: TreeModel, sources: readonly string[], destinationDir: string) {
  const targetTreePath = canonicalTreePath(destinationDir)
  const moves: TreePathMove[] = []

  for (const source of sources) {
    const fromTreePath = canonicalTreePath(source)
    const toTreePath = dropDestinationTreePath(fromTreePath, targetTreePath)
    if (!fromTreePath || !toTreePath || fromTreePath === toTreePath) continue
    moves.push({ fromTreePath, toTreePath })
  }

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

function dropDestinationTreePath(fromTreePath: string, targetTreePath: string) {
  const basename = entryName(fromTreePath)
  if (!basename) return ''
  if (!targetTreePath) return basename

  return `${targetTreePath}/${basename}`
}

const treeStyle = {
  '--wb-bg': 'transparent',
  '--wb-border': 'var(--border)',
  '--wb-fg': 'var(--foreground)',
  '--wb-fg-muted': 'var(--muted-foreground)',
  '--wb-focus-ring': 'var(--ring)',
  '--wb-git-added': 'var(--success)',
  '--wb-git-deleted': 'var(--destructive)',
  '--wb-git-ignored': 'var(--muted-foreground)',
  '--wb-git-modified': 'var(--warning)',
  '--wb-git-renamed': 'var(--warning)',
  '--wb-git-untracked': 'var(--success)',
  '--wb-row-active-bg': 'var(--row-selected)',
  '--wb-row-hover-bg': 'var(--row-hover)',
  '--wb-row-selected-bg': 'var(--row-selected)',
  '--wb-tree-font-family': 'var(--workbench-tree-font-family)',
  '--wb-tree-font-size': 'var(--workbench-tree-font-size)',
  '--wb-tree-indent': 'var(--workbench-tree-level-gap)',
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
