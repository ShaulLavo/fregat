import { defineMetadata } from './metadata'

function setting<const Id extends `settings.${string}` | `dialog.${string}`>(
  id: Id,
  title: string,
  description: string,
) {
  return defineMetadata({
    id,
    title,
    description,

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
  ),
  'settings.editRaw': defineMetadata({
    id: 'settings.editRaw',
    title: 'Edit settings JSON',
    description: 'Open the settings file in the editor to change it as JSON.',
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
  ),
  'settings.reset': setting(
    'settings.reset',
    'Reset selected setting',
    'Remove the selected setting from the current scope.',
  ),
  'settings.retry': setting(
    'settings.retry',
    'Retry settings changes',
    'Retry pending settings changes after a failed write.',
  ),
  'settings.discard': setting(
    'settings.discard',
    'Discard settings changes',
    'Discard pending settings changes.',
  ),
  'dialog.confirm': setting('dialog.confirm', 'Confirm dialog', 'Submit the current dialog.'),
}
