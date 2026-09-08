export type ViewerPosition = { readonly line: number; readonly character: number }

export function findMatches(content: string, query: string): readonly ViewerPosition[] {
  if (!query) return []
  return content.split('\n').flatMap((line, index) => matchesInLine(line, query, index))
}

function matchesInLine(text: string, query: string, line: number) {
  return [...text.matchAll(new RegExp(RegExp.escape(query), 'giu'))].map((match) => ({
    line,
    character: match.index,
  }))
}

export function nextMatch(
  matches: readonly ViewerPosition[],
  position: ViewerPosition,
  direction: 1 | -1,
) {
  if (direction === 1)
    return matches.find((match) => comparePositions(match, position) > 0) ?? matches[0]
  return matches.findLast((match) => comparePositions(match, position) < 0) ?? matches.at(-1)
}

function comparePositions(left: ViewerPosition, right: ViewerPosition) {
  return left.line - right.line || left.character - right.character
}

export function clampPosition(lines: readonly string[], position: ViewerPosition): ViewerPosition {
  const line = Math.max(0, Math.min(lines.length - 1, position.line))
  const text = lines[line] ?? ''
  let character = Math.max(0, Math.min(text.length, position.character))
  const code = text.charCodeAt(character)
  if (code >= 0xdc00 && code <= 0xdfff) character -= 1
  return { line, character }
}

export function nextCharacter(text: string, character: number) {
  return character + ((text.codePointAt(character) ?? 0) > 0xffff ? 2 : 1)
}
