import type { Theme } from '@/features/settings/providers/theme-context'
import type { FlatDocumentSymbol } from '@/lib/document-symbols'
import { GotoLineGroups } from '@/features/command-palette/components/goto-line-groups'
import { AppColorsGroups } from '@/features/command-palette/components/app-colors-groups'
import { ThemeBundleGroups } from '@/features/command-palette/components/theme-bundle-groups'
import { WallpaperGroups } from '@/features/command-palette/components/wallpaper-groups'

import { ColorModeGroups } from '@/features/command-palette/components/color-mode-groups'
import { ColorThemeGroups } from '@/features/command-palette/components/color-theme-groups'
import { CommandGroups } from '@/features/command-palette/components/command-groups'
import type {
  ColorModePaletteItem,
  CommandPaletteItem,
  EditorPaletteItem,
  FilePaletteItem,
  QuickAccessMode,
  ViewPaletteItem,
} from '@/features/command-palette/utils/types'
import { EditorGroups } from '@/features/command-palette/components/editor-groups'
import { QuickOpenGroups } from '@/features/command-palette/components/quick-open-groups'
import { ScriptGroups } from '@/features/command-palette/components/script-groups'
import { SessionGroups } from '@/features/command-palette/components/session-groups'
import { SymbolGroups } from '@/features/command-palette/components/symbol-groups'
import { ViewGroups } from '@/features/command-palette/components/view-groups'
import type { ProjectScriptSuggestion } from '@/features/chat-mode/utils/project-scripts'
import type { SessionRailItem, SessionRailProject } from '@workspace/client-core/chat/rail/model'

type GroupsFactoryProps = {
  readonly colorModeItems: readonly ColorModePaletteItem[]
  readonly commandGroups: readonly (readonly [string, readonly CommandPaletteItem[]])[]
  readonly currentTheme: Theme
  readonly editorItems: readonly EditorPaletteItem[]
  readonly fileItems: readonly FilePaletteItem[]
  readonly fileQuery: string
  readonly fileSearchError: boolean
  readonly hasWorkspace: boolean
  readonly mode: QuickAccessMode
  readonly scriptItems: readonly ProjectScriptSuggestion[]
  readonly scriptsPending: boolean
  readonly sessionItems: readonly SessionRailItem[]
  readonly sessionProjects: readonly SessionRailProject[]
  readonly symbolItems: readonly FlatDocumentSymbol[]
  readonly symbolsPending: boolean
  readonly viewItems: readonly ViewPaletteItem[]
}

export function GroupsFactory({
  colorModeItems,
  commandGroups,
  currentTheme,
  editorItems,
  fileItems,
  fileQuery,
  fileSearchError,
  hasWorkspace,
  mode,
  scriptItems,
  scriptsPending,
  sessionItems,
  sessionProjects,
  symbolItems,
  symbolsPending,
  viewItems,
}: GroupsFactoryProps) {
  if (mode === 'commands') {
    return <CommandGroups groups={commandGroups} />
  }

  if (mode === 'views') {
    return <ViewGroups items={viewItems} />
  }

  if (mode === 'colorMode') {
    return <ColorModeGroups currentTheme={currentTheme} items={colorModeItems} />
  }

  if (mode === 'appColors') {
    return <AppColorsGroups />
  }

  if (mode === 'themeBundle') {
    return <ThemeBundleGroups />
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
    return <ScriptGroups isPending={scriptsPending} scripts={scriptItems} />
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
