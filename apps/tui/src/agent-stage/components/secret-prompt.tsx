import { useLayoutEffect, useRef } from 'react'
import { useKeyboard, usePaste } from '@opentui/react'
import type { Theme } from '@/theme/utils/theme'

export function SecretPrompt({
  id,
  value,
  focused,
  theme,
  onChange,
  onSubmit,
}: {
  readonly id: string
  readonly value: string
  readonly focused: boolean
  readonly theme: Theme
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void
}) {
  const current = useRef(value)
  useLayoutEffect(() => {
    current.current = value
  }, [value])
  function update(text: string) {
    current.current = text
    onChange(text)
  }
  useKeyboard((event) => {
    if (!focused || event.defaultPrevented) return
    if (event.name === 'return') {
      event.preventDefault()
      onSubmit()
      return
    }
    if (event.name === 'backspace') {
      event.preventDefault()
      update(Array.from(current.current).slice(0, -1).join(''))
      return
    }
    if (event.ctrl && event.name === 'u') {
      event.preventDefault()
      update('')
      return
    }
    if (event.ctrl || event.meta || event.super || event.name === 'tab' || event.name === 'escape')
      return
    event.preventDefault()
    if (
      event.sequence &&
      Array.from(event.sequence).every(
        (character) => character >= ' ' && character !== String.fromCharCode(127),
      )
    )
      update(current.current + event.sequence)
  })
  usePaste((event) => {
    if (!focused || event.defaultPrevented) return
    event.preventDefault()
    update(current.current + new TextDecoder().decode(event.bytes).replaceAll(/[\r\n]/g, ''))
  })
  return (
    <input
      id={id}
      value={'•'.repeat(Array.from(value).length)}
      focused={focused}
      onInput={() => {}}
      textColor={theme.foreground}
      backgroundColor={theme.card}
      focusedTextColor={theme.foreground}
      focusedBackgroundColor={theme.card}
      width='100%'
    />
  )
}
