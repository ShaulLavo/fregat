import { machineBalancing } from './machine-balancing'
import { binaryFileOpen, binaryFileRemote } from './binary-file-open'
import { ghosttySiteFit } from './ghostty-site-fit'
import { editorPagedReadonly } from './editor-paged-readonly'
import { editorFeatureTiers } from './editor-feature-tiers'
import { editorSavedSnapshot } from './editor-saved-snapshot'
import { sessionNoFlicker } from './session-no-flicker'
import { restNoFlicker } from './rest-no-flicker'
import { deferredDialogs } from './deferred-dialogs'
import { dialogEscape } from './dialog-escape'
import { rootSwitchNoFlicker } from './root-switch-no-flicker'
import { turnFilesNoFlicker } from './turn-files-no-flicker'
import { branchActionsNoFlicker } from './branch-actions-no-flicker'
import {
  diffNoFlicker,
  savedComparisonNoFlicker,
  historyComparisonNoFlicker,
} from './comparison-no-flicker'
import { textFieldFkeys } from './text-field-fkeys'
import { settingsRoutePreparation } from './settings-route-preparation'
import { startupFailure } from './startup-failure'
import { settingsModuleFailure } from './settings-module-failure'
import { settingsNewerServer, settingsStreamGiveUp } from './settings-newer-server'
import { connectionRefusalRetention } from './connection-refusal-retention'
import { cachedProtocolStartup } from './cached-protocol-startup'
import { primaryIdentityReplacement } from './primary-identity-replacement'
import { editorLspTabSwitch } from './editor-lsp-tab-switch'
import { editorLspServerExit } from './editor-lsp-server-exit'
import { editorTypography } from './editor-typography'
import { editorDecodeReveal } from './editor-decode-reveal'
import { responseDelivery } from './response-delivery'
import { draftRecovery } from './draft-recovery'
import { composerDefaults } from './composer-defaults'
import { sessionNotifications } from './session-notifications'
import { terminalHistory, terminalIdleShells } from './terminal-history'
import { chatStream } from './chat-stream'
import { chatHistoryPages } from './chat-history-pages'
import {
  chatScrollDisclosure,
  chatScrollFoldHeld,
  chatScrollJump,
  chatScrollLoadEarlier,
  chatScrollLoadEarlierJump,
  chatScrollPark,
  chatScrollFollowing,
  chatScrollReaderHeld,
  chatScrollReload,
  chatScrollHome,
} from './chat-scroll'
import { chatStashContext } from './chat-stash-context'
import { chatDraftSentLeftover } from './chat-draft-sent-leftover'
import { chatQueue } from './chat-queue'
import { chatQueueAway } from './chat-queue-away'
import { chatQueueStopUpload } from './chat-queue-stop-upload'
import { providerModelOptions } from './provider-model-options'
import { screenshotDrop } from './screenshot-drop'
import { binaryFileAttachment, fileAttachments } from './file-attachments'
import {
  pdfDocuments,
  pdfAttachment,
  pdfEngineUnavailable,
  pdfPresentationUnavailable,
  pdfWorkerUnavailable,
  pdfRemoteOwner,
} from './pdf-documents'
import { sessionTitles } from './session-titles'
import { sessionNavigation } from './session-navigation'
import { sessionOrdering } from './session-ordering'
import { backgroundLiveness, backgroundMonitorLiveness } from './background-liveness'
import { spinnerPalette } from './spinner-palette'
import { sessionBulkFailures } from './session-bulk-failures'
import { sessionLifecycle } from './session-lifecycle'
import { sessionUndo } from './session-undo'
import { asyncQuestions } from './async-questions'
import { projectGrouping } from './project-grouping'
import { sessionSearch, sessionSearchEnvironments } from './session-search'
import { sessionUnread } from './session-unread'
import { mcpApproval } from './mcp-approval'
import { mcpSettings } from './mcp-settings'
import { mcpStatus } from './mcp-status'
import { nativePermissionGrant } from './native-permission-grant'
import { resetCreditRedemption } from './reset-credit-redemption'
import { pullRequestLookupFailure } from './pull-request-lookup-failure'
import { streamOverflow } from './stream-overflow'
import { questionHistory } from './question-history'
import { chatScreenshot } from './chat-screenshot'
import { chatMultipleModels } from './chat-multiple-models'
import { chatAssistantCitation } from './chat-assistant-citation'
import { chatCitationElsewhere } from './chat-citation-elsewhere'
import { chatFindingSource } from './chat-finding-source'
import { chatReviewContext } from './chat-review-context'
import { chatMultipleModelsLostAck } from './chat-multiple-models-lost-ack'
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
import { chatMermaid } from './chat-mermaid'
import { chatMermaidFirstPaint } from './chat-mermaid-first-paint'
import { editorMermaidStyle, editorStyleBaseline } from './editor-mermaid-style'
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
import { sessionRailMenu } from './session-rail-menu'
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
import { settingsEnumLabels } from './settings-enum-labels'
import { settingsRawConflict } from './settings-raw-conflict'
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
import { chatToolOrder } from './chat-tool-order'
import { chatResume } from './chat-resume'
import { chatTurnSettle } from './chat-turn-settle'
import { devicePairing } from './device-pairing'
import { phoneShell } from './phone-shell'
import { phoneContextMenus } from './phone-context-menus'
import { phoneSurfaces } from './phone-surfaces'
import { phoneComposer } from './phone-composer'
import { logsRestored } from './logs-restored'
import { shellSwitch } from './shell-switch'
import { phoneColdBoot, desktopColdBoot } from './shell-cold-boot'
import { phoneStartupNavigation, phoneStartupTiming } from './phone-startup-navigation'
import { chatSleepingSession } from './chat-sleeping-session'
import { chatSessionGoal } from './chat-session-goal'
import { chatAgentReview } from './chat-agent-review'
import { fileTreeHoverPrefetch } from './file-tree-hover-prefetch'
import { prefetchChatSwitch } from './prefetch-chat-switch'
import { prefetchDiffQueries } from './prefetch-diff-queries'
import { prefetchFirstPaint } from './prefetch-first-paint'
import { editorTabHoverHighlights, editorTabHoverLive } from './editor-tab-hover-highlights'
import { prefetchSettings } from './prefetch-settings'
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
import { opencodeModelCatalog } from './opencode-model-catalog'
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
import { editorSpellcheck } from './editor-spellcheck'
import { markdownSplitView } from './markdown-split-view'
import { markdownAuthoring } from './markdown-authoring'
import { markdownPreviewClobber } from './markdown-preview-clobber'
import { gitOpenAllDiffsSpam } from './git-open-all-diffs-spam'
import { gitStageSettles } from './git-stage-settles'
import { gitExternalCommit } from './git-external-commit'
import { gitChangesScroll } from './git-changes-scroll'
import { gitDiscardConfirm } from './git-discard-confirm'
import { baseComponents } from './base-components'
import { physicalMode } from './physical-mode'
import { physicalChat } from './physical-chat'
import { connectionFrame } from './connection-frame'
import { settingsValueGrids } from './settings-value-grids'
import { settingsDependentRow } from './settings-dependent-row'
import { settingsTokenizationLimit } from './settings-tokenization-limit'
import { settingsRowDetails } from './settings-row-details'
import { settingsKeybindings } from './settings-keybindings'
import { tailFollow } from './tail-follow'
import { checkpointRestore } from './checkpoint-restore'
import { themeStudioAsync } from './theme-studio-async'
import { themeStudioPreview } from './theme-studio-preview'
import { polaronWebPicker } from './polaron-web-picker'
import { filePickerSelection } from './file-picker-selection'
import { filePickerBrowse } from './file-picker-browse'
import { filePickerLocations } from './file-picker-locations'
import { filePickerAppearance } from './file-picker-appearance'
import { quickOpenCrlfPreview } from './quick-open-crlf-preview'
import { quickOpenPreview } from './quick-open-preview'
import { themeStudio } from './theme-studio'
import { themeStudioSettings } from './theme-studio-settings'
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
import { codeThemeNativePreview } from './code-theme-native-preview'
import { editorNativeCoverage } from './editor-native-coverage'
import { editorSyntaxBenchmark } from './editor-syntax-benchmark'
import { bundleWallpapers } from './bundle-wallpapers'
import { coldWallpaperSwitch } from './cold-wallpaper-switch'
import { colorModePreview } from './color-mode-preview'
import { wallpaperModeToggle } from './wallpaper-mode-toggle'
import { editorAutoClose } from './editor-auto-close'
import { editorFormatChord } from './editor-format-chord'
import { editorLspCompletion } from './editor-lsp-completion'
import { editorReadRecovery } from './editor-read-recovery'
import { editorExternalDeletion } from './editor-external-deletion'
import { fileTreeUndo } from './file-tree-undo'
import { editorDefinitionCrlf } from './editor-definition-crlf'
import { editorDiagnosticHoverFix } from './editor-diagnostic-hover-fix'
import { editorLspHover } from './editor-lsp-hover'
import { editorLspHoverCrlf } from './editor-lsp-hover-crlf'
import { editorLspDeprecated } from './editor-lsp-deprecated'
import { editorLspUnnecessary } from './editor-lsp-unnecessary'
import { editorLspRenameKey } from './editor-lsp-rename-key'
import { editorLspSignatureHelp } from './editor-lsp-signature-help'
import { editorMarkdownPunctuation } from './editor-markdown-punctuation'
import { wallpaperLibrary } from './wallpaper-library'
import { wallpaperCatalog } from './wallpaper-catalog'
import { wallpaperPalette } from './wallpaper-palette'
import { themeBundlePalette } from './theme-bundle-palette'
import { settingsColdLoad } from './settings-cold-load'
import { settingsOpen, settingsOpenNavigation } from './settings-open'
import { serverRestart } from './server-restart'
import { settingsDefaults } from './settings-defaults'
import { settingsFocus } from './settings-focus'
import { settingsAppearanceRows } from './settings-appearance-rows'
import { settingsWallpaperScroll } from './settings-wallpaper-scroll'
import { settingsAppearanceOpen } from './settings-appearance-open'
import { editorSettingsPreviewTyping } from './editor-settings-preview-typing'
import { projectMenu } from './project-menu'
import { workspaceSwitch } from './workspace-switch'
import { sidebarSettingsButton } from './sidebar-settings-button'
import { fileIcons } from './file-icons'
import { searchInputUndo } from './search-input-undo'
import { visualSearchPerformance } from './visual-search-performance'
import { visualSearchTiers } from './visual-search-tiers'
import { searchViewAllMatches } from './search-view-all-matches'
import { visualSearchHeaders } from './visual-search-headers'
import { visualSearchScrollContent } from './visual-search-scroll-content'
import { quickOpenNewFile } from './quick-open-new-file'
import { projectSettings } from './project-settings'
import { workspaceTwoRoots } from './workspace-two-roots'
import { quickOpenEditorSource } from './quick-open-editor-source'
import { paletteThemeNoFlicker, studioThemeNoFlicker } from './code-theme-no-flicker'
import { quickOpenNoFlicker } from './quick-open-no-flicker'
import { gitHistorySearchNoFlicker } from './git-history-search-no-flicker'
import { logsSearchNoFlicker } from './logs-search-no-flicker'
import { searchTypeDelete } from './search-type-delete'
import { searchResultLinePick } from './search-result-line-pick'
import { searchResultRecycleFocus } from './search-result-recycle-focus'
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
  /** Fixture scenarios must reject shared servers before opening the first page. */
  readonly requiresIsolatedServer?: boolean
  /** Spends turns on a real Codex or Claude account, so it runs only with `--real-providers`. */
  readonly realProviders?: true
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
import { markdownSourceEditing } from './markdown-source-editing'
import { markdownLoadStability } from './markdown-load-stability'
import { markdownLinks } from './markdown-links'
import { editorTypeBurst } from './editor-type-burst'
import { editorUndoBarrier } from './editor-undo-barrier'
import { editorUndoBranch } from './editor-undo-branch'
import { editorTitleDiffToggle } from './editor-title-diff-toggle'
import { editorUndoReopen } from './editor-undo-reopen'
import { editorStorageMaintenance } from './editor-storage-maintenance'
import { editorReloadPaint, editorReloadPaintSlowFont } from './editor-reload-paint'
import { gitCommitHookColors } from './git-commit-hook-colors'
import { gitDiffHoverTokens } from './git-diff-hover-tokens'
import { gitDiffCrlfSyntax } from './git-diff-crlf-syntax'
import { gitDiffInlineTint } from './git-diff-inline-tint'
import { gitDiffExpandTokens } from './git-diff-expand-tokens'
import { editorPressParticipants } from './editor-press-participants'
import { editorWidgetKeys } from './editor-widget-keys'
import { gitDiffLineComment } from './git-diff-line-comment'
import { gitDiffFold } from './git-diff-fold'
import { gitDiffBudget } from './git-diff-budget'
import { gitDiffScroll } from './git-diff-scroll'
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
import { gitForgeDiscussion } from './git-forge-discussion'
import { gitMergeRequest } from './git-merge-request'
import { gitClonePublish } from './git-clone-publish'
import { worktreeSetupImport } from './worktree-setup-import'
import { gitHistory } from './git-history'
import { gitHistoryNoFlicker } from './git-history-no-flicker'
import { editorCaretBurst } from './editor-caret-burst'
import { editorFocusClicks } from './editor-focus-clicks'
import { editorProportionalFont } from './editor-proportional-font'
import { editorEditContextInput } from './editor-edit-context-input'
import { editorProduct } from './editor-product'
import { editorTerminalSurface } from './editor-terminal-surface'
import { treeFileClicks } from './tree-file-clicks'
import { treeStickyScroll } from './tree-sticky-scroll'
import { treeScrollLive } from './tree-scroll-live'
import { treeLargeScroll } from './tree-large-scroll'
import { treeParity } from './tree-parity'
import { fileIconHues } from './file-icon-hues'
import { filterFields } from './filter-fields'
import { inlineRenameTree } from './inline-rename-tree'
import { treeParityBehaviour } from './tree-parity-behaviour'
import { demoWorkspace } from './demo-workspace'
import { demoAgentGit } from './demo-agent-git'
import { demoReset } from './demo-reset'
import { demoStartup } from './demo-startup'
import { demoThemeStartup } from './demo-theme-startup'
import { demoWallpaperStartup } from './demo-wallpaper-startup'

