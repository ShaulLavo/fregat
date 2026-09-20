import { stopPropagation } from '@workspace/utils/events'
import { MinusIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ToolPaneHeader as Header } from '@workspace/ui/patterns/tool-pane-header'
import { PaneHeaderMenu } from '@/features/workbench/components/pane-header-menu'
import { TreeHeaderDetail } from '@/components/tree-header-detail'
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
  const title = tab ? tab[0].toUpperCase() + tab.slice(1) : 'Tool Pane'
  const treeDetail =
    tab === 'files' && orientation === 'horizontal' ? (
      <TreeHeaderDetail treeState={treeState} visibleTreeItemCount={visibleTreeItemCount ?? null} />
    ) : null
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

  const header = (
    <Header
      {...headerAttributes}
      title={title}
      detail={detail}
      orientation={orientation}
      className={className}
      actions={
        actionsVisible ? (
          <div
            className={
              orientation === 'vertical' ? 'flex flex-col gap-0.5' : 'flex items-center gap-0.5'
            }
            data-workbench-drag-blocker=''
          >
            {paneActions}
            {onCollapseToRow ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={rowLabel}
                      className='text-muted-foreground'
                      size='icon-sm'
                      variant='ghost'
                      onClick={rowActive ? onToggleCollapse : onCollapseToRow}
                      onPointerDown={stopPropagation}
                    />
                  }
                >
                  <MinusIcon className='size-(--icon-size-sm)' />
                </TooltipTrigger>
                <TooltipContent side='bottom'>{rowLabel}</TooltipContent>
              </Tooltip>
            ) : null}
            {!onCollapseToRow && onToggleCollapse ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={toggleLabel}
                      className='text-muted-foreground'
                      size='icon-sm'
                      variant='ghost'
                      onClick={onToggleCollapse}
                      onPointerDown={stopPropagation}
                    />
                  }
                >
                  {collapsed ? (
                    <PlusIcon className='size-(--icon-size-sm)' />
                  ) : (
                    <MinusIcon className='size-(--icon-size-sm)' />
                  )}
                </TooltipTrigger>
                <TooltipContent side='bottom'>{toggleLabel}</TooltipContent>
              </Tooltip>
            ) : null}
            {onClose ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={`Close ${title}`}
                      className='text-muted-foreground'
                      size='icon-sm'
                      variant='ghost'
                      onClick={onClose}
                      onPointerDown={stopPropagation}
                    />
                  }
                >
                  <XIcon className='size-(--icon-size-sm)' />
                </TooltipTrigger>
                <TooltipContent side='bottom'>Close {title}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : null
      }
    />
  )
  return <PaneHeaderMenu title={title} trigger={header} />
}
