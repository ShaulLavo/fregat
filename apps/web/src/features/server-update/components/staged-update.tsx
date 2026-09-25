import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useIsMutating } from '@tanstack/react-query'
import { selectServerConnection } from '@workspace/client-core/environments/state/store'
import type { BusySession, ServerUpdate, SessionId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { useState } from 'react'

import { RestartDialog } from '@/features/server-update/components/restart-dialog'
import { useRestart } from '@/features/server-update/hooks/use-restart'
import { serverUpdateMutationKeys } from '@/features/server-update/utils/mutation-keys'
import { notifyMutationError } from '@/features/server-update/utils/notify-mutation-error'
import {
  isRestartDisconnect,
  showsRestarting,
  type RestartMarker,
} from '@/features/server-update/utils/restart-outcome'
import { restartTooltip } from '@/features/server-update/utils/restart-prompt'
import { primaryServerOrigin } from '@/lib/client'
import { clientErrorText } from '@/lib/client-error-taxonomy'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { NATIVE_WINDOW_NO_DRAG_CLASS } from '@/lib/platform/window-drag'

/** "Update available" with Restart; a busy answer opens the confirmation that names the sessions. */
export function StagedUpdate({ update, release }: { update: ServerUpdate; release: string }) {
  const restart = useRestart()
  const pending =
    useIsMutating({ mutationKey: serverUpdateMutationKeys.restart() }, primaryQueryClient()) > 0
  const connection = useEnvironmentsStore((state) =>
    selectServerConnection(state, primaryServerOrigin()),
  )
  const [busy, setBusy] = useState<readonly BusySession[] | null>(null)
  const [marker, setMarker] = useState<RestartMarker | null>(null)
  const restarting = showsRestarting(update, marker, connection)
  let dialogError: string | null = null
  if (busy && restart.isError && !isRestartDisconnect(restart.error))
    dialogError = clientErrorText(restart.error, 'Restart failed')

  // The server pushes `restarting` itself; the marker covers a push lost to the exit.
  function markRestarting(instance: string | null, confirmed: boolean) {
    const latest = useEnvironmentsStore.getState().updateByOrigin[primaryServerOrigin()]
    setBusy(null)
    if (latest) setMarker({ update: latest, instance, confirmed })
  }

  function send(interrupt: SessionId[], onFailure: (error: Error) => void) {
    const instance = connection.serverInstanceId
    restart.mutate(interrupt, {
      onSuccess: (result) => {
        if (result.restarting) markRestarting(instance, true)
        else setBusy(result.busy)
      },
      onError: (error) => {
        if (isRestartDisconnect(error)) markRestarting(instance, false)
        else onFailure(error)
      },
    })
  }

  function requestRestart() {
    send([], notifyMutationError)
  }

  // The open dialog renders its own failure.
  function confirmRestart(interrupt: SessionId[]) {
    send(interrupt, () => {})
  }

  function cancel() {
    setBusy(null)
    restart.reset()
  }

  return (
    <div
      className={cn(
        NATIVE_WINDOW_NO_DRAG_CLASS,
        'flex shrink-0 items-center gap-(--density-gap-tight)',
      )}
      data-server-update={restarting ? 'restarting' : 'staged'}
    >
      {restarting ? (
        <>
          <Spinner label='Restarting server' size='xs' />
          <span className='text-muted-foreground text-xs'>Restarting…</span>
        </>
      ) : (
        <>
          <span className='text-xs'>Update available</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  disabled={pending}
                  onClick={requestRestart}
                  size='xs'
                  type='button'
                  variant='secondary'
                >
                  {pending && !busy ? <Spinner /> : <ArrowClockwiseIcon data-icon='inline-start' />}
                  Restart
                </Button>
              }
            />
            <TooltipContent>{restartTooltip(release)}</TooltipContent>
          </Tooltip>
        </>
      )}
      <RestartDialog
        busy={restarting ? null : busy}
        error={dialogError}
        onCancel={cancel}
        onConfirm={confirmRestart}
        pending={pending}
      />
    </div>
  )
}
