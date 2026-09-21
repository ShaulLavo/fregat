import { GearSixIcon } from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { useCallback, useRef } from 'react'

import { DeferredSettingsPage } from '@/features/settings/components/deferred-page'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

/**
 * Settings with no folder open.
 *
 * With a folder, settings are an editor tab — both layouts render the same
 * `CodePanel`, so one surface covers workbench and chat mode. Without one there
 * is no tab strip to put a tab in, and that is exactly when first-run provider
 * setup happens, so this shell exists to be reachable and, unlike a bare
 * full-screen surface, to have a way out.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { ref: focusTargetRef } = useFocusTarget<HTMLDivElement>({
    area: 'settings',
    capabilities: { overlay: true },
    id: { kind: 'settings-dialog' },
    onIntent: (intent) => {
      if (intent !== 'focus') return false

      const target =
        rootRef.current?.querySelector<HTMLInputElement>('input[aria-label="Search settings"]') ??
        rootRef.current
      if (!target) return false

      target.focus()
      return true
    },
  })
  // The closed dialog must not remain a live overlay target.
  const setRootRef = useCallback(
    (element: HTMLDivElement | null) => {
      rootRef.current = element
      focusTargetRef(open ? element : null)
    },
    [focusTargetRef, open],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='flex h-dvh w-full max-w-none flex-col gap-0 overflow-hidden p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:h-[min(720px,calc(100svh-4rem))] sm:w-[min(880px,calc(100vw-3rem))] sm:max-w-none sm:py-0 max-sm:[&>[data-slot=dialog-close]]:top-[max(0.5rem,env(safe-area-inset-top))] max-sm:[&>[data-slot=dialog-close]]:size-(--icon-size)'
        finalFocus={false}
        ref={setRootRef}
        tabIndex={-1}
      >
        <DialogHeader className='p-(--density-section-padding) max-sm:shrink-0 max-sm:pr-14'>
          <DialogTitle className='flex items-center gap-(--density-control-gap)'>
            <span className='bg-info/10 text-info flex size-(--density-control-height-sm) items-center justify-center rounded-md'>
              <GearSixIcon weight='duotone' />
            </span>
            Settings
          </DialogTitle>
          <DialogDescription>
            Providers, models, and keybindings for this machine.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open so the settings query is not held warm — and
            so closing the dialog discards any half-typed provider config. */}
        {open ? <DeferredSettingsPage /> : null}
      </DialogContent>
    </Dialog>
  )
}
