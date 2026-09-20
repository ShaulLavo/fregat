import { WarningCircleIcon } from '@phosphor-icons/react'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'
import { hasConnectionNotice } from '@/lib/environments/utils/availability'

export function StaleNotice() {
  const unavailable = useUnavailableEnvironment()
  if (!unavailable || !hasConnectionNotice(unavailable)) return null
  return (
    <div
      role='status'
      className='border-warning/30 bg-warning/10 text-warning flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs'
    >
      <WarningCircleIcon aria-hidden='true' className='size-(--icon-size) shrink-0' />
      <span>{unavailable.label ?? unavailable.name} is unreachable. Showing cached data.</span>
    </div>
  )
}
