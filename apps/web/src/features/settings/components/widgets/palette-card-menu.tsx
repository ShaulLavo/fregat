import { DotsThreeIcon } from '@phosphor-icons/react'
import type { Palette } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

/** Per-card actions. A bundled palette can only be copied; a user one is editable. */
export function PaletteCardMenu({
  disabled,
  onCopy,
  onDelete,
  onEdit,
  palette,
}: {
  readonly disabled: boolean
  readonly onCopy: () => void
  readonly onDelete: () => void
  readonly onEdit: () => void
  readonly palette: Palette
}) {
  const editable = palette.source === 'user'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`${palette.name} actions`}
            disabled={disabled}
            size='icon-xs'
            variant='ghost'
          />
        }
      >
        <DotsThreeIcon weight='bold' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {editable ? <DropdownMenuItem onClick={onEdit}>Customize…</DropdownMenuItem> : null}
        <DropdownMenuItem onClick={onCopy}>
          {editable ? 'Duplicate…' : 'Customize a copy…'}
        </DropdownMenuItem>
        {editable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} variant='destructive'>
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
