import { toast } from 'sonner'
import type { SettingsStreamStop } from '@workspace/client-core/settings/stream'
import { clientErrorDescription } from '@/lib/client-error-taxonomy'
import { toastError } from '@/lib/toast-error'

const SETTINGS_STREAM_STOPPED_TOAST = 'settings-stream-stopped'
const SETTINGS_STREAM_STOPPED_TITLE = 'Settings stopped syncing'

/** Stays up until acted on: without it, changes from the server silently stop reaching this tab. */
export function notifySettingsStreamStopped(stop: SettingsStreamStop, retry: () => void) {
  const unreadable = stop.reason === 'unreadable'
  const description = unreadable
    ? clientErrorDescription({
        message: stop.message ?? 'This tab cannot read the settings the server sent',
        fix: stop.fix,
      })
    : clientErrorDescription({
        message: `The server did not answer ${stop.failureCount} reconnect attempts`,
        fix: 'Retry to reconnect and load the changes made meanwhile.',
      })
  toastError(
    SETTINGS_STREAM_STOPPED_TITLE,
    {
      id: SETTINGS_STREAM_STOPPED_TOAST,
      description,
      duration: Infinity,
      action: unreadable
        ? { label: 'Reload', onClick: () => window.location.reload() }
        : { label: 'Retry', onClick: retry },
    },
    { code: stop.code, why: stop.why, fix: stop.fix },
  )
}

export function dismissSettingsStreamStopped() {
  toast.dismiss(SETTINGS_STREAM_STOPPED_TOAST)
}
