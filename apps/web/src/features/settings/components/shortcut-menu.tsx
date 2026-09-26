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
import type { ShortcutRow } from '@/features/settings/utils/shortcut-rows'

/** One row's actions, the same set from ⋯, a right-click, and a tap on a narrow row. */
export function ShortcutMenu({
  anchor,
  onChange,
  onClose,
  onShowConflicts,
  row,
}: {
  anchor: HTMLElement
  onChange: () => void
  onClose: () => void
  onShowConflicts: (keys: string) => void
  row: ShortcutRow
}) {
  const { resetKeybinding, setKeybinding } = useSettingsActions()
  const keyboardSeen = useKeyboardSeen()
  const [first] = row.keys
  const bound = first !== undefined
  const changed = row.source === 'custom' || row.source === 'removed'

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open
    >
      <DropdownMenuContent align='end' anchor={anchor} className='w-56'>
        <DropdownMenuItem onClick={onChange}>
          {bound ? 'Change shortcut' : 'Add shortcut'}
          {keyboardSeen ? <Kbd className='ml-auto'>↵</Kbd> : null}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!bound} onClick={() => setKeybinding(row.command, null)}>
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
            if (first !== undefined) onShowConflicts(first)
          }}
        >
          Show conflicts
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
