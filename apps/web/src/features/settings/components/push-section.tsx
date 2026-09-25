import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'

import { PushDeviceRow } from '@/features/settings/components/push-device-row'
import { SettingRow } from '@/features/settings/components/setting-row'
import { PushLoading } from '@/features/settings/components/push-loading'
import { PushThisDevice } from '@/features/settings/components/push-this-device'
import { usePushDevices } from '@/features/settings/hooks/use-push-devices'
import { usePushThisDevice } from '@/features/settings/hooks/use-push-this-device'
import type { SettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { pushErrors } from '@/features/settings/utils/push-errors'

export function PushSection({ snapshot }: { readonly snapshot: SettingsProjection }) {
  const thisDevice = usePushThisDevice()
  const scopeTaken = thisDevice.data?.support === 'scope-taken'
  const listed = thisDevice.isSuccess && !scopeTaken
  const devices = usePushDevices(listed)

  return (
    <section
      aria-label='Push notifications'
      className='bg-muted mb-3 flex flex-col gap-3 rounded-lg p-3'
      data-push-section
    >
      <div className='space-y-1'>
        <h3 className='text-foreground text-sm font-medium'>Push notifications</h3>
        <p className='text-muted-foreground text-xs'>
          Each browser that should receive notices from this server turns push on for itself. Push
          session notifications then sends session notices to every device listed here, with every
          tab closed.
        </p>
      </div>
      <SettingRow id='chat.pushNotifications' snapshot={snapshot} />
      {thisDevice.isPending || (listed && devices.isPending) ? <PushLoading /> : null}
      {thisDevice.isError ? (
        <EmptyState
          align='start'
          description={pushErrors.UNSUPPORTED.fix}
          title={pushErrors.UNSUPPORTED.message}
          tone='warning'
        />
      ) : null}
      {scopeTaken ? (
        <EmptyState
          align='start'
          description={pushErrors.SCOPE_TAKEN.fix}
          title={pushErrors.SCOPE_TAKEN.message}
          tone='warning'
        />
      ) : null}
      {devices.isError ? (
        <EmptyState
          action={
            <Button onClick={() => void devices.refetch()} size='sm' variant='outline'>
              Retry
            </Button>
          }
          align='start'
          title='Push devices could not be loaded'
          tone='error'
        />
      ) : null}
      {thisDevice.data && devices.data ? (
        <PushThisDevice
          device={thisDevice.data}
          registered={devices.data.devices.some((device) => device.id === thisDevice.data.deviceId)}
        />
      ) : null}
      {devices.data && devices.data.devices.length === 0 ? (
        <EmptyState
          align='start'
          description='Turn push notifications on in each browser that should receive them.'
          title='No devices registered'
        />
      ) : null}
      {devices.data && devices.data.devices.length > 0 ? (
        <ul aria-label='Push devices' className='flex flex-col'>
          {devices.data.devices.map((device) => (
            <PushDeviceRow
              device={device}
              isThisDevice={device.id === thisDevice.data?.deviceId}
              key={device.id}
            />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
