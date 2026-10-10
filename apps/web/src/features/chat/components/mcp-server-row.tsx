import { ArrowsClockwiseIcon, CheckIcon, SignInIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { ProviderMcpServer } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { cn } from '@workspace/ui/lib/utils'
import { Switch } from '@workspace/ui/components/switch'

import { RowIconAction } from '@/features/chat/components/row-icon-action'
import { mcpServerFacts, mcpStatusClass, mcpStatusLabel } from '@/lib/mcp-status'

export function McpServerRow({
  busy,
  canReconnect,
  canSignIn,
  onApprove,
  onReconnect,
  onSessionOffChange,
  onSignIn,
  server,
  sessionOff,
  signInPanel,
}: {
  readonly busy: boolean
  readonly canReconnect: boolean
  readonly canSignIn: boolean
  readonly onApprove: () => void
  readonly onReconnect: () => void
  readonly onSessionOffChange: (off: boolean) => void
  readonly onSignIn: () => void
  readonly server: ProviderMcpServer
  /** Null when the session cannot run without it; true when it runs without it now. */
  readonly sessionOff: boolean | null
  /** The sign-in started from this row, once the server has handed out its page. */
  readonly signInPanel: ReactNode
}) {
  const needsAuth = server.status === 'needs-auth'
  const hint = sessionOff ? SESSION_OFF_HINT : mcpServerHint(server, canSignIn)
  const facts = mcpServerFacts(server)
  const status = sessionOff ? 'Off for this session' : mcpStatusLabel(server.status)
  return (
    <ListRow
      className='h-auto flex-col items-stretch gap-0.5 py-(--density-row-padding-y)'
      interactive={false}
      title={[server.name, status]
        .concat(facts, hint ? [hint] : [])
        .filter(Boolean)
        .join(' · ')}
    >
      <span className='flex min-w-0 items-center gap-(--density-control-gap)'>
        <span className='min-w-0 flex-1 truncate'>{server.name}</span>
        <span className={cn('shrink-0 text-2xs', mcpStatusClass(server.status))}>{status}</span>
        {needsAuth && canSignIn && !signInPanel ? (
          <RowIconAction busy={busy} label={`Sign in to ${server.name}`} onClick={onSignIn}>
            <SignInIcon className='size-(--icon-size-sm)' />
          </RowIconAction>
        ) : null}
        {server.status === 'unapproved' ? (
          <RowIconAction busy={busy} label={`Approve ${server.name}`} onClick={onApprove}>
            <CheckIcon className='size-(--icon-size-sm)' />
          </RowIconAction>
        ) : null}
        {server.status === 'failed' && canReconnect && !sessionOff ? (
          <RowIconAction busy={busy} label={`Reconnect ${server.name}`} onClick={onReconnect}>
            <ArrowsClockwiseIcon className='size-(--icon-size-sm)' />
          </RowIconAction>
        ) : null}
        {sessionOff === null ? null : (
          <Switch
            aria-label={`${server.name} in this session`}
            checked={!sessionOff}
            disabled={busy}
            onCheckedChange={(on) => onSessionOffChange(!on)}
            size='sm'
          />
        )}
      </span>
      {signInPanel}
      {facts.length > 0 ? (
        <span className='text-muted-foreground text-2xs truncate font-mono'>
          {facts.join(' · ')}
        </span>
      ) : null}
      {hint ? <span className='text-muted-foreground text-2xs truncate'>{hint}</span> : null}
    </ListRow>
  )
}

const SESSION_OFF_HINT =
  'Switching restarts an idle session on the same conversation. Settings › MCP servers removes it everywhere.'

function mcpServerHint(server: ProviderMcpServer, canSignIn: boolean) {
  if (server.status === 'needs-auth' && !canSignIn) return 'Sign in with /mcp in Claude Code.'
  if (server.status === 'unapproved')
    return 'Defined by a .mcp.json in this folder or above it. Approve to let sessions start it; a changed definition asks again.'
  return server.error
}
