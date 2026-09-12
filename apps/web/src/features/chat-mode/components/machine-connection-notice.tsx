import { XIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useStore } from 'zustand'
import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'
import { Button } from '@workspace/ui/components/button'
import { MachineErrorDetails } from '@/components/machine-error-details'
import { Phase } from '@/lib/environments/components/phase'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import {
  connectionNoticeDismissed,
  connectionNoticeSummary,
  connectionPending,
} from '@/lib/environments/utils/connection-notice'
import { errorMessage } from '@/lib/error-message'

export function MachineConnectionNotice({
  id,
  label,
  phase,
  error,
  disabled,
  retry,
}: {
  id: string
  label: string
  phase: EnvironmentPhase
  error: string | null
  disabled: boolean
  retry: () => Promise<unknown>
}) {
  const { notices } = useEnvironmentConnections()
  const dismissed = useStore(notices.store, (state) =>
    connectionNoticeDismissed(state.dismissed, id, phase, error),
  )
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  if (dismissed) return null
  const pending = retrying || connectionPending(phase)
  const details = retryError ?? error

  async function retryConnection() {
    notices.reset(id)
    setRetrying(true)
    setRetryError(null)
    try {
      await retry()
    } catch (error) {
      setRetryError(errorMessage(error, `Could not reconnect ${label}.`))
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className='border-border bg-muted/40 flex min-w-0 items-center gap-1 rounded-md border px-2 py-1 text-xs'>
      <Phase phase={retrying ? 'connecting' : phase} label={label} />
      <span className='min-w-0 flex-1 truncate' role='status' title={label}>
        {label} · {connectionNoticeSummary(phase, details)}
      </span>
      {details ? <MachineErrorDetails label={label} error={details} /> : null}
      <Button
        size='xs'
        variant='ghost'
        disabled={disabled || pending}
        title={disabled ? 'Reconnect from the desktop app' : undefined}
        onClick={() => void retryConnection()}
      >
        {phase === 'idle' ? 'Connect' : 'Retry'}
      </Button>
      <Button
        size='icon-xs'
        variant='ghost'
        aria-label={`Dismiss ${label} connection notice`}
        onClick={() => notices.dismiss(id, error)}
      >
        <XIcon className='size-3' />
      </Button>
    </div>
  )
}
