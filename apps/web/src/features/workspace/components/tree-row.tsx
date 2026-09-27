/** @jsxImportSource react */

import {
  Fragment,
  type DragEvent as ReactDragEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react'

import { SparkleIcon } from '@phosphor-icons/react'
import { FileTypeIcon } from '@/components/file-type-icon'
import { iconForEntry } from '@/lib/file-icons'
import { TreeGlyphIcon } from '@/features/workspace/components/tree-glyph'
import { MiddleTruncate } from '@/features/workspace/components/tree-middle-truncate'
import { Truncate } from '@/features/workspace/components/tree-truncate'
import { RenameInput } from '@/features/workspace/components/tree-rename-input'
import { GIT_STATUS_DESCENDANT_TITLE, GIT_STATUS_LABEL, GIT_STATUS_TITLE } from '@workspace/tree'
import type { FileTreeController } from '@workspace/tree'
import type {
  FileTreeContextMenuButtonVisibility,
  FileTreeContextMenuOpenContext,
  FileTreeContextMenuTriggerMode,
  FileTreeRowDecoration,
  FileTreeRowDecorationAction,
  FileTreeVisibleRow,
} from '@workspace/tree'
import type { GitStatus } from '@workspace/tree'
import { createAnchorRectFromPoint } from '@/features/workspace/utils/tree-context-menu-anchor'
import { focusElement } from '@/features/workspace/utils/tree-focus'
import { computeTreeRowElementAttributes } from '@/features/workspace/utils/tree-row-attributes'
import type { TreeRowClickMode } from '@/features/workspace/utils/tree-row-click-plan'
import {
  getTreeFocusedRowDomId,
  getTreeRowAriaLabel,
  getTreeRowPath,
} from '@/features/workspace/utils/tree-row-identity'

function formatFlattenedSegments(
  row: FileTreeVisibleRow,
  renameInput: JSX.Element | null = null,
): JSX.Element | string {
  const segments = row.flattenedSegments
  if (segments == null || segments.length === 0) {
    return renameInput ?? row.name
  }

  return (
    <span data-item-flattened-subitems>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        return (
          <Fragment key={segment.path}>
            <span data-item-flattened-subitem={segment.path}>
              {isLast && renameInput != null ? (
                renameInput
              ) : (
                <Truncate variant='native'>{segment.name}</Truncate>
              )}
            </span>
            {index < segments.length - 1 ? ' / ' : ''}
          </Fragment>
        )
      })}
    </span>
  )
}

type TreeGitDecoration =
  | { readonly text: string; readonly title: string | undefined }
  | { readonly dot: true; readonly title: string }

// Built-in git decorations now live in their own fixed lane so custom row
// decorations can coexist without borrowing git styling or precedence.
function getBuiltInGitStatusDecoration(
  gitStatus: GitStatus | null,
  containsGitChange: boolean,
): TreeGitDecoration | null {
  if (gitStatus != null) {
    const label = GIT_STATUS_LABEL[gitStatus]
    if (label == null) {
      return null
    }

    return {
      text: label,
      title: GIT_STATUS_TITLE[gitStatus],
    }
  }

  if (containsGitChange) {
    return { dot: true, title: GIT_STATUS_DESCENDANT_TITLE }
  }

  return null
}

function getInheritedIgnoredGitStatus(
  ancestorPaths: readonly string[],
  ignoredDirectoryPaths: ReadonlySet<string> | undefined,
  ignoredInheritanceCache: Map<string, boolean>,
): GitStatus | null {
  if (ignoredDirectoryPaths == null || ignoredDirectoryPaths.size === 0) {
    return null
  }

  const visitedAncestors: string[] = []
  for (let index = ancestorPaths.length - 1; index >= 0; index -= 1) {
    const ancestorPath = ancestorPaths[index]
    const cached = ignoredInheritanceCache.get(ancestorPath)
    if (cached != null) {
      for (const visitedAncestor of visitedAncestors) {
        ignoredInheritanceCache.set(visitedAncestor, cached)
      }
      return cached ? 'ignored' : null
    }

    if (ignoredDirectoryPaths.has(ancestorPath)) {
      ignoredInheritanceCache.set(ancestorPath, true)
      for (const visitedAncestor of visitedAncestors) {
        ignoredInheritanceCache.set(visitedAncestor, true)
      }
      return 'ignored'
    }

    visitedAncestors.push(ancestorPath)
  }

  for (const visitedAncestor of visitedAncestors) {
    ignoredInheritanceCache.set(visitedAncestor, false)
  }

  return null
}

