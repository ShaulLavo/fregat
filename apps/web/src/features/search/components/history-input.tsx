import type { ChangeEvent, ComponentProps, KeyboardEvent, ReactNode } from 'react'
import { useState } from 'react'

import { Input } from '@workspace/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { cn } from '@workspace/ui/lib/utils'

type SearchHistoryInputProps = {
  'aria-label': string
  className?: string
  endAddon?: ReactNode
  label: string
  size?: 'default' | 'sm'
  startAddon?: ReactNode
  type?: 'search' | 'text'
  value: string
  onSelectNextHistory: () => void
  onSelectPreviousHistory: () => void
  onValueChange: (value: string) => void
}

const FIELD_HEIGHT = {
  default: 'h-(--density-control-height)',
  sm: 'h-(--density-control-height-sm)',
} as const

const FIELD_TEXT = {
  default: 'text-xs',
  sm: 'text-2xs',
} as const

// A native search input paints its own cancel affordance, which would duplicate the
// trailing addon controls this field already carries.
const HIDE_NATIVE_SEARCH_AFFORDANCES =
  '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden'

export function SearchHistoryInput({
  'aria-label': ariaLabel,
  className,
  endAddon,
  label,
  size = 'default',
  startAddon,
  type = 'text',
  value,
  onSelectNextHistory,
  onSelectPreviousHistory,
  onValueChange,
}: SearchHistoryInputProps) {
  const [focused, setFocused] = useState(false)

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onSelectPreviousHistory()
      return
    }
    if (event.key !== 'ArrowDown') return

    event.preventDefault()
    onSelectNextHistory()
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onValueChange(event.target.value)
  }

  // Query and replacement text are code, never prose: autocorrect would rewrite them.
  const fieldProps: ComponentProps<'input'> = {
    'aria-label': ariaLabel,
    autoCapitalize: 'off',
    autoComplete: 'off',
    autoCorrect: 'off',
    placeholder: focused ? `${label} (↑↓ for history)` : label,
    spellCheck: false,
    type,
    value,
    onBlur: () => setFocused(false),
    onChange: handleChange,
    onFocus: () => setFocused(true),
    onKeyDown: handleKeyDown,
  }
  const controlClassName = cn(FIELD_TEXT[size], type === 'search' && HIDE_NATIVE_SEARCH_AFFORDANCES)

  if (!startAddon && !endAddon) {
    return <Input {...fieldProps} className={cn(FIELD_HEIGHT[size], controlClassName, className)} />
  }

  return (
    <InputGroup className={cn(FIELD_HEIGHT[size], className)}>
      {startAddon ? <InputGroupAddon align='inline-start'>{startAddon}</InputGroupAddon> : null}
      <InputGroupInput {...fieldProps} className={cn('h-full', controlClassName)} />
      {/* The group already centers the addon, so its block padding only pushes controls
          past the field border once the field is sized small. */}
      {endAddon ? (
        <InputGroupAddon align='inline-end' className='py-0'>
          {endAddon}
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}
