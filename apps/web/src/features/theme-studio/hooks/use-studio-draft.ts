import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useStudioStore } from '@/lib/theme-studio/state/studio-store'
import { DEFAULT_THEME_ID, draftsEqual, savedDraft } from '@/features/theme-studio/utils/draft'

/** The draft on screen, the saved theme it started from, and whether they differ. */
export function useStudioDraft() {
  const bundles = useBundles()
  const customizations = useSettingValue('workbench.theme.customizations')
  const stored = useStudioStore((state) => state.draft)
  // With no theme chosen the app wears Graphite's colors, so that is where the studio starts.
  const theme =
    bundles.catalog.find((entry) => entry.id === (bundles.bundleId ?? DEFAULT_THEME_ID)) ??
    bundles.catalog[0]
  const saved = theme ? savedDraft(theme, customizations) : null
  const draft = stored ?? saved
  return { draft, saved, customizations, dirty: !draftsEqual(draft, saved) }
}