function renderRowDecoration(decoration: FileTreeRowDecoration | null): JSX.Element | null {
  if (decoration == null) {
    return null
  }

  return (
    <span title={decoration.title}>
      {decoration.text}
      {decoration.action ? <DecorationAction action={decoration.action} /> : null}
    </span>
  )
}

function renderGitDecoration(decoration: TreeGitDecoration | null): JSX.Element | null {
  if (decoration == null) {
    return null
  }

  return (
    <span title={decoration.title}>
      {'dot' in decoration ? <TreeGlyphIcon name='dot' /> : decoration.text}
    </span>
  )
}

// The row is itself a button, so the action is a span; it keeps its press from reaching the row.
function DecorationAction({ action }: { action: FileTreeRowDecorationAction }): JSX.Element {
  return (
    <span
      aria-label={action.label}
      data-item-decoration-action=''
      data-tooltip={action.label}
      role='button'
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        action.onActivate()
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <SparkleIcon aria-hidden='true' size={12} />
    </span>
  )
}

function renderTreeRowContent(
  row: FileTreeVisibleRow,
  {
    actionLaneEnabled = false,
    customDecoration = null,
    decorationLaneEnabled = false,
    gitDecoration = null,
    gitLaneActive = false,
    renameInput = null,
    showDecorativeActionAffordance = false,
  }: {
    actionLaneEnabled?: boolean
    customDecoration?: FileTreeRowDecoration | null
    decorationLaneEnabled?: boolean
    gitDecoration?: TreeGitDecoration | null
    gitLaneActive?: boolean
    renameInput?: JSX.Element | null
    showDecorativeActionAffordance?: boolean
  } = {},
): JSX.Element {
  return (
    <Fragment>
      {row.depth > 0 ? (
        <div data-item-section='spacing'>
          {Array.from({ length: row.depth }).map((_, index) => (
            <div
              key={index}
              data-item-section='spacing-item'
              data-ancestor-path={row.ancestorPaths[index]}
            />
          ))}
        </div>
      ) : null}
      <div data-item-section='icon'>
        {row.kind === 'directory' ? (
          <TreeGlyphIcon name='chevron' />
        ) : (
          <FileTypeIcon icon={iconForEntry({ name: row.name, type: 'file' })} sprite />
        )}
      </div>
      <div data-item-section='content'>
        {row.isFlattened
          ? formatFlattenedSegments(row, renameInput)
          : (renameInput ?? (
              <MiddleTruncate minimumLength={5} split='extension' variant='native'>
                {row.name}
              </MiddleTruncate>
            ))}
      </div>
      {decorationLaneEnabled ? (
        <div data-item-section='decoration'>{renderRowDecoration(customDecoration)}</div>
      ) : null}
      {gitLaneActive ? (
        <div data-item-section='git'>{renderGitDecoration(gitDecoration)}</div>
      ) : null}
      {actionLaneEnabled ? (
        <div data-item-section='action'>
          {showDecorativeActionAffordance ? (
            <span aria-hidden='true' data-item-action-affordance='decorative'>
              <TreeGlyphIcon name='ellipsis' />
            </span>
          ) : null}
        </div>
      ) : null}
    </Fragment>
  )
}

export type TreeRenderedRowMode = TreeRowClickMode

