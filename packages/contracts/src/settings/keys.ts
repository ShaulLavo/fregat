import { LOG_TIME_RANGES } from '../log-dashboard'
import { modelSelectionSchema } from '../orchestration-runtime'
import { DEFAULT_CODEX_PROVIDER_SETTINGS } from '../provider'
import { themeBundleSchema, themeCustomizationsSchema } from '../themes/bundle'
import { wallpaperSelectionSchema } from '../themes/wallpaper'
import * as v from 'valibot'
import { machinesSchema } from '../machines'
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
} from './boot-defaults'
import { defineSetting, type SettingDescriptor } from './registry'
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
    widget: 'enum',
    category: 'Chat',
    title: 'Follow-up behavior',
    description:
      'Queue messages during a running turn or send them immediately as corrections. Ctrl/Cmd+Enter uses the other behavior.',
  }),
  'chat.sendShortcut': defineSetting({
    schema: v.picklist(['enter', 'mod-enter-multiline', 'mod-enter']),
    default: 'enter',
    // Binds a key, so it never comes from a workspace file.
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
    title: 'Send shortcut',
    description:
      'Which key sends a message. enter: Enter sends and Shift+Enter adds a line. mod-enter-multiline: like enter until the message has a second line, then Ctrl/Cmd+Enter sends. mod-enter: Ctrl/Cmd+Enter sends and Enter adds a line. Where Ctrl/Cmd+Enter sends, Shift+Ctrl/Cmd+Enter takes the other follow-up behavior.',
    keywords: ['send', 'enter', 'submit', 'newline', 'shortcut', 'keyboard'],
  }),
  'chat.planModeEnabled': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
    title: 'Plan mode controls',
    description:
      'Show the Plan mode picker and /plan and /default commands for providers that support them. Stored draft preferences are retained while hidden.',
  }),
  'chat.activeFileContext': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
    title: 'Active file in the composer',
    description:
      'Show the file open in the editor as a chip in the composer. While the chip is there, sending mentions that file. Remove the chip to send without it.',
  }),
  'chat.contextWindowMeterEnabled': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
    title: 'Context window meter',
    description:
      'Show conversation context occupancy in the composer and session header. Provider quota information is independent.',
  }),
  'chat.responseStreamingMode': defineSetting({
    schema: v.picklist(['paragraph', 'turn', 'token']),
    default: 'paragraph',
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
    title: 'Response streaming',
    description: 'Publish assistant responses by paragraph, complete turn, or individual token.',
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
    title: 'Project response streaming',
    description: 'Response streaming mode overrides keyed by project UUID on this machine.',
  }),
  'chat.notificationMode': defineSetting({
    schema: v.picklist(['off', 'notifications', 'sound', 'notifications-and-sound']),
    default: 'off',
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
    title: 'Session notifications',
    description:
      'Notify when a session needs attention or completes. Native notifications require browser permission; sound starts after a pointer or keyboard gesture.',
  }),
  'chat.inAppNotificationsEnabled': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
    title: 'In-app session notifications',
    description:
      'Show an Open session action when another session needs attention or completes while this window is focused.',
  }),
  'chat.pushNotifications': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
    title: 'Push session notifications',
    description:
      'Push to every device registered below when a session needs attention or completes. Held back while a window of this server is visible and focused.',
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
    title: 'Title generation model',
    description:
      'Provider and model used to generate session titles, independently of the conversation model.',
  }),
  'chat.projectTextGenerationModels': defineSetting({
    schema: v.record(v.string(), modelSelectionSchema),
    default: {},
    scope: 'application',
    widget: 'complex',
    visibility: 'internal',
    merge: 'record',
    category: 'Chat',
    title: 'Project title generation models',
    description: 'Title generation model overrides keyed by project UUID on this machine.',
  }),
  'chat.sessionSortOrder': defineSetting({
    schema: v.picklist(['updated_at', 'created_at']),
    default: 'updated_at',
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
    title: 'Session navigation order',
    description:
      'Order palette sessions and choose the surviving project session after deletion by latest user activity or creation time. Shelf ordering remains independent.',
  }),
  'chat.confirmSessionDelete': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
    title: 'Confirm session deletion',
    description: 'Ask before permanently deleting one or more conversations.',
  }),
  'chat.projectGrouping': defineSetting({
    schema: v.picklist(['repository', 'repository_path', 'separate']),
    default: 'repository',
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
    title: 'Project grouping',
    description:
      'Group projects by repository, repository-relative path, or owning machine. Git projects currently register at the repository root, so both repository modes are equivalent.',
  }),
  'chat.autoSettleAfterDays': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365)),
    default: 3,
    scope: 'application',
    widget: 'number',
    category: 'Chat',
    title: 'Settle inactive sessions after days',
    description:
      'Move a session to Settled once it has had no activity for this many days, including existing sessions. 0 turns it off.',
    keywords: ['settle', 'inactive', 'days', 'automatic'],
  }),
  'chat.autoSettleOnMerge': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Chat',
    title: 'Settle sessions when their pull request merges',
    description:
      "Move a session to Settled when its worktree's pull request is merged. A closed pull request settles it whenever automatic settlement is on.",
    keywords: ['settle', 'merge', 'pull request', 'automatic'],
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
    title: 'Project automatic settlement',
    description: 'Automatic settlement overrides keyed by project UUID on this machine.',
  }),
  'chat.projectGroupingOverrides': defineSetting({
    schema: v.record(v.string(), v.picklist(['repository', 'repository_path', 'separate'])),
    default: {},
    scope: 'application',
    widget: 'complex',
    visibility: 'internal',
    merge: 'record',
    category: 'Chat',
    title: 'Project grouping overrides',
    description: 'Grouping mode per scoped project key (environment UUID:project UUID).',
  }),
  'environments.machines': defineSetting({
    schema: machinesSchema,
    default: {},
    scope: 'machine',
    widget: 'machines',
    merge: 'record',
    category: 'Machines',
    title: 'Connected machines',
    description:
      'SSH targets and direct origins available to this client. The local machine is always available.',
    keywords: ['remote', 'ssh', 'environment', 'server', 'connect'],
  }),
  'git.autoPull': defineSetting({
    schema: v.boolean(),
    default: false,
    // Machine scope: it writes to checkouts and reaches the network.
    scope: 'machine',
    widget: 'boolean',
    category: 'Git',
    title: 'Keep the default branch current',
    description:
      'Fast-forward a project checkout on its default branch when its upstream moves. A checkout with changes, local commits or another branch checked out is left alone.',
    keywords: ['pull', 'fast-forward', 'fetch', 'default branch', 'main'],
  }),
  'git.projectAutoPull': defineSetting({
    schema: v.record(v.string(), v.boolean()),
    default: {},
    merge: 'record',
    scope: 'machine',
    widget: 'complex',
    visibility: 'internal',
    category: 'Git',
    title: 'Project default-branch pull',
    description: 'Automatic default-branch pull keyed by project UUID on this machine.',
  }),
  'git.worktreeSubmodules': defineSetting({
    schema: v.picklist(WORKTREE_SUBMODULE_MODES),
    default: 'recursive',
    // Machine scope: the value picks git flags and can reach the network.
    scope: 'machine',
    widget: 'enum',
    category: 'Git',
    title: 'Submodules in new worktrees',
    description:
      'Initialize every nested submodule, only the ones this repository declares, or none when a session creates a worktree.',
    keywords: ['submodule', 'worktree', 'recursive'],
  }),
  'git.projectWorktreeSubmodules': defineSetting({
    schema: v.record(v.string(), v.picklist(WORKTREE_SUBMODULE_MODES)),
    default: {},
    merge: 'record',
    scope: 'machine',
    widget: 'complex',
    visibility: 'internal',
    category: 'Git',
    title: 'Project submodules in new worktrees',
    description: 'Submodule modes for new worktrees keyed by project UUID on this machine.',
  }),
  'git.worktreeCleanupOnDelete': defineSetting({
    schema: v.boolean(),
    default: false,
    // Machine scope: it deletes checkouts on this machine.
    scope: 'machine',
    widget: 'boolean',
    category: 'Git',
    title: 'Remove worktrees after their last session is deleted',
    description:
      'Remove a session worktree once every session using it is deleted and has stopped, including earlier deletions. A worktree with uncommitted changes, ignored files other than node_modules, or another branch checked out stays.',
    keywords: ['worktree', 'cleanup', 'delete', 'remove', 'storage'],
  }),
  'git.projectWorktreeCleanupOnDelete': defineSetting({
    schema: v.record(v.string(), v.boolean()),
    default: {},
    merge: 'record',
    scope: 'machine',
    widget: 'complex',
    visibility: 'internal',
    category: 'Git',
    title: 'Project worktree removal after deletion',
    description:
      'Worktree removal after the last session is deleted, keyed by project UUID on this machine.',
  }),
  'workbench.colorTheme': defineSetting({
    schema: v.picklist(COLOR_THEME_MODES),
    default: DEFAULT_COLOR_THEME,
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
    title: 'Light / dark mode',
    description: 'Light or dark, or follow the operating system.',
    keywords: ['theme', 'dark', 'light', 'appearance', 'colour'],
  }),
  'workbench.theme': defineSetting({
    schema: v.nullable(themeBundleSchema),
    default: null,
    scope: 'application',
    widget: 'theme',
    category: 'Appearance',
    title: 'Theme bundles',
    description:
      'A light and dark version of your app colors, code colors, wallpaper and material.',
    keywords: ['theme', 'bundle', 'light', 'dark', 'wallpaper'],
  }),
  'workbench.theme.customizations': defineSetting({
    schema: themeCustomizationsSchema,
    default: {},
    scope: 'application',
    widget: 'complex',
    category: 'Appearance',
    visibility: 'internal',
    description: 'Part overrides saved separately for each theme bundle and mode.',
  }),
  'tui.theme.colors': defineSetting({
    schema: v.picklist(['theme', 'terminal']),
    default: 'theme',
    scope: 'application',
    widget: 'enum',
    category: 'Appearance',
    title: 'Terminal app colors',
    description: 'Use the selected theme bundle or the terminal host colors in the TUI.',
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
    title: 'App colors',
    description:
      'Colors for app backgrounds, text, borders, accents and the terminal. Pick a palette or make your own.',
    keywords: [
      'palette',
      'colour',
      'sage',
      'graphite',
      'teal',
      'monochrome',
      'accent',
      'appearance',
      'terminal',
    ],
  }),
  'editor.codeTheme.dark': defineSetting({
    schema: v.pipe(v.string(), v.minLength(1)),
    default: 'dark-plus',
    scope: 'window',
    widget: 'code-theme',
    category: 'Appearance',
    title: 'Code theme in dark mode',
    description: 'Colors for code in editors and chat code blocks when the app uses dark mode.',
    keywords: ['syntax', 'highlighting', 'theme', 'native', 'vscode', 'colour'],
  }),
  'editor.codeTheme.light': defineSetting({
    schema: v.pipe(v.string(), v.minLength(1)),
    default: 'light-plus',
    scope: 'window',
    widget: 'code-theme',
    category: 'Appearance',
    title: 'Code theme in light mode',
    description: 'Colors for code in editors and chat code blocks when the app uses light mode.',
    keywords: ['syntax', 'highlighting', 'theme', 'native', 'vscode', 'colour'],
  }),
  'workbench.reduceMotion': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
    widget: 'boolean',
    category: 'Appearance',
    title: 'Reduce terminal motion',
    description: 'Slow terminal loading indicators while keeping progress visible.',
    keywords: ['tui', 'terminal', 'animation', 'accessibility', 'motion'],
  }),
  'workbench.fontFamily': defineSetting({
    schema: fontRefSchema,
    default: DEFAULT_UI_FONT,
    scope: 'window',
    widget: 'font',
    category: 'Appearance',
    title: 'Interface font',
    description: 'Font for the words the app writes: titles, labels, menus and prose.',
    keywords: ['font', 'typeface', 'interface', 'ui', 'sans', 'appearance'],
  }),
  'workbench.density': defineSetting({
    schema: v.picklist(WORKBENCH_DENSITIES),
    default: DEFAULT_WORKBENCH_DENSITY,
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
    title: 'Interface density',
    description: 'Use tighter compact spacing or roomier cozy spacing throughout the app.',
    keywords: ['density', 'compact', 'cozy', 'spacing', 'padding', 'appearance'],
  }),
  'workbench.surface.opacity': defineSetting({
    schema: percentSchema,
    default: 80,
    scope: 'window',
    widget: 'number',
    category: 'Appearance',
    description:
      'How opaque panels and sidebars are over the wallpaper. 100 turns the glass material off.',
    keywords: ['transparency', 'opacity', 'glass', 'material', 'blur'],
  }),
  'workbench.surface.contentOpacity': defineSetting({
    schema: percentSchema,
    default: 50,
    scope: 'window',
    widget: 'number',
    category: 'Appearance',
    // Drives --content-opacity: the well is a second layer over a panel that
    // already painted one, so 50 over 80 composites to 90.
    description:
      'How opaque the extra layer under the editor, terminal and settings is. It sits on top of the panel, so 0 leaves them as see-through as a sidebar.',
    keywords: ['transparency', 'opacity', 'editor', 'terminal', 'content'],
  }),
  'workbench.surface.blur': defineSetting({
    // Clamped rather than open: at `window` scope a cloned repository can set
    // this, and an unbounded backdrop-filter blur is a real GPU cost.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(40)),
    default: 9,
    scope: 'window',
    widget: 'number',
    category: 'Appearance',
    description: 'Backdrop blur radius, in pixels, behind translucent surfaces.',
    keywords: ['blur', 'glass', 'material', 'vibrancy'],
  }),
  'workbench.surface.saturation': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(400)),
    default: 160,
    scope: 'window',
    widget: 'number',
    category: 'Appearance',
    description: 'Backdrop saturation, as a percentage, behind translucent surfaces.',
    visibility: 'advanced',
    keywords: ['saturation', 'glass', 'material', 'vibrancy'],
  }),
  'workbench.surface.continuousSeams': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
    widget: 'boolean',
    category: 'Appearance',
    title: 'Continuous panel background',
    // Which element paints the surface. Off, each panel paints its own and the
    // resize handles between them show the wallpaper. On, the region around them
    // paints once, so the handles carry the same surface and the panels merge.
    description:
      'Carry one background across panels and their resize handles, instead of showing the wallpaper in the gap between them.',
    keywords: ['seam', 'handle', 'divider', 'wallpaper', 'surface', 'glass'],
  }),
  'workbench.wallpaper': defineSetting({
    schema: wallpaperSelectionSchema,
    default: DEFAULT_WALLPAPER_SELECTION,
    scope: 'application',
    widget: 'wallpaper',
    category: 'Appearance',
    description: 'Choose a wallpaper and turn it on or off without losing the selection.',
    keywords: ['wallpaper', 'background', 'desktop'],
  }),
  'workbench.tree.indentGuides': defineSetting({
    schema: v.picklist(['none', 'onHover', 'always'] as const),
    default: 'always',
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
    title: 'File tree indent guides',
    description:
      'When to show indentation guides in the file tree. Guides take editor colours while the tree is hovered.',
    keywords: ['tree', 'files', 'folders', 'indent', 'guides', 'colour'],
  }),
  'editor.fontFamily': defineSetting({
    schema: fontRefSchema,
    default: DEFAULT_CODE_FONT,
    scope: 'window',
    widget: 'font',
    category: 'Editor',
    title: 'Code font',
    description: 'Font for the editor, the terminal, and code and metadata across the app.',
    keywords: ['font', 'typeface', 'monospace', 'nerd font', 'editor', 'terminal', 'code'],
  }),
  'editor.fontSize': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(72)),
    default: 13,
    scope: 'window',
    widget: 'number',
    category: 'Editor',
    description: 'Editor font size in pixels.',
    keywords: ['font', 'size', 'zoom', 'editor'],
  }),
  'editor.lineHeight': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(8), v.maxValue(120)),
    default: 24,
    scope: 'window',
    widget: 'number',
    category: 'Editor',
    description: 'Editor row height in pixels.',
    keywords: ['line', 'height', 'spacing', 'density'],
  }),
  'editor.tabSize': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(16)),
    default: 4,
    scope: 'window',
    widget: 'number',
    category: 'Editor',
    description:
      'Width of a tab character, in spaces. Also the indentation width for a file whose own cannot be detected.',
    keywords: ['tab', 'indent', 'width', 'spaces'],
  }),
  'editor.history.retainedStates': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(5000)),
    default: 200,
    scope: 'application',
    widget: 'number',
    category: 'Editor',
    description:
      'Earlier states kept per open file, across every undo branch. The least recently visited go first when the budget is exceeded.',
    keywords: ['undo', 'history', 'branches', 'retained', 'memory'],
  }),
  'editor.history.persist': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'application',
    widget: 'boolean',
    category: 'Editor',
    description:
      'Keep undo history for closed files in this browser, so reopening a file or reloading the window brings it back. A file that changed on disk in the meantime starts fresh.',
    keywords: ['undo', 'history', 'restore', 'reopen', 'reload', 'persist'],
  }),
  'editor.history.persistDays': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365)),
    default: 30,
    scope: 'application',
    widget: 'number',
    category: 'Editor',
    description: 'Days a closed file keeps its stored undo history before it is dropped.',
    keywords: ['undo', 'history', 'ttl', 'expire', 'persist'],
  }),
  'editor.history.persistBudget': defineSetting({
    // Clamped at 1 GiB, like the retained text budget: browser storage is shared.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_073_741_824)),
    default: 67_108_864,
    scope: 'application',
    widget: 'number',
    category: 'Editor',
    description:
      'Total stored undo history across closed files, in UTF-16 code units. The least recently saved files go first when it is exceeded.',
    visibility: 'advanced',
    keywords: ['undo', 'history', 'storage', 'budget', 'persist'],
  }),
  'editor.markdownView': defineSetting({
    schema: v.picklist(['source', 'split', 'preview'] as const),
    default: 'preview',
    scope: 'window',
    widget: 'enum',
    category: 'Editor',
    title: 'Markdown view',
    description:
      'How markdown files open: source text, source beside a rendered view, or rendered in place while you edit. Cycle markdown view changes one file.',
    keywords: ['markdown', 'preview', 'split', 'render'],
  }),
  'editor.diff.viewMode': defineSetting({
    schema: v.picklist(['split', 'stacked'] as const),
    default: 'stacked',
    scope: 'window',
    widget: 'enum',
    category: 'Editor',
    description: 'Show diffs side by side or stacked.',
    keywords: ['diff', 'split', 'stacked', 'compare', 'git'],
  }),
  'editor.inputRoute': defineSetting({
    schema: v.picklist(['textarea', 'edit-context'] as const),
    default: 'edit-context',
    scope: 'application',
    widget: 'enum',
    category: 'Editor',
    // EditContext exists only in Chromium; other engines keep the textarea whatever this says.
    description:
      'How typed text reaches the editor. EditContext (Chromium) receives IME, autocorrect and dictation edits with their exact ranges instead of reading them back out of a hidden textarea; other browsers always use the textarea.',
    // Editors are reused across tabs and take the route only when they are built.
    requiresRestart: true,
    visibility: 'advanced',
    keywords: ['input', 'ime', 'editcontext', 'composition', 'autocorrect', 'textarea'],
  }),
  'terminal.integrated.fontSize': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(72)),
    default: 12,
    scope: 'window',
    widget: 'number',
    category: 'Terminal',
    description: 'Terminal font size in pixels.',
    keywords: ['terminal', 'font', 'size'],
  }),
  'terminal.integrated.scrollback': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(500_000)),
    default: 10_000,
    scope: 'window',
    widget: 'number',
    category: 'Terminal',
    description: 'How many lines of output the terminal keeps.',
    keywords: ['terminal', 'scrollback', 'history', 'buffer'],
  }),
  'terminal.integrated.cursorBlinking': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Terminal',
    description: 'Blink the terminal cursor while the terminal has focus.',
    keywords: ['terminal', 'cursor', 'blink'],
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
    description:
      'Total text the editor keeps resident across the active and parked projects, in UTF-16 code units, re-checked at a project switch and a tab close. The active project is charged first and is never trimmed, so a large one leaves less room for parked projects.',
    visibility: 'advanced',
    keywords: ['memory', 'retention', 'projects', 'budget', 'documents'],
  }),
  'editor.unicodeHighlight.ambiguousCharacters': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
    description:
      'Highlight Unicode characters that resemble other characters. Hover a highlight for an explanation.',
    keywords: ['unicode', 'ambiguous', 'confusable', 'characters'],
  }),
  'editor.unicodeHighlight.invisibleCharacters': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
    description: 'Highlight invisible Unicode characters. Hover a highlight for its code point.',
    keywords: ['unicode', 'invisible', 'characters'],
  }),
  'editor.unicodeHighlight.allowedCharacters': defineSetting({
    schema: v.string(),
    default: '',
    scope: 'window',
    widget: 'string',
    category: 'Editor',
    description:
      'Characters allowed without Unicode highlighting. Paste the characters here, for example an en dash.',
    keywords: ['unicode', 'allowed', 'exclude', 'characters'],
  }),
  'editor.minimap.enabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
    description: 'Show the minimap beside the editor.',
    // The non-critical plugin list is built once per page load, behind a lazy
    // module-level promise. Claiming this applies live would be a lie the user
    // discovers by toggling it and seeing nothing happen.
    requiresRestart: true,
    keywords: ['minimap', 'overview', 'performance'],
  }),
  'editor.guides.indentation': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
    description: 'Draw indentation guides (scope lines).',
    requiresRestart: true,
    keywords: ['indent', 'guides', 'scope lines', 'performance'],
  }),
  'editor.syntaxHighlighting.enabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Editor',
    description: 'Colour code by syntax. Turning this off makes very large files faster.',
    requiresRestart: true,
    keywords: ['syntax', 'highlighting', 'colour', 'performance'],
  }),
  'editor.decode.mode': defineSetting({
    schema: v.picklist(['off', 'diffusion', 'autoregressive', 'parallel', 'token'] as const),
    default: 'off',
    scope: 'window',
    widget: 'enum',
    category: 'Editor',
    description: 'Animate a file as it opens, as if it were being written.',
    requiresRestart: true,
    visibility: 'advanced',
    keywords: ['decode', 'animation', 'diffusion', 'typewriter'],
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
    description: 'How a new search interprets the query.',
    keywords: ['search', 'regex', 'literal', 'fuzzy', 'match'],
  }),
  'search.caseSensitive': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
    widget: 'boolean',
    category: 'Search',
    description: 'Match case by default.',
    keywords: ['search', 'case', 'sensitive'],
  }),
  'search.wholeWord': defineSetting({
    schema: v.boolean(),
    default: false,
    scope: 'window',
    widget: 'boolean',
    category: 'Search',
    description: 'Match whole words by default.',
    keywords: ['search', 'word', 'boundary'],
  }),
  'search.maxResults': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(WORKSPACE_SEARCH_LIMIT_MAX)),
    default: WORKSPACE_SEARCH_LIMIT_MAX,
    scope: 'window',
    widget: 'number',
    category: 'Search',
    // The route rejects rather than clamps, so the schema shares its cap or a legal-looking
    // setting produces a failed request.
    description: 'How many matches a workspace search returns.',
    keywords: ['search', 'results', 'limit'],
  }),
  'search.maxResultFiles': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(WORKSPACE_SEARCH_LIMIT_MAX)),
    default: WORKSPACE_SEARCH_LIMIT_MAX,
    scope: 'window',
    widget: 'number',
    category: 'Search',
    // Separate from `search.maxResults`: one pathological file can hold every
    // match in the budget, so bounding matches alone still yields a one-file
    // result set. The route caps it at the same limit.
    description: 'How many files a workspace search returns matches from.',
    visibility: 'advanced',
    keywords: ['search', 'results', 'files', 'limit'],
  }),
  'search.quickOpenLimit': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
    default: 80,
    scope: 'window',
    widget: 'number',
    category: 'Search',
    // A different surface from `search.maxResults`, despite the similar name:
    // this is the file picker, that is the workspace search pane.
    description: 'How many files the file picker lists.',
    visibility: 'advanced',
    keywords: ['search', 'quick open', 'picker', 'files', 'limit'],
  }),
  'chat.keepImportedSessionsUpdated': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'machine',
    widget: 'boolean',
    category: 'Chat',
    title: 'Keep imported chats updated',
    description:
      'Imported chats receive one-way updates from local history until you send their first message in Platform. New chats are only imported when you click Import.',
    keywords: ['chat', 'import', 'sync', 'history', 'claude', 'codex', 'cli', 'app', 'local'],
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
    description: 'Permission posture a new session starts in.',
    keywords: ['chat', 'permission', 'approval', 'runtime', 'safety'],
  }),
  'chat.defaultInteractionMode': defineSetting({
    schema: v.picklist(['default', 'plan'] as const),
    default: 'default',
    // Same permission axis: plan mode decides whether the agent writes and execs
    // before the user approves.
    scope: 'application',
    widget: 'enum',
    category: 'Chat',
    description: 'Whether a new session starts in plan mode.',
    keywords: ['chat', 'plan', 'mode', 'interaction'],
  }),
  'logs.defaultTimeRange': defineSetting({
    schema: v.picklist(LOG_TIME_RANGES),
    default: '1h',
    scope: 'window',
    widget: 'enum',
    category: 'Logs',
    description: 'Time range the logs view opens on.',
    visibility: 'advanced',
    keywords: ['logs', 'time', 'range', 'filter'],
  }),
  'logs.slowThresholdMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(60_000)),
    default: 500,
    scope: 'window',
    widget: 'number',
    category: 'Logs',
    description: 'How many milliseconds counts as a slow operation.',
    visibility: 'advanced',
    keywords: ['logs', 'slow', 'threshold', 'performance'],
  }),
  'developer.simulatedLatencyMs': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000)),
    default: 0,
    // A delay is not a binary, a flag or a key, but it reaches every request,
    // so it stays out of the workspace file all the same.
    scope: 'application',
    widget: 'number',
    category: 'Developer',
    title: 'Simulated network latency',
    description:
      'Milliseconds added before every request to the server, to see how the app behaves on a slow link. Zero disables it.',
    visibility: 'advanced',
    keywords: ['developer', 'latency', 'delay', 'slow', 'network', 'optimistic', 'pending'],
  }),
  'window.transparency': defineSetting({
    // Who supplies the see-through, not how much of it there is.
    //
    // `compositor` leaves the shell window opaque and lets the window manager
    // blend it over the desktop — what Linux compositors already do to every
    // window, at no cost to us. `window` makes the window itself transparent,
    // which is what a macOS NSVisualEffectView needs and what puts the desktop
    // directly behind each translucent pane; it also forces CEF into off-screen
    // rendering, measured at a 5.5MB CPU copy per paint.
    schema: v.picklist(['compositor', 'window'] as const),
    default: 'compositor',
    // Machine scope: window chrome is a property of this machine's desktop shell,
    // and a cloned repository must not be able to re-chrome the window.
    scope: 'machine',
    widget: 'enum',
    category: 'Window',
    description:
      'Where the see-through comes from: the window manager blending an opaque window, or a per-pixel transparent window (which costs a full-surface CPU copy per frame).',
    // The window is created once, from this value, before the page exists.
    requiresRestart: true,
    keywords: ['window', 'transparency', 'vibrancy', 'compositor', 'desktop', 'wallpaper', 'blur'],
  }),
  'files.autoSave': defineSetting({
    schema: v.picklist(['off', 'afterDelay', 'onFocusChange', 'onWindowChange'] as const),
    default: 'off',
    scope: 'window',
    widget: 'enum',
    category: 'Files',
    description: 'Save edited files automatically, and when.',
    keywords: ['autosave', 'save', 'files', 'automatic'],
  }),
  'files.autoSaveDelay': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(60_000)),
    default: 1_000,
    scope: 'window',
    widget: 'number',
    category: 'Files',
    description: 'Milliseconds of quiet before an automatic save, when saving after a delay.',
    keywords: ['autosave', 'delay', 'debounce', 'files'],
  }),
  'files.showHidden': defineSetting({
    schema: v.boolean(),
    default: false,
    // Visibility is suppression-only, so a workspace may choose it. The
    // settings UI already marks workspace overrides for window-scoped values.
    scope: 'window',
    widget: 'boolean',
    category: 'Files',
    title: 'Show hidden files in pickers',
    description: 'Show dot-prefixed files and folders in file pickers.',
    keywords: ['files', 'folders', 'hidden', 'dotfiles', 'picker'],
  }),
  'files.watchDirectoryLimit': defineSetting({
    // Each watched directory is one inotify watch from the machine's per-user pool, which every
    // other watcher on the box shares; a workspace file must never raise it.
    schema: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2_000_000)),
    default: 200_000,
    scope: 'machine',
    widget: 'number',
    category: 'Files',
    title: 'Folder watch limit',
    description:
      'How many folders all open workspaces may watch for live changes together. A workspace that would pass it updates its top level and open files only.',
    visibility: 'advanced',
    keywords: ['files', 'watch', 'watcher', 'inotify', 'limit', 'large', 'folders', 'live'],
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
    // Honest about the pooling: matching is re-run per file, but a language
    // server already running for a folder is reused by key, so an open Python
    // file keeps whichever server it started with.
    description:
      'Use ty instead of pyright for Python. Files already open keep their current server until reopened.',
    visibility: 'advanced',
    keywords: ['lsp', 'python', 'ty', 'pyright', 'experimental'],
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
    description:
      'Milliseconds an unused language server stays alive after the last editor disconnects. 0 shuts it down immediately.',
    visibility: 'advanced',
    keywords: ['lsp', 'idle', 'timeout', 'memory', 'process'],
  }),
  'lsp.downloadRuntimes': defineSetting({
    schema: v.boolean(),
    default: true,
    // Machine scope: this decides whether a binary is fetched onto this machine
    // and then executed.
    scope: 'machine',
    widget: 'boolean',
    category: 'Language servers',
    description:
      'Download missing language servers on demand. Off means only servers already on PATH are used.',
    visibility: 'advanced',
    keywords: ['lsp', 'download', 'install', 'offline', 'network'],
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
    description:
      'Per-server overrides: extensions and feature ranks apply when a document is matched; command, env, and initialization apply on the next backend start. Set a feature to null to exclude that server. A running backend keeps its old process options until it idles out.',
    keywords: ['lsp', 'language server', 'command', 'override', 'disable'],
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
    description:
      "Which language servers may serve a file type, keyed by extension ('.json'). Values are server ids in preference order, '!id' drops a server, and '...' keeps the rest. Naming a registered server explicitly enables it for matching file types even without its project marker. Open documents keep their current servers until reopened.",
    // Per-extension rather than replace: a workspace should be able to answer
    // for `.json` without erasing the answer someone gave for `.ts`.
    merge: 'record',
    keywords: ['lsp', 'language server', 'disable', 'json', 'biome', 'eslint'],
  }),
  'lsp.semanticTokens.enabled': defineSetting({
    schema: v.boolean(),
    // Off by default. The colour it adds is a refinement over the syntactic layer rather than a
    // replacement, and a warm server routinely answers before the highlighter does, so a document
    // can show identifier colour on otherwise-unpainted text for up to a second and a half.
    default: false,
    // Machine scope for the same reason as `lsp.idleTimeoutMs`: it governs how
    // much work a child process on this box does. It gates *requests* only —
    // the declared capability block stays a pure function of the server id, so
    // that a pooled backend's advertised legend cannot depend on which tab
    // connected first.
    scope: 'machine',
    widget: 'boolean',
    category: 'Language servers',
    description:
      'Ask language servers to colour identifiers they have actually resolved. Off means no token request is ever sent. Each server still has its own default under lsp.semanticTokens.servers.',
    visibility: 'advanced',
    keywords: ['lsp', 'semantic', 'tokens', 'highlighting', 'colour', 'color'],
  }),
  'lsp.semanticTokens.delta': defineSetting({
    schema: v.boolean(),
    // rust-analyzer on hashbrown's 197 KB map.rs, twelve keystrokes: whole files cost 1.60 MB,
    // 14.1 ms of JSON.parse and 9.0 MB of heap; deltas cost 1.9 KB, 0.1 ms and 2.0 MB. Same latency.
    default: true,
    // Machine scope: it governs how much a child process on this box is asked to
    // serialize, and how much garbage this box's proxy makes per keystroke.
    scope: 'machine',
    widget: 'boolean',
    category: 'Language servers',
    description:
      'Ask delta-capable language servers for only the tokens an edit changed. Saves bandwidth, parse time and garbage on every keystroke.',
    visibility: 'advanced',
    keywords: ['lsp', 'semantic', 'tokens', 'delta', 'bandwidth', 'memory'],
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
    description:
      'Server id to true or false, overriding the per-server default. Lets one misbehaving server be turned off without turning the feature off.',
    keywords: ['lsp', 'semantic', 'tokens', 'server', 'override'],
  }),
  'providers.instances': defineSetting({
    schema: providerInstanceConfigsSchema,
    default: [],
    // Carries `binaryPath` and `environment`, both of which reach process spawn.
    // A cloned repo must never be able to point a provider at another binary.
    scope: 'application',
    widget: 'providers',
    category: 'Providers',
    description: 'Configured provider instances, in the order the picker shows them.',
    keywords: ['provider', 'agent', 'codex', 'claude', 'model'],
  }),
  'models.hidden': defineSetting({
    schema: modelRefListSchema,
    default: [],
    // Steers which credentialed account a turn bills to, so it stays out of a
    // workspace file for the same reason `providers.instances` does.
    scope: 'application',
    widget: 'models',
    category: 'Models',
    // Stored as a denylist because that is the only shape where a model the
    // provider starts offering next week appears on its own. An allowlist would
    // have to materialise every other model the first time one was turned off,
    // and then go quiet about everything added afterwards.
    title: 'Models',
    description:
      'Which models the picker offers, and in what order. Turn one off to keep it out of the picker.',
    keywords: ['model', 'hide', 'show', 'visible', 'order', 'sort', 'picker'],
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
    description:
      'Explicit leading order for the picker. Models named by neither list stay visible after these, in provider order.',
    keywords: ['model', 'order', 'sort', 'picker'],
  }),
  'models.favorites': defineSetting({
    schema: modelRefListSchema,
    default: [],
    scope: 'application',
    widget: 'models',
    category: 'Models',
    // Starred on the same row that hides and orders a model.
    rowOwner: 'models.hidden',
    description:
      'Models starred as favorites. The picker lists them first and gathers them under Favorites.',
    keywords: ['model', 'favorite', 'star', 'pin', 'picker'],
  }),
  'keybindings.preset': defineSetting({
    schema: v.picklist(['default', 'vscode'] as const),
    default: 'default',
    scope: 'application',
    widget: 'enum',
    category: 'Keyboard shortcuts',
    title: 'Keyboard mode',
    description:
      'Shortcuts your overrides apply on top of. VS Code keeps VS Code bindings. Platform starts from them and adds its own keys for tabs, chats and sidebar panels.',
    keywords: ['keybinding', 'shortcut', 'preset', 'vscode', 'keymap'],
  }),
  'keybindings.overrides': defineSetting({
    schema: keybindingOverridesSchema,
    default: {},
    // A binding can invoke any app command, which puts this on the execution
    // side of the scope rule despite looking like pure preference.
    scope: 'application',
    widget: 'keybindings',
    category: 'Keyboard shortcuts',
    description:
      'Command id to shortcut: one hotkey or two separated by a single space. A missing key keeps the default; an explicit null unbinds the command.',
    // The one key that merges rather than replaces: a later layer should be able
    // to bind a command without dropping every other binding the user set.
    merge: 'record',
    keywords: ['keybinding', 'shortcut', 'hotkey', 'chord', 'keymap'],
  }),
} satisfies Readonly<Record<string, SettingDescriptor>>

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

