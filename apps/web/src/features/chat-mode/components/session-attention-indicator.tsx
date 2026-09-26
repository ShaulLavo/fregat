import type { SessionRailStatus } from '@workspace/contracts'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'
import {
  sessionStatusDotClass,
  sessionStatusLabel,
} from '@/features/chat-mode/utils/attention-state'

export function SessionAttentionIndicator({ status }: { readonly status: SessionRailStatus }) {
  const label = sessionStatusLabel(status)
  if (status === 'working') return <Spinner size='xs' label={label} />
  return (
    <span
      aria-label={label}
      className={cn('size-1.5 shrink-0 rounded-full', sessionStatusDotClass(status))}
      role='status'
      title={label}
    />
  )
}
