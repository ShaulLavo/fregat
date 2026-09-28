import type { TextEdit, TextReadSnapshot } from '@singapore-editor/core/document'
import type { EditorSelectionRange } from '@singapore-editor/core/extensions'
import { Kind } from 'tree-sitter-md'
import { markEdit } from './markEdit'
import { semanticMarkdownEdit } from './semanticEdit'

export const MARKDOWN_AUTHORING_COMMANDS = [
  'markdown.bold',
  'markdown.italic',
  'markdown.strikethrough',
  'markdown.code',
  'markdown.link',
  'markdown.heading',
  'markdown.bulletList',
  'markdown.orderedList',
  'markdown.taskList',
  'markdown.toggleTask',
  'markdown.quote',
  'markdown.codeBlock',
] as const

export type MarkdownAuthoringCommand = (typeof MARKDOWN_AUTHORING_COMMANDS)[number]

export type MarkdownEdit = {
  readonly edits: readonly TextEdit[]
  readonly selection: EditorSelectionRange
}

/** Explicit authoring commands read only the selection and its boundary lines. */
export function planMarkdownEdit(
  source: TextReadSnapshot,
  selection: EditorSelectionRange,
  command: MarkdownAuthoringCommand,
  records?: Uint32Array,
): MarkdownEdit | null {
  if (requiresMarkdownRecords(command) && !records) return null
  if (command === 'markdown.bold')
    return records ? markEdit(source, selection, Kind.Strong, '**', records) : null
  if (command === 'markdown.italic')
    return records ? markEdit(source, selection, Kind.Emphasis, '*', records) : null
  if (command === 'markdown.strikethrough')
    return records ? markEdit(source, selection, Kind.Strikethrough, '~~', records) : null
  const semantic = semanticMarkdownEdit(source, selection, command, records)
  if (semantic) return semantic
  const start = Math.min(selection.anchor, selection.head)
  const end = Math.max(selection.anchor, selection.head)
  if (command === 'markdown.code') return codeEdit(source, selection)
  if (command === 'markdown.link') return linkEdit(source, start, end)
  const first = source.lineAt(start)
  const last = source.lineAt(end > start ? end - 1 : end)
  const from = source.lineRange(first).start
  const to = source.lineRange(last).end
  const text = source.readRange(from, to).replace(/\r$/, '')
  if (command === 'markdown.codeBlock') return fenceEdit(source, selection, from, text)
  return linesEdit(selection, from, text, command)
}

export function requiresMarkdownRecords(command: MarkdownAuthoringCommand): boolean {
  return (
    command === 'markdown.bold' ||
    command === 'markdown.italic' ||
    command === 'markdown.strikethrough' ||
    command === 'markdown.code' ||
    command === 'markdown.link'
  )
}

