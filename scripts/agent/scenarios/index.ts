import { pageLifecycle } from './page-lifecycle'
import { editorThemePreview } from './editor-theme-preview'
import { themeBundles } from './theme-bundles'
import { themeGallery } from './theme-gallery'
import { wallpaperModeToggle } from './wallpaper-mode-toggle'
import { editorLspHover } from './editor-lsp-hover'
import { editorMarkdownPunctuation } from './editor-markdown-punctuation'
import { wallpaperLibrary } from './wallpaper-library'
import { wallpaperPalette } from './wallpaper-palette'
import { settingsDefaults } from './settings-defaults'
import { fileIcons } from './file-icons'
import { searchInputUndo } from './search-input-undo'
import { quickOpenNewFile } from './quick-open-new-file'
import { quickOpenLinkedFile } from './quick-open-linked-file'
import { quickOpenNoFlicker } from './quick-open-no-flicker'
import { gitHistorySearchNoFlicker } from './git-history-search-no-flicker'
import { logsSearchNoFlicker } from './logs-search-no-flicker'
import type { Page } from 'playwright'

type ScenarioContext = {
  readonly file: string
  readonly step: (label: string) => Promise<void>
}

export type Scenario = {
  readonly surface?: 'site' | 'demo'
  readonly name: string
  readonly description: string
  readonly run: (page: Page, context: ScenarioContext) => Promise<void>
  readonly inspect?: (page: Page) => Promise<unknown>
}

import { editorFastScroll } from './editor-fast-scroll'
import { editorRowHeightAudit } from './editor-row-height-audit'
import { editorLargePaste } from './editor-large-paste'
import { editorTypeBurst } from './editor-type-burst'
import { editorUndoBarrier } from './editor-undo-barrier'
import { editorUndoBranch } from './editor-undo-branch'
import { gitHistory } from './git-history'
import { editorCaretBurst } from './editor-caret-burst'
import { editorFocusClicks } from './editor-focus-clicks'
import { editorProduct } from './editor-product'
import { treeStickyScroll } from './tree-sticky-scroll'
import { demoWorkspace } from './demo-workspace'
import { demoAgentGit } from './demo-agent-git'
import { demoReset } from './demo-reset'
import { demoStartup } from './demo-startup'
import { demoThemeStartup } from './demo-theme-startup'
import { demoWallpaperStartup } from './demo-wallpaper-startup'

export const scenarios: readonly Scenario[] = [
  editorThemePreview,
  themeGallery,
  pageLifecycle,
  themeBundles,
  editorLspHover,
  editorMarkdownPunctuation,
  fileIcons,
  searchInputUndo,
  quickOpenNewFile,
  quickOpenLinkedFile,
  quickOpenNoFlicker,
  gitHistorySearchNoFlicker,
  logsSearchNoFlicker,
  wallpaperModeToggle,
  wallpaperLibrary,
  wallpaperPalette,
  settingsDefaults,
  demoWorkspace,
  demoAgentGit,
  demoReset,
  demoStartup,
  demoThemeStartup,
  demoWallpaperStartup,
  gitHistory,
  editorLargePaste,
  editorFastScroll,
  editorRowHeightAudit,
  editorTypeBurst,
  editorUndoBarrier,
  editorUndoBranch,
  editorCaretBurst,
  editorFocusClicks,
  editorProduct,
  treeStickyScroll,
]

export function scenarioNamed(name: string): Scenario {
  const scenario = scenarios.find((entry) => entry.name === name)
  if (scenario) return scenario
  const names = scenarios.map((entry) => entry.name).join(', ')
  throw new Error(`Unknown scenario "${name}". Known: ${names}`)
}
