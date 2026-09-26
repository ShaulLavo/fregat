import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@workspace/ui/components/dropdown-menu'
import { Kbd } from '@workspace/ui/components/kbd'

import { copyTextToClipboard } from '@/lib/clipboard'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useKeyboardSeen } from '@/features/settings/state/keyboard-seen'
import { shortcutListWith, type ShortcutRow } from '@/features/settings/utils/shortcut-rows'

/** One row's actions, the same set from ⋯, a right-click, and a tap on a narrow row. */
export function ShortcutMenu({
  anchor,
  onChange,
  onClose,
  onShowConflicts,
  row,
}: {
  anchor: HTMLElement
  onChange: (mode: 'change' | 'add') => void
  onClose: () => void
  onShowConflicts: (keys: string) => void
  row: ShortcutRow
}) {
  const { resetKeybinding, setKeybinding } = useSettingsActions()
  const keyboardSeen = useKeyboardSeen()
  const bound = row.keys !== null
  const changed = row.source === 'custom' || row.source === 'removed'

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open
    >
      <DropdownMenuContent align='end' anchor={anchor} className='w-56'>
        <DropdownMenuItem onClick={() => onChange(bound ? 'change' : 'add')}>
          {bound ? 'Change shortcut' : 'Add shortcut'}
          {keyboardSeen ? <Kbd className='ml-auto'>↵</Kbd> : null}
        </DropdownMenuItem>
        {bound ? (
          <DropdownMenuItem onClick={() => onChange('add')}>Add another shortcut</DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={!bound}
          onClick={() => setKeybinding(row.command, shortcutListWith(row, { remove: true }))}
        >
          Remove shortcut
          {keyboardSeen ? <Kbd className='ml-auto'>Delete</Kbd> : null}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!changed} onClick={() => resetKeybinding(row.command)}>
          Reset to default
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void copyTextToClipboard(row.command, 'command ID')}>
          Copy command ID
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!bound}
          onClick={() => {
            if (row.keys !== null) onShowConflicts(row.keys)
          }}
        >
          Show conflicts
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
