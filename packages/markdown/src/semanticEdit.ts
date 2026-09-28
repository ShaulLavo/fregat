import { Kind } from 'tree-sitter-md'
import type { TextReadSnapshot } from '@singapore-editor/core/document'
import type { EditorSelectionRange } from '@singapore-editor/core/extensions'
import type { MarkdownAuthoringCommand, MarkdownEdit } from './authoring'

export function semanticMarkdownEdit(
  source: TextReadSnapshot,
  selection: EditorSelectionRange,
  command: MarkdownAuthoringCommand,
  records: Uint32Array | undefined,
): MarkdownEdit | null {
  if (!records) return null
  if (command !== 'markdown.link' && command !== 'markdown.code') return null
  const wanted = command === 'markdown.link' ? Kind.Link : Kind.CodeSpan
  const low = Math.min(selection.anchor, selection.head)
  const high = Math.max(selection.anchor, selection.head)
  let enclosing: { start: number; end: number } | null = null
  for (let index = 0; index < records.length; index += 4) {
    const start = records[index]!,
      end = records[index + 1]!
    if (records[index + 2] !== wanted || start > low || end < high) continue
    if (!enclosing || end - start < enclosing.end - enclosing.start) enclosing = { start, end }
  }
  if (!enclosing) return null
  if (command === 'markdown.link') return selectLinkTarget(source, enclosing, records)
  const { start, end } = enclosing
  const width = markWidth(source, start, end)
  const code = source.readRange(start + width, end - width)
  const padding =
    wanted === Kind.CodeSpan && code.startsWith(' ') && code.endsWith(' ') && code.trim() ? 1 : 0
  const contentStart = start + width + padding
  const contentEnd = end - width - padding
  if (low !== high) {
    const from = Math.max(contentStart, Math.min(contentEnd, low))
    const to = Math.max(contentStart, Math.min(contentEnd, high))
    const marker = source.readRange(start, start + width)
    const prefix = quoteCode(source.readRange(contentStart, from), marker)
    const selected = source.readRange(from, to)
    const suffix = quoteCode(source.readRange(to, contentEnd), marker)
    const anchor = start + prefix.length
    const head = anchor + selected.length
    return {
      edits: [{ from: start, to: end, text: prefix + selected + suffix }],
      selection:
        selection.anchor <= selection.head ? { anchor, head } : { anchor: head, head: anchor },
    }
  }
  const clamp = (offset: number) =>
    Math.max(contentStart, Math.min(contentEnd, offset)) - width - padding
  return {
    edits: [
      { from: start, to: contentStart, text: '' },
      { from: contentEnd, to: end, text: '' },
    ],
    selection: { anchor: clamp(selection.anchor), head: clamp(selection.head) },
  }
}

function markWidth(source: TextReadSnapshot, start: number, end: number): number {
  const lineEnd = Math.min(end, source.lineRange(source.lineAt(start)).end)
  return source.readRange(start, lineEnd).match(/^`+/)?.[0].length ?? 1
}

function selectLinkTarget(
  source: TextReadSnapshot,
  link: { start: number; end: number },
  records: Uint32Array,
): MarkdownEdit | null {
  for (let index = 0; index < records.length; index += 4) {
    if (records[index + 2] !== Kind.LinkText) continue
    const start = records[index]!,
      end = records[index + 1]!
    if (start < link.start || end > link.end) continue
    const suffix = source.readRange(end, link.end)
    if (!suffix.startsWith(']('))
      return { edits: [], selection: { anchor: link.start, head: link.end } }
    const leading = suffix.match(/^\]\(\s*/)?.[0].length ?? 2
    const angle = suffix[leading] === '<'
    const from = leading + (angle ? 1 : 0)
    const to = destinationEnd(suffix, from, angle)
    return { edits: [], selection: { anchor: end + from, head: end + to } }
  }
  return null
}

function destinationEnd(text: string, start: number, angle: boolean): number {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (character === '\\') {
      index++
      continue
    }
    if (angle && character === '>') return index
    if (angle) continue
    if ((character === ')' && depth === 0) || /\s/.test(character!)) return index
    if (character === '(') depth++
    if (character === ')') depth--
  }
  return text.length
}

function quoteCode(text: string, marker: string): string {
  if (!text) return ''
  const pad =
    text.startsWith('`') ||
    text.endsWith('`') ||
    (text.startsWith(' ') && text.endsWith(' ') && text.trim())
      ? ' '
      : ''
  return marker + pad + text + pad + marker
}
