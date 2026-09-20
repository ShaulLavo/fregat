import { isWholeWordMatch } from '@workspace/contracts'
import { textSnapshotLineRange } from '@/features/editor/utils/text-snapshot'
import type { TextEdit } from '@singapore-editor/core'
import type { TextSnapshot } from '@singapore-editor/core'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'

export type WorkspaceSearchReplacePlan = {
  appliedCount: number
  edits: readonly TextEdit[]
  skippedCount: number
}

export type WorkspaceSearchReplacementPreview = {
  range: {
    end: number
    start: number
  }
  text: string
}

type WorkspaceSearchReplaceQuery = Pick<
  WorkspaceSearchQuery,
  'caseSensitive' | 'matchMode' | 'query' | 'wholeWord'
>

type TextLineRange = {
  end: number
  start: number
  text: string
}

type SearchReplaceText = string | TextSnapshot

type ReplacementMatch = {
  captures: readonly string[] | null
  from: number
  to: number
}

export function workspaceSearchReplacePlan({
  matches,
  query,
  replaceText,
  text,
}: {
  matches: readonly WorkspaceSearchMatch[]
  query: WorkspaceSearchQuery
  replaceText: string
  text: SearchReplaceText
}): WorkspaceSearchReplacePlan {
  const edits: TextEdit[] = []
  let skippedCount = 0

  for (const match of matches) {
    const replacement = replacementForSearchMatch(text, match, query, replaceText)
    if (!replacement) {
      skippedCount += 1
      continue
    }

    edits.push(replacement)
  }

  return {
    appliedCount: edits.length,
    edits: mergeAdjacentEdits(edits),
    skippedCount,
  }
}

export function applyWorkspaceSearchReplaceEdits(text: string, edits: readonly TextEdit[]) {
  let next = text
  const sorted = edits.toSorted(compareEditsDescending)

  for (const edit of sorted) {
    next = `${next.slice(0, edit.from)}${edit.text}${next.slice(edit.to)}`
  }

  return next
}

export function workspaceSearchReplacementPreview({
  match,
  query,
  replaceText,
}: {
  match: WorkspaceSearchMatch
  query: WorkspaceSearchReplaceQuery
  replaceText: string
}): WorkspaceSearchReplacementPreview | null {
  if (!replaceText) return null

  const previewLine = replacementPreviewLine(match)
  if (!previewLine) return null

  const candidate = replacementMatchInLine(previewLine.line, previewLine.match, query)
  if (!candidate) return null

  return {
    range: {
      end: candidate.to,
      start: candidate.from,
    },
    text: searchReplacementText(query, replaceText, candidate.captures),
  }
}

function replacementForSearchMatch(
  text: SearchReplaceText,
  match: WorkspaceSearchMatch,
  query: WorkspaceSearchReplaceQuery,
  replaceText: string,
): TextEdit | null {
  if (!isReplaceableSearchMatch(match)) return null

  const line = textLineRange(text, match.line - 1)
  if (!line) return null

  const candidate = replacementMatchInLine(line, match, query)
  if (!candidate) return null

  return {
    from: line.start + candidate.from,
    text: searchReplacementText(query, replaceText, candidate.captures),
    to: line.start + candidate.to,
  }
}

function replacementMatchInLine(
  line: TextLineRange,
  match: WorkspaceSearchMatch & {
    column: number
    endColumn: number
    line: number
  },
  query: WorkspaceSearchReplaceQuery,
): ReplacementMatch | null {
  const from = match.column - 1
  const to = match.endColumn - 1
  if (from < 0 || to <= from) return null
  if (to > line.text.length) return null
  if (query.matchMode === 'regex') return regexReplacementMatch(line.text, from, to, query)

  return literalReplacementMatch(line.text, from, to, query)
}

function literalReplacementMatch(
  line: string,
  from: number,
  to: number,
  query: WorkspaceSearchReplaceQuery,
): ReplacementMatch | null {
  const candidate = line.slice(from, to)
  if (!sameSearchText(candidate, query.query, query.caseSensitive)) return null
  if (!isWholeWordMatch(line, from, to, query.wholeWord)) return null

  return { captures: null, from, to }
}

function regexReplacementMatch(
  line: string,
  from: number,
  to: number,
  query: WorkspaceSearchReplaceQuery,
): ReplacementMatch | null {
  const regex = searchRegex(query)
  if (!regex) return null

  for (const match of regexMatches(line, regex)) {
    if (!isExactRegexMatch(match, from, to)) continue
    if (!isWholeWordMatch(line, from, to, query.wholeWord)) return null

    return { captures: Array.from(match), from, to }
  }

  return null
}

function searchReplacementText(
  query: WorkspaceSearchReplaceQuery,
  replaceText: string,
  captures: readonly string[] | null,
) {
  if (query.matchMode !== 'regex') return replaceText

  return regexReplacementText(replaceText, captures)
}

function regexReplacementText(replaceText: string, captures: readonly string[] | null) {
  let result = ''

  for (let index = 0; index < replaceText.length; index += 1) {
    const escaped = replacementEscapeAt(replaceText, index)
    if (escaped) {
      result += escaped.value
      index = escaped.nextIndex
      continue
    }

    const capture = replacementCaptureAt(replaceText, index, captures)
    if (capture) {
      result += capture.value
      index = capture.nextIndex
      continue
    }

    result += replaceText[index]
  }

  return result
}

