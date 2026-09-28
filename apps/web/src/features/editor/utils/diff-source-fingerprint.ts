import type { DiffFile } from '@singapore-editor/diff'
import { updateStableHashCode } from '@workspace/client-core/address/path-hash'

export type DiffSourceSide = 'old' | 'new'

/**
 * Names one side's syntax input: its language and text. Line count and length ride beside the
 * FNV-1a hash so two texts must agree on all three to share prepared tokens.
 */
export function diffSourceFingerprint(file: DiffFile, side: DiffSourceSide): string {
  const lines = side === 'old' ? file.oldLines : file.newLines
  let hash = 0x811c9dc5
  let length = 0
  for (const line of lines) {
    for (let index = 0; index < line.length; index += 1) {
      hash = updateStableHashCode(hash, line.charCodeAt(index))
    }
    hash = updateStableHashCode(hash, 10)
    length += line.length + 1
  }
  const language = file.languageId ?? file.path
  return `${language}\u0000${lines.length}:${length}:${(hash >>> 0).toString(36)}`
}
