import type { TextReadSnapshot } from '@singapore-editor/core/document'

/** Length first, then chunk by chunk: a mismatch stops early and no document string is built. */
export function textSnapshotEqualsText(textSnapshot: TextReadSnapshot, text: string) {
  if (textSnapshot.length !== text.length) return false

  let equal = true
  textSnapshot.forEachTextChunk((chunk, start, end) => {
    if (!equal) return
    if (text.slice(start, end) === chunk) return

    equal = false
  })

  return equal
}
