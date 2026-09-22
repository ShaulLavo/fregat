type SnapshotOfferState = {
  readonly active: boolean
  readonly dirty: boolean
  readonly hasRecord: boolean
  readonly matchesTarget: boolean
  readonly themeReady: boolean
  readonly versionMatches: boolean
}

/** Why a cached paint is not handed to the editor, in the order the checks would fail. */
export function snapshotWithheldReason(state: SnapshotOfferState): string | null {
  if (!state.active) return 'inactive'
  if (!state.hasRecord) return 'no-record'
  if (!state.matchesTarget) return 'other-document'
  if (!state.themeReady) return 'theme-pending'
  if (state.dirty) return 'dirty'
  if (!state.versionMatches) return 'content-changed'
  return null
}
