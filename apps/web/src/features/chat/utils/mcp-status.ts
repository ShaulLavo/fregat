import type { ProviderMcpServer, ProviderMcpServerStatus } from '@workspace/contracts'

const LABELS: Record<ProviderMcpServerStatus, string> = {
  connected: 'Connected',
  disabled: 'Disabled',
  failed: 'Failed',
  'needs-auth': 'Needs sign-in',
  pending: 'Starting',
  unapproved: 'Not approved',
}

const SOURCES: Record<string, string> = {
  claudeai: 'Claude.ai',
  default: 'Built in',
  dynamic: 'This session',
  enterprise: 'Managed',
  local: 'Local',
  managed: 'Managed',
  plugin: 'Plugin',
  project: 'Project',
  sdk: 'Platform',
  session: 'This session',
  system: 'System',
  user: 'User',
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

/** Where the definition lives, in the harness's own words when Platform has no name for it. */
function mcpSourceLabel(source: string | null) {
  if (!source) return null

  return SOURCES[source] ?? source
}

/** Source, transport or HTTP origin, and tool count: what the harness reported beyond status. */
export function mcpServerFacts(server: ProviderMcpServer) {
  const tools = server.tools.length
  return [
    mcpSourceLabel(server.source),
    server.origin ?? server.transport,
    tools > 0 ? `${tools} ${tools === 1 ? 'tool' : 'tools'}` : null,
  ].filter((part): part is string => Boolean(part))
}
