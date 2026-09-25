import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'

/**
 * A text field that commits on blur or Enter, never per keystroke, and ignores incoming values
 * while focused: the snapshot from the user's own save would otherwise reset it under the cursor.
 * `parse` returns undefined to reject a draft, which snaps the field back.
 */
export function useDeferredCommitField<T>({
  onCommit,
  parse,
  toDraft,
  value,
}: {
  onCommit: (next: T) => void
  parse: (draft: string) => T | undefined
  toDraft: (value: T) => string
  value: T
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputValue = draft ?? toDraft(value)
  // Escape blurs and blur commits, so cancelling is out of band: state is not flushed by `onBlur`.
  const cancelled = useRef(false)

  const commit = () => {
    const next = parse(inputValue)
    if (next === undefined || next === value) {
      setDraft(null)
      return
    }

    onCommit(next)
  }

  return {
    onBlur: () => {
      if (!cancelled.current) commit()
      cancelled.current = false
      setDraft(null)
    },
    onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft(event.currentTarget.value),
    onFocus: () => setDraft(toDraft(value)),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        cancelled.current = true
        event.currentTarget.blur()
        return
      }
      if (event.key !== 'Enter') return
      commit()
    },
    value: inputValue,
  }
}
