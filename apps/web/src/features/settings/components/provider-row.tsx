import type { ProviderInstanceConfig } from '@workspace/contracts'
import { Badge } from '@workspace/ui/components/badge'
import { Switch } from '@workspace/ui/components/switch'

import { ProviderValues } from '@/features/settings/components/provider-values'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'

export function ProviderRow({
  agentView,
  instance,
}: {
  agentView: boolean
  instance: ProviderInstanceConfig
}) {
  const { setProviderEnabled } = useSettingsActions()
  const label = instance.displayLabel ?? instance.providerInstanceId
  const binary = instance.binaryPath === '' ? 'Resolved from PATH' : instance.binaryPath

  return (
    <div className='flex flex-col gap-1 px-(--density-control-padding-x) py-(--density-section-gap)'>
      <div
        className='flex items-center gap-(--density-control-gap)'
        title={`${instance.providerInstanceId} · ${binary}`}
      >
        <span className='text-foreground min-w-0 flex-1 truncate text-sm'>{label}</span>
        <Badge variant='secondary'>{instance.driverKind}</Badge>
        <Switch
          aria-label={`Enable ${label}`}
          checked={instance.enabled}
          onCheckedChange={(checked) => setProviderEnabled(instance, checked)}
        />
      </div>
      <ProviderValues agentView={agentView} instance={instance} />
    </div>
  )
}
