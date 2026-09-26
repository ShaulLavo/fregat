import { useIsMutating } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Spinner } from '@workspace/ui/components/spinner'

import { InlineError } from '@/components/inline-error'
import { usePushSubscribe } from '@/features/settings/hooks/use-push-subscribe'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import type { ThisDevice } from '@/features/settings/utils/push-browser'
import { thisDeviceBlocker } from '@/features/settings/utils/push-device'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'

/** This browser's control: why it cannot, that it already does, or the button that turns it on. */
export function PushThisDevice({
  device,
  registered,
}: {
  readonly device: ThisDevice
  readonly registered: boolean
}) {
  const owner = useSettingsOwner()
  const subscribe = usePushSubscribe()
  const pending = useIsMutating({ mutationKey: settingsMutationKeys.push.subscribe }, owner) > 0
  const blocker = thisDeviceBlocker(device)

  if (blocker)
    return (
      <EmptyState align='start' description={blocker.fix} title={blocker.message} tone='warning' />
    )
  if (registered)
    return <p className='text-muted-foreground text-xs'>This device receives push notifications.</p>

  return (
    <div className='flex flex-col items-start gap-(--density-gap)'>
      <Button disabled={pending} onClick={() => subscribe.mutate()} size='sm' variant='outline'>
        {pending ? <Spinner label='Turning on push notifications' /> : null}
        Turn on for this device
      </Button>
      {subscribe.isError && !pending ? (
        <InlineError
          message={clientErrorDescription(toClientError(subscribe.error))}
          title='Turn on push notifications'
        />
      ) : null}
    </div>
  )
}
