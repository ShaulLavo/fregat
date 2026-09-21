const TURN_FILE_STATUSES = ['added', 'deleted', 'renamed'] as const

/** A checkpoint's `kind` is an open string; anything unrecognized reads as modified. */
export function turnFileStatus(kind: string) {
  return TURN_FILE_STATUSES.find((status) => status === kind) ?? 'modified'
}
