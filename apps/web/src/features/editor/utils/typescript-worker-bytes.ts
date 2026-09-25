import type { TextEdit, TextReadSnapshot } from '@singapore-editor/core/document'
const encoder = new TextEncoder()
export function textBytes(text: string) {
  return encoder.encode(text).byteLength
}

export function snapshotBytes(snapshot: TextReadSnapshot): number {
  let bytes = 0
  for (let start = 0; start < snapshot.length;) {
    let end = Math.min(snapshot.length, start + 65_536)
    if (end < snapshot.length && /[\uD800-\uDBFF]/.test(snapshot.readRange(end - 1, end))) end--
    bytes += textBytes(snapshot.readRange(start, end))
    start = end
  }
  return bytes
}

/** Neighboring code units participate when an edit joins or splits a surrogate pair. */
export function editedByteDelta(before: TextReadSnapshot, edits: readonly TextEdit[]): number {
  const groups: { start: number; end: number; edits: TextEdit[] }[] = []
  for (const edit of edits.toSorted((a, b) => a.from - b.from)) {
    const start = Math.max(0, edit.from - 1)
    const end = Math.min(before.length, edit.to + 1)
    const previous = groups.at(-1)
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end)
      previous.edits.push(edit)
      continue
    }
    groups.push({ start, end, edits: [edit] })
  }
  let delta = 0
  for (const group of groups) {
    const source = before.readRange(group.start, group.end)
    let text = source
    for (const edit of group.edits.toReversed())
      text = text.slice(0, edit.from - group.start) + edit.text + text.slice(edit.to - group.start)
    delta += textBytes(text) - textBytes(source)
  }
  return delta
}
