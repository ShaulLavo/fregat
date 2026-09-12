import { SETTINGS_REGISTRY, type SettingsValues, type SessionId } from '@workspace/contracts'
import type { ChatOwnerSnapshot } from '@workspace/client-core/chat/owner'
import type { CommandId } from '@workspace/client-core/commands/catalog'
import {
  quickAccessMode,
  quickAccessQuery,
  scopedPaletteFilter,
} from '@workspace/client-core/commands/palette'

import type { CommandBus } from '@/commands/state/bus'
import type { TerminalBinding } from '@/commands/utils/bindings'
import { paletteOptions } from '@/commands/utils/palette'
import { sessionAccessRows } from '@/commands/utils/session-access'

type PaletteAction =
  | { readonly kind: 'command'; readonly id: CommandId }
  | { readonly kind: 'files'; readonly query: string }
  | { readonly kind: 'app-colors'; readonly id: SettingsValues['workbench.palette'] }
  | { readonly kind: 'session'; readonly sessionId: SessionId }

type PaletteOption = {
  readonly name: string
  readonly description: string
  readonly value: { readonly action: PaletteAction; readonly reason: string | null }
}

const viewCommands = [
  'workspace.revealChat',
  'workspace.showSettings',
  'workspace.showQuickAccess',
  'workspace.openWorkbench',
  'workspace.focusFileTree',
  'workspace.focusEditor',
  'workspace.focusGit',
  'workspace.openSearchEditor',
  'workspace.revealTerminal',
  'workspace.showProblems',
  'workspace.showLogs',
  'workspace.showShortcutHelp',
] as const satisfies readonly CommandId[]

const colorCommands = {
  light: 'workspace.setLightTheme',
  dark: 'workspace.setDarkTheme',
  system: 'workspace.setSystemTheme',
} as const satisfies Record<string, CommandId>

export function paletteModeRows({
  captured,
  bindings,
  search,
  recents,
  colorMode,
  palette,
  writable,
  chat,
}: {
  readonly captured: ReturnType<CommandBus['capture']>
  readonly bindings: readonly TerminalBinding[]
  readonly search: string
  readonly recents: readonly string[]
  readonly colorMode: keyof typeof colorCommands
  readonly palette: SettingsValues['workbench.palette']
  readonly writable: boolean
  readonly chat: ChatOwnerSnapshot
}): { readonly title: string; readonly empty: string; readonly options: PaletteOption[] } {
  const mode = quickAccessMode(search)
  const query = quickAccessQuery(search)
  switch (mode) {
    case 'commands':
      return {
        title: 'Commands',
        empty: 'No matching commands.',
        options: paletteOptions(captured, bindings, search, recents).map((row) => ({
          ...row,
          value: { action: { kind: 'command', id: row.value.id }, reason: row.value.reason },
        })),
      }
    case 'views':
      return {
        title: 'Views',
        empty: 'No matching available views.',
        options: commandRows(captured, viewCommands, query),
      }
    case 'colorMode':
      return {
        title: 'Light / dark mode',
        empty: 'No matching appearance modes.',
        options: commandRows(
          captured,
          Object.values(colorCommands),
          query,
          colorCommands[colorMode],
        ),
      }
    case 'colorTheme':
      return unavailable('Code themes')
    case 'appColors':
      return {
        title: 'App colors',
        empty: 'No matching app colors.',
        options: appColorRows(query, palette, writable),
      }
    case 'files':
      return {
        title: 'Files',
        empty: '',
        options: [
          {
            name: query ? `Browse files matching “${query}”` : 'Browse files',
            description: 'Open the file picker',
            value: {
              action: { kind: 'files', query },
              reason: writable ? null : 'Reconnect to browse files.',
            },
          },
        ],
      }
    case 'editors':
      return unavailable('Open editors')
    case 'scripts':
      return unavailable('Scripts')
    case 'sessions':
      return {
        title: 'Sessions',
        empty: chat.error ?? 'No matching sessions.',
        options: sessionAccessRows(chat.projection, query),
      }
    case 'symbols':
      return unavailable('Symbols')
    case 'gotoLine':
      return unavailable('Go to line')
  }
}

function commandRows(
  captured: ReturnType<CommandBus['capture']>,
  ids: readonly CommandId[],
  query: string,
  active?: CommandId,
): PaletteOption[] {
  return ids.flatMap((id) => {
    const row = captured.inspect(id)
    if (row.status === 'unavailable') return []
    if (scopedPaletteFilter(id, query, [row.command.title, id, row.command.description ?? '']) <= 0)
      return []
    return [
      {
        name: `${row.command.title}${id === active ? ' · active' : ''}`,
        description: row.status === 'disabled' ? row.reason : (row.command.description ?? ''),
        value: {
          action: { kind: 'command', id },
          reason: row.status === 'disabled' ? row.reason : null,
        },
      },
    ]
  })
}

function appColorRows(query: string, active: string, writable: boolean): PaletteOption[] {
  return SETTINGS_REGISTRY['workbench.palette'].schema.options
    .filter((id) => scopedPaletteFilter(id, query) > 0)
    .map((id) => ({
      name: `${id.charAt(0).toUpperCase()}${id.slice(1)}${id === active ? ' · active' : ''}`,
      description: 'Interface colors',
      value: {
        action: { kind: 'app-colors', id },
        reason: writable ? null : 'Reconnect before changing app colors.',
      },
    }))
}

function unavailable(title: string) {
  return { title, empty: `${title} is not available in the TUI yet.`, options: [] }
}
