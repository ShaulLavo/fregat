import { useDndContext } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { SessionGroupHeader } from '@/features/chat-mode/components/session-group-header'
import { SessionRow } from '@/features/chat-mode/components/session-row'
import type { SessionRailGroup } from '@workspace/client-core/chat/rail/model'
import { cn } from '@workspace/ui/lib/utils'

export function SessionGroup({ group }: { readonly group: SessionRailGroup }) {
  const { active } = useDndContext()
  const draggingProject = active?.data.current?.kind === 'project'
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    attributes: {
      roleDescription: 'sortable project band',
    },
    id: group.key,
    disabled: group.project.members.length !== 1,
    data: { kind: 'project' },
  })

  return (
    <div
      className={cn('flex flex-col gap-0.5', isDragging && 'text-muted-foreground text-2xs')}
      ref={setNodeRef}
      // Measured drag offsets: nothing but the drag itself knows these values.
      // The band being dragged is deliberately NOT translated — the overlay is
      // carrying its header, so this stays put as the gap it will drop back into.
      // Its siblings still shift, which is what shows where it will land.
      style={
        !draggingProject || isDragging
          ? undefined
          : { transform: CSS.Transform.toString(transform), transition }
      }
    >
      <SessionGroupHeader
        dragAttributes={attributes}
        dragListeners={listeners}
        dragging={isDragging}
        group={group}
      />
      <SortableContext
        items={group.sessions.map((session) => session.key)}
        strategy={verticalListSortingStrategy}
      >
        {group.sessions.map((session) => (
          <SessionRow key={session.key} session={session} />
        ))}
      </SortableContext>
      {/* Said out loud: a fold that silently swallows rows leaves the counts in the
          header looking wrong to anyone reading the list under it. */}
      {group.hiddenCount > 0 ? (
        <p className='text-muted-foreground text-2xs px-2 pb-1 pl-[26px] tabular-nums'>
          {group.hiddenCount} hidden
        </p>
      ) : null}
    </div>
  )
}
