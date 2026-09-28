import { Kind } from 'tree-sitter-md'
import type { TextReadSnapshot, TextEdit } from '@singapore-editor/core/document'
import type { EditorSelectionRange } from '@singapore-editor/core/extensions'
import type { MarkdownEdit } from './authoring'

type Mark = { readonly start: number; readonly end: number; readonly width: number }

export function markEdit(
  source: TextReadSnapshot,
  selection: EditorSelectionRange,
  kind: number,
  marker: string,
  records: Uint32Array,
): MarkdownEdit {
  const low = Math.min(selection.anchor, selection.head)
  const high = Math.max(selection.anchor, selection.head)
  const marks = selectedMarks(source, records, kind, low, high)
  if (marks.length) return removeMarks(source, selection, marks, marker)
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
  marks: readonly Mark[],
  marker: string,
): MarkdownEdit {
  const low = Math.min(selection.anchor, selection.head)
  const high = Math.max(selection.anchor, selection.head)
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
