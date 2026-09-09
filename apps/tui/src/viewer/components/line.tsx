import type { Theme } from '@/theme/utils/theme'
import type { ViewerTokens } from '@/viewer/state/syntax'
import { viewerLineRuns } from '@/viewer/utils/line-runs'
import { useRenderer } from '@opentui/react'
import { viewerGutterWidth, viewerTextWidth } from '@/viewer/utils/columns'

export function ViewerLine({
  text,
  number,
  selected,
  tokens,
  theme,
  diagnostic,
  character,
  query,
  onSelect,
}: {
  readonly text: string
  readonly number: number
  readonly selected: boolean
  readonly character: number
  readonly query: string
  readonly tokens: ViewerTokens[number] | undefined
  readonly theme: Theme
  readonly diagnostic: boolean
  readonly onSelect: () => void
}) {
  const renderer = useRenderer()
  const runs = viewerLineRuns({ text, tokens, theme, query, cursor: selected ? character : null })
  const textWidth = viewerTextWidth(text, renderer.widthMethod) + 1
  return (
    <box
      height={1}
      width={viewerGutterWidth + textWidth}
      minWidth='100%'
      flexShrink={0}
      flexDirection='row'
      backgroundColor={selected ? theme.accent : theme.background}
      onMouseDown={onSelect}
    >
      <text
        width={viewerGutterWidth}
        flexShrink={0}
        fg={diagnostic ? theme.destructive : theme.mutedForeground}
      >{`${diagnostic ? '!' : ' '} ${number.toString().padStart(4)} `}</text>
      <text wrapMode='none' fg={theme.foreground} width={textWidth} flexShrink={0}>
        {runs.map((run, index) => (
          <span key={index} fg={run.fg} bg={run.bg}>
            {run.text}
          </span>
        ))}
        {selected && character === text.length ? <span fg={theme.primary}>▏</span> : null}
      </text>
    </box>
  )
}
