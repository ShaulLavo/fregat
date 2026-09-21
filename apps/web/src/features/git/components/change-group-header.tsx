import { CaretDownIcon } from '@phosphor-icons/react'
import { listRowClassName } from '@workspace/ui/patterns/list-row-classes'
import { cn } from '@workspace/ui/lib/utils'
import { use, type KeyboardEvent, type MouseEvent } from 'react'

import { useGitState } from '@/features/git/state/store'

import { TickerNumber } from '@/components/ticker-number'
import { ChangesContext } from '@/features/git/providers/changes-context'
import { GroupActions } from '@/features/git/components/group-actions'
import { GroupMenu } from '@/features/git/components/group-menu'
import type { ChangesGroup } from '@/features/git/utils/change-entries'
import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'

export function ChangeGroupHeader({
  group,
  rootPath,
  onToggle,
}: {
  group: ChangesGroup
  rootPath: string
  onToggle: () => void
}) {
  const contextMenu = useContextMenu()
  const listbox = use(ChangesContext)
  const selected = useGitState((state) => state.activeChangeId === group.section)
  const rowProps = listbox
    ? {
        ...listbox.rowBindings(group.section),
        'aria-selected': selected,
        'data-active': selected || undefined,
      }
    : undefined

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    contextMenu.openAtEvent(event, event.currentTarget)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    contextMenu.openOnMenuKey(event)
  }

  return (
    <>
      <div
        {...rowProps}
        role='treeitem'
        aria-level={1}
        aria-expanded={group.expanded}
        className={listRowClassName({
          className:
            'group/group text-muted-foreground text-2xs h-(--density-control-height-sm) w-full font-medium tracking-wider uppercase',
        })}
        onClick={(event) => {
          rowProps?.onClick(event)
          onToggle()
        }}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
      >
        <CaretDownIcon
          className={cn(
            'size-(--icon-size-sm) shrink-0 transition-transform',
            !group.expanded && '-rotate-90',
          )}
        />
        <span className='min-w-0 flex-1 truncate'>{group.label}</span>
        <GroupActions rootPath={rootPath} rows={group.rows} section={group.section} />
        <span className='ml-1'>
          <TickerNumber value={group.rows.length} />
        </span>
      </div>
      {contextMenu.anchor ? (
        <GroupMenu
          anchor={contextMenu.anchor}
          onOpenChange={contextMenu.onOpenChange}
          rootPath={rootPath}
          rows={group.rows}
          section={group.section}
        />
      ) : null}
    </>
  )
}
