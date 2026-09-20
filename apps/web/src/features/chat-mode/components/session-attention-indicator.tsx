import type { SessionRailStatus } from '@workspace/client-core/chat/rail/status'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'
import {
  sessionStatusDotClass,
  sessionStatusLabel,
} from '@/features/chat-mode/utils/attention-state'

export function SessionAttentionIndicator({ status }: { readonly status: SessionRailStatus }) {
  const label = sessionStatusLabel(status)
  if (status === 'working')
    return <OrbitLoader className='text-info size-3 shrink-0' label={label} />
  return (
    <span
      aria-label={label}
      className={cn('size-1.5 shrink-0 rounded-full', sessionStatusDotClass(status))}
      role='status'
      title={label}
    />
  )
}
