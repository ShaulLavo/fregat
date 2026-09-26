import type { SessionRailStatus } from '@workspace/contracts'
import type { StatusDotTone } from '@workspace/ui/components/status-dot'

export function sessionStatusLabel(status: SessionRailStatus) {
  if (status === 'approval') return 'Approval requested'
  if (status === 'input') return 'Waiting for you'
  if (status === 'failed') return 'Failed'
  if (status === 'working') return 'Working'
  if (status === 'monitoring') return 'Monitoring'

  return 'Ready'
}

export function sessionStatusTone(status: SessionRailStatus): StatusDotTone {
  if (status === 'approval' || status === 'input') return 'warning'
  if (status === 'failed') return 'destructive'
  if (status === 'working' || status === 'monitoring') return 'info'

  return 'neutral'
}

export function sessionStatusTextClass(status: SessionRailStatus) {
  if (status === 'approval' || status === 'input') return 'text-warning'
  if (status === 'failed') return 'text-destructive'
  if (status === 'working' || status === 'monitoring') return 'text-info'

  return 'text-muted-foreground'
}
