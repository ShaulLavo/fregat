import { settingsRoutePreparation } from './settings-route-preparation'
import { settingsModuleFailure } from './settings-module-failure'
import { connectionRefusalRetention } from './connection-refusal-retention'
import { cachedProtocolStartup } from './cached-protocol-startup'
import { editorLspTabSwitch } from './editor-lsp-tab-switch'
import { editorLspServerExit } from './editor-lsp-server-exit'
import { editorTypography } from './editor-typography'
import { editorDecodeReveal } from './editor-decode-reveal'
import { responseDelivery } from './response-delivery'
import { draftRecovery } from './draft-recovery'
import { composerDefaults } from './composer-defaults'
import { sessionNotifications } from './session-notifications'
import { terminalHistory } from './terminal-history'
import { chatStream } from './chat-stream'
import { chatHistoryPages } from './chat-history-pages'
import { chatStashContext } from './chat-stash-context'
import { chatQueue } from './chat-queue'
import { providerModelOptions } from './provider-model-options'
import { fileAttachments } from './file-attachments'
import { sessionTitles } from './session-titles'
import { sessionNavigation } from './session-navigation'
import { sessionOrdering } from './session-ordering'
import { backgroundLiveness } from './background-liveness'
import { spinnerPalette } from './spinner-palette'
import { sessionLifecycle } from './session-lifecycle'
import { sessionUndo } from './session-undo'
import { asyncQuestions } from './async-questions'
import { projectGrouping } from './project-grouping'
import { sessionSearch, sessionSearchEnvironments } from './session-search'
import { sessionUnread } from './session-unread'
import { mcpApproval } from './mcp-approval'
import { chatScreenshot } from './chat-screenshot'
import { chatMultipleModels } from './chat-multiple-models'
import { chatComposerEditing } from './chat-composer-editing'
import { chatArtifactTemplate } from './chat-artifact-template'
import { chatModelFavorites } from './chat-model-favorites'
import { chatBackgroundStart } from './chat-background-start'
import { approvalTurnEnded } from './approval-turn-ended'
import { approvalTwoTabs } from './approval-two-tabs'
import { approvalReconnect } from './approval-reconnect'
import { stoppedTurnReasons } from './stopped-turn-reasons'
import { streamAmbiguousTail } from './stream-ambiguous-tail'
import { streamCodeColour } from './stream-code-colour'
import { claudeApprovalRules, codexApprovalRules } from './approval-rules'
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
import { panelSeams } from './panel-seams'
import { surfaceAudit } from './surface-audit'
import { surfaceStacking } from './surface-stacking'
import { chatTimelinePattern } from './chat-timeline-pattern'
import { copyFeedback } from './copy-feedback'
import { fileLabelCohesion } from './file-label-cohesion'
import { checkpointStates } from './checkpoint-states'
import { checkpointDiffTokens } from './checkpoint-diff-tokens'
import { sessionActionsSurfaces } from './session-actions-surfaces'
import { exportTranscript } from './export-transcript'
import { claudeHookRows } from './hook-rows'
import { claudeBackgroundTasks } from './background-tasks'
import { claudeCustomAgent } from './custom-agent'
import { customAgentProviderSwitch } from './custom-agent-switch'
import { claudeContextPopover } from './context-popover'
import { claudeManualCompaction, codexManualCompaction } from './manual-compaction'
import { claudeSessionTools, codexSessionTools } from './session-tools'
import { claudeSessionFork, codexSessionFork } from './session-fork'
import { searchFileActions } from './search-file-actions'
import { settingsStaleDiagnostics } from './settings-stale-diagnostics'
import { fontPicker } from './font-picker'
import { fontPickerHover } from './font-picker-hover'
import { settingsSaveRejected } from './settings-save-rejected'
import { settingsResponsive } from './settings-responsive'
import { filePickerNavigation, gitHistoryScroll } from './list-regressions'
import { iconHints } from './icon-hints'
import { chatIconHints } from './chat-icon-hints'
import { chatCardNarrow } from './chat-card-narrow'
import { chatComposerInsert } from './chat-composer-insert'
import { chatDisclosureSettle } from './chat-disclosure-settle'
import { chatTurnAnatomy } from './chat-turn-anatomy'
import { fileTreeHoverPrefetch } from './file-tree-hover-prefetch'
import { prefetchChatSwitch } from './prefetch-chat-switch'
import { prefetchFirstPaint } from './prefetch-first-paint'
import {
  filePickerPrefetchBound,
  workspaceOpenLargeRoot,
  workspaceOpenUnreadableChild,
  workspaceSwitchClickDuringOpen,
} from './large-folder'
import { wallpaperBootHandoff } from './wallpaper-boot-handoff'
import { chatGitTabSwitch } from './chat-git-tab-switch'
import { chatGitTurnRows } from './chat-git-turn-rows'
import { chatModelPicker } from './chat-model-picker'
import { chatUsageMeter } from './chat-usage-meter'
import { chatComposerNarrow } from './chat-composer-narrow'
import { settingsUsage } from './settings-usage'
import { pushSubscribe } from './push-subscribe'
import { pushSessionNotice } from './push-session-notice'
import { chatClaudeCatalog } from './chat-claude-catalog'
import { chatDraftContextStrip } from './chat-draft-context-strip'
import { machineConnectError } from './machine-connect-error'
import { machineProtocolMismatch } from './machine-protocol-mismatch'
import { wallpaperIconHints } from './wallpaper-icon-hints'
import { terminalOfflineHost } from './terminal-offline-host'
import { terminalBackground } from './terminal-background'
import { terminalRenderer, terminalRendererWebgl } from './terminal-renderer'
import { bottomPanelPersistence } from './bottom-panel-persistence'
import { sidebarToggle } from './sidebar-toggle'
import { itemNavigation } from './item-navigation'
import { shortcutHints } from './shortcut-hints'
import { editorAddToChat } from './editor-add-to-chat'
import { markdownSplitView } from './markdown-split-view'
import { gitOpenAllDiffsSpam } from './git-open-all-diffs-spam'
import { gitStageSettles } from './git-stage-settles'
import { gitChangesScroll } from './git-changes-scroll'
import { gitDiscardConfirm } from './git-discard-confirm'
import { baseComponents } from './base-components'
import { physicalMode } from './physical-mode'
import { physicalChat } from './physical-chat'
import { connectionFrame } from './connection-frame'
import { settingsValueGrids } from './settings-value-grids'
import { settingsDependentRow } from './settings-dependent-row'
import { tailFollow } from './tail-follow'
import { checkpointRestore } from './checkpoint-restore'
import { themeStudioAsync } from './theme-studio-async'
import { themeStudioPreview } from './theme-studio-preview'
import { filePickerSelection } from './file-picker-selection'
import { filePickerBrowse } from './file-picker-browse'
import { quickOpenPreview } from './quick-open-preview'
import { themeStudio } from './theme-studio'
import { themeStudioLibrary } from './theme-studio-library'
import { serverUpdate } from './server-update'
import { commandPaletteTypeBurst } from './command-palette-type-burst'
import { paletteScriptsPending } from './palette-scripts-pending'
import { settingsModelsPending } from './settings-models-pending'
import { settingsProviderUpdate } from './settings-provider-update'
import { claudeUsageImport } from './claude-usage-import'
import { chatFollowUp } from './chat-follow-up'
import { chatDiffSyntax } from './chat-diff-syntax'
import { chatMarkdownFence } from './chat-markdown-fence'
import { editorSplitDrag } from './editor-split-drag'
import { editorSplitActions } from './editor-split-actions'
import { editorSplitUnmounted } from './editor-split-unmounted'
import { editorTabReveal } from './editor-tab-reveal'
import { editorSplitContent } from './editor-split-content'
import { editorSplitState } from './editor-split-state'
import { editorSplitFolds } from './editor-split-folds'
import { editorSplitBlur } from './editor-split-blur'
import { editorSplitOrder } from './editor-split-order'
import { editorSplitTargets } from './editor-split-targets'
import { editorSplitBreadcrumbs } from './editor-split-breadcrumbs'
import { editorSplitHistoryState } from './editor-split-history-state'
import { pageLifecycle } from './page-lifecycle'
import { editorConflictMerge } from './editor-conflict-merge'
import { editorExternalDiagnostics } from './editor-external-diagnostics'
import { editorExternalEdit } from './editor-external-edit'
import { editorLinkedPackage } from './editor-linked-package'
import { editorOfflineResync } from './editor-offline-resync'
import { editorThemePreview } from './editor-theme-preview'
import { editorNativeCoverage } from './editor-native-coverage'
import { editorSyntaxBenchmark } from './editor-syntax-benchmark'
import { bundleWallpapers } from './bundle-wallpapers'
import { colorModePreview } from './color-mode-preview'
import { wallpaperModeToggle } from './wallpaper-mode-toggle'
import { editorAutoClose } from './editor-auto-close'
import { editorFormatChord } from './editor-format-chord'
import { editorLspCompletion } from './editor-lsp-completion'
import { editorExternalDeletion } from './editor-external-deletion'
import { fileTreeUndo } from './file-tree-undo'
import { editorDefinitionCrlf } from './editor-definition-crlf'
import { editorDiagnosticHoverFix } from './editor-diagnostic-hover-fix'
import { editorLspHover } from './editor-lsp-hover'
import { editorLspDeprecated } from './editor-lsp-deprecated'
import { editorLspUnnecessary } from './editor-lsp-unnecessary'
import { editorLspRenameKey } from './editor-lsp-rename-key'
import { editorLspSignatureHelp } from './editor-lsp-signature-help'
import { editorMarkdownPunctuation } from './editor-markdown-punctuation'
import { wallpaperLibrary } from './wallpaper-library'
import { wallpaperPalette } from './wallpaper-palette'
import { themeBundlePalette } from './theme-bundle-palette'
import { settingsColdLoad } from './settings-cold-load'
import { serverRestart } from './server-restart'
import { settingsDefaults } from './settings-defaults'
import { projectMenu } from './project-menu'
import { workspaceSwitch } from './workspace-switch'
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
import { searchResultLinePick } from './search-result-line-pick'
import { paneRenderCrash } from './pane-render-crash'
import type { Page } from 'playwright'
import type { IsolatedServer } from '../isolated-server'
import type { CaptureSize } from '../capture-options'
import type { Evidence } from '../evidence'

