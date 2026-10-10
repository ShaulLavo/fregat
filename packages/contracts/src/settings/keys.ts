import { deployTargetSchema } from './deploy-target'
import {
  collaborationSignalingUrlsSchema,
  collaborationIceServersSchema,
  collaborationDisplayNameSchema,
  collaborationColourSchema,
} from './collaboration'
import { LOG_TIME_RANGES } from '../log-dashboard'
import { modelSelectionSchema } from '../orchestration-runtime'
import { DEFAULT_CODEX_PROVIDER_SETTINGS } from '../provider'
import { providerInstanceIdSchema } from '../chat-ids'
import { themeBundleSchema, themeCustomizationsSchema } from '../themes/bundle'
import { wallpaperSelectionSchema } from '../themes/wallpaper'
import * as v from 'valibot'
import { machinesSchema } from '../machines'
import { absolutePathSchema } from '../absolute-path'
import { WORKTREE_SUBMODULE_MODES } from '../git'
import {
  keybindingOverridesSchema,
  lspLanguageServerListsSchema,
  lspServerOverridesSchema,
  modelRefListSchema,
  providerInstanceConfigsSchema,
  semanticTokenServerOverridesSchema,
} from '../settings'
import { paletteIdSchema } from '../themes/palette'
import { fontRefSchema } from '../fonts/schema'
import {
  COLOR_THEME_MODES,
  DEFAULT_COLOR_THEME,
  DEFAULT_CODE_FONT,
  DEFAULT_UI_FONT,
  DEFAULT_PALETTE_ID,
  DEFAULT_WALLPAPER_SELECTION,
  DEFAULT_WORKBENCH_DENSITY,
  WORKBENCH_DENSITIES,
  DEFAULT_WORKBENCH_FEEL,
  WORKBENCH_FEELS,
} from './boot-defaults'
import { applySettingDependencies, defineSetting, type SettingDefinition } from './registry'
import { WORKSPACE_SEARCH_LIMIT_MAX } from '../workspace-search'

/**
 * Every setting this build knows about, keyed by its dotted id.
 *
 * Flat keys rather than nested sections: `editor.fontSize` as a first-class key
 * is what makes per-key reset, per-key scope, per-key search and per-key
 * `inspect()` possible at all, and it is the shape a hand-edited settings.json
 * has to have. Sections survive only as `category`, a presentation concern.
 *
 * A key is never registered inert. Every entry here has a consumer wired in the
 * same phase it is added, so the table cannot drift into a list of knobs that
 * write a file nothing reads.
 *
 * PHASE 1 registers only the keys that already exist on disk, so the resolver
 * can be proven against real schemas before the storage layer moves. Phases 3
 * and 5-7 add the rest; see `docs/settings-registry-inventory.md`.
 */
