import { CaretDownIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { useRef, useState } from 'react'

import { useNerdFonts } from '../../hooks/use-nerd-fonts'
import { FontPreview } from './font-preview'

/**
 * Pick a Nerd Font from a previewed list, or type any family name.
 *
 * Both, because both are real cases. The server can fetch, subset and cache any
 * of the ~70 Nerd Fonts on demand, so picking one means the user actually gets
 * it rather than hoping it is installed — but a font already on the machine
 * should not be unreachable just because it is not in that catalogue. The stack
 * this produces tries the Nerd Font family first and the bare family second, so
 * one value serves both without the widget having to know which it is.
 */
export function FontWidget({
  disabled,
  id,
  onChange,
  value,
}: {
  disabled?: boolean
  id: string
  onChange: (next: string) => void
  value: string
}) {
  const fonts = useNerdFonts()
  const [draft, setDraft] = useState<string | null>(null)
  const inputValue = draft ?? value
  const cancelled = useRef(false)

  const commit = () => {
    const next = inputValue.trim()
    if (next === '' || next === value) {
      setDraft(null)

      return
    }

    onChange(next)
  }

  return (
    <div className='flex min-w-0 items-center gap-1 @max-3xl/settings:flex-1'>
      <Input
        aria-label='Font family'
        autoCapitalize='off'
        autoComplete='off'
        autoCorrect='off'
        className='w-52 @max-3xl/settings:w-full'
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

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label='Browse Nerd Fonts'
              disabled={disabled}
              size='icon-sm'
              variant='ghost'
            >
              <CaretDownIcon />
            </Button>
          }
        />
        <DropdownMenuContent align='end' className='max-h-96 w-72 overflow-y-auto'>
          {fonts.data?.map((font) => (
            <DropdownMenuItem key={font} onClick={() => onChange(font)}>
              <FontPreview fontId={font} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
