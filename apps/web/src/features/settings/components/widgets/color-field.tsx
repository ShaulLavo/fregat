import { parseColor, toHex, type Oklch } from '@workspace/contracts'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { useState } from 'react'

/**
 * A color with two ways in: the native picker for dragging, the hex text for
 * pasting. Alpha survives a picker change, which only carries RGB.
 */
export function ColorField({
  disabled,
  id,
  label,
  onChange,
  value,
}: {
  readonly disabled?: boolean
  readonly id: string
  readonly label: string
  readonly onChange: (next: Oklch) => void
  readonly value: Oklch
}) {
  const hex = toHex(value)
  const [draft, setDraft] = useState<string | null>(null)
  const invalid = draft !== null && parseColor(draft) === null

  const commitText = () => {
    if (draft === null) return
    const parsed = parseColor(draft)
    setDraft(null)
    if (parsed && toHex(parsed) !== hex) onChange(parsed)
  }

  return (
    <label className='flex min-w-0 items-center justify-between gap-2 text-xs' htmlFor={id}>
      <span className='text-muted-foreground truncate'>{label}</span>
      <InputGroup className='w-36 shrink-0'>
        <InputGroupAddon>
          <input
            aria-label={`${label} picker`}
            className='size-4 cursor-pointer rounded-md border-0 bg-transparent p-0'
            disabled={disabled}
            onChange={(event) => {
              const picked = parseColor(event.target.value)
              if (picked) onChange({ ...picked, alpha: value.alpha })
            }}
            type='color'
            value={hex.slice(0, 7)}
          />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={label}
          aria-invalid={invalid || undefined}
          autoCapitalize='off'
          autoComplete='off'
          autoCorrect='off'
          className='font-mono'
          disabled={disabled}
          id={id}
          onBlur={commitText}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitText()
            if (event.key === 'Escape') setDraft(null)
          }}
          spellCheck={false}
          value={draft ?? hex}
        />
      </InputGroup>
    </label>
  )
}
