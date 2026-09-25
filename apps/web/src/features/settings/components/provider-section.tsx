import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import type { ProviderInstanceConfig } from '@workspace/contracts'

import { providerListQueryOptions } from '@/features/chat/utils/provider-query'

import { providerSettingRows } from '../utils/provider-rows'
import { EmptyRow } from './empty-row'
import { ProviderLoading } from './provider-loading'
import { ProviderRow } from './provider-row'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'

/**
 * The provider list, as the control for `providers.instances`.
 *
 * No heading of its own: it renders inside a settings row that already carries
 * the label, the id and the description, and the category above it is already
 * called Providers. A third "Providers" would be noise.
 *
 * The running providers, not the saved ones — the built-ins are registry
 * constants, so listing the settings document showed an empty screen while two
 * providers were live behind it.
 */
export function ProviderSection({ saved }: { saved: readonly ProviderInstanceConfig[] }) {
  const { data, isPending } = useQuery(providerListQueryOptions(), useSettingsOwner())
  const instances = providerSettingRows({ saved, snapshots: data?.providers ?? [] })
  const [agentView, setAgentView] = useState(false)
  const hasEnvironment = instances.some((instance) => instance.environment.length > 0)

  if (isPending && instances.length === 0) return <ProviderLoading />
  if (instances.length === 0) return <EmptyRow>No providers are available.</EmptyRow>

  return (
    <div className='flex w-96 max-w-full min-w-0 flex-col gap-2 @max-3xl/settings:w-full'>
      {hasEnvironment ? (
        <Tabs
          value={agentView ? 'agent' : 'values'}
          onValueChange={(view: string) => setAgentView(view === 'agent')}
        >
          <TabsList aria-label='Environment view' variant='segmented'>
            <TabsTab value='values'>Values</TabsTab>
            <TabsTab value='agent'>Agent view</TabsTab>
          </TabsList>
        </Tabs>
      ) : null}
      <div className='bg-muted flex flex-col rounded-lg'>
        {instances.map((instance) => (
          <ProviderRow
            agentView={agentView}
            key={instance.providerInstanceId}
            instance={instance}
          />
        ))}
      </div>
    </div>
  )
}