function replacementEscapeAt(source: string, index: number) {
  if (source[index] !== '\\') return null

  const next = source[index + 1]
  if (next === 'n') return { nextIndex: index + 1, value: '\n' }
  if (next === 't') return { nextIndex: index + 1, value: '\t' }
  if (next === '\\') return { nextIndex: index + 1, value: '\\' }

  return null
}

function replacementCaptureAt(source: string, index: number, captures: readonly string[] | null) {
  if (source[index] !== '$') return null

  const next = source[index + 1]
  if (next === '$') return { nextIndex: index + 1, value: '$' }
  if (next === '&' || next === '0') return { nextIndex: index + 1, value: captures?.[0] ?? '' }

  return numberedReplacementCaptureAt(source, index, captures)
}

function numberedReplacementCaptureAt(
  source: string,
  index: number,
  captures: readonly string[] | null,
) {
  const first = source[index + 1]
  if (!first || !isDigit(first) || first === '0') return null

  const second = source[index + 2]
  const twoDigit = second && isDigit(second) ? Number(`${first}${second}`) : null
  if (twoDigit !== null && captures?.[twoDigit] !== undefined) {
    return { nextIndex: index + 2, value: captures[twoDigit] ?? '' }
  }

  const oneDigit = Number(first)
  if (captures?.[oneDigit] === undefined) return null

  return { nextIndex: index + 1, value: captures[oneDigit] ?? '' }
}

function regexMatches(line: string, regex: RegExp) {
  const matches: RegExpExecArray[] = []
  regex.lastIndex = 0

  while (true) {
    const match = regex.exec(line)
    if (!match) return matches

    matches.push(match)
    if (match[0].length > 0) continue
    advancePastEmptyMatch(regex, line)
  }
}

function isExactRegexMatch(match: RegExpExecArray, from: number, to: number) {
  return match.index === from && match.index + match[0].length === to
}

function searchRegex(query: WorkspaceSearchReplaceQuery) {
  try {
    return new RegExp(query.query, query.caseSensitive ? 'gu' : 'giu')
  } catch {
    return null
  }
}

function advancePastEmptyMatch(regex: RegExp, text: string) {
  const current = regex.lastIndex
  const codePoint = text.codePointAt(current)
  regex.lastIndex = current + (codePoint && codePoint > 0xffff ? 2 : 1)
}

function sameSearchText(candidate: string, query: string, caseSensitive?: boolean) {
  if (caseSensitive) return candidate === query

  return candidate.toLocaleLowerCase() === query.toLocaleLowerCase()
}

function textLineRange(text: SearchReplaceText, row: number): TextLineRange | null {
  if (typeof text !== 'string') return textSnapshotLineRange(text, row)
  if (row < 0) return null

  const start = rowStartOffset(text, row)
  if (start > text.length) return null

  const newline = text.indexOf('\n', start)
  const rawEnd = newline === -1 ? text.length : newline
  const end = rawEnd > start && text[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd

  return {
    end,
    start,
    text: text.slice(start, end),
  }
}

function rowStartOffset(text: string, row: number) {
  let offset = 0

  for (let index = 0; index < row; index += 1) {
    const nextLine = text.indexOf('\n', offset)
    if (nextLine === -1) return text.length + 1

    offset = nextLine + 1
  }

  return offset
}

function isReplaceableSearchMatch(match: WorkspaceSearchMatch): match is WorkspaceSearchMatch & {
  column: number
  endColumn: number
  line: number
} {
  if (match.kind !== 'content') return false
  if (typeof match.column !== 'number') return false
  if (typeof match.endColumn !== 'number') return false

  return typeof match.line === 'number'
}

function replacementPreviewLine(match: WorkspaceSearchMatch) {
  if (!isReplaceableSearchMatch(match)) return null
  if (match.preview === undefined) return null

  const from = match.column - 1 - (match.previewStartColumn ?? 0)
  const to = match.endColumn - 1 - (match.previewStartColumn ?? 0)
  if (from < 0 || to <= from) return null
  if (to > match.preview.length) return null

  return {
    line: {
      end: match.preview.length,
      start: 0,
      text: match.preview,
    },
    match: {
      ...match,
      column: from + 1,
      endColumn: to + 1,
      line: 1,
    },
  }
}

function mergeAdjacentEdits(edits: readonly TextEdit[]) {
  const sorted = edits.toSorted(compareEditsAscending)
  const merged: TextEdit[] = []

  for (const edit of sorted) {
    mergeEdit(merged, edit)
  }

  return merged
}

function mergeEdit(merged: TextEdit[], edit: TextEdit) {
  const previous = merged.at(-1)
  if (!previous || previous.to !== edit.from) {
    merged.push({ ...edit })
    return
  }

  merged[merged.length - 1] = {
    from: previous.from,
    text: previous.text + edit.text,
    to: edit.to,
  }
}

function compareEditsAscending(left: TextEdit, right: TextEdit) {
  return left.from - right.from || left.to - right.to
}

function compareEditsDescending(left: TextEdit, right: TextEdit) {
  return right.from - left.from || right.to - left.to
}

function isDigit(value: string) {
  return /^\d$/u.test(value)
}
