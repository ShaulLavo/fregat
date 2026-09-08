import type { InputRenderable } from '@opentui/core'
import { useLayoutEffect, useRef } from 'react'

import type { Theme } from '@/theme/utils/theme'

export function Prompt({
  id,
  value,
  onChange,
  onSubmit,
  theme,
  focused = true,
  placeholder,
  disabled = false,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  theme: Theme
  focused?: boolean
  placeholder?: string
  disabled?: boolean
}) {
  const input = useRef<InputRenderable>(null)
  const synchronizing = useRef(false)
  useLayoutEffect(() => {
    if (!input.current) return
    // Native value assignments emit input events, just like typing.
    synchronizing.current = true
    input.current.value = value
    synchronizing.current = false
  }, [value])
  return (
    <input
      id={id}
      ref={input}
      onInput={(next) => {
        if (!synchronizing.current) onChange(next)
      }}
      onSubmit={disabled ? undefined : () => onSubmit(input.current?.value ?? value)}
      focused={focused && !disabled}
      placeholder={placeholder}
      textColor={theme.foreground}
      backgroundColor={theme.card}
      focusedBackgroundColor={theme.card}
      focusedTextColor={theme.foreground}
      placeholderColor={theme.mutedForeground}
      flexShrink={0}
      width='100%'
    />
  )
}
