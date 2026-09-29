import type { JumpCause } from './jumpHistory'
import type { SelectionAffinity } from '../selections'
import type { RevealBlock } from '../virtualization/virtualizedTextViewInternals'

export type EditorSetSelectionOptions = {
  readonly jumpCause?: JumpCause
  readonly affinity?: SelectionAffinity
  readonly reveal?: boolean
  readonly revealBlock?: RevealBlock
  readonly revealOffset?: number
}

export function selectionRevealOffset(
  options: EditorSetSelectionOptions | undefined,
  fallback: number | undefined,
  revealByDefault: boolean,
): number | undefined {
  if (options?.revealOffset !== undefined) return options.revealOffset
  if (options?.reveal === false) return undefined
  if (!options?.reveal && !revealByDefault) return undefined

  return fallback
}
