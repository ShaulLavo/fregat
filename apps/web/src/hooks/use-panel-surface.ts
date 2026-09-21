import { useSettingValue } from '@/hooks/use-setting-value'
import { PANEL_SURFACE } from '@workspace/ui/patterns/panel-surface'

/**
 * Where the panel surface gets painted, which is the whole difference between
 * the two seam looks. Resize handles are transparent, so painting each panel
 * leaves the wallpaper showing in the gap, and painting the region around them
 * carries one surface across it. Exactly one of the two is ever set.
 */
export function usePanelSurface() {
  const continuous = useSettingValue('workbench.surface.continuousSeams')

  return {
    panel: continuous ? undefined : PANEL_SURFACE,
    region: continuous ? PANEL_SURFACE : undefined,
  }
}