/** Percent, as a whole number, for the surface material knobs. */
const percentSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100))
export const SETTINGS_REGISTRY = {
  'chat.followUpBehavior': defineSetting({
    schema: v.picklist(['queue', 'steer']),
    default: 'queue',
    scope: 'application',
  }),
  // Consumed by chat's use-voice-input hook.
  'chat.dictationLimitSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(1800)),
    default: 300,
    scope: 'application',
  }),
  'chat.sendShortcut': defineSetting({
    schema: v.picklist(['enter', 'mod-enter-multiline', 'mod-enter']),
    default: 'enter',
    // Binds a key, so it never comes from a workspace file.
    scope: 'application',
  }),
  'chat.planModeEnabled': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'agent.diagnosticsFeedback': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
  }),
  'chat.activeFileContext': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'chat.contextWindowMeterEnabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
  }),
  'chat.responseStreamingMode': defineSetting({
    schema: v.picklist(['paragraph', 'turn', 'token']),
    default: 'paragraph',
    scope: 'application',
  }),
  'chat.projectResponseStreamingModes': defineSetting({
    schema: v.record(v.string(), v.picklist(['paragraph', 'turn', 'token'])),
    default: {},
    merge: 'record',
    scope: 'application',
  }),
  'chat.notificationMode': defineSetting({
    schema: v.picklist(['off', 'notifications', 'sound', 'notifications-and-sound']),
    default: 'off',
    scope: 'application',
  }),
  'chat.inAppNotificationsEnabled': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'chat.pushNotifications': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'chat.textGenerationModel': defineSetting({
    schema: modelSelectionSchema,
    default: {
      providerInstanceId: DEFAULT_CODEX_PROVIDER_SETTINGS.providerInstanceId,
      model: 'gpt-5.6-luna',
      options: { reasoningEffort: 'low' },
    },
    scope: 'application',
  }),
  'chat.projectTextGenerationModels': defineSetting({
    schema: v.record(v.string(), modelSelectionSchema),
    default: {},
    scope: 'application',
    merge: 'record',
  }),
  'chat.sessionSortOrder': defineSetting({
    schema: v.picklist(['updated_at', 'created_at']),
    default: 'updated_at',
    scope: 'application',
  }),
  'chat.confirmSessionDelete': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
  }),
  'chat.projectGrouping': defineSetting({
    schema: v.picklist(['repository', 'repository_path', 'separate']),
    default: 'repository',
    scope: 'application',
  }),
  'chat.autoSettleAfterDays': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365)),
    default: 3,
    scope: 'application',
  }),
  'chat.autoSettleOnMerge': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
  }),
  'chat.projectAutoSettle': defineSetting({
    schema: v.record(
      v.string(),
      v.object({
        afterDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365))),
        onMerge: v.optional(v.boolean()),
      }),
    ),
    default: {},
    merge: 'record',
    scope: 'application',
  }),
  'chat.projectGroupingOverrides': defineSetting({
    schema: v.record(v.string(), v.picklist(['repository', 'repository_path', 'separate'])),
    default: {},
    scope: 'application',
    merge: 'record',
  }),
  'environments.loadBalancing': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'environments.loadPreferences': defineSetting({
    schema: v.record(v.string(), v.picklist(['prefer', 'normal', 'less-often', 'manual-only'])),
    default: {},
    scope: 'application',
    merge: 'record',
  }),
  'environments.machines': defineSetting({
    schema: machinesSchema,
    default: {},
    scope: 'machine',
    merge: 'record',
  }),
  'environments.devicePairing': defineSetting({
    schema: v.boolean(),
    default: true,
    // Machine scope: it decides who reaches this machine's files, terminals and agents.
    scope: 'machine',
  }),
  'environments.trustedProxyHosts': defineSetting({
    schema: v.array(v.pipe(v.string(), v.minLength(1))),
    default: [],
    scope: 'machine',
  }),
  'environments.tailnetOwnerDevices': defineSetting({
    schema: v.boolean(),
    default: true,
    // Machine scope: it decides who reaches this machine's files, terminals and agents.
    scope: 'machine',
  }),
  'server.address': defineSetting({
    // One explicit IPv4 loopback origin: `localhost` may resolve to ::1 and miss the socket unit.
    schema: v.pipe(
      v.string(),
      v.regex(/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/),
      v.check((value) => Number(value.split(':')[2]) <= 65535, 'Ports end at 65535'),
    ),
    default: 'http://127.0.0.1:3301',
    // Machine scope: the OS socket unit listens here, and the installed app's identity is this origin.
    scope: 'machine',
  }),
  'server.releaseRoot': defineSetting({
    // Empty resolves per platform in scripts/service/release-root.ts; a path ships in no repository.
    schema: v.union([v.literal(''), absolutePathSchema]),
    default: '',
    scope: 'machine',
  }),
  'server.activationTimeoutSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600)),
    default: 60,
    scope: 'machine',
  }),
  'server.webBase': defineSetting({
    schema: v.pipe(v.string(), v.regex(/^\/(?:[A-Za-z0-9._~-]+\/)*$/)),
    default: '/',
    scope: 'machine',
  }),
  'git.maxDiffFileSizeMiB': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
    default: 50,
    scope: 'machine',
  }),
  'git.autoPull': defineSetting({
    schema: v.boolean(),
    default: false,
    // Machine scope: it writes to checkouts and reaches the network.
    scope: 'machine',
  }),
  'git.projectAutoPull': defineSetting({
    schema: v.record(v.string(), v.boolean()),
    default: {},
    merge: 'record',
    scope: 'machine',
  }),
  'git.worktreeSubmodules': defineSetting({
    schema: v.picklist(WORKTREE_SUBMODULE_MODES),
    default: 'recursive',
    // Machine scope: the value picks git flags and can reach the network.
    scope: 'machine',
  }),
  'git.projectWorktreeSubmodules': defineSetting({
    schema: v.record(v.string(), v.picklist(WORKTREE_SUBMODULE_MODES)),
    default: {},
    merge: 'record',
    scope: 'machine',
  }),
  'git.worktreeCleanupOnDelete': defineSetting({
    schema: v.boolean(),
    default: false,
    // Machine scope: it deletes checkouts on this machine.
    scope: 'machine',
  }),
  'git.projectWorktreeCleanupOnDelete': defineSetting({
    schema: v.record(v.string(), v.boolean()),
    default: {},
    merge: 'record',
    scope: 'machine',
  }),
  'workbench.colorTheme': defineSetting({
    schema: v.picklist(COLOR_THEME_MODES),
    default: DEFAULT_COLOR_THEME,
    scope: 'window',
  }),
  'workbench.theme': defineSetting({
    schema: v.nullable(themeBundleSchema),
    default: null,
    scope: 'application',
  }),
  'workbench.theme.customizations': defineSetting({
    schema: themeCustomizationsSchema,
    default: {},
    scope: 'application',
  }),
  'workbench.palette': defineSetting({
    // A palette id, bundled or from the user's library on the primary server.
    // Application scope: a workspace file cannot name a palette that exists
    // only on one machine. The mode is still workbench.colorTheme.
    schema: paletteIdSchema,
    default: DEFAULT_PALETTE_ID,
    scope: 'application',
  }),
  'editor.codeTheme.dark': defineSetting({
    schema: v.pipe(v.string(), v.minLength(1)),
    default: 'dark-plus',
    scope: 'window',
  }),
  'editor.codeTheme.light': defineSetting({
    schema: v.pipe(v.string(), v.minLength(1)),
    default: 'light-plus',
    scope: 'window',
  }),
  'workbench.wallpaper': defineSetting({
    schema: wallpaperSelectionSchema,
    default: DEFAULT_WALLPAPER_SELECTION,
    scope: 'application',
  }),
  'workbench.surface.opacity': defineSetting({
    schema: percentSchema,
    default: 80,
    scope: 'window',
  }),
  'workbench.surface.contentOpacity': defineSetting({
    schema: percentSchema,
    default: 50,
    scope: 'window',
  }),
  'workbench.surface.blur': defineSetting({
    // Clamped rather than open: at `window` scope a cloned repository can set
    // this, and an unbounded backdrop-filter blur is a real GPU cost.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(40)),
    default: 9,
    scope: 'window',
  }),
  'workbench.surface.saturation': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(400)),
    default: 160,
    scope: 'window',
  }),
  'tui.theme.colors': defineSetting({
    schema: v.picklist(['theme', 'terminal']),
    default: 'theme',
    scope: 'application',
  }),
  'workbench.reduceMotion': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
  }),
  'workbench.fontFamily': defineSetting({
    schema: fontRefSchema,
    default: DEFAULT_UI_FONT,
    scope: 'window',
  }),
  'workbench.sounds.controls': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'workbench.sounds.errors': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'workbench.sounds.git': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'workbench.sounds.terminalBell': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'workbench.sounds.volume': defineSetting({
    schema: percentSchema,
    default: 50,
    scope: 'application',
  }),
  'workbench.feel': defineSetting({
    schema: v.picklist(WORKBENCH_FEELS),
    default: DEFAULT_WORKBENCH_FEEL,
    scope: 'window',
  }),
  'workbench.density': defineSetting({
    schema: v.picklist(WORKBENCH_DENSITIES),
    default: DEFAULT_WORKBENCH_DENSITY,
    scope: 'window',
  }),
  'workbench.surface.continuousSeams': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
  }),
  'workbench.tree.indentGuides': defineSetting({
    schema: v.picklist(['none', 'onHover', 'always'] as const),
    default: 'always',
    scope: 'window',
  }),
  'editor.fontFamily': defineSetting({
    schema: fontRefSchema,
    default: DEFAULT_CODE_FONT,
    scope: 'window',
  }),
  'editor.fontSize': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(72)),
    default: 13,
    scope: 'window',
  }),
  'editor.lineHeight': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(8), v.maxValue(120)),
    default: 24,
    scope: 'window',
  }),
  'editor.tabSize': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(16)),
    default: 4,
    scope: 'window',
  }),
  'editor.history.retainedStates': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(5000)),
    default: 200,
    scope: 'application',
  }),
  'editor.history.persist': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
  }),
  'editor.history.persistDays': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365)),
    default: 30,
    scope: 'application',
    dependsOn: 'editor.history.persist',
  }),
  'editor.history.persistBudget': defineSetting({
    // Clamped at 1 GiB, like the retained text budget: browser storage is shared.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_073_741_824)),
    default: 67_108_864,
    scope: 'application',
    dependsOn: 'editor.history.persist',
  }),
  'editor.markdownView': defineSetting({
    schema: v.picklist(['source', 'preview'] as const),
    default: 'preview',
    scope: 'window',
  }),
  'editor.markdownRenderedPane': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
  }),
  'editor.spellcheck': defineSetting({
    schema: v.picklist(['off', 'prose', 'proseAndCode'] as const),
    // Off for files until marks stop costing a keystroke several milliseconds (E058 question 3).
    default: 'off',
    // Suppression, not execution: it only decides which words are marked, so a docs repository may
    // turn it on for itself.
    scope: 'window',
  }),
  'spellcheck.words': defineSetting({
    schema: v.record(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)), v.boolean()),
    default: {},
    merge: 'record',
    // Suppression only: a workspace dictionary lists the words its files use.
    scope: 'window',
  }),
  'editor.diff.viewMode': defineSetting({
    schema: v.picklist(['split', 'stacked'] as const),
    default: 'stacked',
    scope: 'window',
  }),
  'editor.inputRoute': defineSetting({
    schema: v.picklist(['textarea', 'edit-context'] as const),
    default: 'edit-context',
    scope: 'application',
  }),
  'terminal.shellKeys': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'terminal.integrated.screenReader': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
  }),
  'terminal.integrated.fontSize': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(72)),
    default: 12,
    scope: 'window',
  }),
  'terminal.integrated.scrollback': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(500_000)),
    default: 10_000,
    scope: 'window',
  }),
  'terminal.integrated.cursorBlinking': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
  }),
  'editor.inactiveAnalysisEntryLimit': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER)),
    default: 2,
    scope: 'machine',
  }),
  'editor.retainedTextBudget': defineSetting({
    // Clamped at 1 GiB: an unbounded value is a memory leak with a settings key
    // in front of it. 0 retains only the active project, which is never trimmed.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_073_741_824)),
    default: 67_108_864,
    // Machine scope, following `lsp.idleTimeoutMs`: a per-box RAM tradeoff, and a
    // workspace file ships inside a clone, so this must not be window-scoped.
    scope: 'machine',
  }),
  'editor.unicodeHighlight.ambiguousCharacters': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
  }),
  'editor.unicodeHighlight.invisibleCharacters': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
  }),
  'editor.unicodeHighlight.allowedCharacters': defineSetting({
    schema: v.string(),
    default: '',
    scope: 'window',
  }),
  // Consumed by the editor's collaboration-options resolver.
  'editor.collaboration.signalingUrls': defineSetting({
    schema: collaborationSignalingUrlsSchema,
    default: [],
    scope: 'application',
  }),
  'editor.collaboration.iceServers': defineSetting({
    schema: collaborationIceServersSchema,
    default: [],
    scope: 'application',
  }),
  'editor.collaboration.transportPolicy': defineSetting({
    schema: v.picklist(['all', 'relay-only']),
    default: 'all',
    scope: 'application',
  }),
  'editor.collaboration.displayName': defineSetting({
    schema: collaborationDisplayNameSchema,
    default: '',
    scope: 'application',
  }),
  'editor.collaboration.colour': defineSetting({
    schema: collaborationColourSchema,
    default: '',
    scope: 'application',
  }),
  'editor.largeFile.analysisLimitMiCodeUnits': defineSetting({
    schema: v.pipe(v.number(), v.minValue(0), v.maxValue(1024)),
    default: 10,
    scope: 'machine',
  }),
  'editor.maxTokenizationLineLength': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000_000)),
    default: 20_000,
    scope: 'application',
  }),
  'editor.largeFile.minimapLimitMiCodeUnits': defineSetting({
    schema: v.pipe(v.number(), v.minValue(0), v.maxValue(1024)),
    default: 50,
    scope: 'machine',
  }),
  'editor.minimap.enabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
  }),
  'editor.guides.indentation': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
  }),
  'editor.syntaxHighlighting.enabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
  }),
  'editor.decode.mode': defineSetting({
    schema: v.picklist(['off', 'diffusion', 'autoregressive', 'parallel', 'token'] as const),
    default: 'off',
    scope: 'window',
  }),
  'search.defaultMatchMode': defineSetting({
    schema: v.picklist(['literal', 'regex', 'fuzzy'] as const),
    default: 'literal',
    // Suppression, not execution: this picks between fixed ripgrep flags, so a
    // workspace may set it — with the cross-scope indicator, because a
    // workspace-authored search default changes what the user *and* the agent
    // find.
    scope: 'window',
  }),
  'search.caseSensitive': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
  }),
  'search.wholeWord': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
  }),
  'search.maxResults': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(WORKSPACE_SEARCH_LIMIT_MAX)),
    default: WORKSPACE_SEARCH_LIMIT_MAX,
    scope: 'window',
  }),
  'search.maxResultFiles': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(WORKSPACE_SEARCH_LIMIT_MAX)),
    default: WORKSPACE_SEARCH_LIMIT_MAX,
    scope: 'window',
  }),
  'search.quickOpenLimit': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
    default: 80,
    scope: 'window',
  }),
  'search.quickOpenPreview': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
  }),
  'chat.keepImportedSessionsUpdated': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'machine',
  }),
  'chat.diagramFontWaitMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(30_000)),
    default: 3_000,
    scope: 'application',
  }),
  'chat.defaultRuntimeMode': defineSetting({
    schema: v.picklist(['full-access', 'approval-required', 'auto-accept-edits'] as const),
    default: 'full-access',
    // Execution, unambiguously: this is the permission posture a provider session
    // spawns with. A cloned repository setting it to full-access would silently
    // overrule a user who chose approval-required.
    scope: 'application',
  }),
  'chat.defaultInteractionMode': defineSetting({
    schema: v.picklist(['default', 'plan'] as const),
    default: 'default',
    // Same permission axis: plan mode decides whether the agent writes and execs
    // before the user approves.
    scope: 'application',
    // Plan mode is off in the composer while its switch is off, so this has nothing to pick.
    dependsOn: 'chat.planModeEnabled',
  }),
  'logs.defaultTimeRange': defineSetting({
    schema: v.picklist(LOG_TIME_RANGES),
    default: '1h',
    scope: 'window',
  }),
  // Consumed by the browser's client-log delivery outbox.
  'logs.clientFailureRetention': defineSetting({
    schema: v.object({
      maxEvents: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
      maxBytes: v.pipe(v.number(), v.integer(), v.minValue(4096), v.maxValue(2_097_152)),
      maxAgeHours: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(24)),
    }),
    default: { maxEvents: 250, maxBytes: 524_288, maxAgeHours: 24 },
    scope: 'application',
  }),
  'logs.retentionDays': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3650)),
    default: 0,
    // Machine scope: it deletes files on this machine, which no workspace file may ask for.
    scope: 'machine',
  }),
  'logs.slowThresholdMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(60_000)),
    default: 500,
    scope: 'window',
  }),
  'developer.simulatedLatencyMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000)),
    default: 0,
    // A delay is not a binary, a flag or a key, but it reaches every request,
    // so it stays out of the workspace file all the same.
    scope: 'application',
  }),
  'developer.devServerIdleMinutes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1440)),
    default: 15,
    // Machine scope: `bun run dev:serve` passes it to mesh, which stops a process with it.
    scope: 'machine',
  }),
  'developer.clientUpdateCheckSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(3600)),
    default: 60,
    scope: 'application',
  }),
  'developer.deployTarget': defineSetting({
    schema: v.nullable(deployTargetSchema),
    default: null,
    scope: 'machine',
  }),
  'developer.deployRestartWaitMinutes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1440)),
    // Long enough for a typical agent turn to finish; a session busy for longer is stuck or
    // background work, which the caller should interrupt on purpose.
    default: 30,
    // Machine scope: `bun run install-release --restart` reads it from this machine's production home.
    scope: 'machine',
  }),
  'window.browser': defineSetting({
    schema: v.pipe(v.string(), v.regex(/^(?:auto|webview|\/[^\0\r\n]+)$/)),
    default: 'auto',
    scope: 'machine',
  }),
  'window.browserStartupIdleSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600)),
    // A cold start on a slow disk keeps faulting in its files long after this; only a silent browser waits it out.
    default: 5,
    // Machine scope: it decides when the launcher stops a browser process on this machine.
    scope: 'machine',
  }),
  'window.browserStartupLimitSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600)),
    default: 60,
    scope: 'machine',
  }),
  'window.nativeDialogTimeoutSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3600)),
    default: 300,
    scope: 'machine',
  }),
  'window.nativeHostStopGraceSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30)),
    default: 2,
    scope: 'machine',
  }),
  'window.transparency': defineSetting({
    // Window creation belongs to the native host, before the page exists.
    schema: v.picklist(['compositor', 'window'] as const),
    default: 'compositor',
    // Machine scope: window chrome is a property of this machine's desktop shell,
    // and a cloned repository must not be able to re-chrome the window.
    scope: 'machine',
  }),
  'window.material': defineSetting({
    schema: v.picklist(['none', 'frosted', 'glass']),
    default: 'none',
    scope: 'window',
  }),
  'prefetch.enabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
  }),
  'prefetch.files': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    dependsOn: 'prefetch.enabled',
  }),
  'prefetch.diffs': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    dependsOn: 'prefetch.enabled',
  }),
  'files.autoSave': defineSetting({
    schema: v.picklist(['off', 'afterDelay', 'onFocusChange', 'onWindowChange'] as const),
    default: 'off',
    scope: 'window',
  }),
  'files.autoSaveDelay': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(60_000)),
    default: 1_000,
    scope: 'window',
  }),
  'files.picker.pinnedLocations': defineSetting({
    schema: v.array(v.string()),
    default: [],
    // Machine scope: the paths name folders on the machine being browsed.
    scope: 'machine',
  }),
  'files.picker.hiddenLocations': defineSetting({
    schema: v.array(v.string()),
    default: [],
    scope: 'machine',
  }),
  'files.picker.view': defineSetting({
    schema: v.picklist(['auto', 'columns', 'list', 'icons'] as const),
    default: 'auto',
    scope: 'application',
  }),
  'files.previewKilobytes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(4), v.maxValue(1024)),
    default: 64,
    scope: 'application',
  }),
  'files.showHidden': defineSetting({
    schema: v.boolean(),
    default: false,
    // Visibility is suppression-only, so a workspace may choose it. The
    // settings UI already marks workspace overrides for window-scoped values.
    scope: 'window',
  }),
  'files.readSessionLimit': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
    default: 8,
    scope: 'machine',
  }),
  'files.readRangeSizeKiB': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(64), v.maxValue(8192)),
    default: 1024,
    scope: 'machine',
  }),
  'files.readSessionIdleMinutes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60)),
    default: 5,
    scope: 'machine',
  }),
  'files.watchDirectoryLimit': defineSetting({
    // Each watched directory is one inotify watch from the machine's per-user pool, which every
    // other watcher on the box shares; a workspace file must never raise it.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2_000_000)),
    default: 200_000,
    scope: 'machine',
  }),
  'files.searchIndexLimit': defineSetting({
    // Each index holds every entry of its folder in server memory (about 870 B per entry).
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
    default: 4,
    scope: 'machine',
  }),
  'files.searchIndexIdleMinutes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1440)),
    default: 15,
    scope: 'machine',
  }),
  'lsp.experimental.tyForPython': defineSetting({
    schema: v.boolean(),
    default: false,
    // Machine scope, and not negotiable: this picks which Python binary spawns —
    // `spawnTy` or pyright's `pyright-langserver`. A cloned repository choosing
    // the language server that runs against its own source is exactly what the
    // execution rule forbids.
    scope: 'machine',
  }),
  'lsp.idleTimeoutMs': defineSetting({
    // Clamped at an hour: the timer governs how long an idle language-server
    // child process stays resident, and an unbounded value is a memory leak
    // with a settings key in front of it.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3_600_000)),
    default: 120_000,
    // Machine scope: this is a per-box RAM tradeoff and it governs child-process
    // lifetime.
    scope: 'machine',
  }),
  'lsp.downloadRuntimes': defineSetting({
    schema: v.boolean(),
    default: true,
    // Machine scope: this decides whether a binary is fetched onto this machine
    // and then executed.
    scope: 'machine',
  }),
  'lsp.servers': defineSetting({
    schema: lspServerOverridesSchema,
    default: {},
    // The strongest case for machine scope in the whole table: `command` becomes
    // argv and `env` is spread over the child's environment, so a workspace file
    // that could set this would be arbitrary code execution on clone.
    scope: 'machine',
  }),
  'lsp.languageServers': defineSetting({
    schema: lspLanguageServerListsSchema,
    default: {},
    // Named entries may start matching tools, so cloned workspaces cannot set this.
    scope: 'machine',
    // Per-extension rather than replace: a workspace should be able to answer
    // for `.json` without erasing the answer someone gave for `.ts`.
    merge: 'record',
  }),
  'lsp.semanticTokens.enabled': defineSetting({
    schema: v.boolean(),
    // Off by default: see details. Turning it on needs the Editor to hold semantic paint until
    // syntax has painted once.
    default: false,
    // Machine scope for the same reason as `lsp.idleTimeoutMs`: it governs how
    // much work a child process on this box does. It gates *requests* only —
    // the declared capability block stays a pure function of the server id, so
    // that a pooled backend's advertised legend cannot depend on which tab
    // connected first.
    scope: 'machine',
  }),
  'lsp.semanticTokens.delta': defineSetting({
    schema: v.boolean(),
    default: true,
    // Machine scope: it governs how much a child process on this box is asked to
    // serialize, and how much garbage this box's proxy makes per keystroke.
    scope: 'machine',
    dependsOn: 'lsp.semanticTokens.enabled',
  }),
  'lsp.semanticTokens.servers': defineSetting({
    schema: semanticTokenServerOverridesSchema,
    default: {},
    scope: 'machine',
  }),
  'providers.acpOperationTimeoutMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_800_000)),
    default: 30_000,
    scope: 'machine',
  }),
  'providers.usageRefreshSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(86400)),
    default: 300,
    scope: 'machine',
  }),
  'providers.codexUsageRefreshSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(86400)),
    default: 60,
    scope: 'machine',
  }),
  'providers.usageFailureCooldownSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(86400)),
    default: 600,
    scope: 'machine',
  }),
  'providers.usageStaleAfterSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(86400)),
    default: 900,
    scope: 'machine',
  }),
  'providers.transcriptHistoryRefreshSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(86400)),
    default: 60,
    scope: 'machine',
  }),
  'providers.transcriptHistoryMaxBytes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(65536), v.maxValue(2147483647)),
    default: 268435456,
    scope: 'machine',
  }),
  'providers.transcriptHistoryMaxFiles': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000000)),
    default: 10000,
    scope: 'machine',
  }),
  'providers.proxyUsageRequestIntervalHours': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(24)),
    default: 1,
    scope: 'machine',
  }),
  'providers.proxyUsageUrl': defineSetting({
    schema: v.nullable(
      v.pipe(
        v.string(),
        v.url(),
        v.check((value) => {
          const url = URL.parse(value)
          return Boolean(
            url &&
            url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash,
          )
        }, 'Use a localhost HTTP management address.'),
      ),
    ),
    default: null,
    scope: 'machine',
  }),
  'providers.proxyUsageProviderInstanceIds': defineSetting({
    schema: v.array(providerInstanceIdSchema),
    default: [],
    scope: 'application',
  }),
  'providers.instances': defineSetting({
    schema: providerInstanceConfigsSchema,
    default: [],
    // Carries `binaryPath` and `environment`, both of which reach process spawn.
    // A cloned repo must never be able to point a provider at another binary.
    scope: 'application',
  }),
  'models.hidden': defineSetting({
    schema: modelRefListSchema,
    default: [],
    // Steers which credentialed account a turn bills to, so it stays out of a
    // workspace file for the same reason `providers.instances` does.
    scope: 'application',
  }),
  'models.order': defineSetting({
    schema: modelRefListSchema,
    default: [],
    scope: 'application',
  }),
  'models.favorites': defineSetting({
    schema: modelRefListSchema,
    default: [],
    scope: 'application',
  }),
  'keybindings.preset': defineSetting({
    schema: v.picklist(['ours', 'zed', 'vscode'] as const),
    default: 'ours',
    scope: 'application',
  }),
  'keybindings.overrides': defineSetting({
    schema: keybindingOverridesSchema,
    default: [],
    // A binding can invoke any app command, which puts this on the execution
    // side of the scope rule despite looking like pure preference.
    scope: 'application',
  }),
} satisfies Readonly<Record<string, SettingDefinition>>

