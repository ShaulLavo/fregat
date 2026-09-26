import type { SessionRailStatus } from '@workspace/contracts'
import { StatusDot } from '@workspace/ui/components/status-dot'
import { sessionStatusLabel, sessionStatusTone } from '@/features/chat-mode/utils/attention-state'

export function SessionAttentionIndicator({ status }: { readonly status: SessionRailStatus }) {
  const label = sessionStatusLabel(status)
  return (
    <StatusDot
      aria-label={label}
      live={status === 'working'}
      role='status'
      title={label}
      tone={sessionStatusTone(status)}
    />
  )
}
