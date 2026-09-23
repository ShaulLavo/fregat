import type { TextReadSnapshot } from '@singapore-editor/core/document'
import { updateStableHashCode } from '@workspace/client-core/address/path-hash'

export type TextSnapshotLineRange = {
  end: number
  start: number
  text: string
}

export function contentRevisionForText(text: string) {
  return contentRevision(text.length, textHash(0x811c9dc5, text))
}

export function fileContentRevision(fileVersion: string) {
  return `f:${fileVersion}`
}

export function textSnapshotLineRange(
  textSnapshot: TextReadSnapshot,
  row: number,
): TextSnapshotLineRange | null {
  if (row < 0 || row >= textSnapshot.lineCount) return null

  const { start, end: rawEnd } = textSnapshot.lineRange(row)
  const end =
    rawEnd > start && textSnapshot.readRange(rawEnd - 1, rawEnd) === '\r' ? rawEnd - 1 : rawEnd

  return {
    end,
    start,
    text: textSnapshot.readRange(start, end),
  }
}

function textHash(initialHash: number, text: string) {
  let hash = initialHash
  for (let index = 0; index < text.length; index += 1) {
    hash = updateStableHashCode(hash, text.charCodeAt(index))
  }

  return hash
}

function contentRevision(length: number, hash: number) {
  return `h:${length.toString(36)}:${(hash >>> 0).toString(36)}`
}
