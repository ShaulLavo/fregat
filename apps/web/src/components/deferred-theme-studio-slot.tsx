import { DeferredOverlay } from '@/components/deferred-overlay'
import { themeStudioSlotModuleQueryOptions } from '@/components/utils/overlay-modules'
import { useStudioStore } from '@/lib/theme-studio/state/studio-store'

/** The theme studio drawer, downloaded when the studio first opens or when the page is idle. */
export function DeferredThemeStudioSlot() {
  const open = useStudioStore((state) => state.open)

  return (
    <DeferredOverlay
      label='theme studio'
      module={themeStudioSlotModuleQueryOptions}
      open={open}
      onClose={() => useStudioStore.getState().closeStudio()}
    >
      {({ ThemeStudioSlot }) => <ThemeStudioSlot />}
    </DeferredOverlay>
  )
}
