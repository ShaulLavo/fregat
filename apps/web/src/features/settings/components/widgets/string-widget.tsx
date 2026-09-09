import { Input } from '@workspace/ui/components/input'
import { useRef, useState } from 'react'

/**
 * A text field with the same focus contract as the number one: commit on blur or
 * Enter, ignore incoming values while focused, Escape cancels.
 *
 * Per-keystroke writes would be worse here than for numbers — a font stack is
 * long, so typing one would write dozens of intermediate values, most of them
 * naming fonts that do not exist.
 */
export function StringWidget({
  disabled,
  id,
  onCommit,
  value,
}: {
  disabled?: boolean
  id: string
  onCommit: (next: string) => void
  value: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputValue = draft ?? value
  const cancelled = useRef(false)

  const commit = () => {
    const next = inputValue.trim()
    if (next === '' || next === value) {
      setDraft(null)

      return
    }

    onCommit(next)
  }

  return (
    <Input
      className='w-64 @max-3xl/settings:w-full'
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
      type='text'
      value={inputValue}
    />
  )
}