// A frame captures everything that is constant across all rows in a single
// render pass: the controller, feature flags, handlers, and ref registrars.
// Only the `row`, `key`, and per-row `options` vary between call sites. This
// keeps `renderStyledRow`'s signature readable and ensures the sticky and
// flow paths can share the same logical invariants by passing in a frame
// with a different `registerButton` target.
export interface TreeRenderRowFrame {
  readonly controller: FileTreeController
  readonly renameView: ReturnType<FileTreeController['getRenameView']>
  readonly visualFocusPath: string | null
  readonly contextMenuOpenPath: string | null
  readonly draggedPathSet: ReadonlySet<string> | null
  readonly dragAndDropEnabled: boolean
  readonly shouldSuppressContextMenu: () => boolean
  readonly handleRowDragStart: (
    event: ReactDragEvent<HTMLElement>,
    row: FileTreeVisibleRow,
    targetPath: string,
  ) => void
  readonly handleRowDragEnd: () => void
  readonly handleRowTouchStart: (
    event: ReactTouchEvent<HTMLElement>,
    row: FileTreeVisibleRow,
    targetPath: string,
  ) => void
  readonly markPointerFocusPath: (path: string) => void
  readonly instanceId: string | undefined
  readonly itemHeight: number
  readonly loadingPaths: ReadonlySet<string> | undefined
  readonly gitStatusByPath: ReadonlyMap<string, GitStatus> | undefined
  readonly ignoredGitDirectories: ReadonlySet<string> | undefined
  readonly ignoredInheritanceCache: Map<string, boolean>
  readonly directoriesWithGitChanges: ReadonlySet<string> | undefined
  readonly gitLaneActive: boolean
  readonly contextMenuEnabled: boolean
  readonly contextMenuTriggerMode: FileTreeContextMenuTriggerMode
  readonly contextMenuButtonTriggerEnabled: boolean
  readonly contextMenuButtonVisibility: FileTreeContextMenuButtonVisibility
  readonly contextMenuRightClickEnabled: boolean
  readonly registerRenameInput: (element: HTMLInputElement | null) => void
  readonly registerButton: (path: string, element: HTMLElement | null) => void
  readonly renderDecorationForRow: (
    row: FileTreeVisibleRow,
    targetPath: string,
  ) => FileTreeRowDecoration | null
  readonly openContextMenuForRow: (
    row: FileTreeVisibleRow,
    targetPath: string,
    options?: {
      anchorRect?: FileTreeContextMenuOpenContext['anchorRect']
      source?: 'button' | 'keyboard' | 'right-click'
    },
  ) => void
  readonly onRowClick: (
    event: ReactMouseEvent<HTMLElement>,
    row: FileTreeVisibleRow,
    targetPath: string,
    mode: TreeRenderedRowMode,
  ) => void
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

interface TreeRenderRowOptions {
  readonly isParked?: boolean
  readonly mode?: TreeRenderedRowMode
  readonly style?: Record<string, string | undefined>
}

// Render the same row contract in the flow list and sticky overlay so pointer
// behavior, row metadata, and lane structure stay in sync.
interface TreeRowProps {
  readonly frame: TreeRenderRowFrame
  readonly options?: TreeRenderRowOptions
  readonly row: FileTreeVisibleRow
}

export function TreeRow({ frame, options = {}, row }: TreeRowProps): JSX.Element {
  const {
    controller,
    renameView,
    visualFocusPath,
    contextMenuOpenPath,
    draggedPathSet,
    dragAndDropEnabled,
    shouldSuppressContextMenu,
    handleRowDragStart,
    handleRowDragEnd,
    handleRowTouchStart,
    markPointerFocusPath,
    instanceId,
    itemHeight,
    loadingPaths,
    gitStatusByPath,
    ignoredGitDirectories,
    ignoredInheritanceCache,
    directoriesWithGitChanges,
    gitLaneActive,
    contextMenuEnabled,
    contextMenuTriggerMode,
    contextMenuButtonTriggerEnabled,
    contextMenuButtonVisibility,
    contextMenuRightClickEnabled,
    registerRenameInput,
    registerButton,
    renderDecorationForRow,
    openContextMenuForRow,
    onRowClick,
    onKeyDown,
  } = frame
  const targetPath = getTreeRowPath(row)
  const { isParked = false, mode = 'flow', style } = options
  const isSticky = mode === 'sticky'
  const ownGitStatus = gitStatusByPath?.get(targetPath) ?? null
  const effectiveGitStatus =
    ownGitStatus ??
    getInheritedIgnoredGitStatus(row.ancestorPaths, ignoredGitDirectories, ignoredInheritanceCache)
  const containsGitChange =
    row.kind === 'directory' && (directoriesWithGitChanges?.has(targetPath) ?? false)
  const customDecoration = renderDecorationForRow(row, targetPath)
  const gitDecoration = getBuiltInGitStatusDecoration(effectiveGitStatus, containsGitChange)
  const actionLaneEnabled = contextMenuEnabled && contextMenuButtonTriggerEnabled
  const decorationLaneEnabled = customDecoration != null || gitLaneActive || actionLaneEnabled
  const showDecorativeActionAffordance =
    actionLaneEnabled && contextMenuButtonVisibility === 'always'
  const renamingPath = renameView.getPath()
  const isRenamingRow = renamingPath === targetPath
  const renamingValue = isRenamingRow ? renameView.getValue() : ''
  const renameInput =
    isSticky || !isRenamingRow ? null : (
      <RenameInput
        ref={registerRenameInput}
        ariaLabel={`Rename ${getTreeRowAriaLabel(row)}`}
        isFlattened={row.isFlattened}
        value={renamingValue}
        onBlur={() => {
          renameView.commit()
        }}
        onInput={(event) => {
          renameView.setValue(event.currentTarget.value)
        }}
      />
    )
  const rowContent = renderTreeRowContent(row, {
    actionLaneEnabled,
    customDecoration,
    decorationLaneEnabled,
    gitDecoration,
    gitLaneActive,
    renameInput,
    showDecorativeActionAffordance,
  })
  const attributeProps = computeTreeRowElementAttributes({
    ariaLabel: getTreeRowAriaLabel(row),
    domId: row.isFocused ? getTreeFocusedRowDomId(instanceId, targetPath, isParked) : undefined,
    extraStyle: style,
    features: {
      actionLaneEnabled,
      contextMenuButtonVisibility: actionLaneEnabled ? contextMenuButtonVisibility : null,
      contextMenuEnabled,
      contextMenuTriggerMode: contextMenuEnabled ? contextMenuTriggerMode : null,
      gitLaneActive,
    },
    isParked,
    itemHeight,
    mode,
    row,
    state: {
      containsGitChange,
      effectiveGitStatus,
      isContextHovered: contextMenuOpenPath === targetPath,
      isDragging: draggedPathSet?.has(targetPath) === true,
      isFocusRinged: row.isFocused && visualFocusPath === targetPath,
      isLoading: loadingPaths?.has(targetPath) === true,
    },
    targetPath,
  })
  const commonProps = {
    ...attributeProps,
    onContextMenu:
      contextMenuEnabled || dragAndDropEnabled
        ? (event: ReactMouseEvent<HTMLElement>) => {
            if (shouldSuppressContextMenu()) {
              event.preventDefault()
              return
            }

            if (!contextMenuEnabled) {
              return
            }

            event.preventDefault()
            if (!contextMenuRightClickEnabled) {
              return
            }
            controller.focusMountedPathFromInput(targetPath)
            openContextMenuForRow(row, targetPath, {
              anchorRect: createAnchorRectFromPoint(event.clientX, event.clientY),
              source: 'right-click',
            })
          }
        : undefined,
    onFocus: !isSticky
      ? () => {
          controller.focusMountedPathFromInput(targetPath)
        }
      : undefined,
    onKeyDown: !isSticky ? onKeyDown : undefined,
    ref: (element: HTMLElement | null) => {
      registerButton(targetPath, element)
    },
  } as const
  const rendersAsStaticContainer = !isSticky && isRenamingRow

  if (rendersAsStaticContainer) {
    return <div {...commonProps}>{rowContent}</div>
  }

  return (
    <button
      {...commonProps}
      type='button'
      draggable={dragAndDropEnabled && !isParked}
      onDragEnd={dragAndDropEnabled && !isParked ? handleRowDragEnd : undefined}
      onDragStart={
        dragAndDropEnabled && !isParked
          ? (event) => {
              handleRowDragStart(event, row, targetPath)
            }
          : undefined
      }
      onMouseDown={(event) => {
        if (isSticky) {
          event.preventDefault()
          return
        }

        if (controller.isSearchOpen()) {
          event.preventDefault()
          return
        }

        markPointerFocusPath(targetPath)
        focusElement(event.currentTarget instanceof HTMLElement ? event.currentTarget : null)
      }}
      onTouchStart={
        dragAndDropEnabled && !isParked
          ? (event) => {
              handleRowTouchStart(event, row, targetPath)
            }
          : undefined
      }
      onClick={(event) => {
        onRowClick(event, row, targetPath, mode)
      }}
    >
      {rowContent}
    </button>
  )
}