import { devPackageUpdates } from './dev-package-updates'

export const scenarios: readonly Scenario[] = [
  binaryFileOpen,
  binaryFileRemote,
  ghosttySiteFit,
  devPackageUpdates,
  editorPagedReadonly,
  diffNoFlicker,
  savedComparisonNoFlicker,
  editorFeatureTiers,
  editorSavedSnapshot,
  historyComparisonNoFlicker,
  terminalHistory,
  terminalIdleShells,
  responseDelivery,
  archiveLifecycle,
  sessionUnread,
  sessionSearch,
  sessionSearchEnvironments,
  projectGrouping,
  machineBalancing,
  sessionLifecycle,
  sessionBulkFailures,
  sessionUndo,
  cachedProtocolStartup,
  primaryIdentityReplacement,
  connectionRefusalRetention,
  sessionNavigation,
  sessionOrdering,
  sessionTitles,
  sessionNotifications,
  composerDefaults,
  mcpApproval,
  mcpStatus,
  mcpSettings,
  nativePermissionGrant,
  resetCreditRedemption,
  pullRequestLookupFailure,
  streamOverflow,
  questionHistory,
  chatScreenshot,
  chatMultipleModels,
  chatAssistantCitation,
  chatCitationElsewhere,
  chatFindingSource,
  chatReviewContext,
  chatMultipleModelsLostAck,
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
  chatMermaid,
  chatMermaidFirstPaint,
  editorMermaidStyle,
  editorStyleBaseline,
  claudeApprovalRules,
  codexApprovalRules,
  fileAttachments,
  binaryFileAttachment,
  pdfDocuments,
  pdfAttachment,
  pdfEngineUnavailable,
  pdfPresentationUnavailable,
  pdfWorkerUnavailable,
  pdfRemoteOwner,
  screenshotDrop,
  chatStashContext,
  chatDraftSentLeftover,
  chatStream,
  chatHistoryPages,
  sessionNoFlicker,
  chatScrollPark,
  chatScrollFollowing,
  chatScrollReaderHeld,
  chatScrollFoldHeld,
  chatScrollJump,
  chatScrollLoadEarlier,
  chatScrollLoadEarlierJump,
  chatScrollDisclosure,
  chatScrollReload,
  chatScrollHome,
  chatQueue,
  chatQueueAway,
  chatQueueStopUpload,
  providerModelOptions,
  draftRecovery,
  asyncQuestions,
  backgroundLiveness,
  backgroundMonitorLiveness,
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
  opencodeModelCatalog,
  chatUsageMeter,
  chatComposerNarrow,
  restNoFlicker,
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
  settingsEnumLabels,
  settingsRawConflict,
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
  sessionRailMenu,
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
  editorSpellcheck,
  markdownSplitView,
  markdownAuthoring,
  markdownPreviewClobber,
  gitOpenAllDiffsSpam,
  gitStageSettles,
  gitExternalCommit,
  gitChangesScroll,
  gitDiscardConfirm,
  baseComponents,
  physicalMode,
  physicalChat,
  connectionFrame,
  settingsValueGrids,
  settingsDependentRow,
  settingsTokenizationLimit,
  settingsRowDetails,
  settingsKeybindings,
  tailFollow,
  checkpointRestore,
  filePickerBrowse,
  filePickerLocations,
  filePickerAppearance,
  polaronWebPicker,
  filePickerSelection,
  themeStudioPreview,
  themeStudioAsync,
  quickOpenPreview,
  quickOpenCrlfPreview,
  themeStudio,
  themeStudioSettings,
  themeStudioLibrary,
  serverUpdate,
  commandPaletteTypeBurst,
  paletteScriptsPending,
  settingsModelsPending,
  settingsProviderUpdate,
  claudeUsageImport,
  editorThemePreview,
  codeThemeNativePreview,
  editorSyntaxBenchmark('native'),
  editorNativeCoverage('light'),
  editorNativeCoverage('dark'),
  editorSyntaxBenchmark('shiki'),
  editorSyntaxBenchmark('shiki', true),
  colorModePreview,
  pageLifecycle,
  bundleWallpapers,
  coldWallpaperSwitch,
  editorAutoClose,
  editorFormatChord,
  editorLspCompletion,
  editorLspHover,
  editorLspHoverCrlf,
  editorDiagnosticHoverFix,
  editorLspDeprecated,
  editorLspUnnecessary,
  editorLspTabSwitch,
  editorLspServerExit,
  editorTypography,
  editorDecodeReveal,
  editorDefinitionCrlf,
  editorExternalDeletion,
  editorReadRecovery,
  fileTreeUndo,
  editorLspRenameKey,
  editorLspSignatureHelp,
  editorMarkdownPunctuation,
  fileIcons,
  searchInputUndo,
  visualSearchPerformance,
  ...visualSearchTiers,
  searchViewAllMatches,
  visualSearchHeaders,
  visualSearchScrollContent,
  quickOpenNewFile,
  projectSettings,
  workspaceTwoRoots,
  quickOpenEditorSource,
  rootSwitchNoFlicker,
  quickOpenNoFlicker,
  paletteThemeNoFlicker,
  studioThemeNoFlicker,
  turnFilesNoFlicker,
  branchActionsNoFlicker,
  gitHistorySearchNoFlicker,
  logsSearchNoFlicker,
  searchTypeDelete,
  searchResultLinePick,
  searchResultRecycleFocus,
  paneRenderCrash,
  wallpaperModeToggle,
  wallpaperLibrary,
  wallpaperCatalog,
  wallpaperPalette,
  themeBundlePalette,
  settingsDefaults,
  settingsFocus,
  settingsAppearanceRows,
  settingsAppearanceOpen,
  editorSettingsPreviewTyping,
  settingsWallpaperScroll,
  settingsColdLoad,
  settingsOpen,
  settingsOpenNavigation,
  settingsRoutePreparation,
  textFieldFkeys,
  settingsModuleFailure,
  settingsNewerServer,
  settingsStreamGiveUp,
  startupFailure,
  deferredDialogs,
  dialogEscape,
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
  gitHistoryNoFlicker,
  editorLargePaste,
  editorFastScroll,
  editorDiagnosticsLifecycle,
  editorFind,
  problemsPanelRows,
  problemsPanelWorkspace,
  editorTypeBurst,
  markdownSourceEditing,
  markdownLoadStability,
  markdownLinks,
  editorUndoBarrier,
  editorUndoBranch,
  editorTitleDiffToggle,
  gitDiffHoverTokens,
  gitDiffCrlfSyntax,
  gitDiffInlineTint,
  gitDiffExpandTokens,
  editorPressParticipants,
  editorWidgetKeys,
  gitDiffLineComment,
  gitDiffFold,
  gitDiffBudget,
  gitDiffScroll,
  chatCardNarrow,
  chatComposerInsert,
  chatDisclosureSettle,
  chatTurnAnatomy,
  chatToolOrder,
  chatResume,
  chatTurnSettle,
  devicePairing,
  phoneShell,
  phoneContextMenus,
  phoneSurfaces,
  phoneComposer,
  shellSwitch,
  logsRestored,
  phoneColdBoot,
  phoneStartupNavigation,
  phoneStartupTiming,
  desktopColdBoot,
  chatSleepingSession,
  chatSessionGoal,
  chatAgentReview,
  fileTreeHoverPrefetch,
  prefetchFirstPaint,
  editorTabHoverHighlights,
  editorTabHoverLive,
  prefetchDiffQueries,
  prefetchChatSwitch,
  prefetchSettings,
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
  gitForgeDiscussion,
  gitClonePublish,
  worktreeSetupImport,
  editorCaretBurst,
  editorFocusClicks,
  editorProportionalFont,
  editorEditContextInput,
  editorProduct,
  editorTerminalSurface,
  treeStickyScroll,
  treeScrollLive,
  treeLargeScroll,
  treeParity,
  fileIconHues,
  treeParityBehaviour,
  inlineRenameTree,
  filterFields,
  treeFileClicks,
]

export function scenarioNamed(name: string): Scenario {
  const scenario = scenarios.find((entry) => entry.name === name)
  if (scenario) return scenario
  const names = scenarios.map((entry) => entry.name).join(', ')
  throw new Error(`Unknown scenario "${name}". Known: ${names}`)
}
import { workbenchListFocus } from './workbench-list-focus'
