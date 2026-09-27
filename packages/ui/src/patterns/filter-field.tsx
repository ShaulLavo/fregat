import { useImperativeHandle, useRef, type ComponentProps, type Ref } from 'react'
import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@workspace/ui/components/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

export interface FilterFieldHandle {
  seed: (character: string) => void
}

type FilterFieldProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'onInput' | 'ref' | 'onBlur'
> & {
  ref?: Ref<FilterFieldHandle>
  inputRef?: Ref<HTMLInputElement>
  value: string
  onValueChange: (value: string) => void
  onArrowDown: () => void
  blurBehavior: 'retain' | 'clear'
  clearLabel: string
  fakeFocus?: boolean
}

export function FilterField({
  ref,
  inputRef,
  value,
  onValueChange,
  onArrowDown,
  blurBehavior,
  clearLabel,
  fakeFocus,
  onKeyDown,
  ...inputProps
}: FilterFieldProps) {
  const control = useRef<HTMLInputElement>(null)
  useImperativeHandle(inputRef, () => control.current!, [])
  useImperativeHandle(
    ref,
    () => ({
      seed(character) {
        onValueChange(character)
        control.current?.focus()
      },
    }),
    [onValueChange],
  )

  return (
    <PaneBar data-slot='filter-field'>
      <InputGroup
        className='h-(--density-control-height-sm) min-w-0 flex-1'
        data-focus-within={fakeFocus || undefined}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return
          if (blurBehavior === 'clear') onValueChange('')
        }}
      >
        <InputGroupAddon>
          <MagnifyingGlassIcon />
        </InputGroupAddon>
        <InputGroupInput
          {...inputProps}
          ref={control}
          className='h-full'
          value={value}
          onInput={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
              event.stopPropagation()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              if (value) onValueChange('')
              else event.currentTarget.blur()
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              event.stopPropagation()
              onArrowDown()
              return
            }
            onKeyDown?.(event)
          }}
        />
        {value ? (
          <InputGroupAddon align='inline-end'>
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    aria-label={clearLabel}
                    size='icon-xs'
                    onKeyDown={(event) => {
                      // Keep native button activation out of enclosing list keyboard handlers.
                      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
                    }}
                    onClick={() => {
                      onValueChange('')
                      control.current?.focus()
                    }}
                  >
                    <XIcon />
                  </InputGroupButton>
                }
              />
              <TooltipContent>{clearLabel}</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </PaneBar>
  )
}
