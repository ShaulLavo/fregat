import { useIsMutating } from '@tanstack/react-query'
import { useState } from 'react'
import type { ProviderMcpConfigServer, ProviderSnapshot } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import { FileLabel } from '@/components/file-label'
import { McpConfigSignIn } from '@/features/settings/components/mcp-config-sign-in'
import { McpCopyMenu } from '@/features/settings/components/mcp-copy-menu'
import { McpRemoveDialog } from '@/features/settings/components/mcp-remove-dialog'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { mcpServerFacts, mcpStatusClass, mcpStatusLabel } from '@/lib/mcp-status'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

export function McpConfigRow({
  folder,
  instance,
  instances,
  server,
}: {
  readonly folder: string | null
  readonly instance: ProviderSnapshot
  readonly instances: readonly ProviderSnapshot[]
  readonly server: ProviderMcpConfigServer
}) {
  const owner = useSettingsOwner()
  const [removing, setRemoving] = useState(false)
  const copying =
    useIsMutating(
      { mutationKey: settingsMutationKeys.mcp.copy(instance.providerInstanceId, server.name) },
      owner,
    ) > 0
  const facts = mcpServerFacts(server)
  const detail =
    server.error ?? (server.status === 'unapproved' ? 'Approve it from a chat’s MCP list.' : null)
  const targets = instances.filter(
    (entry) => entry.providerInstanceId !== instance.providerInstanceId,
  )

  return (
    <li className='flex flex-col py-2' data-mcp-server={server.name}>
      <div className='flex items-center gap-3'>
        <div
          className='flex min-w-0 flex-1 flex-col'
          title={[server.name, mcpStatusLabel(server.status), ...facts, server.file, detail]
            .filter(Boolean)
            .join(' · ')}
        >
          <span className='flex min-w-0 items-center gap-(--density-control-gap)'>
            <span className='text-foreground truncate text-sm'>{server.name}</span>
            <span className={cn('shrink-0 text-2xs', mcpStatusClass(server.status))}>
              {mcpStatusLabel(server.status)}
            </span>
          </span>
          {facts.length > 0 ? (
            <span className='text-muted-foreground text-2xs truncate font-mono'>
              {facts.join(' · ')}
            </span>
          ) : null}
          {server.file ? (
            <span className='text-2xs flex min-w-0 items-center gap-1'>
              <FileLabel path={server.file} />
            </span>
          ) : null}
          {detail ? (
            <span className='text-muted-foreground text-2xs truncate'>{detail}</span>
          ) : null}
        </div>
        {server.scope && server.status !== 'unapproved' && targets.length > 0 ? (
          <McpCopyMenu
            busy={copying}
            folder={folder}
            instance={instance}
            scope={server.scope}
            serverName={server.name}
            targets={targets}
          />
        ) : null}
        {server.scope ? (
          <Button onClick={() => setRemoving(true)} size='sm' variant='ghost'>
            Remove
          </Button>
        ) : null}
      </div>
      {server.status === 'needs-auth' ? (
        <McpConfigSignIn folder={folder} instance={instance} name={server.name} />
      ) : null}
      {removing && server.scope ? (
        <McpRemoveDialog
          folder={folder}
          instance={instance}
          onClose={() => setRemoving(false)}
          scope={server.scope}
          serverName={server.name}
        />
      ) : null}
    </li>
  )
}
