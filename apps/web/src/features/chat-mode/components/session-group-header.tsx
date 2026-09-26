import { ListRow } from '@workspace/ui/patterns/list-row'
import { useSessionListRow } from '@/features/chat-mode/hooks/use-session-list-row'
import { SessionAttentionIndicator } from '@/features/chat-mode/components/session-attention-indicator'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react'

import { ProjectMenu } from '@/features/chat-mode/components/project-menu'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import type { SessionRailGroup } from '@workspace/client-core/chat/rail/model'

export function SessionGroupHeader({
  dragAttributes,
  dragListeners,
  dragging = false,
  group,
}: {
  readonly dragAttributes?: DraggableAttributes
  readonly dragListeners?: DraggableSyntheticListeners
  readonly dragging?: boolean
  readonly group: SessionRailGroup
}) {
  const toggleProjectCollapsed = useSessionRailStore((state) => state.toggleProjectCollapsed)
  const { project } = group
  const { rowProps, active } = useSessionListRow(group.key)

  return (
    <ProjectMenu
      group={group}
      trigger={
        <ListRow
          as='button'
          {...(!dragAttributes?.['aria-disabled'] ? dragAttributes : {})}
          {...dragListeners}
          {...rowProps}
          role='option'
          selected={active}
          data-project-group={project.groupKey}
          data-active={active || undefined}
          data-dragging={dragging || undefined}
          aria-expanded={!group.collapsed}
          className='text-muted-foreground text-2xs w-full touch-none gap-(--density-control-gap) text-left font-medium'
          title={project.workspaceRoot}
          type='button'
          onClick={(event) => {
            rowProps?.onClick(event)
            toggleProjectCollapsed(project.members.map((member) => member.physicalKey))
          }}
        >
          {group.collapsed ? (
            <CaretRightIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
          ) : (
            <CaretDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
          )}
          <SessionAttentionIndicator status={project.status} />
          <span className='min-w-0 flex-1 truncate'>{project.title}</span>
          {project.qualifier ? (
            <span className='text-muted-foreground text-2xs h-auto max-w-[40%] shrink-0 justify-start truncate font-normal'>
              {project.qualifier}
            </span>
          ) : null}
          {project.unreadCount > 0 ? (
            <span className='text-info shrink-0 font-mono tabular-nums' title='Unread sessions'>
              {project.unreadCount}
            </span>
          ) : null}
          <span className='text-muted-foreground text-2xs h-auto shrink-0 justify-start font-mono tabular-nums'>
            {project.sessionCount}
          </span>
        </ListRow>
      }
    />
  )
}
