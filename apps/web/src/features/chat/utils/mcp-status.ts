import type { ProviderMcpServerStatus } from '@workspace/contracts'

const LABELS: Record<ProviderMcpServerStatus, string> = {
  connected: 'Connected',
  disabled: 'Disabled',
  failed: 'Failed',
  'needs-auth': 'Needs sign-in',
  pending: 'Starting',
  unapproved: 'Not approved',
}

export function mcpStatusLabel(status: ProviderMcpServerStatus) {
  return LABELS[status]
}

export function mcpStatusClass(status: ProviderMcpServerStatus) {
  if (status === 'failed') return 'text-destructive'
  if (status === 'needs-auth' || status === 'unapproved') return 'text-warning'
  if (status === 'connected') return 'text-success'

  return 'text-muted-foreground'
}
