import { cn } from '@workspace/ui/lib/utils'

import { AnsiText } from '@/components/ansi-text'

type CommitOutputLineProps = {
  readonly stream: 'stderr' | 'stdout'
  readonly text: string
}

/** One hook output line. */
export function CommitOutputLine({ stream, text }: CommitOutputLineProps) {
  return (
    <p className={cn('break-all whitespace-pre-wrap', stream === 'stderr' && 'text-warning')}>
      <AnsiText text={text} />
    </p>
  )
}
