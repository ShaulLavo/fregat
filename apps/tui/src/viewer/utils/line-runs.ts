import type { ColorInput } from '@opentui/core'
import type { Theme } from '@/theme/utils/theme'
import { colorForTerminal } from '@/theme/utils/colors'
import type { ViewerTokens } from '@/viewer/state/syntax'

export function viewerLineRuns({
  text,
  tokens,
  theme,
  query,
  cursor,
}: {
  readonly text: string
  readonly tokens: ViewerTokens[number] | undefined
  readonly theme: Theme
  readonly query: string
  readonly cursor: number | null
}) {
  const matches = query ? [...text.matchAll(new RegExp(RegExp.escape(query), 'giu'))] : []
  const boundaries = new Set([0, text.length])
  let offset = 0
  const syntax = (tokens?.length ? tokens : [{ content: text }]).map((token) => {
    const start = offset
    offset += token.content.length
    boundaries.add(start)
    boundaries.add(offset)
    const color = 'color' in token ? token.color : undefined
    return { start, end: offset, color }
  })
  for (const match of matches) {
    boundaries.add(match.index)
    boundaries.add(match.index + match[0].length)
  }
  if (cursor !== null && cursor < text.length) {
    boundaries.add(cursor)
    boundaries.add(cursor + ((text.codePointAt(cursor) ?? 0) > 0xffff ? 2 : 1))
  }
  const points = [...boundaries].toSorted((left, right) => left - right)
  const runs: { text: string; fg: ColorInput; bg?: ColorInput }[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const token = syntax.find((token) => token.start <= start && token.end >= end)
    const matched = matches.some(
      (match) => match.index <= start && match.index + match[0].length >= end,
    )
    const selected = cursor === start
    let fg = theme.foreground
    if (!theme.noColor && token?.color)
      fg = colorForTerminal(token.color, theme.colorMode, theme.terminalColors)
    if (selected || matched) fg = theme.primaryForeground
    runs.push({
      text: text.slice(start, end).replaceAll('\t', '    '),
      fg,
      bg: selected || matched ? theme.primary : undefined,
    })
  }
  return runs
}
