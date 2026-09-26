import { WarningCircleIcon } from '@phosphor-icons/react'
import { useDelayedVisible } from '@workspace/ui/hooks/use-delayed-visible'

// A server that is back within this reconnected; a warning for a frame reads as a failure.
const NOTICE_DELAY_MS = 600

export function UnreachableNotice({ machine }: { readonly machine: string }) {
  const visible = useDelayedVisible(NOTICE_DELAY_MS)
  if (!visible) return null

  return (
    <div
      role='status'
      className='bg-warning/10 text-warning flex shrink-0 items-center gap-2 px-3 py-2 text-xs'
    >
      <WarningCircleIcon aria-hidden='true' className='size-(--icon-size) shrink-0' />
      <span>{machine} is unreachable. Showing cached data.</span>
    </div>
  )
}
