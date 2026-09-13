import { cn } from '@workspace/ui/lib/utils'
import type { ComponentProps } from 'react'

type AssistantMarkdownStrongProps = ComponentProps<'strong'> & { node?: unknown }

/**
 * The renderer emits bold as a styled `span`, which reads as plain text to
 * assistive tech and to anything that reconstructs markdown from the rendered
 * DOM — including the transcript's own copy handler. Emphasis is meaning, so it
 * gets the element that carries it.
 */
export function AssistantMarkdownStrong({
  children,
  className,
  node,
  ...props
}: AssistantMarkdownStrongProps) {
  void node

  return (
    <strong className={cn('font-semibold', className)} data-markdown='strong' {...props}>
      {children}
    </strong>
  )
}
