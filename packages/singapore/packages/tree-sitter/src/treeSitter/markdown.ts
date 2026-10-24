import { CAPTURES, init, Kind, MarkdownDocument } from 'tree-sitter-md'
import grammar from 'tree-sitter-md/tree-sitter-markdown.wasm?url'
import resolver from 'tree-sitter-md/tree-sitter-md.wasm?url'
import { Language, type Node, type Range } from 'web-tree-sitter'
import type { TextEdit } from '@singapore-editor/core/document'
import type { FoldRange, TreeSitterCapture, TreeSitterSyntaxRange } from './types'

let initialization: Promise<void> | undefined
export const initializeMarkdown = (): Promise<void> => {
  initialization ??= Language.load(grammar)
    .then((language) => init({ grammar: language, resolver: new URL(resolver, import.meta.url) }))
    .catch((error) => {
      initialization = undefined
      throw error
    })
  return initialization
}

export function editMarkdown(document: MarkdownDocument, edits: readonly TextEdit[]): void {
  for (const edit of edits.toSorted((a, b) => b.from - a.from)) {
    document.edit(edit.from, edit.to, edit.text)
  }
}

export function markdownCaptures(
  document: MarkdownDocument,
  range: TreeSitterSyntaxRange,
): TreeSitterCapture[] {
  const packed = document.highlights(range.startIndex, range.endIndex)
  const captures: TreeSitterCapture[] = []
  for (let index = 0; index < packed.length; index += 3) {
    const captureName = CAPTURES[packed[index + 2]!]!
    if (!captureName || packed[index]! >= range.endIndex || packed[index + 1]! <= range.startIndex)
      continue
    captures.push({
      startIndex: packed[index]!,
      endIndex: packed[index + 1]!,
      captureName,
      languageId: 'markdown',
    })
  }
  const records = document.decorations(range.startIndex, range.endIndex)
  for (let index = 0; index < records.length; index += 4) {
    if (records[index + 2] !== Kind.CodeBlock) continue
    const startIndex = records[index]!,
      endIndex = records[index + 1]!
    if (startIndex >= range.endIndex || endIndex <= range.startIndex) continue
    captures.push({ startIndex, endIndex, captureName: 'none', languageId: 'markdown' })
  }
  return captures
}

export function markdownFolds(
  document: MarkdownDocument,
  range: TreeSitterSyntaxRange,
): FoldRange[] {
  const packed = document.folds(range.startIndex, range.endIndex)
  const folds: FoldRange[] = []
  for (let index = 0; index < packed.length; index += 2) {
    const startIndex = packed[index]!,
      endIndex = packed[index + 1]!
    const startLine = markdownPoint(document, startIndex).row
    const endLine = markdownPoint(document, Math.max(startIndex, endIndex - 1)).row
    if (endLine <= startLine) continue
    folds.push({
      startIndex,
      endIndex,
      startLine,
      endLine,
      type: 'markdown',
      languageId: 'markdown',
    })
  }
  return folds
}

export function markdownRange(
  document: MarkdownDocument,
  startIndex: number,
  endIndex: number,
): Range {
  return {
    startIndex,
    endIndex,
    startPosition: markdownPoint(document, startIndex),
    endPosition: markdownPoint(document, endIndex),
  }
}

function markdownPoint(document: MarkdownDocument, index: number) {
  let low = 0,
    high = document.lineCount
  while (low + 1 < high) {
    const middle = (low + high) >>> 1
    if (document.rowStart(middle) <= index) low = middle
    else high = middle
  }
  return { row: low, column: index - document.rowStart(low) }
}

// Preserve offsets and line breaks while the MDX tree owns JavaScript and JSX syntax.
export function markdownMdxSource(text: string, root: Node, offset = 0): string {
  const ranges = root
    .descendantsOfType(['markdown_inline', 'jsx_text', 'link_reference_definition'])
    .sort((a, b) => a.startIndex - b.startIndex)
  const chunks: string[] = []
  let end = 0
  for (const range of ranges) {
    const start = range.startIndex - offset,
      finish = range.endIndex - offset
    if (start < end) continue
    chunks.push(text.slice(end, start).replace(/[^\n\r]/g, ' '), text.slice(start, finish))
    end = finish
  }
  chunks.push(text.slice(end).replace(/[^\n\r]/g, ' '))
  return chunks.join('')
}

export function markdownRecords(
  document: MarkdownDocument,
  range: TreeSitterSyntaxRange,
  definitions?: (links: readonly TreeSitterSyntaxRange[]) => Uint32Array,
): Uint32Array {
  const records = document.decorations(range.startIndex, range.endIndex)
  const links: TreeSitterSyntaxRange[] = []
  for (let index = 0; index < records.length; index += 4) {
    const kind = records[index + 2]!
    if (kind !== Kind.Link && kind !== Kind.Image) continue
    if (records[index]! >= range.endIndex || records[index + 1]! <= range.startIndex) continue
    links.push({ startIndex: records[index]!, endIndex: records[index + 1]! })
  }
  const visible: number[] = []
  for (let index = 0; index < records.length; index += 4) {
    const start = records[index]!,
      end = records[index + 1]!,
      kind = records[index + 2]!
    const companion =
      kind === Kind.LinkText &&
      links.some((link) => link.startIndex <= start && link.endIndex >= end)
    if (!companion && (start >= range.endIndex || end <= range.startIndex)) continue
    visible.push(start, end, kind, records[index + 3]!)
  }
  if (links.length && definitions) {
    const references = definitions(links)
    for (let index = 0; index < references.length; index += 4) {
      const start = references[index]!,
        end = references[index + 1]!
      if (start < range.endIndex && end > range.startIndex) continue
      visible.push(start, end, Kind.Definition, references[index + 3]!)
    }
  }
  return Uint32Array.from(visible)
}

export function markdownDefinitions(document: MarkdownDocument, size: number): Uint32Array {
  const records = document.decorations(0, size)
  const definitions: number[] = []
  for (let index = 0; index < records.length; index += 4) {
    if (records[index + 2] !== Kind.Definition) continue
    definitions.push(records[index]!, records[index + 1]!, Kind.Definition, records[index + 3]!)
  }
  return Uint32Array.from(definitions)
}
