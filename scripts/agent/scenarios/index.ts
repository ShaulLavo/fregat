import {
  breadcrumbPicker,
  lspReferences,
  environmentsDialog,
  chatChangedFiles,
  patternHints,
} from './pattern-extras'
import {
  gitChanges,
  logsPanel,
  sessionRail,
  filesTree,
  filePicker,
  searchResults,
  terminalTabs,
  gitGraphKeyboard,
} from './pattern-lists'
import { chatTimelinePattern } from './chat-timeline-pattern'
import { settingsFontInput } from './settings-font-input'
import { settingsResponsive } from './settings-responsive'
import { filePickerNavigation, gitHistoryScroll } from './list-regressions'
import { iconHints } from './icon-hints'
import { chatIconHints } from './chat-icon-hints'
import { chatModelPicker } from './chat-model-picker'
import { wallpaperIconHints } from './wallpaper-icon-hints'
import { terminalBackground } from './terminal-background'
import { chatFollowUp } from './chat-follow-up'
import { chatDiffSyntax } from './chat-diff-syntax'
import { editorSplitDrag } from './editor-split-drag'
import { editorSplitActions } from './editor-split-actions'
import { editorSplitContent } from './editor-split-content'
import { editorSplitState } from './editor-split-state'
import { editorSplitFolds } from './editor-split-folds'
import { editorSplitBlur } from './editor-split-blur'
import { editorSplitOrder } from './editor-split-order'
import { editorSplitTargets } from './editor-split-targets'
import { editorSplitBreadcrumbs } from './editor-split-breadcrumbs'
import { editorSplitHistoryState } from './editor-split-history-state'
import { pageLifecycle } from './page-lifecycle'
import { editorExternalEdit } from './editor-external-edit'
import { editorThemePreview } from './editor-theme-preview'
import { editorSyntaxBenchmark } from './editor-syntax-benchmark'
import { themeBundles } from './theme-bundles'
import { bundleWallpapers } from './bundle-wallpapers'
import { themeGallery } from './theme-gallery'
import { colorModePreview } from './color-mode-preview'
import { wallpaperModeToggle } from './wallpaper-mode-toggle'
import { editorLspHover } from './editor-lsp-hover'
import { editorMarkdownPunctuation } from './editor-markdown-punctuation'
import { wallpaperLibrary } from './wallpaper-library'
import { wallpaperPalette } from './wallpaper-palette'
import { settingsDefaults } from './settings-defaults'
import { sidebarSettingsButton } from './sidebar-settings-button'
import { fileIcons } from './file-icons'
import { searchInputUndo } from './search-input-undo'
import { visualSearchPerformance } from './visual-search-performance'
import { visualSearchHeaders } from './visual-search-headers'
import { visualSearchScrollContent } from './visual-search-scroll-content'
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
import { treeFileClicks } from './tree-file-clicks'
import { treeStickyScroll } from './tree-sticky-scroll'
import { demoWorkspace } from './demo-workspace'
import { demoAgentGit } from './demo-agent-git'
import { demoReset } from './demo-reset'
import { demoStartup } from './demo-startup'
import { demoThemeStartup } from './demo-theme-startup'
import { demoWallpaperStartup } from './demo-wallpaper-startup'

export const scenarios: readonly Scenario[] = [
  workbenchListFocus,
  breadcrumbPicker,
  lspReferences,
  environmentsDialog,
  chatChangedFiles,
  patternHints,
  iconHints,
  chatIconHints,
  chatModelPicker,
  wallpaperIconHints,
  gitChanges,
  logsPanel,
  sessionRail,
  filesTree,
  filePicker,
  filePickerNavigation,
  gitHistoryScroll,
  settingsResponsive,
  searchResults,
  terminalTabs,
  gitGraphKeyboard,
  chatTimelinePattern,
  chatFollowUp,
  chatDiffSyntax,
  editorSplitDrag,
  editorSplitActions,
  editorSplitContent,
  editorSplitState,
  editorSplitFolds,
  editorSplitBlur,
  editorSplitOrder,
  editorSplitTargets,
  editorSplitBreadcrumbs,
  editorSplitHistoryState,
  editorExternalEdit,
  terminalBackground,
  editorThemePreview,
  editorSyntaxBenchmark('native'),
  editorSyntaxBenchmark('shiki'),
  editorSyntaxBenchmark('shiki', true),
  themeGallery,
  colorModePreview,
  pageLifecycle,
  themeBundles,
  bundleWallpapers,
  editorLspHover,
  editorMarkdownPunctuation,
  fileIcons,
  searchInputUndo,
  visualSearchPerformance,
  visualSearchHeaders,
  visualSearchScrollContent,
  quickOpenNewFile,
  quickOpenLinkedFile,
  quickOpenNoFlicker,
  gitHistorySearchNoFlicker,
  logsSearchNoFlicker,
  wallpaperModeToggle,
  wallpaperLibrary,
  wallpaperPalette,
  settingsDefaults,
  sidebarSettingsButton,
  settingsFontInput,
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
  treeFileClicks,
]

export function scenarioNamed(name: string): Scenario {
  const scenario = scenarios.find((entry) => entry.name === name)
  if (scenario) return scenario
  const names = scenarios.map((entry) => entry.name).join(', ')
  throw new Error(`Unknown scenario "${name}". Known: ${names}`)
}
import { workbenchListFocus } from './workbench-list-focus'
