import { Spinner } from '@workspace/ui/components/spinner'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

import { UpdatePopover } from '@/features/server-update/components/update-popover'
import { useLiveCheckToast } from '@/features/server-update/hooks/use-live-check-toast'
import { useUpdateApp } from '@/features/server-update/hooks/use-update-app'
import { updateFailureDescription } from '@/features/server-update/utils/failure-description'
import type { ReloadSafetyStore } from '@/lib/reload-safety'
import { NATIVE_WINDOW_NO_DRAG_CLASS } from '@/lib/platform/window-drag'

export function ServerUpdateStatus(
  props: { readonly safety?: ReloadSafetyStore; readonly reload?: () => void } = {},
) {
  const update = useUpdateApp(props)
  useLiveCheckToast(update.liveCheck)
  if (!update.currentTarget) return null

  const kind = update.intent.kind
  const working = update.progressLabel !== null
  let label = 'Update app'
  if (update.progressLabel) label = update.progressLabel
  else if (kind === 'reload' || update.currentTarget.stagedAt === null) label = 'Reload app'
  else if (kind === 'failed') label = 'Retry update'
  let tooltip = `Updates the app to ${update.currentTarget.release}.`
  if (update.progressLabel) tooltip = update.progressLabel
  if (update.intent.kind === 'failed') tooltip = updateFailureDescription(update.intent.reason)
  if (update.dirtyFiles.length > 0)
    tooltip += ` Save ${update.dirtyFiles.length} file${update.dirtyFiles.length === 1 ? '' : 's'} to reload the app.`
  else if (kind === 'waiting' && update.busy.length > 0)
    tooltip = `Waiting for ${update.busy.length} session${update.busy.length === 1 ? '' : 's'} to finish.`

  return (
    <div
      className={NATIVE_WINDOW_NO_DRAG_CLASS}
      data-server-update={working ? 'restarting' : 'staged'}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={working ? 0 : -1}
              className='focus-ring flex items-center gap-(--density-gap-tight)'
            />
          }
        >
          {working && <Spinner size='sm' label={label} />}
          <UpdatePopover
            open={kind === 'confirm'}
            onOpenChange={(open) => {
              if (!open && !update.pending) update.close()
            }}
            busy={update.busy}
            dirtyFiles={update.dirtyFiles}
            pending={update.pending}
            onWait={update.wait}
            onUpdate={update.updateNow}
          >
            <Button
              size='xs'
              variant='secondary'
              type='button'
              aria-busy={working}
              disabled={working}
              onClick={working ? undefined : update.request}
            >
              {label}
            </Button>
          </UpdatePopover>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </div>
  )
}
