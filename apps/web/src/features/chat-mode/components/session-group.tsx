import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { SessionGroupHeader } from '@/features/chat-mode/components/session-group-header'
import { SessionRow } from '@/features/chat-mode/components/session-row'
import { useRailDragSensors } from '@/features/chat-mode/hooks/use-rail-drag-sensors'
import { useChatRailOrder } from '@/features/chat-mode/providers/rail-order-context'
import type { SessionRailGroup } from '@workspace/client-core/chat/rail/model'
import { cn } from '@workspace/ui/lib/utils'

const SESSION_DND_MODIFIERS = [restrictToVerticalAxis]

/**
 * One project's band: a sortable row in the rail's project list, and the list its
 * own sessions sort inside. The two lists are separate drag contexts because a
 * session never leaves its project — moving one across bands would have to
 * reassign the session, which is a different command entirely.
 */
export function SessionGroup({
  activeSessionKey,
  group,
}: {
  readonly activeSessionKey: string | null
  readonly group: SessionRailGroup
}) {
  const { reorderSession } = useChatRailOrder()
  const sensors = useRailDragSensors()
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    attributes: {
      roleDescription: 'sortable project band',
    },
    id: group.key,
  })

  function handleSessionDragEnd(event: DragEndEvent) {
    reorderSession(String(event.active.id), event.over ? String(event.over.id) : null)
  }

  return (
    <div
      className={cn('flex flex-col gap-0.5', isDragging && 'opacity-40')}
      ref={setNodeRef}
      // Measured drag offsets: nothing but the drag itself knows these values.
      // The band being dragged is deliberately NOT translated — the overlay is
      // carrying its header, so this stays put as the gap it will drop back into.
      // Its siblings still shift, which is what shows where it will land.
      style={isDragging ? undefined : { transform: CSS.Transform.toString(transform), transition }}
    >
      <SessionGroupHeader dragAttributes={attributes} dragListeners={listeners} group={group} />
      <DndContext
        collisionDetection={closestCenter}
        modifiers={SESSION_DND_MODIFIERS}
        sensors={sensors}
        onDragEnd={handleSessionDragEnd}
      >
        <SortableContext
          items={group.sessions.map((session) => session.key)}
          strategy={verticalListSortingStrategy}
        >
          {group.sessions.map((session) => (
            <SessionRow
              active={session.key === activeSessionKey}
              key={session.key}
              session={session}
            />
          ))}
        </SortableContext>
      </DndContext>
      {/* Said out loud: a fold that silently swallows rows leaves the counts in the
          header looking wrong to anyone reading the list under it. */}
      {group.hiddenCount > 0 ? (
        <p className='text-muted-foreground/50 text-2xs px-2 pb-1 pl-[26px] tabular-nums'>
          {group.hiddenCount} hidden
        </p>
      ) : null}
    </div>
  )
}
