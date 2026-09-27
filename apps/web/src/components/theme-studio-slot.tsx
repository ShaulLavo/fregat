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
 * tucked down to its header; the header's Close is the only way out.
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
      // A quick flick down stops at the header; skipping it would read as a close request.
      snapToSequentialPoints
      snapPoint={collapsed ? collapsedPoint : EXPANDED}
      snapPoints={[collapsedPoint, EXPANDED]}
      onOpenChange={(next, details) => {
        if (next) return
        // Closing, with its discard confirmation, is the dock's; a swipe past the header rests there.
        details.cancel()
        if (details.reason === 'swipe') useStudioStore.getState().setCollapsed(true)
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
