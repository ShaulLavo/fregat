import type { TextSnapshot } from '@singapor/core'
import { updateStableHashCode } from '@workspace/client-core/address/path-hash'

export type TextSnapshotLineRange = {
  end: number
  start: number
  text: string
}

export function textSnapshotEqualsText(textSnapshot: TextSnapshot, text: string) {
  if (textSnapshot.length !== text.length) return false

  let equal = true
  textSnapshot.forEachTextChunk((chunk, start, end) => {
    if (!equal) return
    if (text.slice(start, end) === chunk) return

    equal = false
  })

  return equal
}

export function contentRevisionForText(text: string) {
  return contentRevision(text.length, textHash(0x811c9dc5, text))
}

export function fileContentRevision(fileVersion: string) {
  return `f:${fileVersion}`
}

export function textSnapshotLineRange(
  textSnapshot: TextSnapshot,
  row: number,
): TextSnapshotLineRange | null {
  if (row < 0) return null

  const start = textSnapshotRowStartOffset(textSnapshot, row)
  if (start > textSnapshot.length) return null

  const rawEnd = nextTextSnapshotLineBreak(textSnapshot, start) ?? textSnapshot.length
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

function textSnapshotRowStartOffset(textSnapshot: TextSnapshot, row: number) {
  let remainingRows = row
  let result: number | null = null

  textSnapshot.forEachTextChunk((text, start) => {
    if (result !== null) return

    const offset = rowStartOffsetInChunk(text, remainingRows)
    if (offset === null) {
      remainingRows -= lineBreakCount(text)
      return
    }

    result = start + offset
  })

  if (result !== null) return result
  if (remainingRows === 0) return textSnapshot.length

  return textSnapshot.length + 1
}

function rowStartOffsetInChunk(text: string, row: number) {
  if (row === 0) return 0

  let remainingRows = row
  let offset = 0
  while (offset < text.length) {
    const nextLine = text.indexOf('\n', offset)
    if (nextLine === -1) return null

    remainingRows -= 1
    if (remainingRows === 0) return nextLine + 1

    offset = nextLine + 1
  }

  return null
}

function nextTextSnapshotLineBreak(textSnapshot: TextSnapshot, startOffset: number) {
  let result: number | null = null

  textSnapshot.forEachTextChunk((text, chunkStart) => {
    if (result !== null) return

    const localStart = Math.max(0, startOffset - chunkStart)
    if (localStart >= text.length) return

    const nextLine = text.indexOf('\n', localStart)
    if (nextLine === -1) return

    result = chunkStart + nextLine
  })

  return result
}

function lineBreakCount(text: string) {
  let count = 0
  let offset = 0
  while (offset < text.length) {
    const nextLine = text.indexOf('\n', offset)
    if (nextLine === -1) return count

    count += 1
    offset = nextLine + 1
  }

  return count
}
