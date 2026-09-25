import type { StudioTab } from '@/lib/theme-studio/state/studio-store'

/** The studio's tabs in order; a tab appears here once it has a body. */
export const STUDIO_TABS: readonly { readonly id: StudioTab; readonly label: string }[] = [
  { id: 'themes', label: 'Themes' },
]
