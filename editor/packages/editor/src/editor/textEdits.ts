import type { TextReadSnapshot } from '../documentTextSnapshot'
import { forEachTextWindow, forEachTextWindowBackward } from '../textWindows'
import type { TextEdit } from '../tokens'

/** The one replacement turning `current` into `next`; empty (`from === to`, no text) when equal. */
export function syncTextEdit(current: TextReadSnapshot, next: string): TextEdit {
  const prefixLength = commonPrefixLength(current, next)
  const suffixLength = commonSuffixLength(current, next, prefixLength)
  const currentEnd = current.length - suffixLength
  const nextEnd = next.length - suffixLength

  return {
    from: prefixLength,
    to: currentEnd,
    text: next.slice(prefixLength, nextEnd),
  }
}

function commonPrefixLength(current: TextReadSnapshot, next: string): number {
  const maxLength = Math.min(current.length, next.length)
  let length = 0
  forEachTextWindow(current, 0, maxLength, (text, offset) => {
    let index = 0
    while (index < text.length && text.charCodeAt(index) === next.charCodeAt(offset + index)) {
      index += 1
    }
    length = offset + index
    return index === text.length
  })
  return length
}

function commonSuffixLength(current: TextReadSnapshot, next: string, prefixLength: number): number {
  const maxLength = Math.min(current.length, next.length) - prefixLength
  const shift = next.length - current.length
  let length = 0
  forEachTextWindowBackward(current, current.length - maxLength, current.length, (text, offset) => {
    let index = text.length - 1
    while (index >= 0 && text.charCodeAt(index) === next.charCodeAt(offset + index + shift)) {
      index -= 1
    }
    length = current.length - (offset + index + 1)
    return index < 0
  })
  return length
}
