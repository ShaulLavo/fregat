/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
  EditorMinimapDecoration,
  MinimapSectionHeaderStyle,
  ResolvedMinimapOptions,
} from './types'

export type SectionHeader = {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
  readonly text: string
  readonly hasSeparatorLine: boolean
}

const CHUNK_SIZE = 100
const MAX_SECTION_LINES = 5

export function findSectionHeaderDecorations(
  lines: readonly string[],
  options: ResolvedMinimapOptions,
): EditorMinimapDecoration[] {
  if (!options.showMarkSectionHeaders) return []

  return collectMarkHeaders(lines, options.markSectionHeaderRegex).map(headerToDecoration)
}

export function findSectionHeaderDecorationsInRange(
  lines: readonly string[],
  startLineNumber: number,
  options: ResolvedMinimapOptions,
): EditorMinimapDecoration[] {
  return findSectionHeaderDecorations(lines, options).map((decoration) =>
    shiftDecorationLineNumbers(decoration, startLineNumber - 1),
  )
}

export function collectMarkHeaders(
  lines: readonly string[],
  markSectionHeaderRegex: string,
): SectionHeader[] {
  if (markSectionHeaderRegex.trim() === '') return []

  const regex = createHeaderRegex(markSectionHeaderRegex)
  if (!regex || regExpLeadsToEndlessLoop(regex)) return []

  const headers: SectionHeader[] = []
  for (let startLine = 1; startLine <= lines.length; startLine += CHUNK_SIZE - MAX_SECTION_LINES) {
    collectHeadersInChunk(headers, lines, startLine, regex)
  }

  return headers
}

function collectHeadersInChunk(
  headers: SectionHeader[],
  lines: readonly string[],
  startLine: number,
  regex: RegExp,
): void {
  const endLine = Math.min(startLine + CHUNK_SIZE - 1, lines.length)
  const text = lines.slice(startLine - 1, endLine).join('\n')
  regex.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    pushHeader(headers, startLine, text, match)
    regex.lastIndex = match.index + match[0].length
  }
}

function pushHeader(
  headers: SectionHeader[],
  startLine: number,
  chunkText: string,
  match: RegExpExecArray,
): void {
  const header = matchToSectionHeader(startLine, chunkText, match)
  if (!header.text && !header.hasSeparatorLine) return

  const previous = headers.at(-1)
  if (previous && previous.endLineNumber >= header.startLineNumber) return

  headers.push(header)
}

function matchToSectionHeader(
  startLine: number,
  chunkText: string,
  match: RegExpExecArray,
): SectionHeader {
  const precedingText = chunkText.substring(0, match.index)
  const lineOffset = (precedingText.match(/\n/g) || []).length
  const lineNumber = startLine + lineOffset
  const matchLines = match[0].split('\n')
  const matchHeight = matchLines.length
  const lineStartIndex = precedingText.lastIndexOf('\n') + 1
  const startColumn = match.index - lineStartIndex + 1
  const lastMatchLine = matchLines[matchLines.length - 1] ?? ''

  return {
    startLineNumber: lineNumber,
    startColumn,
    endLineNumber: lineNumber + matchHeight - 1,
    endColumn: matchHeight === 1 ? startColumn + match[0].length : lastMatchLine.length + 1,
    text: (match.groups ?? {})['label'] ?? '',
    hasSeparatorLine: ((match.groups ?? {})['separator'] ?? '') !== '',
  }
}

function headerToDecoration(header: SectionHeader): EditorMinimapDecoration {
  return {
    startLineNumber: header.startLineNumber,
    startColumn: header.startColumn,
    endLineNumber: header.endLineNumber,
    endColumn: header.endColumn,
    position: 'inline',
    sectionHeaderStyle: headerStyle(header.hasSeparatorLine),
    sectionHeaderText: header.text,
  }
}

function shiftDecorationLineNumbers(
  decoration: EditorMinimapDecoration,
  lineDelta: number,
): EditorMinimapDecoration {
  if (lineDelta === 0) return decoration

  return {
    ...decoration,
    startLineNumber: decoration.startLineNumber + lineDelta,
    endLineNumber: decoration.endLineNumber + lineDelta,
  }
}

function headerStyle(hasSeparatorLine: boolean): MinimapSectionHeaderStyle {
  return hasSeparatorLine ? 'underlined' : 'normal'
}

function createHeaderRegex(source: string): RegExp | null {
  try {
    return new RegExp(source, `gdm${isMultilineRegexSource(source) ? 's' : ''}`)
  } catch {
    return null
  }
}

function isMultilineRegexSource(source: string): boolean {
  return source.includes('\\n') || source.includes('\n')
}

function regExpLeadsToEndlessLoop(regexp: RegExp): boolean {
  regexp.lastIndex = 0
  const match = regexp.exec('')
  regexp.lastIndex = 0
  return match !== null && match[0].length === 0
}
