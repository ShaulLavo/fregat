import {
  ChatCircleIcon,
  FilesIcon,
  GitBranchIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  ScrollIcon,
  TerminalIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'

import { Button } from '@workspace/ui/components/button'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'
import { PaneHeaderMenu } from '@/features/workbench/components/pane-header-menu'
import type { LoadState } from '@/lib/load-state'
import type { TreeModel } from '@/lib/tree-model'
import type { PointerEvent, ReactNode } from 'react'

type ToolPaneHeaderOrientation = 'horizontal' | 'vertical'
type ToolPaneHeaderTab = 'chat' | 'files' | 'git' | 'logs' | 'problems' | 'search' | 'terminal'

export function ToolPaneHeader({
  className,
  collapsed = false,
  orientation = 'horizontal',
  rowActive = false,
  tab,
  treeState,
  visibleTreeItemCount,
  onClose,
  onCollapseToRow,
  onToggleCollapse,
}: {
  readonly className?: string
  readonly collapsed?: boolean
  readonly orientation?: ToolPaneHeaderOrientation
  readonly rowActive?: boolean
  readonly tab?: ToolPaneHeaderTab
  readonly treeState?: LoadState<TreeModel>
  readonly visibleTreeItemCount?: number | null
  readonly onClose?: () => void
  readonly onCollapseToRow?: () => void
  readonly onToggleCollapse?: () => void
}) {
  const title = panelTabTitle(tab)
  const detail =
    tab === 'files' && orientation === 'horizontal'
      ? treeHeaderDetail(treeState, visibleTreeItemCount ?? null)
      : null
  const toggleLabel = collapsed ? `Expand ${title}` : `Collapse ${title}`
  const rowLabel = rowActive ? `Expand ${title}` : `Collapse ${title} to row`
  const actionsVisible = Boolean(onClose || onToggleCollapse || onCollapseToRow)

  const header = (
    <div
      className={cn(
        'border-border flex shrink-0 text-foreground',
        orientation === 'vertical'
          ? 'h-full w-full flex-col items-center gap-1 border-r px-1 py-1'
          : 'h-10 items-center gap-2 border-b px-3 compact:h-9 compact:gap-1.5 compact:px-2',
        className,
      )}
      data-workbench-tool-pane-header=''
      data-workbench-tool-pane-header-collapsed={collapsed ? 'true' : 'false'}
      data-workbench-tool-pane-header-orientation={orientation}
    >
      {toolPaneHeaderIcon(tab)}
      <div
        className={cn(
          'min-w-0 flex-1',
          orientation === 'vertical' && 'flex min-h-0 w-full flex-col items-center',
        )}
      >
        <div
          className={cn(
            'truncate text-xs font-medium',
            orientation === 'vertical' && 'min-h-0 [writing-mode:vertical-rl]',
          )}
        >
          {title}
        </div>
        {detail ? (
          <div className='text-muted-foreground truncate text-[11px] tabular-nums'>{detail}</div>
        ) : null}
      </div>
      {actionsVisible ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            orientation === 'vertical' ? 'w-full flex-col' : 'ml-auto',
          )}
          data-workbench-drag-blocker=''
        >
          {onCollapseToRow ? (
            <Button
              aria-label={rowLabel}
              className='text-muted-foreground hover:text-foreground compact:size-6 size-7 rounded-md'
              size='icon-sm'
              title={rowLabel}
              type='button'
              variant='ghost'
              onClick={rowActive ? onToggleCollapse : onCollapseToRow}
              onPointerDown={stopToolPaneHeaderPointerDown}
            >
              <MinusIcon className='size-3.5' />
            </Button>
          ) : null}
          {!onCollapseToRow && onToggleCollapse ? (
            <Button
              aria-label={toggleLabel}
              className='text-muted-foreground hover:text-foreground compact:size-6 size-7 rounded-md'
              size='icon-sm'
              title={toggleLabel}
              type='button'
              variant='ghost'
              onClick={onToggleCollapse}
              onPointerDown={stopToolPaneHeaderPointerDown}
            >
              {collapsed ? <PlusIcon className='size-3.5' /> : <MinusIcon className='size-3.5' />}
            </Button>
          ) : null}
          {onClose ? (
            <Button
              aria-label={`Close ${title}`}
              className='text-muted-foreground hover:text-foreground compact:size-6 size-7 rounded-md'
              size='icon-sm'
              title={`Close ${title}`}
              type='button'
              variant='ghost'
              onClick={onClose}
              onPointerDown={stopToolPaneHeaderPointerDown}
            >
              <XIcon className='size-3.5' />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  return <PaneHeaderMenu title={title} trigger={header} />
}

function stopToolPaneHeaderPointerDown(event: PointerEvent<HTMLButtonElement>) {
  event.stopPropagation()
}

function panelTabTitle(tab: ToolPaneHeaderTab | undefined) {
  if (tab === 'chat') return 'Chat'
  if (tab === 'files') return 'Files'
  if (tab === 'git') return 'Git'
  if (tab === 'logs') return 'Logs'
  if (tab === 'problems') return 'Problems'
  if (tab === 'search') return 'Search'
  if (tab === 'terminal') return 'Terminal'

  return 'Tool Pane'
}

function toolPaneHeaderIcon(tab: ToolPaneHeaderTab | undefined) {
  const className = cn('text-muted-foreground size-4 shrink-0')
  if (tab === 'chat') return <ChatCircleIcon className={className} />
  if (tab === 'files') return <FilesIcon className={className} />
  if (tab === 'git') return <GitBranchIcon className={className} />
  if (tab === 'logs') return <ScrollIcon className={className} />
  if (tab === 'problems') return <WarningCircleIcon className={className} />
  if (tab === 'search') return <MagnifyingGlassIcon className={className} />
  if (tab === 'terminal') return <TerminalIcon className={className} />

  return null
}

function treeHeaderDetail(
  treeState: LoadState<TreeModel> | undefined,
  visibleTreeItemCount: number | null,
): ReactNode {
  if (!treeState) return null
  if (treeState.status === 'loading')
    return (
      <span className='flex items-center gap-1.5'>
        <OrbitLoader className='size-3 shrink-0' label='Loading files' />
        Loading…
      </span>
    )
  if (treeState.status === 'error') return 'Unable to load files'
  if (visibleTreeItemCount === null) return null

  return `${visibleTreeItemCount} items`
}
