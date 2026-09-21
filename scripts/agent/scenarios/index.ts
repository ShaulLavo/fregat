import { responseDelivery } from './response-delivery'
import { draftRecovery } from './draft-recovery'
import { composerDefaults } from './composer-defaults'
import { sessionNotifications } from './session-notifications'
import { terminalHistory } from './terminal-history'
import { chatStashContext } from './chat-stash-context'
import { fileAttachments } from './file-attachments'
import { sessionTitles } from './session-titles'
import { sessionNavigation } from './session-navigation'
import { sessionOrdering } from './session-ordering'
import { backgroundLiveness } from './background-liveness'
import { sessionLifecycle } from './session-lifecycle'
import { asyncQuestions } from './async-questions'
import { projectGrouping } from './project-grouping'
import { sessionSearch, sessionSearchEnvironments } from './session-search'
import { sessionUnread } from './session-unread'
import { mcpApproval } from './mcp-approval'
import { checkpointRewind } from './checkpoint-rewind'
import { archiveLifecycle } from './archive-lifecycle'
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
import { bottomPanelPersistence } from './bottom-panel-persistence'
import { gitOpenAllDiffsSpam } from './git-open-all-diffs-spam'
import { gitStageSettles } from './git-stage-settles'
import { commandPaletteTypeBurst } from './command-palette-type-burst'
import { paletteScriptsPending } from './palette-scripts-pending'
import { settingsModelsPending } from './settings-models-pending'
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
import { editorNativeCoverage } from './editor-native-coverage'
import { editorSyntaxBenchmark } from './editor-syntax-benchmark'
import { themeBundles } from './theme-bundles'
import { bundleWallpapers } from './bundle-wallpapers'
import { themeGallery } from './theme-gallery'
import { colorModePreview } from './color-mode-preview'
import { wallpaperModeToggle } from './wallpaper-mode-toggle'
import { editorAutoClose } from './editor-auto-close'
import { editorFormatChord } from './editor-format-chord'
import { editorLspCompletion } from './editor-lsp-completion'
import { editorLspHover } from './editor-lsp-hover'
import { editorLspSignatureHelp } from './editor-lsp-signature-help'
import { editorMarkdownPunctuation } from './editor-markdown-punctuation'
import { wallpaperLibrary } from './wallpaper-library'
import { wallpaperPalette } from './wallpaper-palette'
import { themeBundlePalette } from './theme-bundle-palette'
import { settingsDefaults } from './settings-defaults'
import { projectMenu } from './project-menu'
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
import { searchTypeDelete } from './search-type-delete'
import { paneRenderCrash } from './pane-render-crash'
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

import { editorDiagnosticsLifecycle } from './editor-diagnostics-lifecycle'
import { editorFastScroll } from './editor-fast-scroll'
import { editorRowHeightAudit } from './editor-row-height-audit'
import { editorLargePaste } from './editor-large-paste'
import { editorFind } from './editor-find'
import { editorTypeBurst } from './editor-type-burst'
import { editorUndoBarrier } from './editor-undo-barrier'
import { editorUndoBranch } from './editor-undo-branch'
import { editorTitleDiffToggle } from './editor-title-diff-toggle'
import { editorUndoReopen } from './editor-undo-reopen'
import { gitCommitHookColors } from './git-commit-hook-colors'
import { gitCommitMessageFile } from './git-commit-message-file'
import { gitCommitMessagePersists } from './git-commit-message-persists'
import { gitCommitSlowHook } from './git-commit-slow-hook'
import { gitFixWithAgent } from './git-fix-with-agent'
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
  terminalHistory,
  responseDelivery,
  archiveLifecycle,
  sessionUnread,
  sessionSearch,
  sessionSearchEnvironments,
  projectGrouping,
  sessionLifecycle,
  sessionNavigation,
  sessionOrdering,
  sessionTitles,
  sessionNotifications,
  composerDefaults,
  mcpApproval,
  fileAttachments,
  chatStashContext,
  draftRecovery,
  asyncQuestions,
  backgroundLiveness,
  checkpointRewind,
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
  bottomPanelPersistence,
  gitOpenAllDiffsSpam,
  gitStageSettles,
  commandPaletteTypeBurst,
  paletteScriptsPending,
  settingsModelsPending,
  editorThemePreview,
  editorSyntaxBenchmark('native'),
  editorNativeCoverage('light'),
  editorNativeCoverage('dark'),
  editorSyntaxBenchmark('shiki'),
  editorSyntaxBenchmark('shiki', true),
  themeGallery,
  colorModePreview,
  pageLifecycle,
  themeBundles,
  bundleWallpapers,
  editorAutoClose,
  editorFormatChord,
  editorLspCompletion,
  editorLspHover,
  editorLspSignatureHelp,
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
  searchTypeDelete,
  paneRenderCrash,
  wallpaperModeToggle,
  wallpaperLibrary,
  wallpaperPalette,
  themeBundlePalette,
  settingsDefaults,
  projectMenu,
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
  editorDiagnosticsLifecycle,
  editorRowHeightAudit,
  editorFind,
  editorTypeBurst,
  editorUndoBarrier,
  editorUndoBranch,
  editorTitleDiffToggle,
  editorUndoReopen,
  gitCommitHookColors,
  gitCommitMessageFile,
  gitCommitSlowHook,
  gitCommitMessagePersists,
  gitFixWithAgent,
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
