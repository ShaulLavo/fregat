import { stopPropagation as stopToolPaneHeaderPointerDown } from '@workspace/utils/events'
import { MinusIcon, PlusIcon, XIcon } from '@phosphor-icons/react'

import { Button } from '@workspace/ui/components/button'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { cn } from '@workspace/ui/lib/utils'
import { PaneHeaderMenu } from '@/features/workbench/components/pane-header-menu'
import type { LoadState } from '@/lib/load-state'
import type { TreeModel } from '@/lib/tree-model'
import type { ReactNode } from 'react'

type ToolPaneHeaderOrientation = 'horizontal' | 'vertical'
type ToolPaneHeaderTab = 'chat' | 'files' | 'git' | 'logs' | 'problems' | 'search' | 'terminal'

export function ToolPaneHeader({
  actions,
  className,
  collapsed = false,
  detail: detailSlot,
  orientation = 'horizontal',
  rowActive = false,
  tab,
  treeState,
  visibleTreeItemCount,
  onClose,
  onCollapseToRow,
  onToggleCollapse,
}: {
  readonly actions?: ReactNode
  readonly className?: string
  readonly collapsed?: boolean
  readonly detail?: ReactNode
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
  const treeDetail =
    tab === 'files' && orientation === 'horizontal'
      ? treeHeaderDetail(treeState, visibleTreeItemCount ?? null)
      : null
  const detail = orientation === 'horizontal' ? (detailSlot ?? treeDetail) : null
  const toggleLabel = collapsed ? `Expand ${title}` : `Collapse ${title}`
  const rowLabel = rowActive ? `Expand ${title}` : `Collapse ${title} to row`
  const paneActions = orientation === 'horizontal' ? actions : null
  const actionsVisible = Boolean(paneActions || onClose || onToggleCollapse || onCollapseToRow)

  const headerAttributes = {
    'data-workbench-tool-pane-header': '',
    'data-workbench-tool-pane-header-collapsed': collapsed ? 'true' : 'false',
    'data-workbench-tool-pane-header-orientation': orientation,
  }

  const headerChildren = (
    <>
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-(--density-control-gap)',
          orientation === 'vertical' && 'min-h-0 w-full flex-col',
        )}
        title={typeof detail === 'string' ? detail : undefined}
      >
        <div
          className={cn(
            'shrink-0 truncate text-xs font-medium',
            orientation === 'vertical' && 'min-h-0 [writing-mode:vertical-rl]',
          )}
        >
          {title}
        </div>
        {detail ? (
          <div className='text-muted-foreground text-2xs min-w-0 truncate tabular-nums'>
            {detail}
          </div>
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
          {paneActions}
          {onCollapseToRow ? (
            <Button
              aria-label={rowLabel}
              className='text-muted-foreground'
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
              className='text-muted-foreground'
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
              className='text-muted-foreground'
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
    </>
  )

  const header =
    orientation === 'vertical' ? (
      <div
        className={cn(
          'border-border text-foreground flex h-full w-(--rail-width) shrink-0 flex-col items-center gap-1 border-r px-1 py-1',
          className,
        )}
        {...headerAttributes}
      >
        {headerChildren}
      </div>
    ) : (
      <PaneBar border='bottom' className={cn('text-foreground', className)} {...headerAttributes}>
        {headerChildren}
      </PaneBar>
    )

  return <PaneHeaderMenu title={title} trigger={header} />
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

  return visibleTreeItemCount
}
