import { detectPlatform } from '@fregat/hotkeys'
import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'

import { Section } from '@/features/dev/components/section'
import { ShortcutRecorder } from '@/features/settings/components/shortcut-recorder'
import { ShortcutRow } from '@/features/settings/components/shortcut-row'
import { shortcutRows } from '@/features/settings/utils/shortcut-rows'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'

// Two custom chords, one clash and one removal, the states the page has to draw.
const FIXTURE_OVERRIDES = [
  { command: 'workspace.goToLine', keys: 'Mod+P', context: 'Workspace' },
  { command: 'workspace.togglePanel', keys: 'Mod+Alt+J', context: 'Workspace' },
  { unbind: 'workspace.saveAllFiles', keys: 'Mod+Alt+S', context: 'Workspace' },
] as const

const SHOWN = [
  'workspace.showCommandPalette',
  'workspace.undoSessionAction',
  'workspace.goToLine',
  'workspace.showQuickAccess',
  'workspace.togglePanel',
  'workspace.saveAllFiles',
  'workspace.saveFile',
] as const

/** The shortcuts editor's rows and recorder over fixture overrides, at desk and phone width. */
export function ShortcutsTab() {
  const platform = detectPlatform()
  const defaults = defaultPlatformKeyBindings(platform, 'ours')
  const all = shortcutRows(defaults, FIXTURE_OVERRIDES, platform)
  const rows = SHOWN.flatMap((command) => all.filter((row) => row.command === command))
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const list = rows.map((row) => (
    <ShortcutRow
      keptNote={null}
      key={row.command}
      onChange={() => undefined}
      onMenu={() => undefined}
      platform={platform}
      query=''
      row={row}
      rowProps={{ 'aria-selected': row.command === 'workspace.goToLine' }}
    />
  ))

  return (
    <div className='mx-auto flex max-w-6xl flex-col gap-8 p-(--density-section-padding)'>
      <Section title='Desk rows' detail='Command, keys, where, source; a clash strikes the loser.'>
        <div className='bg-background @container/settings' role='listbox'>
          {list}
        </div>
      </Section>
      <Section title='Phone rows' detail='The same rows below the settings container breakpoint.'>
        <div className='bg-background @container/settings w-[390px] max-w-full' role='listbox'>
          {list}
        </div>
      </Section>
      <Section title='Recorder' detail='Nothing is written until Save; the clash shows first.'>
        <Button className='self-start' onClick={(event) => setAnchor(event.currentTarget)}>
          Change shortcut
        </Button>
        {anchor ? (
          <ShortcutRecorder
            adding={false}
            anchor={anchor}
            onClose={() => setAnchor(null)}
            onSave={() => setAnchor(null)}
            platform={platform}
            preview={() => ({
              blockedBy: null,
              kept: null,
              takes: [{ title: 'Quick Open', where: 'Everywhere' }],
            })}
            title='Go to line'
          />
        ) : null}
      </Section>
    </div>
  )
}
