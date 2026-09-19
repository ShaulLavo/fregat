import type { Theme } from '@/features/settings/providers/theme-context'
import type { FlatDocumentSymbol } from '@/lib/document-symbols'
import { GotoLineGroups } from '@/features/command-palette/goto-line-groups'
import { AppColorsGroups } from '@/features/command-palette/components/app-colors-groups'
import { WallpaperGroups } from '@/features/command-palette/components/wallpaper-groups'

import { ColorModeGroups } from '@/features/command-palette/color-mode-groups'
import { ColorThemeGroups } from '@/features/command-palette/color-theme-groups'
import { CommandGroups } from '@/features/command-palette/command-groups'
import type {
  CommandPaletteItem,
  EditorPaletteItem,
  FilePaletteItem,
  QuickAccessMode,
} from '@/features/command-palette/command-palette-types'
import { EditorGroups } from '@/features/command-palette/editor-groups'
import { QuickOpenGroups } from '@/features/command-palette/quick-open-groups'
import { ScriptGroups } from '@/features/command-palette/script-groups'
import { SessionGroups } from '@/features/command-palette/session-groups'
import { SymbolGroups } from '@/features/command-palette/symbol-groups'
import { ViewGroups } from '@/features/command-palette/view-groups'
import type { ProjectScriptSuggestion } from '@/features/chat-mode/utils/project-scripts'
import type { SessionRailItem, SessionRailProject } from '@workspace/client-core/chat/rail/model'

type CommandPaletteGroupsFactoryProps = {
  readonly commandGroups: readonly (readonly [string, readonly CommandPaletteItem[]])[]
  readonly currentTheme: Theme
  readonly editorItems: readonly EditorPaletteItem[]
  readonly fileItems: readonly FilePaletteItem[]
  readonly fileQuery: string
  readonly fileSearchError: boolean
  readonly hasWorkspace: boolean
  readonly mode: QuickAccessMode
  readonly scriptItems: readonly ProjectScriptSuggestion[]
  readonly sessionItems: readonly SessionRailItem[]
  readonly sessionProjects: readonly SessionRailProject[]
  readonly symbolItems: readonly FlatDocumentSymbol[]
  readonly symbolsPending: boolean
}

export function CommandPaletteGroupsFactory({
  commandGroups,
  currentTheme,
  editorItems,
  fileItems,
  fileQuery,
  fileSearchError,
  hasWorkspace,
  mode,
  scriptItems,
  sessionItems,
  sessionProjects,
  symbolItems,
  symbolsPending,
}: CommandPaletteGroupsFactoryProps) {
  if (mode === 'commands') {
    return <CommandGroups groups={commandGroups} />
  }

  if (mode === 'views') {
    return <ViewGroups />
  }

  if (mode === 'colorMode') {
    return <ColorModeGroups currentTheme={currentTheme} />
  }

  if (mode === 'appColors') {
    return <AppColorsGroups />
  }

  if (mode === 'wallpaper') {
    return <WallpaperGroups />
  }

  if (mode === 'colorTheme') {
    return <ColorThemeGroups />
  }

  if (mode === 'editors') {
    return <EditorGroups items={editorItems} />
  }

  if (mode === 'scripts') {
    return <ScriptGroups scripts={scriptItems} />
  }

  if (mode === 'sessions') {
    return <SessionGroups projects={sessionProjects} sessions={sessionItems} />
  }

  if (mode === 'symbols') {
    return <SymbolGroups isPending={symbolsPending} items={symbolItems} />
  }

  if (mode === 'gotoLine') {
    return <GotoLineGroups query={fileQuery} />
  }

  return (
    <QuickOpenGroups
      files={fileItems}
      hasWorkspace={hasWorkspace}
      query={fileQuery}
      searchError={fileSearchError}
    />
  )
}
