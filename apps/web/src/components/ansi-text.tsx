import { cn } from '@workspace/ui/lib/utils'

import { ansiColorStyle, ansiSpans } from '@/lib/ansi-spans'
import { usePalette } from '@/lib/appearance/hooks/use-palette'

/** One line of process output, its SGR colours painted from the theme's ANSI table. */
export function AnsiText({ text }: { text: string }) {
  const { ansi } = usePalette().resolved.terminal

  return ansiSpans(text).map((span, index) => (
    <span
      className={cn(
        span.bold && 'font-semibold',
        span.dim && 'text-muted-foreground',
        span.italic && 'italic',
        span.underline && 'underline',
      )}
      // Spans never reorder within a line, so the index is the position.
      key={index}
      style={ansiColorStyle(span.color, ansi)}
    >
      {span.text}
    </span>
  ))
}
