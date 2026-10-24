import { Kind } from 'tree-sitter-md'
import type { TextReadSnapshot, TextEdit } from '@singapore-editor/core/document'
import type { EditorSelectionRange } from '@singapore-editor/core/extensions'
import type { MarkdownEdit } from './authoring'

type Mark = { readonly start: number; readonly end: number; readonly width: number }
type Range = { readonly low: number; readonly high: number }

const OPAQUE_KINDS: ReadonlySet<number> = new Set([
  Kind.CodeSpan,
  Kind.HtmlInline,
  Kind.Link,
  Kind.Image,
])

export function markEdit(
  source: TextReadSnapshot,
  selection: EditorSelectionRange,
  kind: number,
  marker: string,
  records: Uint32Array,
): MarkdownEdit {
  const { low, high } = formattableRange(source, records, selection)
  const marks = selectedMarks(source, records, kind, low, high)
  if (marks.length) return removeMarks(source, selection, { low, high }, marks, marker)
  const edits: TextEdit[] = []
  const first = source.lineAt(low)
  const last = source.lineAt(high > low ? high - 1 : high)
  for (let line = first; line <= last; line++) {
    const range = source.lineRange(line)
    const from = Math.max(low, range.start)
    const to = Math.min(high, range.end)
    const text = source.readRange(from, to)
    if (!text.trim()) continue
    const leading = text.length - text.trimStart().length
    const trailing = text.length - text.trimEnd().length
    edits.push({ from: from + leading, to: from + leading, text: marker })
    edits.push({ from: to - trailing, to: to - trailing, text: marker })
  }
  if (!edits.length && low === high) {
    return {
      edits: [{ from: low, to: high, text: marker + 'text' + marker }],
      selection: { anchor: low + marker.length, head: low + marker.length + 4 },
    }
  }
  return { edits, selection: mappedSelection(selection, edits) }
}

// Delimiters inside code, raw HTML or a link destination never parse as emphasis, so each press
// would stack more. An end inside one moves to its edge; only a bracketed label stays open.
function formattableRange(
  source: TextReadSnapshot,
  records: Uint32Array,
  selection: EditorSelectionRange,
): Range {
  let low = Math.min(selection.anchor, selection.head)
  let high = Math.max(selection.anchor, selection.head)
  const labels = new Map<number, number>()
  for (let index = 0; index < records.length; index += 4) {
    if (records[index + 2] === Kind.LinkText) labels.set(records[index]!, records[index + 1]!)
  }
  for (let index = 0; index < records.length; index += 4) {
    const kind = records[index + 2]!
    if (!OPAQUE_KINDS.has(kind)) continue
    const start = records[index]!,
      end = records[index + 1]!
    const labelFrom = labelStart(source, kind, start)
    const labelTo = labelFrom === null ? undefined : labels.get(labelFrom)
    const opaque = (offset: number) =>
      start < offset &&
      offset < end &&
      (labelTo === undefined || offset < labelFrom! || offset > labelTo)
    const lowInside = opaque(low)
    if (opaque(high)) high = end
    if (lowInside) low = start
  }
  return { low, high }
}

function labelStart(source: TextReadSnapshot, kind: number, start: number): number | null {
  if (kind === Kind.Link) return source.readRange(start, start + 1) === '[' ? start + 1 : null
  if (kind === Kind.Image) return start + 2
  return null
}

function selectedMarks(
  source: TextReadSnapshot,
  records: Uint32Array,
  kind: number,
  low: number,
  high: number,
): Mark[] {
  const marks: Mark[] = []
  for (let index = 0; index < records.length; index += 4) {
    const start = records[index]!,
      end = records[index + 1]!
    if (records[index + 2] !== kind) continue
    const width = markWidth(source, kind, start)
    const intersects =
      low === high ? start <= low && low < end : start + width < high && end - width > low
    if (intersects) marks.push({ start, end, width })
  }
  if (low !== high) return marks
  return marks.sort((a, b) => a.end - a.start - (b.end - b.start)).slice(0, 1)
}

function removeMarks(
  source: TextReadSnapshot,
  selection: EditorSelectionRange,
  { low, high }: Range,
  marks: readonly Mark[],
  marker: string,
): MarkdownEdit {
  const edits: TextEdit[] = []
  for (const mark of marks) {
    const start = mark.start + mark.width
    const end = mark.end - mark.width
    const from = low === high ? start : Math.max(start, Math.min(end, low))
    const to = low === high ? end : Math.max(start, Math.min(end, high))
    const prefix = source.readRange(start, from)
    const suffix = source.readRange(to, end)
    edits.push({ from: mark.start, to: start, text: prefix.trim() ? marker : '' })
    edits.push({ from: end, to: mark.end, text: suffix.trim() ? marker : '' })
    if (prefix.trim()) {
      const at = from - (prefix.length - prefix.trimEnd().length)
      edits.push({ from: at, to: at, text: marker })
    }
    if (suffix.trim()) {
      const at = to + (suffix.length - suffix.trimStart().length)
      edits.push({ from: at, to: at, text: marker })
    }
  }
  edits.sort((a, b) => a.from - b.from || a.to - b.to)
  return { edits, selection: mappedSelection(selection, edits) }
}

function mappedSelection(
  selection: EditorSelectionRange,
  edits: readonly TextEdit[],
): EditorSelectionRange {
  const forward = selection.anchor <= selection.head
  return {
    anchor: mappedOffset(selection.anchor, edits, forward),
    head: mappedOffset(selection.head, edits, !forward),
  }
}

function mappedOffset(offset: number, edits: readonly TextEdit[], afterInsertion: boolean): number {
  let delta = 0
  for (const edit of edits) {
    if (offset < edit.from) break
    if (edit.from === edit.to && offset === edit.from && !afterInsertion) break
    if (offset < edit.to) return edit.from + delta
    delta += edit.text.length - (edit.to - edit.from)
  }
  return offset + delta
}

function markWidth(source: TextReadSnapshot, kind: number, start: number): number {
  if (kind === Kind.Emphasis) return 1
  if (kind === Kind.Strong || source.readRange(start, start + 2) === '~~') return 2
  return 1
}
