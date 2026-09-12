import { KeybindingResolution } from '@/features/settings/components/keybinding-resolution'
import { Input } from '@workspace/ui/components/input'
import { useState } from 'react'

import { commandKeyBindings, keyBindingResolution } from '@/keymap/active-bindings'
import { presetPlatformKeyBindings } from '@/keymap/default-bindings'

import { useSettingValue } from '../hooks/use-setting-value'
import { commandsShadowedBy, matchingKeybindingRows } from '../utils/keybinding-rows'
import { EmptyRow } from './empty-row'
import { KeybindingRow } from './keybinding-row'

export function KeybindingSection() {
  const overrides = useSettingValue('keybindings.overrides')
  const preset = useSettingValue('keybindings.preset')
  const [query, setQuery] = useState('')
  const defaults = presetPlatformKeyBindings(undefined, preset)
  const rows = commandKeyBindings(defaults.bindings, overrides)
  const { report } = keyBindingResolution(defaults.bindings, overrides)
  const visible = matchingKeybindingRows(rows, query)

  return (
    <div className='flex w-[28rem] max-w-full min-w-0 flex-col gap-1 @max-3xl/settings:w-full'>
      <Input
        aria-label='Search keyboard shortcuts'
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder='Search commands'
        value={query}
      />
      <KeybindingResolution
        report={report}
        omitted={defaults.omitted}
        unmapped={defaults.unmapped}
      />
      <div className='border-border flex max-h-64 flex-col overflow-y-auto rounded-lg border'>
        {visible.length === 0 ? <EmptyRow>No commands match this search.</EmptyRow> : null}
        {visible.map((row) => (
          <KeybindingRow
            binding={row}
            claimedFrom={commandsShadowedBy(rows, row.command)}
            key={row.command}
          />
        ))}
      </div>
    </div>
  )
}
