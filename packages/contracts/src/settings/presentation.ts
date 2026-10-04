import { SETTING_IDS, type SettingId, type SettingValue } from './keys'
import type { SettingPresentation, WidgetFor } from './registry'

export const SETTINGS_PRESENTATION = {
  'chat.followUpBehavior': {
    widget: 'enum',
    category: 'Chat',
  },
  'chat.sendShortcut': {
    widget: 'enum',
    category: 'Chat',
  },
  'chat.planModeEnabled': {
    widget: 'boolean',
    category: 'Chat',
  },
  'agent.diagnosticsFeedback': {
    widget: 'boolean',
    category: 'Chat',
  },
  'chat.activeFileContext': {
    widget: 'boolean',
    category: 'Chat',
  },
  'chat.contextWindowMeterEnabled': {
    widget: 'boolean',
    category: 'Chat',
  },
  'chat.responseStreamingMode': {
    widget: 'enum',
    category: 'Chat',
  },
  'chat.projectResponseStreamingModes': {
    widget: 'complex',
    // A map keyed by project UUID has no widget; the JSON view is its only editor.
    visibility: 'internal',
    category: 'Chat',
  },
  'chat.notificationMode': {
    widget: 'enum',
    category: 'Chat',
  },
  'chat.inAppNotificationsEnabled': {
    widget: 'boolean',
    category: 'Chat',
  },
  'chat.pushNotifications': {
    widget: 'boolean',
    category: 'Chat',
  },
  'chat.textGenerationModel': {
    widget: 'complex',
    // No widget edits a model selection yet, so a row could only say "Edit in settings.json".
    visibility: 'internal',
    category: 'Chat',
  },
  'chat.projectTextGenerationModels': {
    widget: 'complex',
    visibility: 'internal',
    category: 'Chat',
  },
  'chat.sessionSortOrder': {
    widget: 'enum',
    category: 'Chat',
  },
  'chat.confirmSessionDelete': {
    widget: 'boolean',
    category: 'Chat',
  },
  'chat.projectGrouping': {
    widget: 'enum',
    category: 'Chat',
  },
  'chat.autoSettleAfterDays': {
    widget: 'number',
    category: 'Chat',
  },
  'chat.autoSettleOnMerge': {
    widget: 'boolean',
    category: 'Chat',
  },
  'chat.projectAutoSettle': {
    widget: 'complex',
    visibility: 'internal',
    category: 'Chat',
  },
  'chat.projectGroupingOverrides': {
    widget: 'complex',
    visibility: 'internal',
    category: 'Chat',
  },
  'environments.loadBalancing': {
    widget: 'boolean',
    category: 'Machines',
  },
  'environments.loadPreferences': {
    widget: 'record',
    category: 'Machines',
  },
  'environments.machines': {
    widget: 'machines',
    category: 'Machines',
  },
  'environments.devicePairing': {
    widget: 'boolean',
    category: 'Machines',
  },
  'server.address': {
    widget: 'string',
    category: 'Machines',
    visibility: 'advanced',
    requiresRestart: true,
  },
  'server.releaseRoot': {
    widget: 'string',
    category: 'Machines',
    visibility: 'advanced',
    requiresRestart: true,
  },
  'server.activationTimeoutSeconds': {
    widget: 'number',
    category: 'Machines',
    visibility: 'advanced',
  },
  'server.webBase': {
    widget: 'string',
    category: 'Machines',
    visibility: 'advanced',
    requiresRestart: true,
  },
  'git.maxDiffFileSizeMiB': {
    widget: 'number',
    category: 'Git',
    visibility: 'advanced',
  },
  'git.autoPull': {
    widget: 'boolean',
    category: 'Git',
  },
  'git.projectAutoPull': {
    widget: 'complex',
    visibility: 'internal',
    category: 'Git',
  },
  'git.worktreeSubmodules': {
    widget: 'enum',
    category: 'Git',
  },
  'git.projectWorktreeSubmodules': {
    widget: 'complex',
    visibility: 'internal',
    category: 'Git',
  },
  'git.worktreeCleanupOnDelete': {
    widget: 'boolean',
    category: 'Git',
  },
  'git.projectWorktreeCleanupOnDelete': {
    widget: 'complex',
    visibility: 'internal',
    category: 'Git',
  },
  'workbench.colorTheme': {
    widget: 'enum',
    category: 'Appearance',
  },
  'workbench.theme': {
    widget: 'theme',
    category: 'Appearance',
  },
  'workbench.theme.customizations': {
    widget: 'complex',
    category: 'Appearance',
    visibility: 'internal',
  },
  'workbench.palette': {
    widget: 'palette',
    category: 'Appearance',
  },
  'editor.codeTheme.dark': {
    widget: 'code-theme',
    category: 'Appearance',
  },
  'editor.codeTheme.light': {
    widget: 'code-theme',
    category: 'Appearance',
  },
  'workbench.wallpaper': {
    widget: 'wallpaper',
    category: 'Appearance',
  },
  'workbench.surface.opacity': {
    widget: 'number',
    category: 'Appearance',
  },
  'workbench.surface.contentOpacity': {
    widget: 'number',
    category: 'Appearance',
  },
  'workbench.surface.blur': {
    widget: 'number',
    category: 'Appearance',
  },
  'workbench.surface.saturation': {
    widget: 'number',
    category: 'Appearance',
  },
  'tui.theme.colors': {
    widget: 'enum',
    category: 'Appearance',
  },
  'workbench.reduceMotion': {
    widget: 'boolean',
    category: 'Appearance',
  },
  'workbench.fontFamily': {
    widget: 'font',
    category: 'Appearance',
  },
  'workbench.sounds.controls': {
    widget: 'boolean',
    category: 'Sounds',
  },
  'workbench.sounds.errors': {
    widget: 'boolean',
    category: 'Sounds',
  },
  'workbench.sounds.git': {
    widget: 'boolean',
    category: 'Sounds',
  },
  'workbench.sounds.terminalBell': {
    widget: 'boolean',
    category: 'Sounds',
  },
  'workbench.sounds.volume': {
    widget: 'number',
    category: 'Sounds',
  },
  'workbench.feel': {
    widget: 'enum',
    category: 'Appearance',
  },
  'workbench.density': {
    widget: 'enum',
    category: 'Appearance',
  },
  'workbench.surface.continuousSeams': {
    widget: 'boolean',
    category: 'Appearance',
  },
  'workbench.tree.indentGuides': {
    widget: 'enum',
    category: 'Appearance',
  },
  'editor.fontFamily': {
    widget: 'font',
    category: 'Editor',
  },
  'editor.fontSize': {
    widget: 'number',
    category: 'Editor',
  },
  'editor.lineHeight': {
    widget: 'number',
    category: 'Editor',
  },
  'editor.tabSize': {
    widget: 'number',
    category: 'Editor',
  },
  'editor.history.retainedStates': {
    widget: 'number',
    category: 'Editor',
  },
  'editor.history.persist': {
    widget: 'boolean',
    category: 'Editor',
  },
  'editor.history.persistDays': {
    widget: 'number',
    category: 'Editor',
  },
  'editor.history.persistBudget': {
    widget: 'number',
    category: 'Editor',
    visibility: 'advanced',
  },
  'editor.markdownView': {
    widget: 'enum',
    category: 'Editor',
  },
  'editor.markdownRenderedPane': {
    widget: 'boolean',
    category: 'Editor',
  },
  'editor.spellcheck': {
    widget: 'enum',
    category: 'Editor',
  },
  'spellcheck.words': {
    widget: 'complex',
    // Words arrive from the editor menu; settings.json is where a list is edited by hand.
    visibility: 'internal',
    category: 'Editor',
  },
  'editor.diff.viewMode': {
    widget: 'enum',
    category: 'Editor',
  },
  'editor.inputRoute': {
    widget: 'enum',
    category: 'Editor',
    // Editors are reused across tabs and take the route only when they are built.
    requiresRestart: true,
    visibility: 'advanced',
  },
  'terminal.shellKeys': {
    widget: 'boolean',
    category: 'Terminal',
  },
  'terminal.integrated.fontSize': {
    widget: 'number',
    category: 'Terminal',
  },
  'terminal.integrated.scrollback': {
    widget: 'number',
    category: 'Terminal',
  },
  'terminal.integrated.cursorBlinking': {
    widget: 'boolean',
    category: 'Terminal',
  },
  'editor.inactiveAnalysisEntryLimit': {
    widget: 'number',
    category: 'Editor',
    visibility: 'advanced',
  },
  'editor.retainedTextBudget': {
    widget: 'number',
    category: 'Editor',
    visibility: 'advanced',
  },
  'editor.unicodeHighlight.ambiguousCharacters': {
    widget: 'boolean',
    category: 'Editor',
  },
  'editor.unicodeHighlight.invisibleCharacters': {
    widget: 'boolean',
    category: 'Editor',
  },
  'editor.unicodeHighlight.allowedCharacters': {
    widget: 'string',
    category: 'Editor',
  },
  'editor.largeFile.analysisLimitMiCodeUnits': {
    widget: 'number',
    category: 'Editor',
  },
  'editor.maxTokenizationLineLength': {
    widget: 'number',
    category: 'Editor',
  },
  'editor.largeFile.minimapLimitMiCodeUnits': {
    widget: 'number',
    category: 'Editor',
  },
  'editor.minimap.enabled': {
    widget: 'boolean',
    category: 'Editor',
    // The non-critical plugin list is built once per page load, behind a lazy
    // module-level promise. Claiming this applies live would be a lie the user
    // discovers by toggling it and seeing nothing happen.
    requiresRestart: true,
  },
  'editor.guides.indentation': {
    widget: 'boolean',
    category: 'Editor',
    requiresRestart: true,
  },
  'editor.syntaxHighlighting.enabled': {
    widget: 'boolean',
    category: 'Editor',
    requiresRestart: true,
  },
  'editor.decode.mode': {
    widget: 'enum',
    category: 'Editor',
    requiresRestart: true,
    visibility: 'advanced',
  },
  'search.defaultMatchMode': {
    widget: 'enum',
    category: 'Search',
  },
  'search.caseSensitive': {
    widget: 'boolean',
    category: 'Search',
  },
  'search.wholeWord': {
    widget: 'boolean',
    category: 'Search',
  },
  'search.maxResults': {
    widget: 'number',
    category: 'Search',
  },
  'search.maxResultFiles': {
    widget: 'number',
    category: 'Search',
    visibility: 'advanced',
  },
  'search.quickOpenLimit': {
    widget: 'number',
    category: 'Search',
    visibility: 'advanced',
  },
  'search.quickOpenPreview': {
    widget: 'boolean',
    category: 'Search',
  },
  'chat.keepImportedSessionsUpdated': {
    widget: 'boolean',
    category: 'Chat',
  },
  'chat.diagramFontWaitMs': {
    widget: 'number',
    category: 'Chat',
    visibility: 'advanced',
  },
  'chat.defaultRuntimeMode': {
    widget: 'enum',
    category: 'Chat',
  },
  'chat.defaultInteractionMode': {
    widget: 'enum',
    category: 'Chat',
  },
  'logs.defaultTimeRange': {
    widget: 'enum',
    category: 'Logs',
    visibility: 'advanced',
  },
  'logs.retentionDays': {
    widget: 'number',
    category: 'Logs',
    visibility: 'advanced',
  },
  'logs.slowThresholdMs': {
    widget: 'number',
    category: 'Logs',
    visibility: 'advanced',
  },
  'developer.simulatedLatencyMs': {
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.devServerIdleMinutes': {
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.clientUpdateCheckSeconds': {
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.deployTarget': {
    widget: 'complex',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.deployRestartWaitMinutes': {
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.heavyJobLogDirectory': {
    widget: 'string',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.heavyJobClasses': {
    widget: 'complex',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.heavyJobQuietPolicy': {
    widget: 'complex',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.heavyJobMemoryReserveMiB': {
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.heavyJobMemoryPressureLimit': {
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.heavyJobStopGraceSeconds': {
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.heavyJobQuietHoldSeconds': {
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  },
  'developer.heavyJobCpuLoadLimit': {
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  },
  'window.browser': {
    widget: 'string',
    category: 'Window',
    requiresRestart: true,
  },
  'window.browserStartupIdleSeconds': {
    widget: 'number',
    category: 'Window',
    visibility: 'advanced',
    requiresRestart: true,
  },
  'window.browserStartupLimitSeconds': {
    widget: 'number',
    category: 'Window',
    visibility: 'advanced',
    requiresRestart: true,
  },
  'window.nativeDialogTimeoutSeconds': {
    widget: 'number',
    category: 'Window',
    visibility: 'advanced',
    requiresRestart: true,
  },
  'window.nativeHostStopGraceSeconds': {
    widget: 'number',
    category: 'Window',
    visibility: 'advanced',
    requiresRestart: true,
  },
  'window.transparency': {
    widget: 'enum',
    category: 'Window',
    // The window is created once, from this value, before the page exists.
    requiresRestart: true,
  },
  'window.material': {
    widget: 'enum',
    category: 'Appearance',
  },
  'prefetch.enabled': {
    widget: 'boolean',
    category: 'Prefetch',
  },
  'prefetch.files': {
    widget: 'boolean',
    category: 'Prefetch',
  },
  'prefetch.diffs': {
    widget: 'boolean',
    category: 'Prefetch',
  },
  'files.autoSave': {
    widget: 'enum',
    category: 'Files',
  },
  'files.autoSaveDelay': {
    widget: 'number',
    category: 'Files',
  },
  'files.picker.pinnedLocations': {
    widget: 'list',
    visibility: 'internal',
    category: 'Files',
  },
  'files.picker.hiddenLocations': {
    widget: 'list',
    visibility: 'internal',
    category: 'Files',
  },
  'files.picker.view': {
    widget: 'enum',
    category: 'Files',
  },
  'files.previewKilobytes': {
    widget: 'number',
    category: 'Files',
  },
  'files.showHidden': {
    widget: 'boolean',
    category: 'Files',
  },
  'files.readSessionLimit': {
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  },
  'files.readRangeSizeKiB': {
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  },
  'files.readSessionIdleMinutes': {
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  },
  'files.watchDirectoryLimit': {
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  },
  'files.searchIndexLimit': {
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  },
  'files.searchIndexIdleMinutes': {
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  },
  'lsp.experimental.tyForPython': {
    widget: 'boolean',
    category: 'Language servers',
    visibility: 'advanced',
  },
  'lsp.idleTimeoutMs': {
    widget: 'number',
    category: 'Language servers',
    visibility: 'advanced',
  },
  'lsp.downloadRuntimes': {
    widget: 'boolean',
    category: 'Language servers',
    visibility: 'advanced',
  },
  'lsp.servers': {
    // No widget can edit a record of objects, so this is reachable through the
    // raw JSON view only — which is what `internal` means. Registering it
    // anyway is the point: it replaces an env var nobody could discover.
    widget: 'complex',
    visibility: 'internal',
    category: 'Language servers',
  },
  'lsp.languageServers': {
    // A record of lists has no widget, so the JSON view is its only editor.
    widget: 'complex',
    visibility: 'internal',
    category: 'Language servers',
  },
  'lsp.semanticTokens.enabled': {
    widget: 'boolean',
    category: 'Language servers',
    visibility: 'advanced',
  },
  'lsp.semanticTokens.delta': {
    widget: 'boolean',
    category: 'Language servers',
    visibility: 'advanced',
  },
  'lsp.semanticTokens.servers': {
    // A record of booleans has no editable widget — `record` is typed for
    // `string | null` values — so this is the JSON view only, exactly like
    // `lsp.servers`.
    widget: 'complex',
    visibility: 'internal',
    category: 'Language servers',
  },
  'providers.acpOperationTimeoutMs': {
    widget: 'number',
    category: 'Providers',
  },
  'providers.usageRefreshSeconds': {
    widget: 'number',
    category: 'Providers',
  },
  'providers.usageFailureCooldownSeconds': {
    widget: 'number',
    category: 'Providers',
  },
  'providers.usageStaleAfterSeconds': {
    widget: 'number',
    category: 'Providers',
  },
  'providers.transcriptHistoryRefreshSeconds': {
    widget: 'number',
    category: 'Providers',
  },
  'providers.transcriptHistoryMaxBytes': {
    widget: 'number',
    category: 'Providers',
  },
  'providers.transcriptHistoryMaxFiles': {
    widget: 'number',
    category: 'Providers',
  },
  'providers.proxyUsageRequestIntervalHours': {
    widget: 'number',
    category: 'Providers',
  },
  'providers.proxyUsageUrl': {
    widget: 'string',
    category: 'Providers',
  },
  'providers.proxyUsageProviderInstanceIds': {
    widget: 'complex',
    category: 'Providers',
  },
  'providers.instances': {
    widget: 'providers',
    category: 'Providers',
  },
  'models.hidden': {
    widget: 'models',
    category: 'Models',
  },
  'models.order': {
    widget: 'models',
    category: 'Models',
    // Hiding and ranking are one decision taken per model, so they are one row.
    // Two rows rendered the whole catalogue twice and left the user matching a
    // switch in the first list to a pair of arrows in the second.
    rowOwner: 'models.hidden',
  },
  'models.favorites': {
    widget: 'models',
    category: 'Models',
    // Starred on the same row that hides and orders a model.
    rowOwner: 'models.hidden',
  },
  'keybindings.preset': {
    widget: 'enum',
    category: 'Keyboard shortcuts',
  },
  'keybindings.overrides': {
    widget: 'keybindings',
    category: 'Keyboard shortcuts',
  },
} satisfies {
  readonly [K in SettingId]: SettingPresentation & { readonly widget: WidgetFor<SettingValue<K>> }
}

export function presentationFor(id: SettingId): SettingPresentation {
  return SETTINGS_PRESENTATION[id]
}

export const SETTING_CATEGORIES = [
  ...new Set(SETTING_IDS.map((id) => SETTINGS_PRESENTATION[id].category)),
]

/** The ids that have a row of their own, in registry order. */
export const SETTING_ROW_IDS = SETTING_IDS.filter(
  (id) => presentationFor(id).rowOwner === undefined,
)

/**
 * Every key one row writes: the row's own, then the keys that named it `rowOwner`.
 *
 * The row is the unit the page resets and marks as modified, so both have to ask
 * this rather than the id — a "Reset setting" that cleared the switches and left
 * the ordering behind would be a reset only in name.
 */
export function settingRowIds(id: SettingId): readonly SettingId[] {
  return [id, ...SETTING_IDS.filter((other) => presentationFor(other).rowOwner === id)]
}
