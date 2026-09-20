import { Input } from '@workspace/ui/components/input'
import { useRef, useState } from 'react'

/**
 * A number field that is authoritative while it has focus.
 *
 * Two rules, and both exist because settings are live:
 *
 * 1. Commit on blur and on Enter, never per keystroke. Typing `120` would
 *    otherwise write `1`, then `12`, then `120` — three saves, two of them
 *    values the user never meant, and the intermediate ones may not even satisfy
 *    the setting's schema.
 * 2. Ignore incoming values while focused. The snapshot that comes back from
 *    the user's *own* save arrives mid-typing and would reset the field under
 *    the cursor. This is the single most common way a live settings page feels
 *    haunted.
 */
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
  const [draft, setDraft] = useState<string | null>(null)
  const inputValue = draft ?? String(value)
  // Escape blurs the field, and blur commits — so cancelling has to say so out
  // of band. State would not do: it is not flushed by the time `onBlur` runs.
  const cancelled = useRef(false)

  const commit = () => {
    // `Number('')` is `0`, and `0` is finite — so an emptied field would commit
    // a zero the user never typed, and `type='number'` reports `''` for a
    // half-typed `-` or `1e` too. Blank means "left it alone", not "zero".
    const next = inputValue.trim() === '' ? Number.NaN : Number(inputValue)
    if (!Number.isFinite(next) || next === value) {
      // Snap back rather than leave a value the server rejected on screen.
      setDraft(null)

      return
    }

    onCommit(next)
  }

  return (
    <Input
      autoComplete='off'
      className='w-28 tabular-nums'
      disabled={disabled}
      id={id}
      inputMode='numeric'
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
        setDraft(String(value))
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
      type='number'
      value={inputValue}
    />
  )
}
