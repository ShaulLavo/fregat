import { ArrowsClockwiseIcon, CheckIcon, SignInIcon } from '@phosphor-icons/react'
import type { ProviderMcpServer } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { cn } from '@workspace/ui/lib/utils'
import { buttonVariants } from '@workspace/ui/components/button'

import { RowIconAction } from '@/features/chat/components/row-icon-action'
import { mcpServerFacts, mcpStatusClass, mcpStatusLabel } from '@/lib/mcp-status'

export function McpServerRow({
  authorizationUrl,
  busy,
  canReconnect,
  canSignIn,
  onApprove,
  onReconnect,
  onSignIn,
  server,
}: {
  readonly authorizationUrl: string | null
  readonly busy: boolean
  readonly canReconnect: boolean
  readonly canSignIn: boolean
  readonly onApprove: () => void
  readonly onReconnect: () => void
  readonly onSignIn: () => void
  readonly server: ProviderMcpServer
}) {
  const needsAuth = server.status === 'needs-auth'
  const hint = mcpServerHint(server, canSignIn)
  const facts = mcpServerFacts(server)
  return (
    <ListRow
      className='h-auto flex-col items-stretch gap-0.5 py-(--density-row-padding-y)'
      interactive={false}
      title={[server.name, mcpStatusLabel(server.status), ...facts, hint]
        .filter(Boolean)
        .join(' · ')}
    >
      <span className='flex min-w-0 items-center gap-(--density-control-gap)'>
        <span className='min-w-0 flex-1 truncate'>{server.name}</span>
        <span className={cn('shrink-0 text-2xs', mcpStatusClass(server.status))}>
          {mcpStatusLabel(server.status)}
        </span>
        {needsAuth && canSignIn && !authorizationUrl ? (
          <RowIconAction busy={busy} label={`Sign in to ${server.name}`} onClick={onSignIn}>
            <SignInIcon className='size-(--icon-size-sm)' />
          </RowIconAction>
        ) : null}
        {server.status === 'unapproved' ? (
          <RowIconAction busy={busy} label={`Approve ${server.name}`} onClick={onApprove}>
            <CheckIcon className='size-(--icon-size-sm)' />
          </RowIconAction>
        ) : null}
        {server.status === 'failed' && canReconnect ? (
          <RowIconAction busy={busy} label={`Reconnect ${server.name}`} onClick={onReconnect}>
            <ArrowsClockwiseIcon className='size-(--icon-size-sm)' />
          </RowIconAction>
        ) : null}
      </span>
      {needsAuth && authorizationUrl ? (
        <a
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
          href={authorizationUrl}
          rel='noopener noreferrer'
          target='_blank'
        >
          Continue sign-in to {server.name}
        </a>
      ) : null}
      {facts.length > 0 ? (
        <span className='text-muted-foreground text-2xs truncate font-mono'>
          {facts.join(' · ')}
        </span>
      ) : null}
      {hint ? <span className='text-muted-foreground text-2xs truncate'>{hint}</span> : null}
    </ListRow>
  )
}

function mcpServerHint(server: ProviderMcpServer, canSignIn: boolean) {
  if (server.status === 'needs-auth' && !canSignIn) return 'Sign in with /mcp in Claude Code.'
  if (server.status === 'unapproved')
    return 'Defined by a .mcp.json in this folder or above it. Approve to let sessions start it; a changed definition asks again.'
  return server.error
}
