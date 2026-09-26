import { DotsThreeIcon, PlusIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import { useRef } from 'react'

import { IconTooltip } from '@/components/icon-tooltip'
import { useThemeActions } from '@/features/theme-studio/hooks/use-theme-actions'

/** New and import, and what can be done to the chosen theme. */
export function ThemesToolbar() {
  const actions = useThemeActions()
  const fileRef = useRef<HTMLInputElement>(null)
  const name = actions.theme?.name ?? 'theme'

  return (
    <div className='flex shrink-0 flex-col gap-1'>
      <DropdownMenu>
        <IconTooltip label='New theme'>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label='New theme'
                disabled={actions.pending}
                focusableWhenDisabled
                size='icon-sm'
                variant='ghost'
              >
                {actions.pending ? <Spinner /> : <PlusIcon />}
              </Button>
            }
          />
        </IconTooltip>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={() => void actions.newFromCurrent()}>
            New from current
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>Import…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <IconTooltip label={`Actions for ${name}`}>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`Actions for ${name}`}
                disabled={!actions.theme || actions.pending}
                focusableWhenDisabled
                size='icon-sm'
                variant='ghost'
              >
                <DotsThreeIcon weight='bold' />
              </Button>
            }
          />
        </IconTooltip>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={actions.duplicate}>Duplicate</DropdownMenuItem>
          <DropdownMenuItem onClick={actions.exportTheme}>Export…</DropdownMenuItem>
          {actions.theme?.source === 'bundled' ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={actions.remove}>
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Input
        accept='application/json,.json'
        aria-label='Import theme file'
        className='sr-only'
        ref={fileRef}
        tabIndex={-1}
        type='file'
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) actions.importFile(file)
        }}
      />
    </div>
  )
}
