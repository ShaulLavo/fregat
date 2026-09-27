import { Drawer, DrawerContent } from '@workspace/ui/components/drawer'
import { lazy, Suspense } from 'react'

import { useStudioStore } from '@/lib/theme-studio/state/studio-store'

// The studio's code loads when it opens, never at boot.
const Dock = lazy(() =>
  import('@/features/theme-studio/components/dock').then((module) => ({ default: module.Dock })),
)

/**
 * The theme studio over the bottom of the window. A drawer rather than a row of the layout, so
 * opening, collapsing and closing it never resizes the workspace behind it.
 */
export function ThemeStudioSlot() {
  const open = useStudioStore((state) => state.open)

  return (
    <Drawer
      disablePointerDismissal
      modal={false}
      open={open}
      onOpenChange={(next, details) => {
        if (next) return
        // Closing, with its discard confirmation, is the dock's; a swipe down only tucks it away.
        details.cancel()
        if (details.reason === 'swipe') useStudioStore.getState().setCollapsed(true)
      }}
    >
      <DrawerContent aria-label='Theme studio' finalFocus={false} initialFocus={false}>
        <Suspense fallback={null}>
          <Dock />
        </Suspense>
      </DrawerContent>
    </Drawer>
  )
}