type ScenarioContext = {
  /** This run's evidence directory, for scenarios that write more than step screenshots. */
  readonly evidence: Evidence
  readonly file: string
  /** The throwaway API server, when the run started one. */
  readonly server?: IsolatedServer
  /** Screenshots `target`, the scenario's page unless a second window is named. */
  readonly step: (label: string, target?: Page) => Promise<void>
}

export type Scenario = {
  readonly surface?: 'site' | 'demo'
  /** Only reads, so it may run against production (`--url …/platform/`). */
  readonly readOnly?: boolean
  /** Runs full Chromium with notification permission granted; the headless shell denies it. */
  readonly notifications?: boolean
  readonly name: string
  readonly description: string
  /** Viewport and device scale this scenario captures at unless the command line sets them. */
  readonly capture?: Partial<CaptureSize>
  readonly run: (page: Page, context: ScenarioContext) => Promise<void>
  readonly inspect?: (page: Page) => Promise<unknown>
  /**
   * Runs before the throwaway server starts. A directory it returns goes first on the server's
   * PATH, which is how a scenario stands in for an outside CLI such as `gh`.
   */
  readonly prepareServer?: () => Promise<{ readonly pathPrefix: string }>
}

import { editorDiagnosticsLifecycle } from './editor-diagnostics-lifecycle'
import { editorFastScroll } from './editor-fast-scroll'
import { editorLargePaste } from './editor-large-paste'
import { editorFind } from './editor-find'
import { problemsPanelRows } from './problems-panel-rows'
import { problemsPanelWorkspace } from './problems-panel-workspace'
import { editorTypeBurst } from './editor-type-burst'
import { editorUndoBarrier } from './editor-undo-barrier'
import { editorUndoBranch } from './editor-undo-branch'
import { editorTitleDiffToggle } from './editor-title-diff-toggle'
import { editorUndoReopen } from './editor-undo-reopen'
import { editorStorageMaintenance } from './editor-storage-maintenance'
import { editorReloadPaint, editorReloadPaintSlowFont } from './editor-reload-paint'
import { gitCommitHookColors } from './git-commit-hook-colors'
import { gitDiffHoverTokens } from './git-diff-hover-tokens'
import { gitDiffInlineTint } from './git-diff-inline-tint'
import { gitDiffExpandTokens } from './git-diff-expand-tokens'
import { editorPressParticipants } from './editor-press-participants'
import { editorWidgetKeys } from './editor-widget-keys'
import { gitDiffLineComment } from './git-diff-line-comment'
import { gitDiffFold } from './git-diff-fold'
import { gitCommitMessageFile } from './git-commit-message-file'
import { gitCommitMessagePersists } from './git-commit-message-persists'
import { gitCommitSlowHook } from './git-commit-slow-hook'
import { gitFixWithAgent } from './git-fix-with-agent'
import { gitSubmodulesInit } from './git-submodules-init'
import { gitAutoPull } from './git-auto-pull'
import { sessionBranchDrift } from './session-branch-drift'
import { sessionPullRequestStart } from './session-pull-request-start'
import { worktreeCleanupOnDelete } from './worktree-cleanup-on-delete'
import { sessionPullRequestSync } from './session-pull-request-sync'
import { sessionPullRequestBadge } from './session-pull-request-badge'
import { sessionAutoSettle } from './session-auto-settle'
import { gitMergeRequest } from './git-merge-request'
import { gitClonePublish } from './git-clone-publish'
import { worktreeSetupImport } from './worktree-setup-import'
import { gitHistory } from './git-history'
import { editorCaretBurst } from './editor-caret-burst'
import { editorFocusClicks } from './editor-focus-clicks'
import { editorProportionalFont } from './editor-proportional-font'
import { editorEditContextInput } from './editor-edit-context-input'
import { editorProduct } from './editor-product'
import { treeFileClicks } from './tree-file-clicks'
import { treeStickyScroll } from './tree-sticky-scroll'
import { treeParity } from './tree-parity'
import { treeParityBehaviour } from './tree-parity-behaviour'
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
  sessionUndo,
  cachedProtocolStartup,
  connectionRefusalRetention,
  sessionNavigation,
  sessionOrdering,
  sessionTitles,
  sessionNotifications,
  composerDefaults,
  mcpApproval,
  chatScreenshot,
  chatMultipleModels,
  chatComposerEditing,
  chatArtifactTemplate,
  chatModelFavorites,
  chatBackgroundStart,
  approvalTurnEnded,
  approvalTwoTabs,
  approvalReconnect,
  stoppedTurnReasons,
  streamAmbiguousTail,
  streamCodeColour,
  claudeApprovalRules,
  codexApprovalRules,
  fileAttachments,
  chatStashContext,
  chatStream,
  chatHistoryPages,
  chatQueue,
  providerModelOptions,
  draftRecovery,
  asyncQuestions,
  backgroundLiveness,
  spinnerPalette,
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
  chatUsageMeter,
  chatComposerNarrow,
  settingsUsage,
  pushSubscribe,
  pushSessionNotice,
  chatClaudeCatalog,
  chatDraftContextStrip,
  machineConnectError,
  machineProtocolMismatch,
  wallpaperIconHints,
  gitChanges,
  logsPanel,
  sessionRail,
  filesTree,
  filePicker,
  filePickerNavigation,
  gitHistoryScroll,
  settingsStaleDiagnostics,
  settingsResponsive,
  settingsSaveRejected,
  searchResults,
  terminalTabs,
  gitGraphKeyboard,
  panelSeams,
  surfaceAudit,
  surfaceStacking,
  chatTimelinePattern,
  copyFeedback,
  fileLabelCohesion,
  checkpointStates,
  checkpointDiffTokens,
  sessionActionsSurfaces,
  exportTranscript,
  claudeHookRows,
  claudeBackgroundTasks,
  claudeCustomAgent,
  customAgentProviderSwitch,
  claudeContextPopover,
  claudeManualCompaction,
  codexManualCompaction,
  claudeSessionTools,
  codexSessionTools,
  claudeSessionFork,
  codexSessionFork,
  searchFileActions,
  chatFollowUp,
  chatDiffSyntax,
  chatMarkdownFence,
  editorSplitDrag,
  editorSplitActions,
  editorSplitUnmounted,
  editorTabReveal,
  editorSplitContent,
  editorSplitState,
  editorSplitFolds,
  editorSplitBlur,
  editorSplitOrder,
  editorSplitTargets,
  editorSplitBreadcrumbs,
  editorSplitHistoryState,
  editorConflictMerge,
  editorExternalDiagnostics,
  editorExternalEdit,
  editorLinkedPackage,
  editorOfflineResync,
  terminalBackground,
  terminalOfflineHost,
  terminalRenderer,
  terminalRendererWebgl,
  bottomPanelPersistence,
  sidebarToggle,
  itemNavigation,
  shortcutHints,
  editorAddToChat,
  markdownSplitView,
  gitOpenAllDiffsSpam,
  gitStageSettles,
  gitChangesScroll,
  gitDiscardConfirm,
  baseComponents,
  physicalMode,
  physicalChat,
  connectionFrame,
  settingsValueGrids,
  settingsDependentRow,
  tailFollow,
  checkpointRestore,
  filePickerBrowse,
  filePickerSelection,
  themeStudioPreview,
  themeStudioAsync,
  quickOpenPreview,
  themeStudio,
  themeStudioLibrary,
  serverUpdate,
  commandPaletteTypeBurst,
  paletteScriptsPending,
  settingsModelsPending,
  settingsProviderUpdate,
  claudeUsageImport,
  editorThemePreview,
  editorSyntaxBenchmark('native'),
  editorNativeCoverage('light'),
  editorNativeCoverage('dark'),
  editorSyntaxBenchmark('shiki'),
  editorSyntaxBenchmark('shiki', true),
  colorModePreview,
  pageLifecycle,
  bundleWallpapers,
  editorAutoClose,
  editorFormatChord,
  editorLspCompletion,
  editorLspHover,
  editorDiagnosticHoverFix,
  editorLspDeprecated,
  editorLspUnnecessary,
  editorLspTabSwitch,
  editorLspServerExit,
  editorTypography,
  editorDecodeReveal,
  editorDefinitionCrlf,
  editorExternalDeletion,
  fileTreeUndo,
  editorLspRenameKey,
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
  searchResultLinePick,
  paneRenderCrash,
  wallpaperModeToggle,
  wallpaperLibrary,
  wallpaperPalette,
  themeBundlePalette,
  settingsDefaults,
  settingsColdLoad,
  settingsRoutePreparation,
  settingsModuleFailure,
  projectMenu,
  workspaceSwitch,
  serverRestart,
  sidebarSettingsButton,
  fontPicker,
  fontPickerHover,
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
  editorFind,
  problemsPanelRows,
  problemsPanelWorkspace,
  editorTypeBurst,
  editorUndoBarrier,
  editorUndoBranch,
  editorTitleDiffToggle,
  gitDiffHoverTokens,
  gitDiffInlineTint,
  gitDiffExpandTokens,
  editorPressParticipants,
  editorWidgetKeys,
  gitDiffLineComment,
  gitDiffFold,
  chatCardNarrow,
  chatComposerInsert,
  chatDisclosureSettle,
  chatTurnAnatomy,
  fileTreeHoverPrefetch,
  prefetchFirstPaint,
  prefetchChatSwitch,
  workspaceOpenLargeRoot,
  workspaceOpenUnreadableChild,
  workspaceSwitchClickDuringOpen,
  filePickerPrefetchBound,
  wallpaperBootHandoff,
  chatGitTabSwitch,
  chatGitTurnRows,
  editorUndoReopen,
  editorStorageMaintenance,
  editorReloadPaint,
  editorReloadPaintSlowFont,
  gitCommitHookColors,
  gitCommitMessageFile,
  gitCommitSlowHook,
  gitCommitMessagePersists,
  gitFixWithAgent,
  gitSubmodulesInit,
  gitAutoPull,
  sessionBranchDrift,
  sessionPullRequestStart,
  worktreeCleanupOnDelete,
  sessionPullRequestSync,
  sessionPullRequestBadge,
  sessionAutoSettle,
  gitMergeRequest,
  gitClonePublish,
  worktreeSetupImport,
  editorCaretBurst,
  editorFocusClicks,
  editorProportionalFont,
  editorEditContextInput,
  editorProduct,
  treeStickyScroll,
  treeParity,
  treeParityBehaviour,
  treeFileClicks,
]

export function scenarioNamed(name: string): Scenario {
  const scenario = scenarios.find((entry) => entry.name === name)
  if (scenario) return scenario
  const names = scenarios.map((entry) => entry.name).join(', ')
  throw new Error(`Unknown scenario "${name}". Known: ${names}`)
}
import { workbenchListFocus } from './workbench-list-focus'
