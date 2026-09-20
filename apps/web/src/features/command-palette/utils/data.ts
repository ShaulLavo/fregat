import { hiddenPaletteCommandIds, paletteModeCommandIds } from '@/keymap/table'
import type { PlatformCommandId } from '@/keymap/types'

import type { ColorModePaletteItem, ViewPaletteItem } from '@/features/command-palette/utils/types'

// The palette's names for three projections of the command table. Each set used
// to be written out by hand here, which is how a command could be listed as
// palette-mode in one file and not in the other.
export const paletteModeCommands: ReadonlySet<PlatformCommandId> = paletteModeCommandIds
export const hiddenCommandPaletteCommands: ReadonlySet<PlatformCommandId> = hiddenPaletteCommandIds

export const viewPaletteItems: readonly ViewPaletteItem[] = [
  {
    command: 'workspace.showChatMode',
    description: 'Sessions, chat, and tools in the chat layout.',
    title: 'Chat mode',
    value: 'view:chat-mode',
  },
  {
    command: 'workspace.showWorkbenchMode',
    description: 'The editor-centred workbench layout.',
    title: 'Workbench mode',
    value: 'view:workbench-mode',
  },
  {
    command: 'workspace.focusFileTree',
    description: 'Focus the workspace file explorer.',
    title: 'Explorer',
    value: 'view:explorer',
  },
  {
    command: 'workspace.focusGit',
    description: 'Focus source control.',
    title: 'Source Control',
    value: 'view:source-control',
  },
  {
    command: 'workspace.openSearchEditor',
    description: 'Open workspace search results in an editor tab.',
    title: 'Search',
    value: 'view:search',
  },
  {
    command: 'workspace.focusEditor',
    description: 'Focus the active editor.',
    title: 'Editor',
    value: 'view:editor',
  },
  {
    command: 'workspace.openFilePicker',
    description: 'Choose a workspace folder.',
    title: 'Open Folder',
    value: 'view:open-folder',
  },
  {
    command: 'workspace.showSettings',
    description: 'Providers, models, and keybindings.',
    title: 'Settings',
    value: 'view:settings',
  },
]

export const colorModePaletteItems: readonly ColorModePaletteItem[] = [
  {
    command: 'workspace.setLightTheme',
    description: 'Use light mode.',
    mode: 'light',
    title: 'Light',
    value: 'color-mode:light',
  },
  {
    command: 'workspace.setDarkTheme',
    description: 'Use dark mode.',
    mode: 'dark',
    title: 'Dark',
    value: 'color-mode:dark',
  },
  {
    command: 'workspace.setSystemTheme',
    description: 'Follow the system light or dark mode.',
    mode: 'system',
    title: 'System',
    value: 'color-mode:system',
  },
]
