import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'

import { useDeferredCommitField } from '@/features/settings/hooks/use-deferred-commit-field'

/** Nullable fields clear to null; verbatim fields preserve whitespace and emptiness. */
export function StringWidget({
  'aria-label': ariaLabel,
  className,
  disabled,
  id,
  nullable = false,
  onCommit,
  value,
  verbatim = false,
}: {
  'aria-label'?: string
  className?: string
  disabled?: boolean
  id: string
  nullable?: boolean
  onCommit: (next: string | null) => void
  value: string | null
  verbatim?: boolean
}) {
  const field = useDeferredCommitField({
    onCommit,
    parse: (draft) => {
      if (verbatim) return draft
      const next = draft.trim()
      if (next !== '') return next
      return nullable ? null : undefined
    },
    toDraft: (current) => current ?? '',
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