export type SettingsRegistry = typeof SETTINGS_REGISTRY

export type SettingId = keyof SettingsRegistry & string

/**
 * The typed shape of a resolved document, derived from the registry rather than
 * written out by hand. Adding a key to `SETTINGS_REGISTRY` types it everywhere;
 * there is no second list to keep in step.
 */
export type SettingsValues = {
  [K in SettingId]: v.InferOutput<SettingsRegistry[K]['schema']>
}

export type SettingValue<K extends SettingId> = SettingsValues[K]

export const SETTING_IDS = Object.keys(SETTINGS_REGISTRY) as SettingId[]

export function descriptorFor<K extends SettingId>(id: K): SettingsRegistry[K] {
  return SETTINGS_REGISTRY[id]
}

export function isSettingId(id: string): id is SettingId {
  return Object.hasOwn(SETTINGS_REGISTRY, id)
}

/** The key this one's row sits under (`dependsOn`); `registryProblems` checks it is registered. */
export function settingParentId(id: SettingId): SettingId | undefined {
  return descriptorFor(id).dependsOn as SettingId | undefined
}

/**
 * Registry defaults as a resolved document.
 *
 * Frozen and module-level so the resolver can hand out a default value by
 * reference. Consumers diff object-valued settings by identity — see the
 * `useMemo` on the keymap in `app-command-surface.tsx` — so a fresh `{}` on
 * every resolve would re-register the whole binding table on unrelated writes.
 */
