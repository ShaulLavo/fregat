import type { ColorMode, ThemeBundle, ThemeId } from '@workspace/contracts'
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
}

export const BundleContext = createContext<BundleContextValue | null>(null)
