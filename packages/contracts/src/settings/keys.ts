import * as v from 'valibot'
import { machinesSchema } from '../machines'
import {
  keybindingOverridesSchema,
  lspLanguageServerListsSchema,
  lspServerOverridesSchema,
  modelRefListSchema,
  providerInstanceConfigsSchema,
  semanticTokenServerOverridesSchema,
} from '../settings'
import { defineSetting, type SettingDescriptor } from './registry'

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
  'workbench.colorTheme': defineSetting({
    schema: v.picklist(['dark', 'light', 'system'] as const),
    default: 'system',
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
    title: 'Light / dark mode',
    description: 'Light or dark, or follow the operating system.',
    keywords: ['theme', 'dark', 'light', 'appearance', 'colour'],
  }),
  'workbench.palette': defineSetting({
    // Orthogonal to workbench.colorTheme: the palette picks which set of colors
    // a mode is built from, the theme picks which mode. Every combination is
    // defined, so the two never have to agree.
    schema: v.picklist(['sage', 'graphite'] as const),
    default: 'graphite',
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
    title: 'App colors',
    description: 'Colors for app backgrounds, text, borders, and accents. Choose Graphite or Sage.',
    keywords: [
      'palette',
      'colour',
      'sage',
      'graphite',
      'teal',
      'monochrome',
      'accent',
      'appearance',
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
  'workbench.density': defineSetting({
    schema: v.picklist(['compact', 'cozy'] as const),
    default: 'compact',
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
    default: 95,
    scope: 'window',
    widget: 'number',
    category: 'Appearance',
    // Drives --content-opacity, the opacity of the single content well
    // (--content-well) that panes paint under the editor and terminal.
    description: 'How opaque the editor and terminal background is.',
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
  'workbench.wallpaper.enabled': defineSetting({
    schema: v.boolean(),
    default: true,
    scope: 'window',
    widget: 'boolean',
    category: 'Appearance',
    description: 'Show the desktop wallpaper behind the workbench.',
    keywords: ['wallpaper', 'background', 'desktop'],
  }),
  'workbench.tree.indentGuides': defineSetting({
    schema: v.picklist(['none', 'onHover', 'always'] as const),
    default: 'onHover',
    scope: 'window',
    widget: 'enum',
    category: 'Appearance',
    title: 'File tree indent guides',
    description: 'When to show editor-coloured indentation guides in the file tree.',
    keywords: ['tree', 'files', 'folders', 'indent', 'guides', 'colour'],
  }),
  'editor.fontFamily': defineSetting({
    // A Nerd Font id, not a CSS stack. The server can fetch, subset and cache any
    // of these on demand, so naming one is a font the user actually gets — where
    // a free-text stack naming a font nobody has installed silently does nothing.
    schema: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
    default: 'JetBrainsMono',
    scope: 'window',
    widget: 'font',
    category: 'Editor',
    description: 'Font for the editor and, unless overridden, the terminal.',
    keywords: ['font', 'typeface', 'monospace', 'nerd font', 'editor'],
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
    // Rendered width only. The editor package reads `--editor-tab-size` from CSS,
    // which is what makes this live without a cross-repo setter; what it does
    // *not* change is the indentation the editor inserts, which is captured in
    // the Editor constructor and has no setter.
    description: 'Rendered width of a tab character, in spaces.',
    keywords: ['tab', 'indent', 'width', 'spaces'],
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
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
    default: 200,
    scope: 'window',
    widget: 'number',
    category: 'Search',
    // The route caps this at 200 and rejects rather than clamps, so the schema
    // has to agree or a legal-looking setting produces a failed request.
    description: 'How many matches a workspace search returns.',
    keywords: ['search', 'results', 'limit'],
  }),
  'search.maxResultFiles': defineSetting({
    schema: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
    default: 100,
    scope: 'window',
    widget: 'number',
    category: 'Search',
    // Separate from `search.maxResults`: one pathological file can hold every
    // match in the budget, so bounding matches alone still yields a one-file
    // result set. The route caps this at 200 for the same reason as the match
    // limit.
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
    schema: v.picklist(['15m', '1h', '6h', '24h', 'all'] as const),
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
    // Off until a user has repeated the measurement on their own repository.
    // Measured here on hashbrown 0.15.5 (`src/map.rs`, 197 KB, 11 978 tokens),
    // twelve keystrokes 60 ms apart against rust-analyzer 1.88.0: whole-file
    // answers cost 1.60 MB over the pipe, 14.1 ms of `JSON.parse` and 9.0 MB of
    // heap churn; deltas cost 1.9 KB, 0.1 ms and 2.0 MB. Same latency either way
    // — the server computes the full set and then diffs it — so this buys
    // allocation pressure and main-thread parse time, not speed.
    default: false,
    // Machine scope: it governs how much a child process on this box is asked to
    // serialize, and how much garbage this box's proxy makes per keystroke.
    scope: 'machine',
    widget: 'boolean',
    category: 'Language servers',
    description:
      'Let the proxy re-ask a delta-capable server for token deltas instead of whole files. Saves bandwidth and garbage per keystroke, not latency.',
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
  'keybindings.preset': defineSetting({
    schema: v.picklist(['default', 'vscode'] as const),
    default: 'default',
    scope: 'application',
    widget: 'enum',
    category: 'Keyboard shortcuts',
    title: 'Keyboard preset',
    description:
      'Editor shortcuts to use before applying your overrides. Default uses the native editor pack; vscode uses the VS Code pack.',
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
