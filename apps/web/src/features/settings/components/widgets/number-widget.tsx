import { Input } from '@workspace/ui/components/input'

import { useDeferredCommitField } from '@/features/settings/hooks/use-deferred-commit-field'

export function NumberWidget({
  disabled,
  id,
  onCommit,
  value,
}: {
  disabled?: boolean
  id: string
  onCommit: (next: number) => void
  value: number
}) {
  const field = useDeferredCommitField({
    onCommit,
    // `Number('')` is 0, and `type='number'` reports '' for a half-typed `-` or `1e`,
    // so a blank field rejects instead of committing a zero the user never typed.
    parse: (draft) => {
      const next = draft.trim() === '' ? Number.NaN : Number(draft)
      return Number.isFinite(next) ? next : undefined
    },
    toDraft: String,
    value,
  })

  return (
    <Input
      {...field}
      autoComplete='off'
      className='w-28 tabular-nums'
      disabled={disabled}
      id={id}
      inputMode='numeric'
      spellCheck={false}
      type='number'
    />
  )
}
