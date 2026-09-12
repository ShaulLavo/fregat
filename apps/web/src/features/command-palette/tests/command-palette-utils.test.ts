import { expect, test } from '../../../../test/fixtures'

import {
  commandPaletteItems,
  editorPaletteItems,
  groupedCommandItems,
  OTHER_COMMANDS_HEADING,
  quickAccessMode,
  RECENTLY_USED_COMMANDS_HEADING,
  quickAccessQuery,
} from '@/features/command-palette/command-palette-utils'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { documentTab, tabContentKey } from '@/lib/documents/utils/tabs'
import { platformCommandSpecs } from '@/keymap/command-registry'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import { resolvedPlatformKeyBindings } from '@/keymap/active-bindings'
import { formatChord } from '@/keymap/utils/format-keys'

test('command palette items expose platform command metadata and shortcuts', () => {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))
  const quickOpen = items.find((item) => item.id === 'workspace.showQuickAccess')

  expect(quickOpen).toMatchObject({
    category: 'Workspace',
    command: { command: 'workspace.showQuickAccess', kind: 'platform' },
    shortcut: expect.stringMatching(/P$/u),
    title: 'Quick Open',
  })
  expect(quickOpen?.keywords).toContain('workbench.action.quickOpen')
})

test('command groups rank strong command matches above earlier weak fuzzy groups', () => {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))
  const groups = groupedCommandItems(items, '> color')

  expect(groups[0]?.[1].map((item) => item.id)).toEqual([
    'workspace.selectAppColors',
    'workspace.selectColorTheme',
    'workspace.selectColorMode',
  ])
  expect(groups.flatMap(([, groupItems]) => groupItems.map((item) => item.id))).not.toContain(
    'workspace.toggleSidebarVisibility',
  )
})

test('includes both strokes in a chord shortcut hint', () => {
  const bindings = resolvedPlatformKeyBindings(
    defaultPlatformKeyBindings('linux'),
    {
      'workspace.showSettings': 'Mod+K Mod+S',
    },
    'linux',
  )
  const items = commandPaletteItems(platformCommandSpecs, bindings)

  expect(items.find((item) => item.id === 'workspace.showSettings')?.shortcut).toBe(
    formatChord('Mod+K Mod+S'),
  )
})

test('a query ranks matches in one flat list rather than scattering them by category', () => {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))
  const groups = groupedCommandItems(items, '> mode')

  expect(groups).toHaveLength(1)
  expect(groups[0]?.[0]).toBe('Commands')
})

test('the unfiltered command list leads with what was used most recently', () => {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))
  const groups = groupedCommandItems(items, '>', [
    'workspace.selectColorTheme',
    'workspace.toggleSidebarVisibility',
  ])

  expect(groups[0]?.[0]).toBe(RECENTLY_USED_COMMANDS_HEADING)
  expect(groups[0]?.[1].map((item) => item.id)).toEqual([
    'workspace.selectColorTheme',
    'workspace.toggleSidebarVisibility',
  ])
})

test('a promoted command is not also listed under its category', () => {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))
  const groups = groupedCommandItems(items, '>', ['workspace.selectColorTheme'])
  const idsBelowRecents = groups
    .slice(1)
    .flatMap(([, groupItems]) => groupItems.map((item) => item.id))

  expect(idsBelowRecents).not.toContain('workspace.selectColorTheme')
})

test('no recents leaves the plain category order alone', () => {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))

  expect(groupedCommandItems(items, '>', [])).toEqual(groupedCommandItems(items, '>'))
})

test('a matching recent leads the query results even when something else scores higher', () => {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))
  const ids = (recentCommandIds: readonly string[]) =>
    groupedCommandItems(items, '> color', recentCommandIds).flatMap(([, groupItems]) =>
      groupItems.map((item) => item.id),
    )

  expect(ids([])).toEqual([
    'workspace.selectAppColors',
    'workspace.selectColorTheme',
    'workspace.selectColorMode',
  ])
  expect(ids(['workspace.selectColorTheme'])).toEqual([
    'workspace.selectColorTheme',
    'workspace.selectAppColors',
    'workspace.selectColorMode',
  ])
})

test('a query splits recents out under their own heading, newest first', () => {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))
  const groups = groupedCommandItems(items, '> mode', [
    'workspace.showSettings',
    'workspace.showChatMode',
  ])

  expect(groups.map(([heading]) => heading)).toEqual([
    RECENTLY_USED_COMMANDS_HEADING,
    OTHER_COMMANDS_HEADING,
  ])
  expect(groups[0]?.[1].map((item) => item.id)).toEqual([
    'workspace.showSettings',
    'workspace.showChatMode',
  ])
  expect(groups[1]?.[1].map((item) => item.id)).not.toContain('workspace.showSettings')
})

test('recents that do not match the query are not dragged into the results', () => {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))
  const groups = groupedCommandItems(items, '> color', ['workspace.toggleSidebarVisibility'])

  expect(groups.flatMap(([, groupItems]) => groupItems.map((item) => item.id))).not.toContain(
    'workspace.toggleSidebarVisibility',
  )
})

test('open editor items format search buffers as search tabs', () => {
  const content = documentTab({ kind: 'search', root: filesystemPath('/repo') })

  expect(editorPaletteItems([content], content)).toEqual([
    {
      active: true,
      name: 'Search',
      content,
      key: tabContentKey(content),
      pathLabel: '/repo search results',
    },
  ])
})

test('quick access prefixes select the expected mode and query', () => {
  expect(quickAccessMode('view git')).toBe('views')
  expect(quickAccessQuery('view git')).toBe('git')
  expect(quickAccessMode('color dark')).toBe('colorMode')
  expect(quickAccessMode('theme monokai')).toBe('colorTheme')
  expect(quickAccessQuery('theme monokai')).toBe('monokai')
  expect(quickAccessQuery('> save')).toBe('save')
  expect(quickAccessMode('@ Component')).toBe('symbols')
})