/**
 * Registry defaults as a resolved document.
 *
 * Frozen and module-level so the resolver can hand out a default value by
 * reference. Consumers diff object-valued settings by identity — see the
 * `useMemo` on the keymap in `app-command-surface.tsx` — so a fresh `{}` on
 * every resolve would re-register the whole binding table on unrelated writes.
 */
export const DEFAULT_SETTING_VALUES: SettingsValues = Object.freeze(
  Object.fromEntries(
    Object.entries(SETTINGS_REGISTRY).map(([id, descriptor]) => [id, descriptor.default]),
  ),
) as SettingsValues

/**
 * Runtime schema for a whole resolved document.
 *
 * Every key is optional with its registered default, so `{}` parses into a
 * complete value and a document written by a build with fewer keys still reads.
 * The cast is unavoidable — `Object.fromEntries` erases the key/value pairing —
 * but it cannot drift, because `SettingsValues` is itself derived from the same
 * table this is built from.
 */
export const settingsValuesSchema = v.object(
  Object.fromEntries(
    Object.entries(SETTINGS_REGISTRY).map(([id, descriptor]) => [
      id,
      v.optional(descriptor.schema, descriptor.default),
    ]),
  ) as Record<string, v.GenericSchema>,
) as unknown as v.GenericSchema<unknown, SettingsValues>