export const DEFAULT_SETTING_VALUES: SettingsValues = Object.freeze(
  defaultValues(),
) as SettingsValues

function defaultValues(): Record<string, unknown> {
  const values: Record<string, unknown> = Object.fromEntries(
    Object.entries(SETTINGS_REGISTRY).map(([id, descriptor]) => [id, descriptor.default]),
  )
  applySettingDependencies(SETTINGS_REGISTRY, values)

  return values
}

/**
 * Runtime schema for a whole resolved document.
 *
 * Every key is optional with its registered default, so `{}` parses into a
 * complete value and a document written by a build with fewer keys still reads.
 * The cast is unavoidable — `Object.fromEntries` erases the key/value pairing —
 * but it cannot drift, because `SettingsValues` is itself derived from the same
 * table this is built from.
 */
export const settingsValuesSchema = v.pipe(
  v.object(
    Object.fromEntries(
      Object.entries(SETTINGS_REGISTRY).map(([id, descriptor]) => [
        id,
        v.optional(descriptor.schema, descriptor.default),
      ]),
    ) as Record<string, v.GenericSchema>,
  ),
  // A key filled from its default still has to read off under a parent that is off.
  v.transform((values: Record<string, unknown>) => {
    applySettingDependencies(SETTINGS_REGISTRY, values)
    return values
  }),
) as unknown as v.GenericSchema<unknown, SettingsValues>
