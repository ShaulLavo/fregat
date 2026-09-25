import { useMutation } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { EnumWidget } from '@/features/settings/components/widgets/enum-widget'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'

export function NotificationModeWidget({
  disabled,
  onChange,
  options,
  value,
}: {
  disabled?: boolean
  onChange: (value: string) => void
  options: readonly string[]
  value: string
}) {
  const request = useMutation({
    mutationKey: settingsMutationKeys.notificationPermission(),
    mutationFn: () => Notification.requestPermission(),
  })
  const supported = typeof Notification !== 'undefined'
  const permission = request.data ?? (supported ? Notification.permission : 'denied')
  const native = value === 'notifications' || value === 'notifications-and-sound'
  return (
    <div className='flex flex-col items-start gap-(--density-gap)'>
      <EnumWidget
        id='chat.notificationMode'
        disabled={disabled}
        onChange={onChange}
        options={options}
        value={value}
      />
      {native && supported && permission === 'default' && (
        <Button
          variant='outline'
          size='sm'
          disabled={disabled || request.isPending}
          onClick={() => request.mutate()}
        >
          {request.isPending && <Spinner />} Allow notifications
        </Button>
      )}
      {native && supported && permission === 'denied' && (
        <span className='text-muted-foreground text-xs'>
          Allow notifications in your browser settings.
        </span>
      )}
      {native && !supported && (
        <span className='text-muted-foreground text-xs'>
          Native notifications are unavailable in this browser.
        </span>
      )}
      {request.isError && (
        <span className='text-destructive text-xs'>
          Notification permission could not be requested.
        </span>
      )}
    </div>
  )
}
