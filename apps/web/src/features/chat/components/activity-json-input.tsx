import { HighlightedCode } from '@workspace/markdown/components/highlighted-code'
import { CodeHighlighterContext } from '@workspace/markdown/providers/code-highlighter-context'
import type { Ref } from 'react'

import { useCodeHighlighter } from '@/lib/code-highlight/hooks/use-code-highlighter'

export function ActivityJsonInput({
  className,
  code,
  label,
  scrollRef,
}: {
  className: string
  code: string
  label: string
  scrollRef: Ref<HTMLPreElement>
}) {
  const highlighter = useCodeHighlighter()

  return (
    <CodeHighlighterContext value={highlighter}>
      <HighlightedCode
        aria-label={label}
        className={className}
        code={code}
        data-tool-group-scroll
        incomplete={false}
        language='json'
        ref={scrollRef}
        tabIndex={0}
      />
    </CodeHighlighterContext>
  )
}
