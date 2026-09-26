import {
  ChatCircleIcon,
  CommandIcon,
  CopyIcon,
  DesktopIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GearSixIcon,
  type Icon,
  MoonIcon,
  PaintBrushIcon,
  PaletteIcon,
  SquaresFourIcon,
  SunIcon,
} from '@phosphor-icons/react'

import type { Theme } from '@/features/settings/providers/theme-context'
import {
  actionItem,
  commandItem,
  section,
  submenuItem,
  type Menu,
  type MenuRadioGroupItem,
  type MenuRadioItem,
} from '@/keymap/menus/utils/model'
import type { ProjectMenuEntry } from '@/features/workbench/utils/project-menu-model'
import type { PlatformCommandId } from '@/keymap/types'
import type { WorkspaceUiMode } from '@/lib/ui-mode'

export type TitlebarMenuContext = {
  readonly colorMode: Theme
  readonly copyWorkspacePath: () => void
  /** Every root the menu can switch to, active one first. Empty drops the submenu. */
  readonly projects: readonly ProjectMenuEntry[]
  readonly selectProject: (rootPath: string) => void
  readonly uiMode: WorkspaceUiMode
  /** Absolute path of the open root, or null when no workspace is open. */
  readonly workspacePath: string | null
}

type CommandChoice = {
  readonly command: PlatformCommandId
  readonly icon: Icon
  readonly label: string
}

const uiModeChoices: readonly CommandChoice[] = [
  { command: 'workspace.showWorkbenchMode', icon: SquaresFourIcon, label: 'Workbench Mode' },
  { command: 'workspace.showChatMode', icon: ChatCircleIcon, label: 'Chat Mode' },
]

const colorModeChoices: readonly CommandChoice[] = [
  { command: 'workspace.setLightTheme', icon: SunIcon, label: 'Light' },
  { command: 'workspace.setDarkTheme', icon: MoonIcon, label: 'Dark' },
  { command: 'workspace.setSystemTheme', icon: DesktopIcon, label: 'System' },
]

/**
 * The window-level menu: what this app *is* pointed at, and how it is shown.
 * Nothing here is scoped to a document, so the same items are offered wherever
 * in the title bar the click lands.
 */
export function titlebarMenu(context: TitlebarMenuContext): Menu {
  return [
    section('project', [
      commandItem('workspace.openFilePicker', { icon: FolderPlusIcon, label: 'Open Folder…' }),
      projectSubmenu(context),
    ]),
    section('view', [
      commandItem('workspace.showCommandPalette', {
        icon: CommandIcon,
        label: 'Command Palette…',
      }),
      commandRadio('uiMode', uiModeCommand(context.uiMode), uiModeChoices),
      submenuItem({
        icon: PaletteIcon,
        id: 'colorMode',
        label: 'Light / dark mode',
        sections: [
          section('colorModeChoices', [
            commandRadio('colorMode', colorModeCommand(context.colorMode), colorModeChoices),
          ]),
        ],
      }),
    ]),
    section('settings', [
      commandItem('workspace.openThemeStudio', {
        icon: PaintBrushIcon,
        label: 'Theme…',
        takesFocus: true,
      }),
      commandItem('workspace.showSettings', { icon: GearSixIcon, label: 'Settings…' }),
    ]),
    section('copy', [
      actionItem({
        disabled: context.workspacePath === null,
        icon: CopyIcon,
        id: 'copyWorkspacePath',
        label: 'Copy Workspace Path',
        run: context.copyWorkspacePath,
      }),
    ]),
  ]
}

/**
 * Omitted rather than disabled when nothing is known yet: a submenu that opens
 * onto an empty popup is worse than no submenu.
 */
function projectSubmenu(context: TitlebarMenuContext) {
  if (context.projects.length === 0) return null

  return submenuItem({
    icon: FolderOpenIcon,
    id: 'switchProject',
    label: 'Switch Project',
    sections: [
      section('projects', [
        {
          id: 'projectRoot',
          kind: 'radio-group',
          options: context.projects.map(projectOption),
          select: context.selectProject,
          value: context.workspacePath ?? '',
        },
      ]),
    ],
  })
}

/**
 * The qualifier rides in the label because a radio row has no trailing slot —
 * without it two projects named `web` are indistinguishable.
 */
function projectOption(entry: ProjectMenuEntry): MenuRadioItem {
  if (entry.worktree) return { label: worktreeLabel(entry), value: entry.rootPath }
  if (!entry.qualifier) return { label: entry.title, value: entry.rootPath }

  return { label: `${entry.title} — ${entry.qualifier}`, value: entry.rootPath }
}

/** A radio row has no leading slot either, so the nesting is a glyph in the label. */
function worktreeLabel(entry: ProjectMenuEntry) {
  const branch = entry.worktree?.branch
  return branch ? `↳ ${entry.title} — ${branch}` : `↳ ${entry.title}`
}

/**
 * A radio set whose values are command ids, so the menu never carries its own
 * copy of the state transition — picking a row runs the same command the
 * palette and the keymap run.
 */
function commandRadio(
  id: string,
  value: PlatformCommandId,
  choices: readonly CommandChoice[],
): MenuRadioGroupItem {
  return {
    id,
    kind: 'radio-group',
    options: choices.map((choice) => ({
      command: choice.command,
      icon: choice.icon,
      label: choice.label,
      value: choice.command,
    })),
    value,
  }
}

function uiModeCommand(uiMode: WorkspaceUiMode): PlatformCommandId {
  return uiMode === 'chat' ? 'workspace.showChatMode' : 'workspace.showWorkbenchMode'
}

function colorModeCommand(colorMode: Theme): PlatformCommandId {
  if (colorMode === 'light') return 'workspace.setLightTheme'
  if (colorMode === 'dark') return 'workspace.setDarkTheme'

  return 'workspace.setSystemTheme'
}
