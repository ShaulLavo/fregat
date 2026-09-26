import type { ColorMode, ThemeBundle, ThemeId, ThemeVariantPatch } from '@workspace/contracts'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'
import { createContext } from 'react'

export type BundleContextValue = {
  /** The confirmed selection's id, or `null` when no bundle is selected. */
  readonly bundleId: ThemeId | null
  /** Every bundle that can be selected: bundled first, then the user library. */
  readonly catalog: readonly ThemeBundle[]
  readonly preview: (bundle: ThemeBundle, mode?: ColorMode) => void
  readonly clear: () => void
  readonly select: (bundle: ThemeBundle, initiator?: string) => SettingsSubmission
  /**
   * Selects `bundle` with both halves' changes in one write. `shown` stays on screen until the
   * write is confirmed, so the app does not flash the theme's own values in between.
   */
  readonly apply: (
    bundle: ThemeBundle,
    patches: Readonly<Record<ColorMode, ThemeVariantPatch | null>>,
    shown: ThemeBundle,
  ) => SettingsSubmission
}

export const BundleContext = createContext<BundleContextValue | null>(null)
