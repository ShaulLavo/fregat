import { cn } from '@workspace/ui/lib/utils'

import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { ansiSpans, type AnsiColor, type AnsiRgb } from '@/features/git/utils/ansi-spans'

type CommitOutputLineProps = {
  readonly stream: 'stderr' | 'stdout'
  readonly text: string
}

/** One hook output line, its SGR colors painted from the theme's ANSI table. */
export function CommitOutputLine({ stream, text }: CommitOutputLineProps) {
  const { ansi } = usePalette().resolved.terminal

  return (
    <p className={cn('break-all whitespace-pre-wrap', stream === 'stderr' && 'text-warning')}>
      {ansiSpans(text).map((span, index) => (
        <span
          className={cn(
            span.bold && 'font-semibold',
            span.dim && 'text-muted-foreground',
            span.italic && 'italic',
            span.underline && 'underline',
          )}
          // Spans never reorder within a line, so the index is the position.
          key={index}
          style={spanStyle(span.color, ansi)}
        >
          {span.text}
        </span>
      ))}
    </p>
  )
}

function spanStyle(color: AnsiColor | undefined, ansi: readonly AnsiRgb[]) {
  if (color === undefined) return undefined

  const rgb = typeof color === 'number' ? ansi[color] : color
  if (!rgb) return undefined

  return { color: `rgb(${rgb.r} ${rgb.g} ${rgb.b})` }
}
