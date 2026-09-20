import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  railMarkerId,
  type RailListMarker,
  type RailShelf,
} from '@workspace/client-core/chat/rail/drop'
import { cn } from '@workspace/ui/lib/utils'

export function SessionShelf({
  shelf,
  title,
  children,
}: {
  readonly shelf: RailShelf
  readonly title: string
  readonly children: ReactNode
}) {
  const markers: Record<RailShelf, RailListMarker> = {
    pinned: 'pinned-header',
    active: 'active-placeholder',
    snoozed: 'snoozed-header',
    settled: 'settled-placeholder',
  }
  const { setNodeRef, isOver } = useDroppable({
    id: railMarkerId(markers[shelf]),
    disabled: shelf === 'snoozed',
    data: { kind: 'shelf', shelf },
  })
  return (
    <section aria-label={title}>
      <h2
        ref={setNodeRef}
        data-rail-shelf-target={shelf}
        className={cn(
          'text-muted-foreground text-2xs flex h-(--density-control-height-sm) items-center px-(--density-row-padding-x) font-medium tracking-wider uppercase',
          isOver && 'bg-accent',
        )}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}
