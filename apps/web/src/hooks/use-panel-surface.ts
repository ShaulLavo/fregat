import { useSettingValue } from '@/hooks/use-setting-value'
import { PANEL_GLASS, PANEL_SURFACE } from '@workspace/ui/patterns/panel-surface'

/**
 * Where the panel surface gets painted, which is the whole difference between
 * the two seam looks. Resize handles are transparent, so painting each panel
 * leaves the wallpaper showing in the gap, and painting the region around them
 * carries one surface across it. Exactly one of the two ever paints; the region
 * always holds the glass, so every panel reads one blur of the wallpaper.
 */
export function usePanelSurface() {
  const continuous = useSettingValue('workbench.surface.continuousSeams')

  return {
    panel: continuous ? undefined : PANEL_SURFACE,
    region: continuous ? `${PANEL_GLASS} ${PANEL_SURFACE}` : PANEL_GLASS,
  }
}
