import { useIsMutating } from '@tanstack/react-query'
import type { PushDevice } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

import { InlineError } from '@/components/inline-error'
import { usePushRemove } from '@/features/settings/hooks/use-push-remove'
import { usePushTest } from '@/features/settings/hooks/use-push-test'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { pushDeviceDetail, pushDeviceTitle } from '@/features/settings/utils/push-device'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'

export function PushDeviceRow({
  device,
  isThisDevice,
}: {
  readonly device: PushDevice
  readonly isThisDevice: boolean
}) {
  const owner = useSettingsOwner()
  const test = usePushTest(device.id)
  const remove = usePushRemove(device.id, isThisDevice)
  const testing =
    useIsMutating({ mutationKey: settingsMutationKeys.push.test(device.id) }, owner) > 0
  const removing =
    useIsMutating({ mutationKey: settingsMutationKeys.push.remove(device.id) }, owner) > 0
  const detail = pushDeviceDetail(device)

  return (
    <li className='flex flex-col gap-2 py-2' data-push-device={device.id}>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 flex-1 flex-col' title={pushDeviceTitle(device, isThisDevice)}>
          <span className='text-foreground truncate text-sm'>{device.label}</span>
          <span className='text-muted-foreground text-2xs'>
            {isThisDevice ? 'This device · ' : ''}
            {detail.service} · <span className='font-mono'>{detail.registered}</span>
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-(--density-gap)'>
          {test.isSuccess && !testing ? (
            <span className='text-muted-foreground text-xs' role='status'>
              Sent
            </span>
          ) : null}
          <Button
            disabled={testing || removing}
            onClick={() => test.mutate()}
            size='sm'
            variant='outline'
          >
            {testing ? <Spinner label={`Sending a test to ${device.label}`} /> : null}
            Send test
          </Button>
          <Button
            disabled={testing || removing}
            onClick={() => remove.mutate()}
            size='sm'
            variant='ghost'
          >
            {removing ? <Spinner label={`Removing ${device.label}`} /> : null}
            Remove
          </Button>
        </div>
      </div>
      {test.isError && !testing ? (
        <InlineError
          message={clientErrorDescription(toClientError(test.error))}
          title={`Send test to ${device.label}`}
        />
      ) : null}
      {remove.isError && !removing ? (
        <InlineError
          message={clientErrorDescription(toClientError(remove.error))}
          title={`Remove ${device.label}`}
        />
      ) : null}
    </li>
  )
}
