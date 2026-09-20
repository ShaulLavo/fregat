import { KeybindingResolution } from '@/features/settings/components/keybinding-resolution'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { useState } from 'react'

import { commandKeyBindings, keyBindingResolution } from '@/keymap/active-bindings'
import { presetPlatformKeyBindings } from '@/keymap/default-bindings'

import { useSettingValue } from '@/hooks/use-setting-value'
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
      <InputGroup>
        <InputGroupAddon align='inline-start'>
          <MagnifyingGlassIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          aria-label='Search keyboard shortcuts'
          autoCapitalize='off'
          autoComplete='off'
          autoCorrect='off'
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder='Search commands'
          spellCheck={false}
          value={query}
        />
      </InputGroup>
      <KeybindingResolution
        report={report}
        omitted={defaults.omitted}
        unmapped={defaults.unmapped}
      />
      <div className='bg-muted flex max-h-64 flex-col overflow-y-auto rounded-lg'>
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
