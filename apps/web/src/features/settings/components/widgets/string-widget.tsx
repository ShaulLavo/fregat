import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'

import { useDeferredCommitField } from '@/features/settings/hooks/use-deferred-commit-field'

/** Trims and rejects blank unless `verbatim`, where whitespace and emptiness are the value. */
export function StringWidget({
  'aria-label': ariaLabel,
  className,
  disabled,
  id,
  onCommit,
  value,
  verbatim = false,
}: {
  'aria-label'?: string
  className?: string
  disabled?: boolean
  id: string
  onCommit: (next: string) => void
  value: string
  verbatim?: boolean
}) {
  const field = useDeferredCommitField({
    onCommit,
    parse: (draft) => {
      if (verbatim) return draft
      const next = draft.trim()
      return next === '' ? undefined : next
    },
    toDraft: (current) => current,
    value,
  })

  return (
    <Input
      {...field}
      aria-label={ariaLabel}
      autoCapitalize='off'
      autoComplete='off'
      autoCorrect='off'
      className={cn('w-64 @max-3xl/settings:w-full', className)}
      disabled={disabled}
      id={id}
      spellCheck={false}
      type='text'
    />
  )
}
