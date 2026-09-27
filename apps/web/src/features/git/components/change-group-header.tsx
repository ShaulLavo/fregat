import { TreeRowLead } from '@workspace/ui/patterns/tree-row-lead'
import { listRowClassName } from '@workspace/ui/patterns/list-row-classes'
import { use } from 'react'

import { useGitState } from '@/features/git/state/store'

import { TickerNumber } from '@/components/ticker-number'
import { ChangesContext } from '@/features/git/providers/changes-context'
import { GroupActions } from '@/features/git/components/group-actions'
import type { ChangesGroup } from '@/features/git/utils/change-entries'

export function ChangeGroupHeader({
  group,
  rootPath,
  onToggle,
}: {
  group: ChangesGroup
  rootPath: string
  onToggle: () => void
}) {
  const listbox = use(ChangesContext)
  const selected = useGitState((state) => state.activeChangeId === group.section)
  const rowProps = listbox
    ? {
        ...listbox.rowBindings(group.section),
        'aria-selected': selected,
        'data-active': selected || undefined,
      }
    : undefined

  return (
    <div
      {...rowProps}
      role='treeitem'
      aria-level={1}
      aria-expanded={group.expanded}
      className={listRowClassName({
        className:
          'group/group text-muted-foreground h-(--density-control-height-sm) w-full section-label',
      })}
      onClick={(event) => {
        rowProps?.onClick(event)
        onToggle()
      }}
      onContextMenu={(event) => listbox?.openMenu(group.section, event)}
    >
      <TreeRowLead depth={0} expanded={group.expanded} />
      <span className='min-w-0 flex-1 truncate'>{group.label}</span>
      <GroupActions rootPath={rootPath} rows={group.rows} section={group.section} />
      <span className='ml-1'>
        <TickerNumber value={group.rows.length} />
      </span>
    </div>
  )
}
