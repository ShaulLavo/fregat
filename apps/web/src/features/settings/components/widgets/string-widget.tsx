import { Input } from '@workspace/ui/components/input'
import { useRef, useState } from 'react'
import { cn } from '@workspace/ui/lib/utils'

/**
 * A text field with the same focus contract as the number one: commit on blur or
 * Enter, ignore incoming values while focused, Escape cancels.
 *
 * Per-keystroke writes would be worse here than for numbers — a font stack is
 * long, so typing one would write dozens of intermediate values, most of them
 * naming fonts that do not exist.
 */
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
  const [draft, setDraft] = useState<string | null>(null)
  const inputValue = draft ?? value
  const cancelled = useRef(false)

  const commit = () => {
    const next = verbatim ? inputValue : inputValue.trim()
    if ((!verbatim && next === '') || next === value) {
      setDraft(null)

      return
    }

    onCommit(next)
  }

  return (
    <Input
      aria-label={ariaLabel}
      autoCapitalize='off'
      autoComplete='off'
      autoCorrect='off'
      className={cn('w-64 @max-3xl/settings:w-full', className)}
      disabled={disabled}
      id={id}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false
          setDraft(null)

          return
        }

        commit()
        setDraft(null)
      }}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onFocus={() => {
        setDraft(value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          cancelled.current = true
          event.currentTarget.blur()

          return
        }
        if (event.key !== 'Enter') return

        commit()
      }}
      spellCheck={false}
      type='text'
      value={inputValue}
    />
  )
}
