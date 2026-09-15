import { FileTypeIcon } from '@/components/file-type-icon'
import { CaretRightIcon, FolderIcon, FolderOpenIcon } from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'
import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { iconForEntry } from '@/lib/file-icons'

import {
  buildChatTurnDiffTree,
  hasNonZeroChatTurnDiffStat,
  type ChatTurnDiffTreeNode,
} from '@/features/chat/utils/turn-diff-tree'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { ChatDiffStatLabel } from './chat-diff-stat-label'

const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {}

type DirectoryExpansionState = {
  key: string
  overrides: Record<string, boolean>
}

type RenderTreeNodeOptions = {
  allDirectoriesExpanded: boolean
  depth: number
  expandedDirectories: Record<string, boolean>
  node: ChatTurnDiffTreeNode
  onOpenFileDiff?: (path: string) => void
  toggleDirectory: (pathValue: string) => void
}

export function AssistantChangedFilesTree({
  allDirectoriesExpanded,
  files,
  onOpenFileDiff,
}: {
  allDirectoriesExpanded: boolean
  files: ChatTurnDiffSummary['files']
  onOpenFileDiff?: (path: string) => void
}) {
  const treeNodes = useMemo(() => buildChatTurnDiffTree(files), [files])
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join('\u0000'),
    [treeNodes],
  )
  const expansionStateKey = `${allDirectoriesExpanded ? 'expanded' : 'collapsed'}\u0000${directoryPathsKey}`
  const [directoryExpansionState, setDirectoryExpansionState] = useState<DirectoryExpansionState>(
    () => ({
      key: expansionStateKey,
      overrides: {},
    }),
  )
  const expandedDirectories =
    directoryExpansionState.key === expansionStateKey
      ? directoryExpansionState.overrides
      : EMPTY_DIRECTORY_OVERRIDES

  const toggleDirectory = useCallback(
    (pathValue: string) => {
      setDirectoryExpansionState((current) => {
        const overrides = current.key === expansionStateKey ? current.overrides : {}

        return {
          key: expansionStateKey,
          overrides: {
            ...overrides,
            [pathValue]: !(overrides[pathValue] ?? allDirectoriesExpanded),
          },
        }
      })
    },
    [allDirectoriesExpanded, expansionStateKey],
  )

  return (
    <div className='space-y-0.5'>
      {treeNodes.map((node) =>
        renderChatTurnDiffTreeNode({
          allDirectoriesExpanded,
          depth: 0,
          expandedDirectories,
          node,
          onOpenFileDiff,
          toggleDirectory,
        }),
      )}
    </div>
  )
}

function renderChatTurnDiffTreeNode(options: RenderTreeNodeOptions): ReactNode {
  const { node } = options
  if (node.kind === 'directory') {
    return renderDirectoryNode(options)
  }

  return renderFileNode(options)
}

function renderDirectoryNode({
  allDirectoriesExpanded,
  depth,
  expandedDirectories,
  node,
  onOpenFileDiff,
  toggleDirectory,
}: RenderTreeNodeOptions): ReactNode {
  if (node.kind !== 'directory') return null

  const isExpanded = expandedDirectories[node.path] ?? allDirectoriesExpanded

  return (
    <div key={`dir:${node.path}`}>
      {/* Raw button: a row owns the list hover fill, and Button's ghost variant
          re-declares it in dark mode at a specificity this cannot override. */}
      <button
        className='group hover:bg-row-hover flex w-full items-center gap-1.5 py-1 pr-2 text-left'
        data-scroll-anchor-ignore
        style={treeNodeStyle(depth)}
        title={node.path}
        type='button'
        onClick={() => toggleDirectory(node.path)}
      >
        <CaretRightIcon
          aria-hidden='true'
          className={cn(
            'text-muted-foreground/70 size-3.5 shrink-0 transition-transform group-hover:text-foreground/80',
            isExpanded && 'rotate-90',
          )}
        />
        {isExpanded ? (
          <FolderOpenIcon className='text-muted-foreground/75 size-3.5 shrink-0' />
        ) : (
          <FolderIcon className='text-muted-foreground/75 size-3.5 shrink-0' />
        )}
        <span className='text-muted-foreground/90 group-hover:text-foreground/90 text-2xs truncate font-mono'>
          {node.name}
        </span>
        {hasNonZeroChatTurnDiffStat(node.stat) ? (
          <span className='text-3xs ml-auto shrink-0 font-mono tabular-nums'>
            <ChatDiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        ) : null}
      </button>
      {isExpanded ? (
        <div className='space-y-0.5'>
          {node.children.map((childNode) =>
            renderChatTurnDiffTreeNode({
              allDirectoriesExpanded,
              depth: depth + 1,
              expandedDirectories,
              node: childNode,
              onOpenFileDiff,
              toggleDirectory,
            }),
          )}
        </div>
      ) : null}
    </div>
  )
}

function renderFileNode({ depth, node, onOpenFileDiff }: RenderTreeNodeOptions): ReactNode {
  if (node.kind !== 'file') return null

  const icon = iconForEntry({ name: node.name, type: 'file' })
  const content = (
    <>
      <span aria-hidden='true' className='size-3.5 shrink-0' />
      <FileTypeIcon className='size-3.5 shrink-0' icon={icon} />
      <span className='text-muted-foreground/80 group-hover:text-foreground/90 text-2xs truncate font-mono'>
        {node.name}
      </span>
      {node.stat ? (
        <span className='text-3xs ml-auto shrink-0 font-mono tabular-nums'>
          <ChatDiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
        </span>
      ) : null}
    </>
  )

  if (onOpenFileDiff) {
    return (
      // Raw button for the same reason as the directory row above: the list
      // hover fill must survive the Button primitive's dark-mode ghost hover.
      <button
        className='group hover:bg-row-hover flex w-full items-center gap-1.5 py-1 pr-2 text-left'
        data-scroll-anchor-ignore
        key={`file:${node.path}`}
        style={treeNodeStyle(depth)}
        title={node.path}
        type='button'
        onClick={() => onOpenFileDiff(node.path)}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      className='group hover:bg-row-hover flex w-full items-center gap-1.5 py-1 pr-2 text-left'
      key={`file:${node.path}`}
      style={treeNodeStyle(depth)}
      title={node.path}
    >
      {content}
    </div>
  )
}

function collectDirectoryPaths(nodes: readonly ChatTurnDiffTreeNode[]) {
  const paths: string[] = []

  for (const node of nodes) {
    if (node.kind !== 'directory') continue

    paths.push(node.path)
    paths.push(...collectDirectoryPaths(node.children))
  }

  return paths
}

function treeNodeStyle(depth: number): CSSProperties {
  return {
    paddingLeft: `${8 + depth * 14}px`,
  }
}
