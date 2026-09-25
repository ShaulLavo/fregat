import { lazy, Suspense } from 'react'

import { useStudioStore } from '@/lib/theme-studio/state/studio-store'

// The studio's code loads when it opens, never at boot.
const Dock = lazy(() =>
  import('@/features/theme-studio/components/dock').then((module) => ({ default: module.Dock })),
)

/** Where the theme studio docks: under the whole workspace, in either mode. */
export function ThemeStudioSlot() {
  const open = useStudioStore((state) => state.open)
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <Dock />
    </Suspense>
  )
}
