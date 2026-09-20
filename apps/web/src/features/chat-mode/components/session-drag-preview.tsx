import { useDndContext } from '@dnd-kit/core'
import { resolveRailDropVerb, type RailShelf } from '@workspace/client-core/chat/rail/drop'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'

export function SessionDragPreview({ session }: { readonly session: SessionRailItem }) {
  const { over } = useDndContext()
  const destination: RailShelf | null = over?.data.current?.shelf ?? null
  const verb = resolveRailDropVerb(session.placement, destination)
  return (
    <div className='bg-popover-solid pointer-events-none rounded-lg px-(--density-row-padding-x) py-(--density-row-padding-y) shadow-md'>
      <div className='truncate text-xs' title={session.title}>
        {session.title}
      </div>
      {verb ? <div className='text-muted-foreground text-2xs capitalize'>{verb}</div> : null}
    </div>
  )
}
