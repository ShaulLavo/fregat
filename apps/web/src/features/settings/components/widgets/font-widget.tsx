import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { CaretDownIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { useNerdFonts } from '@/features/settings/hooks/use-nerd-fonts'
import { StringWidget } from '@/features/settings/components/widgets/string-widget'
import { FontPreview } from '@/features/settings/components/widgets/font-preview'

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
  return (
    <div className='flex min-w-0 items-center gap-1 @max-3xl/settings:flex-1'>
      <StringWidget
        aria-label='Font family'
        className='w-52'
        disabled={disabled}
        id={id}
        onCommit={onChange}
        value={value}
      />

      <DropdownMenu>
        <Tooltip>
          <DropdownMenuTrigger
            render={
              <TooltipTrigger
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
            }
          />
          <TooltipContent>{'Browse Nerd Fonts'}</TooltipContent>
        </Tooltip>
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
