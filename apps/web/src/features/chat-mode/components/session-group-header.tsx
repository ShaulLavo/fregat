import { Button } from '@workspace/ui/components/button'
import { SessionAttentionIndicator } from '@/features/chat-mode/components/session-attention-indicator'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react'

import { ProjectMenu } from '@/features/chat-mode/components/project-menu'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import type { SessionRailGroup } from '@workspace/client-core/chat/rail/model'

export function SessionGroupHeader({
  dragAttributes,
  dragListeners,
  group,
}: {
  readonly dragAttributes?: DraggableAttributes
  readonly dragListeners?: DraggableSyntheticListeners
  readonly group: SessionRailGroup
}) {
  const toggleProjectCollapsed = useSessionRailStore((state) => state.toggleProjectCollapsed)
  const { project } = group

  return (
    <ProjectMenu
      group={group}
      trigger={
        <Button
          variant='ghost'
          {...dragAttributes}
          {...dragListeners}
          aria-expanded={!group.collapsed}
          className='text-muted-foreground hover:text-foreground text-2xs flex h-auto w-full touch-none items-center justify-start gap-(--density-control-gap) px-(--density-row-padding-x) py-1 text-left font-medium'
          title={project.workspaceRoot}
          type='button'
          onClick={() => toggleProjectCollapsed(project.id)}
        >
          {group.collapsed ? (
            <CaretRightIcon className='size-3 shrink-0 opacity-60' />
          ) : (
            <CaretDownIcon className='size-3 shrink-0 opacity-60' />
          )}
          <SessionAttentionIndicator status={project.status} />
          <span className='min-w-0 flex-1 truncate'>{project.title}</span>
          {project.qualifier ? (
            <span className='text-muted-foreground/60 h-auto max-w-[40%] shrink-0 justify-start truncate font-normal'>
              {project.qualifier}
            </span>
          ) : null}
          {project.unreadCount > 0 ? (
            <span className='text-info shrink-0 tabular-nums' title='Unread sessions'>
              {project.unreadCount}
            </span>
          ) : null}
          <span className='text-muted-foreground/60 h-auto shrink-0 justify-start tabular-nums'>
            {project.sessionCount}
          </span>
        </Button>
      }
    />
  )
}