function codeEdit(source: TextReadSnapshot, selection: EditorSelectionRange): MarkdownEdit {
  const start = Math.min(selection.anchor, selection.head)
  const end = Math.max(selection.anchor, selection.head)
  const text = source.readRange(start, end)
  const before = source.readRange(source.lineRange(source.lineAt(start)).start, start)
  const after = source.readRange(end, source.lineRange(source.lineAt(end)).end)
  const opening = before.match(/(`+)( ?)$/)
  const markerBefore = opening?.[1]
  const padBefore = opening?.[2] ?? ''
  const closing = padBefore + markerBefore
  if (markerBefore && after.startsWith(closing) && after[closing.length] !== '`') {
    return replace(
      selection,
      start - markerBefore.length - padBefore.length,
      end + closing.length,
      text,
      0,
      text.length,
    )
  }
  const content = text || 'code'
  const marker = '`'.repeat(longestBackticks(content) + 1)
  const pad =
    content.startsWith('`') ||
    content.endsWith('`') ||
    (content.startsWith(' ') && content.endsWith(' ') && content.trim())
      ? ' '
      : ''
  return replace(
    selection,
    start,
    end,
    marker + pad + content + pad + marker,
    marker.length + pad.length,
    content.length,
  )
}

function longestBackticks(text: string): number {
  let longest = 0
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return longest
}

function linkEdit(source: TextReadSnapshot, start: number, end: number): MarkdownEdit {
  const selected = source.readRange(start, end) || 'link text'
  const label = selected.replace(/([\\[\]])/g, '\\$1')
  const target = 'https://'
  return replace(
    { anchor: start, head: end },
    start,
    end,
    `[${label}](${target})`,
    label.length + 3,
    target.length,
  )
}

type LineCommand = Exclude<
  MarkdownAuthoringCommand,
  | 'markdown.bold'
  | 'markdown.italic'
  | 'markdown.strikethrough'
  | 'markdown.code'
  | 'markdown.link'
  | 'markdown.codeBlock'
>

const LIST_MARKER = /^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/

function linesEdit(
  selection: EditorSelectionRange,
  from: number,
  text: string,
  command: LineCommand,
): MarkdownEdit | null {
  const lines = text.split('\n')
  const remove =
    lines.some((line) => line.trim()) &&
    lines.every((line) => line.trim() === '' || hasStyle(line, command))
  let offset = from
  const numbers = new Map<number, number>()
  const edits: TextEdit[] = []
  for (const line of lines) {
    const depth = line.match(/^\s*/)?.[0].length ?? 0
    const number = nextListNumber(numbers, depth)
    const next = !line.trim() && lines.length > 1 ? line : formatLine(line, command, remove, number)
    if (line.trim()) numbers.set(depth, number + 1)
    if (next !== line) edits.push({ from: offset, to: offset + line.length, text: next })
    offset += line.length + 1
  }
  if (!edits.length) return null
  return {
    edits,
    selection: {
      anchor: mapOffset(selection.anchor, edits),
      head: mapOffset(selection.head, edits),
    },
  }
}

function nextListNumber(numbers: Map<number, number>, depth: number): number {
  for (const previous of numbers.keys()) {
    if (previous > depth) numbers.delete(previous)
  }
  return numbers.get(depth) ?? 1
}

function hasStyle(line: string, command: LineCommand): boolean {
  if (command === 'markdown.heading') return /^\s*##\s/.test(line)
  if (command === 'markdown.quote') return /^\s*>\s?/.test(line)
  if (command === 'markdown.bulletList') return /^\s*[-+*]\s+(?!\[[ xX]\]\s)/.test(line)
  if (command === 'markdown.orderedList') return /^\s*\d+[.)]\s/.test(line)
  if (command === 'markdown.taskList') return /^\s*[-+*]\s+\[[ xX]\]\s/.test(line)
  return /^\s*(?:[-+*]|\d+[.)])\s+\[[xX]\]/.test(line)
}

function formatLine(line: string, command: LineCommand, remove: boolean, number: number): string {
  if (command === 'markdown.toggleTask') {
    return line.replace(/^(\s*(?:[-+*]|\d+[.)])\s+\[)[ xX](\])/, `$1${remove ? ' ' : 'x'}$2`)
  }
  if (!line.trim() && remove) return line
  const indentation = line.match(/^\s*/)?.[0] ?? ''
  if (command === 'markdown.heading')
    return indentation + (remove ? '' : '## ') + line.trimStart().replace(/^#{1,6}\s+/, '')
  if (command === 'markdown.quote')
    return indentation + (remove ? '' : '> ') + line.trimStart().replace(/^>\s?/, '')
  const content = line.replace(LIST_MARKER, '').trimStart()
  if (remove) return indentation + content
  if (command === 'markdown.bulletList') return indentation + '- ' + content
  if (command === 'markdown.orderedList') return indentation + `${number}. ` + content
  return indentation + '- [ ] ' + content
}

function mapOffset(offset: number, edits: readonly TextEdit[]): number {
  let delta = 0
  for (const edit of edits) {
    if (offset < edit.from) break
    const change = edit.text.length - (edit.to - edit.from)
    if (offset <= edit.to) return edit.from + delta + Math.max(0, offset - edit.from + change)
    delta += change
  }
  return offset + delta
}

function fenceEdit(
  source: TextReadSnapshot,
  selection: EditorSelectionRange,
  from: number,
  text: string,
): MarkdownEdit {
  const firstEnd = source.lineRange(0).end
  const eol =
    source.readRange(Math.max(0, firstEnd - 1), Math.min(source.length, firstEnd + 1)) === '\r\n'
      ? '\r\n'
      : '\n'
  const marker = '`'.repeat(Math.max(3, longestBackticks(text) + 1))
  const content = text || 'code'
  return replace(
    selection,
    from,
    from + text.length,
    marker + eol + content + eol + marker,
    marker.length + eol.length,
    content.length,
  )
}

function replace(
  selection: EditorSelectionRange,
  from: number,
  to: number,
  text: string,
  contentOffset: number,
  contentLength: number,
): MarkdownEdit {
  const start = from + contentOffset
  const end = start + contentLength
  return {
    edits: [{ from, to, text }],
    selection:
      selection.anchor > selection.head
        ? { anchor: end, head: start }
        : { anchor: start, head: end },
  }
}
