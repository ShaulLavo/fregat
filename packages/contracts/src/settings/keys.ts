import { deployTargetSchema } from './deploy-target'
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
const mebibytesSchema = v.pipe(v.number(), v.integer(), v.minValue(16), v.maxValue(262144))
const heavyJobBudgetSchema = v.pipe(
  v.object({ ceilingMiB: mebibytesSchema, estimateMiB: mebibytesSchema }),
  v.check(
    (budget) => budget.ceilingMiB >= budget.estimateMiB,
    'The ceiling is at least the estimate.',
  ),
)

export const SETTINGS_REGISTRY = {
  'chat.followUpBehavior': defineSetting({
    schema: v.picklist(['queue', 'steer']),
    default: 'queue',
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
  }),
  'chat.sendShortcut': defineSetting({
    schema: v.picklist(['enter', 'mod-enter-multiline', 'mod-enter']),
    default: 'enter',
    // Binds a key, so it never comes from a workspace file.
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
  }),
  'chat.planModeEnabled': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
  }),
  'agent.diagnosticsFeedback': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
  }),
  'chat.activeFileContext': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
  }),
  'chat.contextWindowMeterEnabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
  }),
  'chat.responseStreamingMode': defineSetting({
    schema: v.picklist(['paragraph', 'turn', 'token']),
    default: 'paragraph',
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
  }),
  'chat.projectResponseStreamingModes': defineSetting({
    schema: v.record(v.string(), v.picklist(['paragraph', 'turn', 'token'])),
    default: {},
    merge: 'record',
    scope: 'application',
    widget: 'complex',
    // A map keyed by project UUID has no widget; the JSON view is its only editor.
    visibility: 'internal',
    category: 'Chat',
  }),
  'chat.notificationMode': defineSetting({
    schema: v.picklist(['off', 'notifications', 'sound', 'notifications-and-sound']),
    default: 'off',
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
  }),
  'chat.inAppNotificationsEnabled': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
  }),
  'chat.pushNotifications': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
  }),
  'chat.textGenerationModel': defineSetting({
    schema: modelSelectionSchema,
    default: {
      providerInstanceId: DEFAULT_CODEX_PROVIDER_SETTINGS.providerInstanceId,
      model: 'gpt-5.6-luna',
      options: { reasoningEffort: 'low' },
    },
    scope: 'application',
    widget: 'complex',
    // No widget edits a model selection yet, so a row could only say "Edit in settings.json".
    visibility: 'internal',
    category: 'Chat',
  }),
  'chat.projectTextGenerationModels': defineSetting({
    schema: v.record(v.string(), modelSelectionSchema),
    default: {},
    scope: 'application',
    widget: 'complex',
    visibility: 'internal',
    merge: 'record',
    category: 'Chat',
  }),
  'chat.sessionSortOrder': defineSetting({
    schema: v.picklist(['updated_at', 'created_at']),
    default: 'updated_at',
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
  }),
  'chat.confirmSessionDelete': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
  }),
  'chat.projectGrouping': defineSetting({
    schema: v.picklist(['repository', 'repository_path', 'separate']),
    default: 'repository',
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
  }),
  'chat.autoSettleAfterDays': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365)),
    default: 3,
    scope: 'application',
    widget: 'number',
    category: 'Chat',
  }),
  'chat.autoSettleOnMerge': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
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
    widget: 'complex',
    visibility: 'internal',
    category: 'Chat',
  }),
  'chat.projectGroupingOverrides': defineSetting({
    schema: v.record(v.string(), v.picklist(['repository', 'repository_path', 'separate'])),
    default: {},
    scope: 'application',
    widget: 'complex',
    visibility: 'internal',
    merge: 'record',
    category: 'Chat',
  }),
  'environments.loadBalancing': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Machines',
  }),
  'environments.loadPreferences': defineSetting({
    schema: v.record(v.string(), v.picklist(['prefer', 'normal', 'less-often', 'manual-only'])),
    default: {},
    scope: 'application',
    widget: 'record',
    merge: 'record',
    category: 'Machines',
  }),
  'environments.machines': defineSetting({
    schema: machinesSchema,
    default: {},
    scope: 'machine',
    widget: 'machines',
    merge: 'record',
    category: 'Machines',
  }),
  'environments.devicePairing': defineSetting({
    schema: v.boolean(),
    default: true,
    // Machine scope: it decides who reaches this machine's files, terminals and agents.
    scope: 'machine',
    widget: 'boolean',
    category: 'Machines',
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
    widget: 'string',
    category: 'Machines',
    visibility: 'advanced',
    requiresRestart: true,
  }),
  'server.releaseRoot': defineSetting({
    // Empty resolves per platform in scripts/service/release-root.ts; a path ships in no repository.
    schema: v.union([v.literal(''), absolutePathSchema]),
    default: '',
    scope: 'machine',
    widget: 'string',
    category: 'Machines',
    visibility: 'advanced',
    requiresRestart: true,
  }),
  'server.activationTimeoutSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600)),
    default: 60,
    scope: 'machine',
    widget: 'number',
    category: 'Machines',
    visibility: 'advanced',
  }),
  'server.webBase': defineSetting({
    schema: v.pipe(v.string(), v.regex(/^\/(?:[A-Za-z0-9._~-]+\/)*$/)),
    default: '/',
    scope: 'machine',
    widget: 'string',
    category: 'Machines',
    visibility: 'advanced',
    requiresRestart: true,
  }),
  'git.maxDiffFileSizeMiB': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
    default: 50,
    scope: 'machine',
    widget: 'number',
    category: 'Git',
    visibility: 'advanced',
  }),
  'git.autoPull': defineSetting({
    schema: v.boolean(),
    default: false,
    // Machine scope: it writes to checkouts and reaches the network.
    scope: 'machine',
    widget: 'boolean',
    category: 'Git',
  }),
  'git.projectAutoPull': defineSetting({
    schema: v.record(v.string(), v.boolean()),
    default: {},
    merge: 'record',
    scope: 'machine',
    widget: 'complex',
    visibility: 'internal',
    category: 'Git',
  }),
  'git.worktreeSubmodules': defineSetting({
    schema: v.picklist(WORKTREE_SUBMODULE_MODES),
    default: 'recursive',
    // Machine scope: the value picks git flags and can reach the network.
    scope: 'machine',
    widget: 'enum',
    category: 'Git',
  }),
  'git.projectWorktreeSubmodules': defineSetting({
    schema: v.record(v.string(), v.picklist(WORKTREE_SUBMODULE_MODES)),
    default: {},
    merge: 'record',
    scope: 'machine',
    widget: 'complex',
    visibility: 'internal',
    category: 'Git',
  }),
  'git.worktreeCleanupOnDelete': defineSetting({
    schema: v.boolean(),
    default: false,
    // Machine scope: it deletes checkouts on this machine.
    scope: 'machine',
    widget: 'boolean',
    category: 'Git',
  }),
  'git.projectWorktreeCleanupOnDelete': defineSetting({
    schema: v.record(v.string(), v.boolean()),
    default: {},
    merge: 'record',
    scope: 'machine',
    widget: 'complex',
    visibility: 'internal',
    category: 'Git',
  }),
  'workbench.colorTheme': defineSetting({
    schema: v.picklist(COLOR_THEME_MODES),
    default: DEFAULT_COLOR_THEME,
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
  }),
  'workbench.theme': defineSetting({
    schema: v.nullable(themeBundleSchema),
    default: null,
    scope: 'application',
    widget: 'theme',
    category: 'Appearance',
  }),
  'workbench.theme.customizations': defineSetting({
    schema: themeCustomizationsSchema,
    default: {},
    scope: 'application',
    widget: 'complex',
    category: 'Appearance',
    visibility: 'internal',
  }),
  'workbench.palette': defineSetting({
    // A palette id, bundled or from the user's library on the primary server.
    // Application scope: a workspace file cannot name a palette that exists
    // only on one machine. The mode is still workbench.colorTheme.
    schema: paletteIdSchema,
    default: DEFAULT_PALETTE_ID,
    scope: 'application',
    widget: 'palette',
    category: 'Appearance',
  }),
  'editor.codeTheme.dark': defineSetting({
    schema: v.pipe(v.string(), v.minLength(1)),
    default: 'dark-plus',
    scope: 'window',
    widget: 'code-theme',
    category: 'Appearance',
  }),
  'editor.codeTheme.light': defineSetting({
    schema: v.pipe(v.string(), v.minLength(1)),
    default: 'light-plus',
    scope: 'window',
    widget: 'code-theme',
    category: 'Appearance',
  }),
  'workbench.wallpaper': defineSetting({
    schema: wallpaperSelectionSchema,
    default: DEFAULT_WALLPAPER_SELECTION,
    scope: 'application',
    widget: 'wallpaper',
    category: 'Appearance',
  }),
  'workbench.surface.opacity': defineSetting({
    schema: percentSchema,
    default: 80,
    scope: 'window',
    widget: 'number',
    category: 'Appearance',
  }),
  'workbench.surface.contentOpacity': defineSetting({
    schema: percentSchema,
    default: 50,
    scope: 'window',
    widget: 'number',
    category: 'Appearance',
  }),
  'workbench.surface.blur': defineSetting({
    // Clamped rather than open: at `window` scope a cloned repository can set
    // this, and an unbounded backdrop-filter blur is a real GPU cost.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(40)),
    default: 9,
    scope: 'window',
    widget: 'number',
    category: 'Appearance',
  }),
  'workbench.surface.saturation': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(400)),
    default: 160,
    scope: 'window',
    widget: 'number',
    category: 'Appearance',
  }),
  'tui.theme.colors': defineSetting({
    schema: v.picklist(['theme', 'terminal']),
    default: 'theme',
    scope: 'application',
    widget: 'enum',
    category: 'Appearance',
  }),
  'workbench.reduceMotion': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
    widget: 'boolean',
    category: 'Appearance',
  }),
  'workbench.fontFamily': defineSetting({
    schema: fontRefSchema,
    default: DEFAULT_UI_FONT,
    scope: 'window',
    widget: 'font',
    category: 'Appearance',
  }),
  'workbench.sounds.controls': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Sounds',
  }),
  'workbench.sounds.errors': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Sounds',
  }),
  'workbench.sounds.git': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Sounds',
  }),
  'workbench.sounds.terminalBell': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Sounds',
  }),
  'workbench.sounds.volume': defineSetting({
    schema: percentSchema,
    default: 50,
    scope: 'application',
    widget: 'number',
    category: 'Sounds',
  }),
  'workbench.feel': defineSetting({
    schema: v.picklist(WORKBENCH_FEELS),
    default: DEFAULT_WORKBENCH_FEEL,
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
  }),
  'workbench.density': defineSetting({
    schema: v.picklist(WORKBENCH_DENSITIES),
    default: DEFAULT_WORKBENCH_DENSITY,
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
  }),
  'workbench.surface.continuousSeams': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
    widget: 'boolean',
    category: 'Appearance',
  }),
  'workbench.tree.indentGuides': defineSetting({
    schema: v.picklist(['none', 'onHover', 'always'] as const),
    default: 'always',
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
  }),
  'editor.fontFamily': defineSetting({
    schema: fontRefSchema,
    default: DEFAULT_CODE_FONT,
    scope: 'window',
    widget: 'font',
    category: 'Editor',
  }),
  'editor.fontSize': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(72)),
    default: 13,
    scope: 'window',
    widget: 'number',
    category: 'Editor',
  }),
  'editor.lineHeight': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(8), v.maxValue(120)),
    default: 24,
    scope: 'window',
    widget: 'number',
    category: 'Editor',
  }),
  'editor.tabSize': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(16)),
    default: 4,
    scope: 'window',
    widget: 'number',
    category: 'Editor',
  }),
  'editor.history.retainedStates': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(5000)),
    default: 200,
    scope: 'application',
    widget: 'number',
    category: 'Editor',
  }),
  'editor.history.persist': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Editor',
  }),
  'editor.history.persistDays': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365)),
    default: 30,
    scope: 'application',
    widget: 'number',
    category: 'Editor',
    dependsOn: 'editor.history.persist',
  }),
  'editor.history.persistBudget': defineSetting({
    // Clamped at 1 GiB, like the retained text budget: browser storage is shared.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_073_741_824)),
    default: 67_108_864,
    scope: 'application',
    widget: 'number',
    category: 'Editor',
    dependsOn: 'editor.history.persist',
    visibility: 'advanced',
  }),
  'editor.markdownView': defineSetting({
    schema: v.picklist(['source', 'preview'] as const),
    default: 'preview',
    scope: 'window',
    widget: 'enum',
    category: 'Editor',
  }),
  'editor.markdownRenderedPane': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
  }),
  'editor.spellcheck': defineSetting({
    schema: v.picklist(['off', 'prose', 'proseAndCode'] as const),
    // Off for files until marks stop costing a keystroke several milliseconds (E058 question 3).
    default: 'off',
    // Suppression, not execution: it only decides which words are marked, so a docs repository may
    // turn it on for itself.
    scope: 'window',
    widget: 'enum',
    category: 'Editor',
  }),
  'spellcheck.words': defineSetting({
    schema: v.record(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)), v.boolean()),
    default: {},
    merge: 'record',
    // Suppression only: a workspace dictionary lists the words its files use.
    scope: 'window',
    widget: 'complex',
    // Words arrive from the editor menu; settings.json is where a list is edited by hand.
    visibility: 'internal',
    category: 'Editor',
  }),
  'editor.diff.viewMode': defineSetting({
    schema: v.picklist(['split', 'stacked'] as const),
    default: 'stacked',
    scope: 'window',
    widget: 'enum',
    category: 'Editor',
  }),
  'editor.inputRoute': defineSetting({
    schema: v.picklist(['textarea', 'edit-context'] as const),
    default: 'edit-context',
    scope: 'application',
    widget: 'enum',
    category: 'Editor',
    // Editors are reused across tabs and take the route only when they are built.
    requiresRestart: true,
    visibility: 'advanced',
  }),
  'terminal.integrated.fontSize': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(72)),
    default: 12,
    scope: 'window',
    widget: 'number',
    category: 'Terminal',
  }),
  'terminal.integrated.scrollback': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(500_000)),
    default: 10_000,
    scope: 'window',
    widget: 'number',
    category: 'Terminal',
  }),
  'terminal.integrated.cursorBlinking': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Terminal',
  }),
  'editor.retainedTextBudget': defineSetting({
    // Clamped at 1 GiB: an unbounded value is a memory leak with a settings key
    // in front of it. 0 retains only the active project, which is never trimmed.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_073_741_824)),
    default: 67_108_864,
    // Machine scope, following `lsp.idleTimeoutMs`: a per-box RAM tradeoff, and a
    // workspace file ships inside a clone, so this must not be window-scoped.
    scope: 'machine',
    widget: 'number',
    category: 'Editor',
    visibility: 'advanced',
  }),
  'editor.unicodeHighlight.ambiguousCharacters': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
  }),
  'editor.unicodeHighlight.invisibleCharacters': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
  }),
  'editor.unicodeHighlight.allowedCharacters': defineSetting({
    schema: v.string(),
    default: '',
    scope: 'window',
    widget: 'string',
    category: 'Editor',
  }),
  'editor.largeFile.analysisLimitMiCodeUnits': defineSetting({
    schema: v.pipe(v.number(), v.minValue(0), v.maxValue(1024)),
    default: 10,
    scope: 'machine',
    widget: 'number',
    category: 'Editor',
  }),
  'editor.maxTokenizationLineLength': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000_000)),
    default: 20_000,
    scope: 'application',
    widget: 'number',
    category: 'Editor',
  }),
  'editor.largeFile.minimapLimitMiCodeUnits': defineSetting({
    schema: v.pipe(v.number(), v.minValue(0), v.maxValue(1024)),
    default: 50,
    scope: 'machine',
    widget: 'number',
    category: 'Editor',
  }),
  'editor.minimap.enabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
    // The non-critical plugin list is built once per page load, behind a lazy
    // module-level promise. Claiming this applies live would be a lie the user
    // discovers by toggling it and seeing nothing happen.
    requiresRestart: true,
  }),
  'editor.guides.indentation': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
    requiresRestart: true,
  }),
  'editor.syntaxHighlighting.enabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
    requiresRestart: true,
  }),
  'editor.decode.mode': defineSetting({
    schema: v.picklist(['off', 'diffusion', 'autoregressive', 'parallel', 'token'] as const),
    default: 'off',
    scope: 'window',
    widget: 'enum',
    category: 'Editor',
    requiresRestart: true,
    visibility: 'advanced',
  }),
  'search.defaultMatchMode': defineSetting({
    schema: v.picklist(['literal', 'regex', 'fuzzy'] as const),
    default: 'literal',
    // Suppression, not execution: this picks between fixed ripgrep flags, so a
    // workspace may set it — with the cross-scope indicator, because a
    // workspace-authored search default changes what the user *and* the agent
    // find.
    scope: 'window',
    widget: 'enum',
    category: 'Search',
  }),
  'search.caseSensitive': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
    widget: 'boolean',
    category: 'Search',
  }),
  'search.wholeWord': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
    widget: 'boolean',
    category: 'Search',
  }),
  'search.maxResults': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(WORKSPACE_SEARCH_LIMIT_MAX)),
    default: WORKSPACE_SEARCH_LIMIT_MAX,
    scope: 'window',
    widget: 'number',
    category: 'Search',
  }),
  'search.maxResultFiles': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(WORKSPACE_SEARCH_LIMIT_MAX)),
    default: WORKSPACE_SEARCH_LIMIT_MAX,
    scope: 'window',
    widget: 'number',
    category: 'Search',
    visibility: 'advanced',
  }),
  'search.quickOpenLimit': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
    default: 80,
    scope: 'window',
    widget: 'number',
    category: 'Search',
    visibility: 'advanced',
  }),
  'search.quickOpenPreview': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Search',
  }),
  'chat.keepImportedSessionsUpdated': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'machine',
    widget: 'boolean',
    category: 'Chat',
  }),
  'chat.diagramFontWaitMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(30_000)),
    default: 3_000,
    scope: 'application',
    widget: 'number',
    category: 'Chat',
    visibility: 'advanced',
  }),
  'chat.defaultRuntimeMode': defineSetting({
    schema: v.picklist(['full-access', 'approval-required', 'auto-accept-edits'] as const),
    default: 'full-access',
    // Execution, unambiguously: this is the permission posture a provider session
    // spawns with. A cloned repository setting it to full-access would silently
    // overrule a user who chose approval-required.
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
  }),
  'chat.defaultInteractionMode': defineSetting({
    schema: v.picklist(['default', 'plan'] as const),
    default: 'default',
    // Same permission axis: plan mode decides whether the agent writes and execs
    // before the user approves.
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
    // Plan mode is off in the composer while its switch is off, so this has nothing to pick.
    dependsOn: 'chat.planModeEnabled',
  }),
  'logs.defaultTimeRange': defineSetting({
    schema: v.picklist(LOG_TIME_RANGES),
    default: '1h',
    scope: 'window',
    widget: 'enum',
    category: 'Logs',
    visibility: 'advanced',
  }),
  'logs.retentionDays': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3650)),
    default: 0,
    // Machine scope: it deletes files on this machine, which no workspace file may ask for.
    scope: 'machine',
    widget: 'number',
    category: 'Logs',
    visibility: 'advanced',
  }),
  'logs.slowThresholdMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(60_000)),
    default: 500,
    scope: 'window',
    widget: 'number',
    category: 'Logs',
    visibility: 'advanced',
  }),
  'developer.simulatedLatencyMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000)),
    default: 0,
    // A delay is not a binary, a flag or a key, but it reaches every request,
    // so it stays out of the workspace file all the same.
    scope: 'application',
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.devServerIdleMinutes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1440)),
    default: 15,
    // Machine scope: `bun run dev:serve` passes it to mesh, which stops a process with it.
    scope: 'machine',
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.clientUpdateCheckSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(3600)),
    default: 60,
    scope: 'application',
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.deployTarget': defineSetting({
    schema: v.nullable(deployTargetSchema),
    default: null,
    scope: 'machine',
    widget: 'complex',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.deployRestartWaitMinutes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1440)),
    // Long enough for a typical agent turn to finish; a session busy for longer is stuck or
    // background work, which the caller should interrupt on purpose.
    default: 30,
    // Machine scope: `bun run install-release --restart` reads it from this machine's production home.
    scope: 'machine',
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.heavyJobLogDirectory': defineSetting({
    schema: v.pipe(v.string(), v.minLength(1)),
    // Beside production's logs, so every checkout's wrapper writes one machine-wide record.
    default: '/work/platform-production/heavy-jobs',
    // Machine scope: `scripts/heavy/run.ts` reads it from this machine's production home.
    scope: 'machine',
    widget: 'string',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.heavyJobClasses': defineSetting({
    schema: v.object({
      bench: heavyJobBudgetSchema,
      browser: heavyJobBudgetSchema,
      build: heavyJobBudgetSchema,
      light: heavyJobBudgetSchema,
      suite: heavyJobBudgetSchema,
    }),
    // Estimate: p90 peak of the class's runs that were not OOM-killed, in the 2026-10-01 heavy-job
    // log, rounded up to 512 MiB: build 2968, light 1368, suite 6158 MiB; browser 3882 from runs
    // after bounded browser-test memory. Bench keeps 3072 for the large-file bench's 8 GiB case
    // cap. A job past its estimate is still capped by its ceiling; the reserve and the pressure
    // gate cover overlaps.
    default: {
      bench: { ceilingMiB: 9216, estimateMiB: 3072 },
      browser: { ceilingMiB: 10240, estimateMiB: 4096 },
      build: { ceilingMiB: 4096, estimateMiB: 3072 },
      light: { ceilingMiB: 2048, estimateMiB: 1536 },
      suite: { ceilingMiB: 8192, estimateMiB: 6656 },
    },
    // Machine scope: `scripts/heavy/run.ts` reads it from this machine's production home.
    scope: 'machine',
    widget: 'complex',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.heavyJobQuietPolicy': defineSetting({
    schema: v.object({
      allowedClasses: v.array(v.literal('light')),
      measurementCpus: v.pipe(
        v.array(v.pipe(v.number(), v.integer(), v.minValue(0))),
        v.maxLength(0),
      ),
      concurrentCpus: v.pipe(
        v.array(v.pipe(v.number(), v.integer(), v.minValue(0))),
        v.maxLength(0),
      ),
    }),
    // CPU affinity and additional classes require a separately validated scheduling policy.
    default: { allowedClasses: ['light'], measurementCpus: [], concurrentCpus: [] },
    scope: 'machine',
    widget: 'complex',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.heavyJobMemoryReserveMiB': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(65536)),
    default: 2048,
    // Machine scope: `scripts/heavy/run.ts` reads it from this machine's production home.
    scope: 'machine',
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.heavyJobMemoryPressureLimit': defineSetting({
    schema: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
    default: 10,
    // Machine scope: `scripts/heavy/run.ts` reads it from this machine's production home.
    scope: 'machine',
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.heavyJobStopGraceSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600)),
    // Long enough for a test runner to shut its workers down after SIGTERM.
    default: 10,
    // Machine scope: `scripts/heavy/run.ts` reads it from this machine's production home.
    scope: 'machine',
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.heavyJobQuietHoldSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(7200)),
    // Long enough for one quiet measurement; other sessions' jobs queue behind it meanwhile.
    default: 600,
    // Machine scope: `scripts/heavy/run.ts` reads it from this machine's production home.
    scope: 'machine',
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'developer.heavyJobCpuLoadLimit': defineSetting({
    schema: v.pipe(v.number(), v.minValue(0.1), v.maxValue(16)),
    default: 1,
    // Machine scope: `scripts/heavy/run.ts` reads it from this machine's production home.
    scope: 'machine',
    widget: 'number',
    category: 'Developer',
    visibility: 'advanced',
  }),
  'window.browser': defineSetting({
    schema: v.pipe(v.string(), v.regex(/^(?:auto|webview|\/[^\0\r\n]+)$/)),
    default: 'auto',
    scope: 'machine',
    widget: 'string',
    category: 'Window',
    requiresRestart: true,
  }),
  'window.browserStartupIdleSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600)),
    // A cold start on a slow disk keeps faulting in its files long after this; only a silent browser waits it out.
    default: 5,
    // Machine scope: it decides when the launcher stops a browser process on this machine.
    scope: 'machine',
    widget: 'number',
    category: 'Window',
    visibility: 'advanced',
    requiresRestart: true,
  }),
  'window.browserStartupLimitSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600)),
    default: 60,
    scope: 'machine',
    widget: 'number',
    category: 'Window',
    visibility: 'advanced',
    requiresRestart: true,
  }),
  'window.nativeDialogTimeoutSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3600)),
    default: 300,
    scope: 'machine',
    widget: 'number',
    category: 'Window',
    visibility: 'advanced',
    requiresRestart: true,
  }),
  'window.nativeHostStopGraceSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30)),
    default: 2,
    scope: 'machine',
    widget: 'number',
    category: 'Window',
    visibility: 'advanced',
    requiresRestart: true,
  }),
  'window.transparency': defineSetting({
    // Window creation belongs to the native host, before the page exists.
    schema: v.picklist(['compositor', 'window'] as const),
    default: 'compositor',
    // Machine scope: window chrome is a property of this machine's desktop shell,
    // and a cloned repository must not be able to re-chrome the window.
    scope: 'machine',
    widget: 'enum',
    category: 'Window',
    // The window is created once, from this value, before the page exists.
    requiresRestart: true,
  }),
  'window.material': defineSetting({
    schema: v.picklist(['none', 'frosted', 'glass']),
    default: 'none',
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
  }),
  'prefetch.enabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Prefetch',
  }),
  'prefetch.files': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Prefetch',
    dependsOn: 'prefetch.enabled',
  }),
  'prefetch.diffs': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Prefetch',
    dependsOn: 'prefetch.enabled',
  }),
  'files.autoSave': defineSetting({
    schema: v.picklist(['off', 'afterDelay', 'onFocusChange', 'onWindowChange'] as const),
    default: 'off',
    scope: 'window',
    widget: 'enum',
    category: 'Files',
  }),
  'files.autoSaveDelay': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(60_000)),
    default: 1_000,
    scope: 'window',
    widget: 'number',
    category: 'Files',
  }),
  'files.picker.pinnedLocations': defineSetting({
    schema: v.array(v.string()),
    default: [],
    // Machine scope: the paths name folders on the machine being browsed.
    scope: 'machine',
    widget: 'list',
    visibility: 'internal',
    category: 'Files',
  }),
  'files.picker.hiddenLocations': defineSetting({
    schema: v.array(v.string()),
    default: [],
    scope: 'machine',
    widget: 'list',
    visibility: 'internal',
    category: 'Files',
  }),
  'files.picker.view': defineSetting({
    schema: v.picklist(['auto', 'columns', 'list', 'icons'] as const),
    default: 'auto',
    scope: 'application',
    widget: 'enum',
    category: 'Files',
  }),
  'files.previewKilobytes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(4), v.maxValue(1024)),
    default: 64,
    scope: 'application',
    widget: 'number',
    category: 'Files',
  }),
  'files.showHidden': defineSetting({
    schema: v.boolean(),
    default: false,
    // Visibility is suppression-only, so a workspace may choose it. The
    // settings UI already marks workspace overrides for window-scoped values.
    scope: 'window',
    widget: 'boolean',
    category: 'Files',
  }),
  'files.readSessionLimit': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
    default: 8,
    scope: 'machine',
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  }),
  'files.readRangeSizeKiB': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(64), v.maxValue(8192)),
    default: 1024,
    scope: 'machine',
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  }),
  'files.readSessionIdleMinutes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60)),
    default: 5,
    scope: 'machine',
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  }),
  'files.watchDirectoryLimit': defineSetting({
    // Each watched directory is one inotify watch from the machine's per-user pool, which every
    // other watcher on the box shares; a workspace file must never raise it.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2_000_000)),
    default: 200_000,
    scope: 'machine',
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  }),
  'files.searchIndexLimit': defineSetting({
    // Each index holds every entry of its folder in server memory (about 870 B per entry).
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
    default: 4,
    scope: 'machine',
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  }),
  'files.searchIndexIdleMinutes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1440)),
    default: 15,
    scope: 'machine',
    widget: 'number',
    category: 'Files',
    visibility: 'advanced',
  }),
  'lsp.experimental.tyForPython': defineSetting({
    schema: v.boolean(),
    default: false,
    // Machine scope, and not negotiable: this picks which Python binary spawns —
    // `spawnTy` or pyright's `pyright-langserver`. A cloned repository choosing
    // the language server that runs against its own source is exactly what the
    // execution rule forbids.
    scope: 'machine',
    widget: 'boolean',
    category: 'Language servers',
    visibility: 'advanced',
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
    widget: 'number',
    category: 'Language servers',
    visibility: 'advanced',
  }),
  'lsp.downloadRuntimes': defineSetting({
    schema: v.boolean(),
    default: true,
    // Machine scope: this decides whether a binary is fetched onto this machine
    // and then executed.
    scope: 'machine',
    widget: 'boolean',
    category: 'Language servers',
    visibility: 'advanced',
  }),
  'lsp.servers': defineSetting({
    schema: lspServerOverridesSchema,
    default: {},
    // The strongest case for machine scope in the whole table: `command` becomes
    // argv and `env` is spread over the child's environment, so a workspace file
    // that could set this would be arbitrary code execution on clone.
    scope: 'machine',
    // No widget can edit a record of objects, so this is reachable through the
    // raw JSON view only — which is what `internal` means. Registering it
    // anyway is the point: it replaces an env var nobody could discover.
    widget: 'complex',
    visibility: 'internal',
    category: 'Language servers',
  }),
  'lsp.languageServers': defineSetting({
    schema: lspLanguageServerListsSchema,
    default: {},
    // Named entries may start matching tools, so cloned workspaces cannot set this.
    scope: 'machine',
    // A record of lists has no widget, so the JSON view is its only editor.
    widget: 'complex',
    visibility: 'internal',
    category: 'Language servers',
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
    widget: 'boolean',
    category: 'Language servers',
    visibility: 'advanced',
  }),
  'lsp.semanticTokens.delta': defineSetting({
    schema: v.boolean(),
    default: true,
    // Machine scope: it governs how much a child process on this box is asked to
    // serialize, and how much garbage this box's proxy makes per keystroke.
    scope: 'machine',
    widget: 'boolean',
    category: 'Language servers',
    dependsOn: 'lsp.semanticTokens.enabled',
    visibility: 'advanced',
  }),
  'lsp.semanticTokens.servers': defineSetting({
    schema: semanticTokenServerOverridesSchema,
    default: {},
    scope: 'machine',
    // A record of booleans has no editable widget — `record` is typed for
    // `string | null` values — so this is the JSON view only, exactly like
    // `lsp.servers`.
    widget: 'complex',
    visibility: 'internal',
    category: 'Language servers',
  }),
  'providers.acpOperationTimeoutMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_800_000)),
    default: 30_000,
    scope: 'machine',
    widget: 'number',
    category: 'Providers',
  }),
  'providers.usageRefreshSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(86400)),
    default: 300,
    scope: 'machine',
    widget: 'number',
    category: 'Providers',
  }),
  'providers.usageFailureCooldownSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(86400)),
    default: 600,
    scope: 'machine',
    widget: 'number',
    category: 'Providers',
  }),
  'providers.usageStaleAfterSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(86400)),
    default: 900,
    scope: 'machine',
    widget: 'number',
    category: 'Providers',
  }),
  'providers.transcriptHistoryRefreshSeconds': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(86400)),
    default: 60,
    scope: 'machine',
    widget: 'number',
    category: 'Providers',
  }),
  'providers.transcriptHistoryMaxBytes': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(65536), v.maxValue(2147483647)),
    default: 268435456,
    scope: 'machine',
    widget: 'number',
    category: 'Providers',
  }),
  'providers.transcriptHistoryMaxFiles': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000000)),
    default: 10000,
    scope: 'machine',
    widget: 'number',
    category: 'Providers',
  }),
  'providers.proxyUsageRequestIntervalHours': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(24)),
    default: 1,
    scope: 'machine',
    widget: 'number',
    category: 'Providers',
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
    widget: 'string',
    category: 'Providers',
  }),
  'providers.proxyUsageProviderInstanceIds': defineSetting({
    schema: v.array(providerInstanceIdSchema),
    default: [],
    scope: 'application',
    widget: 'complex',
    category: 'Providers',
  }),
  'providers.instances': defineSetting({
    schema: providerInstanceConfigsSchema,
    default: [],
    // Carries `binaryPath` and `environment`, both of which reach process spawn.
    // A cloned repo must never be able to point a provider at another binary.
    scope: 'application',
    widget: 'providers',
    category: 'Providers',
  }),
  'models.hidden': defineSetting({
    schema: modelRefListSchema,
    default: [],
    // Steers which credentialed account a turn bills to, so it stays out of a
    // workspace file for the same reason `providers.instances` does.
    scope: 'application',
    widget: 'models',
    category: 'Models',
  }),
  'models.order': defineSetting({
    schema: modelRefListSchema,
    default: [],
    scope: 'application',
    widget: 'models',
    category: 'Models',
    // Hiding and ranking are one decision taken per model, so they are one row.
    // Two rows rendered the whole catalogue twice and left the user matching a
    // switch in the first list to a pair of arrows in the second.
    rowOwner: 'models.hidden',
  }),
  'models.favorites': defineSetting({
    schema: modelRefListSchema,
    default: [],
    scope: 'application',
    widget: 'models',
    category: 'Models',
    // Starred on the same row that hides and orders a model.
    rowOwner: 'models.hidden',
  }),
  'keybindings.preset': defineSetting({
    schema: v.picklist(['default', 'vscode'] as const),
    default: 'default',
    scope: 'application',
    widget: 'enum',
    category: 'Keyboard shortcuts',
  }),
  'keybindings.overrides': defineSetting({
    schema: keybindingOverridesSchema,
    default: {},
    // A binding can invoke any app command, which puts this on the execution
    // side of the scope rule despite looking like pure preference.
    scope: 'application',
    widget: 'keybindings',
    category: 'Keyboard shortcuts',
    // The one key that merges rather than replaces: a later layer should be able
    // to bind a command without dropping every other binding the user set.
    merge: 'record',
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

/** The ids that have a row of their own, in registry order. */
export const SETTING_ROW_IDS = SETTING_IDS.filter((id) => descriptorFor(id).rowOwner === undefined)

/**
 * Every key one row writes: the row's own, then the keys that named it `rowOwner`.
 *
 * The row is the unit the page resets and marks as modified, so both have to ask
 * this rather than the id — a "Reset setting" that cleared the switches and left
 * the ordering behind would be a reset only in name.
 */
export function settingRowIds(id: SettingId): readonly SettingId[] {
  return [id, ...SETTING_IDS.filter((other) => descriptorFor(other).rowOwner === id)]
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
