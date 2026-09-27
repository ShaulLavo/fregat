import { useId, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'
import { stopPropagation } from '@workspace/utils/events'

import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'

type InlineRenameInputProps = Omit<
  ComponentProps<typeof Input>,
  'value' | 'defaultValue' | 'onBlur' | 'onKeyDown' | 'onFocus' | 'onChange' | 'onInput'
> & {
  readonly initialValue: string
  readonly initialSelection?: readonly [start: number, end: number]
  readonly validationMessage?: string
  readonly onValueChange?: (value: string) => void
  readonly onCommit: (value: string) => void
  readonly onCancel: () => void
}

export function InlineRenameInput({
  initialValue,
  initialSelection,
  validationMessage,
  onValueChange,
  onCommit,
  onCancel,
  className,
  autoFocus = true,
  ...props
}: InlineRenameInputProps) {
  const [value, setValue] = useState(initialValue)
  const errorId = useId()
  const settled = useRef(false)
  const selected = useRef(false)

  function commit(input: HTMLInputElement) {
    if (settled.current) return
    if (validationMessage) {
      input.focus({ preventScroll: true })
      return
    }
    settled.current = true
    onCommit(input.value)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation()
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    if (settled.current) return
    if (event.key === 'Enter') {
      commit(event.currentTarget)
      return
    }
    settled.current = true
    onCancel()
  }

  return (
    <>
      <Input
        autoCapitalize='off'
        autoComplete='off'
        autoCorrect='off'
        spellCheck={false}
        {...props}
        autoFocus={autoFocus}
        aria-invalid={Boolean(validationMessage)}
        aria-describedby={validationMessage ? errorId : props['aria-describedby']}
        className={cn(
          'h-[calc(var(--density-row-height)-4px)] bg-transparent px-(--density-row-padding-x) shadow-none',
          className,
        )}
        value={value}
        onBlur={(event) => commit(event.currentTarget)}
        onInput={(event) => {
          setValue(event.currentTarget.value)
          onValueChange?.(event.currentTarget.value)
        }}
        onFocus={(event) => {
          if (selected.current) return
          selected.current = true
          const [start, end] = initialSelection ?? [0, event.currentTarget.value.length]
          event.currentTarget.setSelectionRange(start, end)
        }}
        onKeyDown={handleKeyDown}
        onClick={stopPropagation}
        onDoubleClick={stopPropagation}
        onMouseDown={stopPropagation}
        onPointerDown={stopPropagation}
      />
      {validationMessage && (
        <span id={errorId} className='sr-only'>
          {validationMessage}
        </span>
      )}
    </>
  )
}
