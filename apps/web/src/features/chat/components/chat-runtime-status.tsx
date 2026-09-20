import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import { chatRuntimeAlerts, type ChatRuntimeAlert } from '@/features/chat/utils/runtime-state'
import { errorMessage } from '@/lib/error-message'
import { useProviderSignInDialog } from '../hooks/use-provider-sign-in-dialog'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import type { ChatSession } from '@workspace/client-core/chat/types'

// Keep the most urgent error visible; additional provider notices remain expandable.
export function ChatRuntimeStatus({
  commandFailure,
  session,
}: {
  commandFailure: string | null
  session: ChatSession
}) {
  const { openSignIn } = useProviderSignInDialog()
  const providersQuery = useQuery(providerListQueryOptions())
  const [dismissedKeys, setDismissedKeys] = useState<readonly string[]>([])
  const [expanded, setExpanded] = useState(false)
  const provider = providersQuery.data?.providers.find(
    (candidate) => candidate.providerInstanceId === session.modelSelection.providerInstanceId,
  )
  const alerts = chatRuntimeAlerts({
    commandFailure,
    provider,
    providerError: providersQuery.error
      ? errorMessage(providersQuery.error, 'Provider request failed.')
      : null,
    providerLoading: providersQuery.isLoading,
    session,
  }).filter((alert) => !alert.dismissKey || !dismissedKeys.includes(alert.dismissKey))

  const [front, ...folded] = alerts
  if (!front) return null

  function dismiss(alert: ChatRuntimeAlert) {
    if (!alert.dismissKey) return

    const dismissKey = alert.dismissKey
    setDismissedKeys((keys) => (keys.includes(dismissKey) ? keys : [...keys, dismissKey]))
  }

  return (
    <div
      aria-label='Runtime notices'
      className='shrink-0 px-(--density-control-padding-x) pt-(--density-control-padding-x)'
      role='status'
    >
      <div className='mx-auto max-w-3xl space-y-(--density-control-gap)'>
        <RuntimeAlert alert={front} onDismiss={dismiss} onSignIn={openSignIn} />
        {folded.length === 0 ? null : (
          <Button
            aria-expanded={expanded}
            className='text-muted-foreground hover:text-foreground text-2xs px-1.5 font-normal'
            size='xs'
            type='button'
            variant='ghost'
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? 'Hide' : 'Show'} {folded.length} more{' '}
            {folded.length === 1 ? 'notice' : 'notices'}
          </Button>
        )}
        {expanded
          ? folded.map((alert) => (
              <RuntimeAlert
                alert={alert}
                key={alert.id}
                onDismiss={dismiss}
                onSignIn={openSignIn}
              />
            ))
          : null}
      </div>
    </div>
  )
}

function RuntimeAlert({
  alert,
  onDismiss,
  onSignIn,
}: {
  readonly alert: ChatRuntimeAlert
  readonly onDismiss: (alert: ChatRuntimeAlert) => void
  readonly onSignIn: (target: NonNullable<ChatRuntimeAlert['signIn']>) => void
}) {
  const signIn = alert.signIn

  return (
    <Alert variant={alert.tone === 'error' ? 'destructive' : 'warning'}>
      <WarningCircleIcon className='size-(--icon-size)' />
      <AlertTitle>{alert.title}</AlertTitle>
      {alert.detail ? (
        <AlertDescription className='line-clamp-3 tabular-nums' title={alert.detail}>
          {alert.detail}
        </AlertDescription>
      ) : null}
      {signIn || alert.dismissKey ? (
        <AlertAction className='flex items-center gap-1'>
          {signIn ? (
            <Button onClick={() => onSignIn(signIn)} size='xs' type='button' variant='outline'>
              Sign in
            </Button>
          ) : null}
          {alert.dismissKey ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`Dismiss ${alert.title}`}
                    onClick={() => onDismiss(alert)}
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    <XIcon className='size-(--icon-size-sm)' />
                  </Button>
                }
              />
              <TooltipContent>{`Dismiss ${alert.title}`}</TooltipContent>
            </Tooltip>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  )
}
