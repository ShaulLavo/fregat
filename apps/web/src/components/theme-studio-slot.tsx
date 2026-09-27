import { Drawer, DrawerContent } from '@workspace/ui/components/drawer'
import { lazy, Suspense } from 'react'

import { useStudioStore } from '@/lib/theme-studio/state/studio-store'

// The studio's code loads when it opens, never at boot.
const Dock = lazy(() =>
  import('@/features/theme-studio/components/dock').then((module) => ({ default: module.Dock })),
)

const EXPANDED = 1

// The dock's header is one bar; density and the phone shell each set their own bar height.
function collapsedSnapPoint() {
  const height = getComputedStyle(document.documentElement).getPropertyValue('--bar-height').trim()
  return /^[\d.]+(rem|px)$/u.test(height) ? height : '2.5rem'
}

/**
 * The theme studio over the bottom of the window. A drawer rather than a row of the layout, so
 * opening, collapsing and closing it never resizes the workspace behind it. It rests open or
 * tucked down to its header; Close, Escape or a flick down closes it.
 */
export function ThemeStudioSlot() {
  const open = useStudioStore((state) => state.open)
  const collapsed = useStudioStore((state) => state.collapsed)
  const collapsedPoint = collapsedSnapPoint()

  return (
    <Drawer
      disablePointerDismissal
      modal={false}
      open={open}
      snapPoint={collapsed ? collapsedPoint : EXPANDED}
      snapPoints={[collapsedPoint, EXPANDED]}
      onOpenChange={(next, details) => {
        if (next) return
        // A flick down asks the dock to close, which confirms unapplied edits first; until then the
        // drawer springs back. Other dismissals leave it as it is.
        details.cancel()
        if (details.reason === 'swipe') useStudioStore.getState().requestLeave()
      }}
      onSnapPointChange={(point) => {
        if (point !== null) useStudioStore.getState().setCollapsed(point !== EXPANDED)
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
