import { expandRegexReplacement } from '@workspace/client-core/files/search-replace'
import { isWholeWordMatch } from '@workspace/contracts'
import { textSnapshotLineRange } from '@/features/editor/utils/text-snapshot'
import type { TextEdit, TextSnapshot } from '@singapore-editor/core/document'
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
  captures: RegExpExecArray | null
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

    return { captures: match, from, to }
  }

  return null
}

function searchReplacementText(
  query: WorkspaceSearchReplaceQuery,
  replaceText: string,
  captures: RegExpExecArray | null,
) {
  if (query.matchMode !== 'regex') return replaceText

  return captures ? expandRegexReplacement(replaceText, captures) : replaceText
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
