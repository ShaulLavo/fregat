import { defineMetadata, type CommandKeyDefault } from './metadata'

function foundation<const Id extends `workspace.${string}`>(
  id: Id,
  title: string,
  description: string,
  keys: readonly CommandKeyDefault[] = [],
) {
  return defineMetadata({
    id,
    title,
    description,
    keys,
    category: 'Workspace',
    execution: 'async',
    target: 'workspace',
    undoCategory: 'view-only',
    when: [],
  })
}

export const foundationCommandMetadata = {
  'workspace.openAddress': foundation(
    'workspace.openAddress',
    'Open address',
    'Navigate to a Platform address.',
  ),
  'workspace.reconnect': foundation(
    'workspace.reconnect',
    'Reconnect',
    'Reconnect and reload the current environment.',
    [{ chord: ['Control+R'], platforms: ['tui'] }],
  ),
  'workspace.quit': foundation(
    'workspace.quit',
    'Quit',
    'Close Platform and restore the terminal.',
    [
      { chord: ['Control+C'], platforms: ['tui'] },
      { chord: ['Control+K', 'Q'], platforms: ['tui'] },
    ],
  ),
  'workspace.suspend': foundation(
    'workspace.suspend',
    'Suspend',
    'Restore the terminal and suspend until the shell resumes Platform.',
    [{ chord: ['Control+Z'], platforms: ['tui'] }],
  ),
  'workspace.focusNextPane': foundation(
    'workspace.focusNextPane',
    'Focus next pane',
    'Move focus to the next visible pane.',
    [{ chord: ['Tab'], platforms: ['tui'] }],
  ),
  'workspace.focusPreviousPane': foundation(
    'workspace.focusPreviousPane',
    'Focus previous pane',
    'Move focus to the previous visible pane.',
    [{ chord: ['Shift+Tab'], platforms: ['tui'] }],
  ),
  'workspace.dismiss': foundation(
    'workspace.dismiss',
    'Dismiss',
    'Close the current overlay or return to its parent.',
    [{ chord: ['Escape'], platforms: ['tui'] }],
  ),
  'workspace.showShortcutHelp': foundation(
    'workspace.showShortcutHelp',
    'Show keyboard shortcuts',
    'Show available commands and their keyboard shortcuts.',
    [{ chord: [{ key: '?' }], platforms: ['tui'] }],
  ),
}
