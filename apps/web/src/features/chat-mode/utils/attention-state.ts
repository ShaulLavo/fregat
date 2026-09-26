import type { SessionRailStatus } from '@workspace/contracts'

export function sessionStatusLabel(status: SessionRailStatus) {
  if (status === 'approval') return 'Approval requested'
  if (status === 'input') return 'Waiting for you'
  if (status === 'failed') return 'Failed'
  if (status === 'working') return 'Working'
  if (status === 'monitoring') return 'Monitoring'

  return 'Ready'
}

/** Token classes only — these flip with the theme and must never be palette hues. */
export function sessionStatusDotClass(status: SessionRailStatus) {
  if (status === 'approval' || status === 'input') return 'bg-warning'
  if (status === 'failed') return 'bg-destructive'
  if (status === 'working' || status === 'monitoring') return 'bg-info'

  return 'bg-muted-foreground/40'
}

export function sessionStatusTextClass(status: SessionRailStatus) {
  if (status === 'approval' || status === 'input') return 'text-warning'
  if (status === 'failed') return 'text-destructive'
  if (status === 'working' || status === 'monitoring') return 'text-info'

  return 'text-muted-foreground'
}
