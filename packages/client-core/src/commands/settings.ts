import { defineMetadata, type CommandKeyDefault } from './metadata'

function setting<const Id extends `settings.${string}` | `dialog.${string}`>(
  id: Id,
  title: string,
  description: string,
  key: CommandKeyDefault,
) {
  return defineMetadata({
    id,
    title,
    description,
    keys: [key],
    category: 'Settings',
    execution: 'async',
    target: 'workspace',
    undoCategory: 'view-only',
    when: [],
  })
}

export const settingsCommandMetadata = {
  'settings.edit': setting(
    'settings.edit',
    'Edit selected setting',
    'Change the selected setting in the current scope.',
    { chord: ['F2'], platforms: ['tui'], pane: 'settings' },
  ),
  'settings.editRaw': defineMetadata({
    id: 'settings.editRaw',
    title: 'Edit settings JSON',
    description: 'Edit the current settings scope in the built-in editor with revision protection.',
    category: 'Settings',
    execution: 'async',
    target: 'workspace',
    undoCategory: 'view-only',
    when: [],
  }),
  'settings.viewDefaults': defineMetadata({
    id: 'settings.viewDefaults',
    title: 'View default settings',
    description: 'Open every setting with its default value as a read-only document.',
    category: 'Settings',
    execution: 'async',
    target: 'workspace',
    undoCategory: 'view-only',
    when: [],
  }),
  'settings.nextScope': setting(
    'settings.nextScope',
    'Change settings scope',
    'Switch between user and workspace settings.',
    { chord: ['F3'], platforms: ['tui'], pane: 'settings' },
  ),
  'settings.reset': setting(
    'settings.reset',
    'Reset selected setting',
    'Remove the selected setting from the current scope.',
    { chord: ['F4'], platforms: ['tui'], pane: 'settings' },
  ),
  'settings.retry': setting(
    'settings.retry',
    'Retry settings changes',
    'Retry pending settings changes after a failed write.',
    { chord: ['F5'], platforms: ['tui'], pane: 'settings' },
  ),
  'settings.discard': setting(
    'settings.discard',
    'Discard settings changes',
    'Discard pending settings changes.',
    { chord: ['F6'], platforms: ['tui'], pane: 'settings' },
  ),
  'dialog.confirm': setting('dialog.confirm', 'Confirm dialog', 'Submit the current dialog.', {
    chord: ['F2'],
    platforms: ['tui'],
    pane: 'dialog',
  }),
}
