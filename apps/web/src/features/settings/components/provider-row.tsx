import type { ProviderInstanceConfig } from '@workspace/contracts'
import { Badge } from '@workspace/ui/components/badge'
import { Switch } from '@workspace/ui/components/switch'

import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'

export function ProviderRow({ instance }: { instance: ProviderInstanceConfig }) {
  const { setProviderEnabled } = useSettingsActions()
  const label = instance.displayLabel ?? instance.providerInstanceId

  return (
    <div className='border-border flex items-center gap-(--density-control-gap) border-b px-(--density-control-padding-x) py-(--density-section-gap) last:border-b-0'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='text-foreground truncate text-sm'>{label}</span>
        <span className='text-muted-foreground truncate text-xs'>
          {instance.binaryPath === '' ? 'Resolved from PATH' : instance.binaryPath}
        </span>
      </div>
      <Badge variant='secondary'>{instance.driverKind}</Badge>
      <Switch
        aria-label={`Enable ${label}`}
        checked={instance.enabled}
        onCheckedChange={(checked) => setProviderEnabled(instance, checked)}
      />
    </div>
  )
}
