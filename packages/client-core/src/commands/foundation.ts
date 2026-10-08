import { defineMetadata } from './metadata'

function foundation<const Id extends `workspace.${string}`>(
  id: Id,
  title: string,
  description: string,
) {
  return defineMetadata({
    id,
    title,
    description,

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
    'Navigate to a Fregat address.',
  ),
  'workspace.reconnect': foundation(
    'workspace.reconnect',
    'Reconnect',
    'Reconnect and reload the current environment.',
  ),
  'workspace.quit': foundation('workspace.quit', 'Quit', 'Close Fregat and restore the terminal.'),
  'workspace.suspend': foundation(
    'workspace.suspend',
    'Suspend',
    'Restore the terminal and suspend until the shell resumes Fregat.',
  ),
  'workspace.focusNextPane': foundation(
    'workspace.focusNextPane',
    'Focus next pane',
    'Move focus to the next visible pane.',
  ),
  'workspace.focusPreviousPane': foundation(
    'workspace.focusPreviousPane',
    'Focus previous pane',
    'Move focus to the previous visible pane.',
  ),
  'workspace.dismiss': foundation(
    'workspace.dismiss',
    'Dismiss',
    'Close the current overlay or return to its parent.',
  ),
  'workspace.showShortcutHelp': foundation(
    'workspace.showShortcutHelp',
    'Show keyboard shortcuts',
    'Show available commands and their keyboard shortcuts.',
  ),
}
