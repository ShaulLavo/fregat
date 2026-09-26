import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ProviderInstanceId } from '@workspace/contracts'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'

import { McpFolderField } from '@/features/settings/components/mcp-folder-field'
import { McpServerList } from '@/features/settings/components/mcp-server-list'
import { ProviderLoading } from '@/features/settings/components/provider-loading'
import { mcpInstances } from '@/features/settings/utils/mcp'
import { providerListQueryOptions } from '@/lib/provider-query'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

/**
 * Settings › MCP servers: one provider instance at a time, read on request, because a read
 * starts each of its servers once.
 */
export function McpSection() {
  const providers = useQuery(providerListQueryOptions(), useSettingsOwner())
  const instances = mcpInstances(providers.data?.providers ?? [])
  const [selected, setSelected] = useState<ProviderInstanceId | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const instance = instances.find((entry) => entry.providerInstanceId === selected) ?? null

  if (providers.isPending) return <ProviderLoading />
  if (instances.length === 0)
    return <EmptyState align='start' title='No Claude or Codex provider is turned on' />

  return (
    <div
      className='flex w-full min-w-0 flex-col gap-3 @3xl/settings:w-[min(40rem,60vw)]'
      data-mcp-section
    >
      <p className='text-muted-foreground text-xs'>
        Servers each agent starts, read from its own config. Changes are written with the agent’s
        own config tools.
      </p>
      <Tabs
        onValueChange={(value: string) =>
          setSelected(
            instances.find((entry) => entry.providerInstanceId === value)?.providerInstanceId ??
              null,
          )
        }
        value={selected ?? ''}
      >
        <TabsList aria-label='Provider' variant='segmented'>
          {instances.map((entry) => (
            <TabsTab key={entry.providerInstanceId} value={entry.providerInstanceId}>
              {entry.displayLabel}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      <McpFolderField folder={folder} onChange={setFolder} />
      {instance ? (
        <McpServerList folder={folder} instance={instance} instances={instances} />
      ) : (
        <EmptyState
          align='start'
          description='Listing starts each server once to read its status and tools.'
          title='Choose a provider to list its MCP servers'
        />
      )}
    </div>
  )
}
