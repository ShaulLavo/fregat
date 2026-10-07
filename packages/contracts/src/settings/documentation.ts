import { descriptorFor, type SettingId, type SettingsRegistry } from './keys'
import { presentationFor } from './presentation'
import type { SettingDocumentation, SettingPresentation } from './registry'

export const SETTINGS_DOCUMENTATION = {
  'chat.followUpBehavior': {
    optionTitles: { queue: 'Wait for the agent', steer: 'Send at once' },
    title: 'Follow-up behavior',
    description:
      'What happens to a message you send while the agent is still working: it waits until the turn ends, or reaches the agent at once to correct it. The other send key (Ctrl/Cmd+Enter, or Shift+Ctrl/Cmd+Enter where Ctrl/Cmd+Enter sends) does the other one.',
  },
  'chat.dictationLimitSeconds': {
    title: 'Dictation time limit',
    description:
      'Maximum seconds of speech input before transcription finishes automatically. Uses the browser speech recognition service and the browser language. Audio may be sent to the browser provider for transcription.',
    keywords: ['microphone', 'speech', 'voice', 'transcription'],
  },
  'chat.sendShortcut': {
    optionTitles: {
      enter: 'Enter',
      'mod-enter-multiline': 'Enter until multiline',
      'mod-enter': 'Ctrl/Cmd+Enter',
    },
    title: 'Send shortcut',
    description:
      'Which key sends a message. Enter: Enter sends and Shift+Enter adds a line. Enter until multiline: Enter sends until the message has a second line, then Ctrl/Cmd+Enter sends. Ctrl/Cmd+Enter: Ctrl/Cmd+Enter sends and Enter adds a line. Where Ctrl/Cmd+Enter sends, Shift+Ctrl/Cmd+Enter sends with the other follow-up behavior.',
    keywords: ['send', 'enter', 'submit', 'newline', 'shortcut', 'keyboard'],
  },
  'chat.planModeEnabled': {
    title: 'Plan mode controls',
    description:
      'Show the Plan mode picker and the /plan and /default commands for providers that have them. Hiding them keeps the plan mode choice saved in each draft.',
  },
  'agent.diagnosticsFeedback': {
    title: 'Errors after agent edits',
    details:
      'Only errors the edit introduced, from the language server already open for that file: up to 10 per file.',
    description:
      'After an agent edits a file, tell it the errors that edit introduced, so it can fix them in the same turn.',
  },
  'chat.activeFileContext': {
    title: 'Active file in the composer',
    details:
      "The chip names the file relative to the workspace. Removing it lasts until the editor's active file changes.",
    description:
      'Show the file open in the editor as a chip in the composer. While the chip is there, sending mentions that file. Remove the chip to send without it.',
  },
  'chat.contextWindowMeterEnabled': {
    title: 'Context window meter',
    details:
      "Claude reports what fills the window: system prompt, tools, messages, and the reserve kept for compaction. Other providers show the turn's token counts. The meter's popover also shows the session's tokens and cost.",
    description:
      "Show how full the session's context window is, in the composer and the session header.",
  },
  'chat.responseStreamingMode': {
    optionTitles: {
      paragraph: 'By paragraph',
      turn: 'When the turn ends',
      token: 'Token by token',
    },
    title: 'Response streaming',
    details:
      'Paragraph publishes text at blank lines, closed code fences and new list items: the first break at once, later ones at least 400 ms apart. The end of the turn, a question from the agent, or 24,000 buffered characters flushes the rest. Token mode still delivers reasoning by paragraph.',
    description:
      'How the agent’s reply appears while it writes: a paragraph at a time, all at once when the turn ends, or token by token.',
  },
  'chat.projectResponseStreamingModes': {
    title: 'Project response streaming',
    description: 'Response streaming mode overrides keyed by project UUID on this machine.',
  },
  'chat.notificationMode': {
    optionTitles: {
      off: 'Off',
      notifications: 'Notifications',
      sound: 'Sound',
      'notifications-and-sound': 'Notifications and sound',
    },
    title: 'Session notifications',
    description:
      'Notify you when a session needs you or finishes. System notifications need the browser’s permission; sound plays only after you have clicked or typed in the app.',
  },
  'chat.inAppNotificationsEnabled': {
    title: 'In-app session notifications',
    description:
      'While you are using this window, show a notice with an Open session button when another session needs you or finishes.',
  },
  'chat.pushNotifications': {
    title: 'Push session notifications',
    details:
      'Only live changes push: replaying history, recovering after a restart and archived sessions never notify. A device the push service rejects with 404 or 410 is removed.',
    description:
      'Send a push notification to every device listed below when a session needs you or finishes. None are sent while you are using a window of this app.',
  },
  'chat.textGenerationModel': {
    title: 'Title generation model',
    details:
      "Titles use gpt-5.6-luna at low effort through Codex. When Codex is disabled or missing, the server uses the first enabled provider in the order Codex, Claude, Cursor, Grok, OpenCode, Antigravity, with that provider's small model. A failed title request keeps the current title and logs a warning.",
    description: 'Provider and model that write session titles.',
  },
  'chat.projectTextGenerationModels': {
    title: 'Project title generation models',
    description: 'Title generation model overrides keyed by project UUID on this machine.',
  },
  'chat.sessionSortOrder': {
    optionTitles: { updated_at: 'Latest activity', created_at: 'Creation time' },
    title: 'Session navigation order',
    description:
      'Order sessions in the palette, and pick which session opens after a deletion, by latest user activity or by creation time.',
  },
  'chat.confirmSessionDelete': {
    title: 'Confirm session deletion',
    description: 'Ask before permanently deleting one or more sessions.',
  },
  'chat.projectGrouping': {
    optionTitles: {
      repository: 'Repository',
      repository_path: 'Repository folder',
      separate: 'Each machine apart',
    },
    title: 'Project grouping',
    details:
      "Repository puts one repository's checkouts on this machine and on connected machines under one project row. Separate gives each machine's project its own row.",
    description:
      'Group projects by repository, by folder inside the repository, or by machine. Git projects are added at the repository root today, so the two repository options group the same way.',
  },
  'chat.autoSettleAfterDays': {
    title: 'Settle inactive sessions after days',
    details:
      'The server checks every 5 minutes. A session with an open pull request, a pending approval or question, a queued or running turn, or live background work stays unsettled.',
    description:
      'Move a session to Settled once it has had no activity for this many days, including existing sessions. 0 turns it off.',
    keywords: ['settle', 'inactive', 'days', 'automatic'],
  },
  'chat.autoSettleOnMerge': {
    title: 'Settle sessions when their pull request merges',
    details: 'A merge or close counts when it happens after your last request in the session.',
    description:
      "Move a session to Settled when its worktree's pull request is merged. A closed pull request settles it whenever automatic settlement is on.",
    keywords: ['settle', 'merge', 'pull request', 'automatic'],
  },
  'chat.projectAutoSettle': {
    title: 'Project automatic settlement',
    description: 'Automatic settlement overrides keyed by project UUID on this machine.',
  },
  'chat.projectGroupingOverrides': {
    title: 'Project grouping overrides',
    description: 'Grouping mode per scoped project key (environment UUID:project UUID).',
  },
  'environments.loadBalancing': {
    title: 'Balance new sessions across machines',
    description:
      'Choose a connected checkout with available CPU and memory for a new draft. The draft keeps its chosen machine.',
    keywords: ['capacity', 'automatic', 'load'],
  },
  'environments.loadPreferences': {
    title: 'Machine selection preferences',
    description:
      'Weight automatic selection for each connected machine. Manual only requires choosing the machine yourself.',
    keywords: ['capacity', 'automatic', 'load'],
  },
  'environments.machines': {
    title: 'Connected machines',
    description:
      'Other machines this app can connect to, over SSH or by address. This machine is always available.',
    keywords: ['remote', 'ssh', 'environment', 'server', 'connect'],
  },
  'environments.devicePairing': {
    title: 'Require pairing for other devices',
    description:
      'A browser on another device, such as a phone reaching this machine over the mesh, shows a pairing screen until a link from this machine pairs it. This machine’s own browser needs no pairing.',
    keywords: ['pair', 'phone', 'device', 'security', 'mesh', 'tailnet'],
  },
  'server.address': {
    title: 'Server address',
    description:
      'The loopback address this machine’s Fregat server listens on, and the origin of the installed app. A changed address is a new app installation with its own browser storage.',
    keywords: ['server', 'port', 'address', 'install', 'socket', 'loopback'],
  },
  'server.releaseRoot': {
    title: 'Server release folder',
    description:
      'The folder holding the releases, logs and current release this machine’s Fregat server runs. Empty uses the application data folder: ~/Library/Application Support/Fregat/releases on macOS, ~/.local/share/fregat/releases on Linux.',
    keywords: ['server', 'release', 'install', 'folder', 'update'],
  },
  'server.activationTimeoutSeconds': {
    title: 'Server start time limit',
    description:
      'Seconds setup waits for this machine’s Fregat server to start and prove its identity before it reports the address as unverified.',
    keywords: ['server', 'install', 'setup', 'timeout', 'socket'],
  },
  'server.webBase': {
    title: 'Server web path',
    description:
      'The path the installed app opens under the server address. A server that already serves this machine’s state keeps the path it serves.',
    keywords: ['server', 'path', 'base', 'install'],
  },
  'git.maxDiffFileSizeMiB': {
    title: 'Diff file size limit',
    description:
      'Maximum size in MiB of each file version loaded for a Git comparison. Larger files show a size-limit notice.',
    keywords: ['diff', 'size', 'limit', 'memory', 'large'],
  },
  'git.autoPull': {
    title: 'Keep the default branch current',
    details:
      'Checked on each Git status read after the background fetch moves the upstream. After a failed pull the next try waits 60 seconds. The Git panel shows why a pull was skipped.',
    description:
      'Pull new commits into a project’s default branch when the remote gets them. A checkout with uncommitted changes, unpushed commits or another branch checked out is left alone.',
    keywords: ['pull', 'fast-forward', 'fetch', 'default branch', 'main'],
  },
  'git.projectAutoPull': {
    title: 'Project default-branch pull',
    description: 'Automatic default-branch pull keyed by project UUID on this machine.',
  },
  'git.worktreeSubmodules': {
    optionTitles: { recursive: 'All, nested too', 'top-level': 'Top level only', none: 'None' },
    title: 'Submodules in new worktrees',
    details:
      'Runs git submodule update --init after the worktree is created, with --recursive in the recursive mode. Credential prompts are off and the step stops after 15 minutes. A failed step keeps the worktree, and the Git panel offers Initialize to retry.',
    description:
      'Initialize every nested submodule, only the ones this repository declares, or none when a session creates a worktree.',
    keywords: ['submodule', 'worktree', 'recursive'],
  },
  'git.projectWorktreeSubmodules': {
    title: 'Project submodules in new worktrees',
    description: 'Submodule modes for new worktrees keyed by project UUID on this machine.',
  },
  'git.worktreeCleanupOnDelete': {
    title: 'Remove worktrees after their last session is deleted',
    details:
      'While this is off, the delete dialog offers removal for that one deletion. node_modules is allowed because a package install recreates it.',
    description:
      'Remove a session worktree once every session using it is deleted and has stopped, including earlier deletions. A worktree with uncommitted changes, ignored files other than node_modules, or another branch checked out stays.',
    keywords: ['worktree', 'cleanup', 'delete', 'remove', 'storage'],
  },
  'git.projectWorktreeCleanupOnDelete': {
    title: 'Project worktree removal after deletion',
    description:
      'Worktree removal after the last session is deleted, keyed by project UUID on this machine.',
  },
  'workbench.colorTheme': {
    optionTitles: { dark: 'Dark', light: 'Light', system: 'System' },
    title: 'Light / dark mode',
    description: 'Light or dark, or follow the operating system.',
    keywords: ['theme', 'dark', 'light', 'appearance', 'colour'],
  },
  'workbench.theme': {
    title: 'Theme',
    details:
      'Picking a theme sets the rows below at once: app colors, code colors, wallpaper and surfaces. Changes you make afterwards, in these rows or in the theme studio, are saved for that theme and come back when you pick it again. With no theme, each of those rows holds one value for both modes.',
    description:
      'App colors, code colors, wallpaper and surfaces, in a light and a dark version. Try them in the theme studio.',
    keywords: ['theme', 'studio', 'light', 'dark', 'wallpaper', 'colors', 'palette'],
  },
  'workbench.theme.customizations': {
    description: 'Part overrides saved separately for each theme bundle and mode.',
  },
  'workbench.palette': {
    title: 'App colors',
    description:
      'Colors for app backgrounds, text, borders, accents and the terminal. Pick a palette here, or edit its colors in the theme studio.',
    keywords: [
      'palette',
      'colour',
      'colors',
      'sage',
      'graphite',
      'teal',
      'monochrome',
      'accent',
      'appearance',
      'terminal',
    ],
  },
  'editor.codeTheme.dark': {
    title: 'Code theme in dark mode',
    description: 'Colors for code in editors and chat code blocks when the app uses dark mode.',
    keywords: ['syntax', 'highlighting', 'theme', 'code', 'native', 'vscode', 'colour'],
  },
  'editor.codeTheme.light': {
    title: 'Code theme in light mode',
    description: 'Colors for code in editors and chat code blocks when the app uses light mode.',
    keywords: ['syntax', 'highlighting', 'theme', 'code', 'native', 'vscode', 'colour'],
  },
  'workbench.wallpaper': {
    title: 'Wallpaper',
    details:
      "Desktop shows the server machine's current wallpaper: Omarchy's current background on Linux, the desktop picture on macOS. On a Linux screen the compositor already shows the desktop behind the window, so Desktop draws nothing there.",
    description:
      'The image behind the panes: one from the library, an upload, the desktop wallpaper, or none. None keeps the chosen image for later.',
    keywords: ['wallpaper', 'background', 'desktop', 'image', 'upload'],
  },
  'workbench.surface.opacity': {
    title: 'Pane opacity',
    description:
      'How opaque panels and sidebars are over the wallpaper. 100 hides the wallpaper behind them.',
    keywords: ['panes', 'surfaces', 'transparency', 'opacity', 'glass', 'material', 'blur'],
  },
  'workbench.surface.contentOpacity': {
    title: 'Content opacity',
    // Drives --content-opacity: the well is a second layer over a panel that
    // already painted one, so 50 over 80 composites to 90.
    details:
      "This layer sits over the panel's own surface, so 50 over a panel at 80 makes the ground behind code and terminal text 90% opaque: text stays readable and a trace of the wallpaper shows through.",
    description:
      'How opaque the extra layer under the editor, terminal and settings is. It sits on top of the panel, so 0 leaves them as see-through as a sidebar.',
    keywords: ['content', 'surfaces', 'transparency', 'opacity', 'glass', 'editor', 'terminal'],
  },
  'workbench.surface.blur': {
    title: 'Backdrop blur',
    details:
      "Capped at 40 px. A repository's settings file can set this, and a large backdrop blur costs GPU time on every frame.",
    description: 'How much the wallpaper behind see-through panels is blurred, in pixels.',
    keywords: ['blur', 'surfaces', 'glass', 'transparency', 'material', 'vibrancy'],
  },
  'workbench.surface.saturation': {
    title: 'Backdrop saturation',
    description: 'How vivid the wallpaper behind see-through panels looks, as a percentage.',
    keywords: ['saturation', 'surfaces', 'glass', 'transparency', 'material', 'vibrancy'],
  },
  'tui.theme.colors': {
    optionTitles: { theme: 'Theme colors', terminal: 'Terminal colors' },
    title: 'Terminal app colors',
    description:
      'Colors for the terminal app: the selected theme’s, or the colors of the terminal it runs in.',
  },
  'workbench.reduceMotion': {
    title: 'Reduce terminal motion',
    details:
      "Applies to the terminal app: its spinners and loaders run at half speed. The web app follows the operating system's reduce-motion setting.",
    description: 'Slow down spinners and loaders in the terminal app.',
    keywords: ['tui', 'terminal', 'animation', 'accessibility', 'motion'],
  },
  'workbench.fontFamily': {
    title: 'Interface font',
    details:
      "Bundled fonts ship with the app and load with no network. Installed fonts come from the server machine's fontconfig (fc-list), so a font installed there works on every device; a server without fontconfig lists none.",
    description: 'Font for the words the app writes: titles, labels, menus and prose.',
    keywords: ['font', 'typeface', 'interface', 'ui', 'sans', 'appearance'],
  },
  'workbench.sounds.controls': {
    title: 'Controls',
    details:
      'Only pointer presses click. Keyboard presses stay silent, and nothing sounds while the tab is hidden.',
    description: 'Play clicks when pressing controls and changing values with the pointer.',
    keywords: ['sound', 'audio', 'click', 'feedback'],
  },
  'workbench.sounds.errors': {
    title: 'Errors',
    description: 'Play a short rattle when an error toast appears.',
    keywords: ['sound', 'audio', 'error', 'toast', 'feedback'],
  },
  'workbench.sounds.git': {
    title: 'Git results',
    description:
      'Play two rising clicks when a commit is created, a push finishes or a pull request opens.',
    keywords: ['sound', 'audio', 'git', 'commit', 'push', 'pull request', 'feedback'],
  },
  'workbench.sounds.terminalBell': {
    title: 'Terminal bell',
    details: 'At most one bell every 500 ms. Silent while the tab is hidden.',
    description: 'Play a click when a terminal program rings the bell.',
    keywords: ['sound', 'audio', 'terminal', 'bell', 'bel', 'feedback'],
  },
  'workbench.sounds.volume': {
    title: 'Volume',
    details:
      'Agent notification sounds (turn finished, input requested) play through this volume too. At 100 they play at their recorded level.',
    description: 'Loudness of every sound, agent notifications included.',
    keywords: ['sound', 'audio', 'volume', 'loudness'],
  },
  'workbench.feel': {
    optionTitles: {
      flat: 'Flat',
      seam: 'Seam',
      brisk: 'Brisk',
      relaxed: 'Relaxed',
      playful: 'Playful',
    },
    title: 'Feel',
    details:
      'Flat moves on fixed durations with flat controls. Seam, Brisk, Relaxed and Playful move on springs and give controls raised keys, sunken wells and squircle corners (squircles in Chromium only). Under reduced motion every feel uses fades.',
    description:
      'How controls move and how raised they look: Flat, Seam, Brisk, Relaxed or Playful.',
    keywords: ['motion', 'spring', 'physical', 'animation', 'depth'],
  },
  'workbench.density': {
    optionTitles: { compact: 'Compact', cozy: 'Cozy' },
    title: 'Interface density',
    description: 'Use tighter compact spacing or roomier cozy spacing throughout the app.',
    keywords: ['density', 'compact', 'cozy', 'spacing', 'padding', 'appearance'],
  },
  'workbench.surface.continuousSeams': {
    title: 'Continuous panel background',
    // Which element paints the surface. Off, each panel paints its own and the
    // resize handles between them show the wallpaper. On, the region around them
    // paints once, so the handles carry the same surface and the panels merge.
    description:
      'Paint one background across panels and the resize handles between them, so the panels read as one surface. Off, the wallpaper shows in the gaps between panels.',
    keywords: ['seam', 'handle', 'divider', 'wallpaper', 'surface', 'glass'],
  },
  'workbench.tree.indentGuides': {
    optionTitles: { none: 'Never', onHover: 'On hover', always: 'Always' },
    title: 'File tree indent guides',
    description:
      'When to show indentation guides in the file tree. Guides take editor colours while the tree is hovered.',
    keywords: ['tree', 'files', 'folders', 'indent', 'guides', 'colour'],
  },
  'editor.fontFamily': {
    title: 'Code font',
    details:
      'Also the terminal font. A code font without Nerd Font icons borrows them from Nerd Fonts Symbols Only, so terminal prompts keep their glyphs. Installed fonts come from the server machine (fc-list).',
    description: 'Font for the editor, the terminal, and code and metadata across the app.',
    keywords: ['font', 'typeface', 'monospace', 'nerd font', 'editor', 'terminal', 'code'],
  },
  'editor.fontSize': {
    description: 'Editor font size in pixels.',
    keywords: ['font', 'size', 'zoom', 'editor'],
  },
  'editor.lineHeight': {
    description: 'Editor row height in pixels.',
    keywords: ['line', 'height', 'spacing', 'density'],
  },
  'editor.tabSize': {
    details: 'Diffs skip indentation detection, so tabs in a diff always use this width.',
    description:
      'Width of a tab character, in spaces. Also the indentation width for a file whose own cannot be detected.',
    keywords: ['tab', 'indent', 'width', 'spaces'],
  },
  'editor.history.retainedStates': {
    details:
      "A state is a run of typing. Each retained state keeps its text snapshot in memory, and each edit copies a map of them: 1,000 commits with pruning took 4.55 ms under Bun in the Editor's undo-graph measurement.",
    description:
      'How many undo steps each open file keeps, across every undo branch. Past this number, the steps you visited longest ago are dropped first.',
    keywords: ['undo', 'history', 'branches', 'retained', 'memory'],
  },
  'editor.history.persist': {
    description:
      'Keep undo history for closed files in this browser, so reopening a file or reloading the window brings it back. A file that changed on disk in the meantime starts fresh.',
    keywords: ['undo', 'history', 'restore', 'reopen', 'reload', 'persist'],
  },
  'editor.history.persistDays': {
    description: 'Days a closed file keeps its stored undo history before it is dropped.',
    keywords: ['undo', 'history', 'ttl', 'expire', 'persist'],
  },
  'editor.history.persistBudget': {
    details:
      'Same ceiling as the retained text budget, capped at 1 GiB because browser storage is shared with every other site. A single history larger than the budget is skipped.',
    description:
      'Total stored undo history across closed files, in UTF-16 code units. The least recently saved files go first when it is exceeded.',
    keywords: ['undo', 'history', 'storage', 'budget', 'persist'],
  },
  'editor.markdownView': {
    optionTitles: { source: 'Plain source', preview: 'Live preview' },
    title: 'Markdown editing style',
    details:
      'Live preview formats Markdown in place and reveals syntax near the caret. Plain source keeps Markdown syntax visible. The rendered side pane is a separate setting.',
    description:
      'Edit Markdown as plain source, or as a live preview that formats the text and shows the Markdown symbols near the cursor. The Cycle Markdown View command changes one file.',
    keywords: ['markdown', 'preview', 'split', 'render'],
  },
  'editor.markdownRenderedPane': {
    title: 'Markdown rendered side pane',
    description:
      'Show a fully rendered page beside the Markdown editor, with synchronized scrolling. Works with either editing style.',
    keywords: ['markdown', 'preview', 'split', 'render'],
  },
  'editor.spellcheck': {
    optionTitles: { off: 'Off', prose: 'Prose', proseAndCode: 'Prose and code' },
    title: 'Spellcheck',
    description:
      'Mark misspelled words: in plain text and Markdown prose, or also in code comments and strings. Right-click a marked word for suggestions.',
    keywords: ['spelling', 'spellcheck', 'dictionary', 'typo', 'prose'],
  },
  'spellcheck.words': {
    title: 'Spellcheck dictionary',
    description:
      'Words spellcheck never marks. Set a word to false to mark it again where another scope accepts it.',
    keywords: ['spelling', 'spellcheck', 'dictionary', 'words', 'ignore'],
  },
  'editor.diff.viewMode': {
    optionTitles: { split: 'Side by side', stacked: 'Stacked' },
    description: 'Show diffs side by side or stacked.',
    keywords: ['diff', 'split', 'stacked', 'compare', 'git'],
  },
  'editor.inputRoute': {
    optionTitles: { textarea: 'Hidden textarea', 'edit-context': 'EditContext' },
    // EditContext exists only in Chromium; other engines keep the textarea whatever this says.
    details:
      'In the editor-edit-context-input scenario, an IME correction over the first word yields Hello日本 on EditContext and hello日本Hello on the textarea. EditContext is Chromium-only; Firefox and Safari use the textarea whatever this says.',
    description:
      'How typed text reaches the editor. EditContext (Chromium) hands IME, autocorrect and dictation edits to the editor with their exact ranges. Other browsers use a hidden textarea.',
    keywords: ['input', 'ime', 'editcontext', 'composition', 'autocorrect', 'textarea'],
  },
  'terminal.shellKeys': {
    title: 'Shell keys',
    description: 'Send Ctrl+letter and readline Alt shortcuts to the focused terminal shell.',
    keywords: ['terminal', 'shell', 'readline', 'shortcut', 'keybinding'],
  },
  'terminal.integrated.fontSize': {
    description: 'Terminal font size in pixels.',
    keywords: ['terminal', 'font', 'size'],
  },
  'terminal.integrated.scrollback': {
    description: 'How many lines of output the terminal keeps.',
    keywords: ['terminal', 'scrollback', 'history', 'buffer'],
  },
  'terminal.integrated.cursorBlinking': {
    description: 'Blink the terminal cursor while the terminal has focus.',
    keywords: ['terminal', 'cursor', 'blink'],
  },
  'editor.inactiveAnalysisEntryLimit': {
    title: 'Inactive analysis entry limit',
    description:
      'How many unused document syntax analysis entries the editor keeps across all retained environments. Structural analysis and highlighting each count as one entry.',
    details:
      "Each retained document's structural or highlighter session counts once, including each distinct configuration. Checked after analysis and document ownership changes settle. Views and preparation leases protect their entries until release. Obsolete and abandoned entries leave first, then the least recently released entries. The default of 2 can keep a previous document's structural analysis and highlighting warm while another document is active. Set 0 to reclaim every unused entry. Reclaimed analysis is recreated when needed; the document keeps its text and Undo history. This setting counts entries. Memory use depends on the retained documents and providers.",
    keywords: ['memory', 'retention', 'analysis', 'syntax', 'warm', 'environments'],
  },
  'editor.retainedTextBudget': {
    details:
      'Checked at a project switch and at a tab close, so opening two large projects can exceed it until the next switch or close. Counted in UTF-16 code units, which equals bytes for ASCII text. Files of other projects past the limit leave memory and are read from disk again when you switch back.',
    description:
      'How much text the editor keeps in memory across the current project and the other open projects, in UTF-16 code units. The current project counts first and is never trimmed, so a large one leaves less room for the others.',
    keywords: ['memory', 'retention', 'projects', 'budget', 'documents'],
  },
  'editor.unicodeHighlight.ambiguousCharacters': {
    details:
      'A confusable character looks like an ASCII one, so the Cyrillic а in pаssword names a different identifier from the one you read. Typographic punctuation such as an en dash also counts; add it to Allowed characters to stop highlighting it.',
    description:
      'Highlight Unicode characters that resemble other characters. Hover a highlight for an explanation.',
    keywords: ['unicode', 'ambiguous', 'confusable', 'characters'],
  },
  'editor.unicodeHighlight.invisibleCharacters': {
    details:
      'An invisible character draws nothing. A bidirectional override can reorder a line so the code the compiler reads differs from the line on screen.',
    description: 'Highlight invisible Unicode characters. Hover a highlight for its code point.',
    keywords: ['unicode', 'invisible', 'characters'],
  },
  'editor.unicodeHighlight.allowedCharacters': {
    description:
      'Characters allowed without Unicode highlighting. Paste the characters here, for example an en dash.',
    keywords: ['unicode', 'allowed', 'exclude', 'characters'],
  },
  'editor.largeFile.analysisLimitMiCodeUnits': {
    title: 'Analysis size limit',
    description:
      'Pause syntax, language services, folding and document analysis above this size in Mi UTF-16 code units (1,048,576 units).',
    keywords: ['large files', 'performance', 'analysis', 'memory'],
  },
  'editor.maxTokenizationLineLength': {
    title: 'Tokenization line limit',
    description:
      'Longest line, in UTF-16 code units, that imported code themes color. Longer lines show as plain text in the theme foreground.',
    keywords: ['long lines', 'performance', 'syntax', 'shiki', 'tokenization'],
  },
  'editor.largeFile.minimapLimitMiCodeUnits': {
    title: 'Minimap size limit',
    description: 'Pause the minimap above this size in Mi UTF-16 code units (1,048,576 units).',
    keywords: ['large files', 'performance', 'minimap', 'memory'],
  },
  'editor.minimap.enabled': {
    description: 'Show the minimap beside the editor.',
    keywords: ['minimap', 'overview', 'performance'],
  },
  'editor.guides.indentation': {
    description: 'Draw indentation guides (scope lines).',
    keywords: ['indent', 'guides', 'scope lines', 'performance'],
  },
  'editor.syntaxHighlighting.enabled': {
    description: 'Colour code by syntax. Turning this off makes very large files faster.',
    keywords: ['syntax', 'highlighting', 'colour', 'performance'],
  },
  'editor.decode.mode': {
    optionTitles: {
      off: 'Off',
      diffusion: 'Diffusion',
      autoregressive: 'Autoregressive',
      parallel: 'Parallel',
      token: 'Token',
    },
    details:
      'Autoregressive types one character at a time, line after line. Parallel types every line at once, staggered. Token streams one token at a time, like a language model. Diffusion settles scrambled glyphs into the text.',
    description: 'Animate a file as it opens, as if it were being written.',
    keywords: ['decode', 'animation', 'diffusion', 'typewriter'],
  },
  'search.defaultMatchMode': {
    optionTitles: { literal: 'Exact text', regex: 'Regular expression', fuzzy: 'Fuzzy' },
    description: 'How a new search interprets the query.',
    keywords: ['search', 'regex', 'literal', 'fuzzy', 'match'],
  },
  'search.caseSensitive': {
    description: 'Match case by default.',
    keywords: ['search', 'case', 'sensitive'],
  },
  'search.wholeWord': {
    description: 'Match whole words by default.',
    keywords: ['search', 'word', 'boundary'],
  },
  'search.maxResults': {
    // The route rejects rather than clamps, so the schema shares its cap or a legal-looking
    // setting produces a failed request.
    details:
      "20,000 is VS Code's default cap. Once a parallel ripgrep run is cut off, which matches it returns can change from run to run, so the cap sits high enough that this is rare. The server refuses larger values.",
    description: 'How many matches a workspace search returns.',
    keywords: ['search', 'results', 'limit'],
  },
  'search.maxResultFiles': {
    // Separate from `search.maxResults`: one pathological file can hold every
    // match in the budget, so bounding matches alone still yields a one-file
    // result set. The route caps it at the same limit.
    details:
      'Every file in the results holds at least one match, so at the default the match limit always stops a search first. It takes effect when set below the match limit.',
    description: 'How many files a workspace search returns matches from.',
    keywords: ['search', 'results', 'files', 'limit'],
  },
  'search.quickOpenLimit': {
    // A different surface from `search.maxResults`, despite the similar name:
    // this is the file picker, that is the workspace search pane.
    description: 'How many files the file picker lists.',
    keywords: ['search', 'quick open', 'picker', 'files', 'limit'],
  },
  'search.quickOpenPreview': {
    title: 'Preview files in quick open',
    description: 'Show the highlighted file below the quick open list.',
    keywords: ['search', 'quick open', 'preview', 'files'],
  },
  'chat.keepImportedSessionsUpdated': {
    title: 'Keep imported chats updated',
    details:
      'The server rescans local Claude and Codex history every minute and brings imported chats up to date. A chat stops updating once it has a turn sent from Platform.',
    description:
      'Imported chats keep getting new messages from the Claude or Codex history on this machine until you send a message in them from Platform. New chats are imported only when you click Import.',
    keywords: ['chat', 'import', 'sync', 'history', 'claude', 'codex', 'cli', 'app', 'local'],
  },
  'chat.diagramFontWaitMs': {
    title: 'Diagram font wait',
    description:
      'Milliseconds a chat diagram waits for the interface font to download before it is measured with the faces already loaded. 0 measures at once.',
    keywords: ['chat', 'diagram', 'mermaid', 'font', 'wait', 'timeout'],
  },
  'chat.defaultRuntimeMode': {
    optionTitles: {
      'full-access': 'Full access',
      'approval-required': 'Ask first',
      'auto-accept-edits': 'Auto-accept edits',
    },
    details:
      'Full access suits a machine with one owner who trusts agents with its checkouts: Codex starts with approval policy never and sandbox danger-full-access, and Claude pre-approves every tool. This is an application setting, so a workspace file in a cloned repository cannot change it.',
    description: 'What the agent in a new session may do without asking you first.',
    keywords: ['chat', 'permission', 'approval', 'runtime', 'safety'],
  },
  'chat.defaultInteractionMode': {
    optionTitles: { default: 'Default', plan: 'Plan' },
    description: 'Whether a new session starts in plan mode.',
    keywords: ['chat', 'plan', 'mode', 'interaction'],
  },
  'logs.defaultTimeRange': {
    optionTitles: {
      '15m': '15 minutes',
      '1h': '1 hour',
      '6h': '6 hours',
      '24h': '24 hours',
      all: 'All',
    },
    description: 'Time range the logs view opens on.',
    keywords: ['logs', 'time', 'range', 'filter'],
  },
  'logs.retentionDays': {
    title: 'Log retention',
    description:
      'Days of server log files this machine keeps, today included; older days are deleted once a day. 0 keeps every day, up to 60 files.',
    keywords: ['logs', 'retention', 'delete', 'days', 'disk', 'cleanup'],
  },
  'logs.slowThresholdMs': {
    description: 'How many milliseconds counts as a slow operation.',
    keywords: ['logs', 'slow', 'threshold', 'performance'],
  },
  'developer.simulatedLatencyMs': {
    title: 'Simulated network latency',
    description:
      'Milliseconds added before every request to the server, to see how the app behaves on a slow link. Zero disables it.',
    keywords: ['developer', 'latency', 'delay', 'slow', 'network', 'optimistic', 'pending'],
  },
  'developer.devServerIdleMinutes': {
    title: 'Dev server idle window',
    description:
      'Minutes the shared dev server keeps running after its last connection closes; mesh then stops it and starts it again on the next connection. Takes effect the next time `bun run dev:serve` runs.',
    keywords: ['developer', 'dev server', 'mesh', 'idle', 'vite'],
  },
  'developer.clientUpdateCheckSeconds': {
    title: 'Client update check interval',
    description:
      'Seconds between checks for an available web update while the app is visible. Refresh applies the update when you choose.',
    keywords: ['developer', 'deploy', 'update', 'refresh'],
  },
  'developer.deployTarget': {
    title: 'Installation target',
    description: 'Install releases and pair through Mesh and systemd.',
  },
  'developer.deployRestartWaitMinutes': {
    title: 'Restart wait',
    description: 'Minutes to wait for busy sessions. --interrupt ends them and restarts.',
    keywords: ['developer', 'deploy', 'restart', 'update', 'busy', 'wait'],
  },
  'developer.heavyJobLogDirectory': {
    title: 'Heavy job log directory',
    description:
      'Directory where `scripts/heavy/run.ts` writes one JSON line per heavy job: its peak memory, CPU time, wall time and exit code. `scripts/heavy/report.ts` reads it.',
    keywords: ['developer', 'heavy', 'jobs', 'wrapper', 'memory', 'log', 'report'],
  },
  'developer.heavyJobClasses': {
    title: 'Heavy job classes',
    details:
      'The estimate is what admission reserves for a job of the class until the job uses it. The ceiling is the memory limit of the job’s slice: the kernel kills a job that grows past it.',
    description:
      'Memory estimate and ceiling, in MiB, for each `scripts/heavy/run.ts --class`: suite, browser, build, bench and light.',
    keywords: ['developer', 'heavy', 'jobs', 'class', 'memory', 'estimate', 'ceiling', 'admission'],
  },
  'developer.heavyJobQuietPolicy': {
    title: 'Quiet job concurrency',
    details:
      'Use an empty allowedClasses array to hold new light jobs during measurements. The measurementCpus and concurrentCpus fields currently accept empty arrays, preserving host scheduling. CPU affinity requires a validated scheduling implementation.',
    description:
      'Classes allowed alongside a quiet measurement. Light jobs keep their memory and pressure checks. Empty CPU sets use the machine scheduler.',
    keywords: ['developer', 'heavy', 'quiet', 'concurrency', 'affinity'],
  },
  'developer.heavyJobMemoryReserveMiB': {
    title: 'Heavy job memory reserve',
    description:
      'MiB of available memory that heavy-job admission leaves free for the desktop, the app and work outside the wrapper.',
    keywords: ['developer', 'heavy', 'jobs', 'memory', 'reserve', 'admission'],
  },
  'developer.heavyJobMemoryPressureLimit': {
    title: 'Heavy job memory pressure limit',
    details:
      'Memory pressure is the share of the last ten seconds in which some task waited for memory (`/proc/pressure/memory`, `some avg10`). It stays near zero until the machine reclaims or swaps.',
    description:
      'Percent of memory pressure at or above which heavy-job admission starts no further job while one runs.',
    keywords: ['developer', 'heavy', 'jobs', 'memory', 'pressure', 'psi', 'admission'],
  },
  'developer.heavyJobStopGraceSeconds': {
    title: 'Heavy job stop grace',
    description:
      'Seconds a stopped heavy job, and anything a finished one left running, gets between SIGTERM and SIGKILL.',
    keywords: ['developer', 'heavy', 'jobs', 'stop', 'cancel', 'grace', 'sigterm', 'sigkill'],
  },
  'developer.heavyJobQuietHoldSeconds': {
    title: 'Heavy job quiet hold',
    details:
      'A `--quiet` job waits for finite jobs to finish while later jobs queue behind it. Declared servers keep running and count toward resource admission. Admission and execution each get this many seconds. Expiry releases the request or stops the running job and returns exit 75; invoke it again for a fresh queue ticket. A `drain.request` is honoured for this many seconds from its first observation.',
    description:
      'Maximum seconds for quiet admission, a running quiet hold, and an external drain request, measured independently.',
    keywords: ['developer', 'heavy', 'jobs', 'quiet', 'exclusive', 'hold', 'drain', 'benchmark'],
  },
  'developer.heavyJobCpuLoadLimit': {
    title: 'Heavy job CPU load limit',
    details:
      'The one-minute load average divided by the number of cores: 1 means every core has a runnable task. CPU pressure’s `some` share stays high on an idle desktop and its `full` share reads zero for the whole machine, so admission counts runnable tasks.',
    description:
      'Runnable tasks per core at or above which heavy-job admission starts no further job while one runs.',
    keywords: ['developer', 'heavy', 'jobs', 'cpu', 'load', 'cores', 'admission'],
  },
  'window.browser': {
    title: 'Browser',
    description:
      'The desktop window engine: auto uses the native WebKit window on macOS. On Linux, auto tries Chrome, the default supported Chromium browser, other installed Chromium browsers, then the system window. With window transparency, auto uses the system window. webview selects the system window, and an absolute path selects a browser executable first.',
    keywords: ['window', 'browser', 'chromium', 'webview', 'desktop'],
  },
  'window.browserStartupIdleSeconds': {
    title: 'Browser startup idle limit',
    description:
      'Seconds a starting browser may spend without reading its files, using the CPU or answering the launcher before the launcher stops it.',
    keywords: ['window', 'browser', 'chromium', 'startup', 'idle', 'stall', 'desktop'],
  },
  'window.browserStartupLimitSeconds': {
    title: 'Browser startup limit',
    description:
      'Seconds a starting browser gets to answer the launcher, however steadily it is loading, before the launcher stops it.',
    keywords: ['window', 'browser', 'chromium', 'startup', 'limit', 'desktop'],
  },
  'window.nativeDialogTimeoutSeconds': {
    title: 'Native dialog time limit',
    description:
      'Seconds a desktop file chooser or startup message stays open before its helper closes.',
    keywords: ['window', 'picker', 'native', 'timeout'],
  },
  'window.nativeHostStopGraceSeconds': {
    title: 'Native host stop grace',
    description: 'Seconds the desktop gives an owned native helper to stop before terminating it.',
    keywords: ['window', 'native', 'shutdown', 'grace'],
  },
  'window.transparency': {
    optionTitles: { compositor: 'Window manager', window: 'Transparent window' },
    details:
      'Transparent macOS windows enable native Frosted and Glass materials. The native WebKit host is the default macOS window engine. On Linux, window-manager mode uses the installed browser app.',
    description:
      'Choose window-manager transparency or a see-through native window using the system webview.',
    keywords: ['window', 'transparency', 'vibrancy', 'compositor', 'desktop', 'wallpaper', 'blur'],
  },
  'window.material': {
    optionTitles: { none: 'None', frosted: 'Frosted', glass: 'Glass' },
    title: 'Window material',
    description: 'None shows the desktop; Frosted blurs it; Glass adds Liquid Glass.',
  },
  'prefetch.enabled': {
    title: 'Prefetch on intent',
    description:
      'Start loading what a click will open while the pointer moves toward it or the keyboard selects it, so it shows at once. Folder listings follow this switch; files and diffs each have their own switch below.',
    keywords: ['prefetch', 'preload', 'hover', 'intent', 'speed', 'latency'],
  },
  'prefetch.files': {
    title: 'Prefetch files',
    description:
      'Read a file and colour its syntax while the pointer heads for its tree row, tab or definition link.',
    keywords: ['prefetch', 'preload', 'files', 'tree', 'tabs', 'hover', 'syntax'],
  },
  'prefetch.diffs': {
    title: 'Prefetch diffs',
    description:
      'Load changes, commit files and checkpoint diffs when their rows are hovered or active.',
    keywords: ['prefetch', 'preload', 'diffs', 'git', 'history', 'checkpoints'],
  },
  'files.autoSave': {
    optionTitles: {
      off: 'Off',
      afterDelay: 'After a delay',
      onFocusChange: 'When the editor loses focus',
      onWindowChange: 'When the window loses focus',
    },
    description: 'Save edited files automatically, and when.',
    keywords: ['autosave', 'save', 'files', 'automatic'],
  },
  'files.autoSaveDelay': {
    description:
      'Milliseconds after your last edit before an automatic save, when saving after a delay.',
    keywords: ['autosave', 'delay', 'debounce', 'files'],
  },
  'files.picker.pinnedLocations': {
    title: 'Pinned picker locations',
    description:
      'Folders pinned to the top of the file picker sidebar on this machine, as paths from the browsable root.',
    keywords: ['files', 'folders', 'picker', 'pin', 'favorites', 'sidebar', 'places'],
  },
  'files.picker.hiddenLocations': {
    title: 'Removed picker locations',
    description:
      'Places, project folders and drives removed from the file picker sidebar on this machine, as paths from the browsable root.',
    keywords: ['files', 'folders', 'picker', 'hide', 'remove', 'sidebar', 'places'],
  },
  'files.picker.view': {
    optionTitles: { auto: 'Auto', columns: 'Columns', list: 'List', icons: 'Icons' },
    title: 'File picker view',
    description:
      'How the file picker shows a folder: columns, a list, or icons. Auto uses columns when choosing a folder and a list when choosing a file.',
    keywords: ['files', 'folders', 'picker', 'columns', 'list', 'icons', 'finder'],
  },
  'files.previewKilobytes': {
    title: 'Text preview size',
    description:
      'Kilobytes of a text file the file picker and quick open read for their preview. A longer file shows its first part and says how much of it that is.',
    keywords: ['files', 'preview', 'picker', 'quick open', 'size', 'kilobytes'],
  },
  'files.showHidden': {
    title: 'Show hidden files in pickers',
    description: 'Show dot-prefixed files and folders in file pickers.',
    keywords: ['files', 'folders', 'hidden', 'dotfiles', 'picker'],
  },
  'files.readSessionLimit': {
    title: 'Open large-file read sessions',
    description:
      'Maximum number of open large-file read sessions and simultaneous page reads on this machine. Lowering the limit applies to new reads and sessions.',
    keywords: ['files', 'large', 'pages', 'memory', 'limit'],
  },
  'files.readRangeSizeKiB': {
    title: 'Large-file page size limit',
    description:
      'Maximum byte range in KiB returned by one large-file read request. Each simultaneous read holds at most one range in memory.',
    keywords: ['files', 'large', 'pages', 'memory', 'limit'],
  },
  'files.readSessionIdleMinutes': {
    title: 'Large-file read session idle time',
    description:
      'Minutes a large-file read session remains open after its last page request. Reopening an expired view starts a new session.',
    keywords: ['files', 'large', 'pages', 'memory', 'limit'],
  },
  'files.watchDirectoryLimit': {
    title: 'Folder watch limit',
    details:
      "Each watched folder uses one inotify watch from a per-user pool that every watcher on the machine shares (524,288 on the owner's machine). Opening /work took 484,687 watches and other apps began failing with ENOSPC. 200,000 fits four roots the size of the Platform checkout (45,036 folders) and leaves 62% of the pool free.",
    description:
      'How many folders all open workspaces may watch for live changes together. A workspace that would pass it updates its top level and open files only.',
    keywords: ['files', 'watch', 'watcher', 'inotify', 'limit', 'large', 'folders', 'live'],
  },
  'files.searchIndexLimit': {
    title: 'Search index limit',
    description:
      'How many open folders keep a file index for fast search at once. Opening one more drops the least recently used index; search there reads the disk until the folder is opened again.',
    keywords: ['files', 'search', 'index', 'limit', 'memory', 'folders', 'quick open'],
  },
  'files.searchIndexIdleMinutes': {
    title: 'Search index idle time',
    description:
      'Minutes a folder keeps its file index after the last window showing it closes, so reopening it searches at full speed at once.',
    keywords: ['files', 'search', 'index', 'idle', 'warm', 'folders', 'quick open'],
  },
  'lsp.experimental.tyForPython': {
    // Honest about the pooling: matching is re-run per file, but a language
    // server already running for a folder is reused by key, so an open Python
    // file keeps whichever server it started with.
    description:
      'Run ty as the Python language server. Off runs pyright. Files already open keep their current server until reopened.',
    keywords: ['lsp', 'python', 'ty', 'pyright', 'experimental'],
  },
  'lsp.idleTimeoutMs': {
    description:
      'Milliseconds an unused language server stays alive after the last editor disconnects. 0 shuts it down immediately.',
    keywords: ['lsp', 'idle', 'timeout', 'memory', 'process'],
  },
  'lsp.downloadRuntimes': {
    description:
      'Download missing language servers on demand. Off means only servers already on PATH are used.',
    keywords: ['lsp', 'download', 'install', 'offline', 'network'],
  },
  'lsp.servers': {
    description:
      'Per-server overrides: extensions and feature ranks apply when a document is matched; command, env, and initialization apply on the next backend start. Set a feature to null to exclude that server. A running backend keeps its old process options until it idles out.',
    keywords: ['lsp', 'language server', 'command', 'override', 'disable'],
  },
  'lsp.languageServers': {
    description:
      "Which language servers may serve a file type, keyed by extension ('.json'). Values are server ids in preference order, '!id' drops a server, and '...' keeps the rest. Naming a registered server explicitly enables it for matching file types even without its project marker. Open documents keep their current servers until reopened.",
    keywords: ['lsp', 'language server', 'disable', 'json', 'biome', 'eslint'],
  },
  'lsp.semanticTokens.enabled': {
    details:
      "Server colour paints over the syntax highlighter's colour. On a first open with no saved paint, a warm server can answer before the highlighter has run, so identifiers take colour while the rest of the text is still plain, for up to about a second and a half. Reopening a file with a saved paint is unaffected.",
    description:
      'Ask language servers to colour identifiers they have actually resolved. Off means no token request is ever sent. Each server still has its own default under lsp.semanticTokens.servers.',
    keywords: ['lsp', 'semantic', 'tokens', 'highlighting', 'colour', 'color'],
  },
  'lsp.semanticTokens.delta': {
    details:
      "Measured with rust-analyzer on hashbrown's map.rs (197 KB, 11,978 tokens) over twelve keystrokes: whole files cost 1.60 MB, 14.1 ms of JSON.parse and 9.0 MB of heap; deltas cost 1.9 KB, 0.1 ms and 2.0 MB, at the same latency. About 5 of 37 servers support delta.",
    description:
      'Ask language servers that support it for only the tokens an edit changed. Saves network, parsing time and memory on every keystroke.',
    keywords: ['lsp', 'semantic', 'tokens', 'delta', 'bandwidth', 'memory'],
  },
  'lsp.semanticTokens.servers': {
    details:
      'Six servers are measured and on by default: rust-analyzer 1.88.0, gopls v0.21.0, clangd, zls 0.16.0, terraform-ls and typescript-language-server. A server nobody has measured stays off until named here.',
    description:
      "Server id to true or false, overriding the per-server default. Turns one server's semantic colour on or off while the feature stays on.",
    keywords: ['lsp', 'semantic', 'tokens', 'server', 'override'],
  },
  'providers.acpOperationTimeoutMs': {
    title: 'ACP operation timeout',
    description:
      'Milliseconds an ACP agent has to initialize, change configuration or drain a cancelled turn. Active answers wait until they finish or you stop them.',
    keywords: ['provider', 'acp', 'timeout'],
  },
  'providers.usageRefreshSeconds': {
    title: 'Native usage refresh interval',
    description:
      'Seconds between native Claude and other provider usage reads. Claude also respects the full quota refresh interval as its maximum wait. Cached observations can update between quota requests. Feed reads return persisted observations.',
    keywords: ['usage', 'quota', 'cache'],
  },
  'providers.codexUsageRefreshSeconds': {
    title: 'Enabled Codex quota interval',
    description:
      'Seconds between genuine quota reads for enabled Codex accounts. The full quota refresh interval bounds their maximum wait. Parked accounts use the full interval. Feed reads return persisted observations.',
    keywords: ['usage', 'codex', 'quota'],
  },
  'providers.usageFailureCooldownSeconds': {
    title: 'Usage failure cooldown',
    description: 'Seconds before retrying a failed account usage request.',
    keywords: ['usage', 'quota', 'cache'],
  },
  'providers.usageStaleAfterSeconds': {
    title: 'Usage observation age',
    description: 'Seconds an observed quota remains current before its window is marked stale.',
    keywords: ['usage', 'quota', 'cache'],
  },
  'providers.transcriptHistoryRefreshSeconds': {
    title: 'Transcript history refresh',
    description: 'Seconds between bounded local transcript scans.',
    keywords: ['usage', 'quota', 'cache'],
  },
  'providers.transcriptHistoryMaxBytes': {
    title: 'Transcript scan byte budget',
    description: 'Maximum transcript bytes read in one local history scan.',
    keywords: ['usage', 'quota', 'cache'],
  },
  'providers.transcriptHistoryMaxFiles': {
    title: 'Transcript scan file budget',
    description: 'Maximum transcript files visited in one local history scan.',
    keywords: ['usage', 'quota', 'cache'],
  },
  'providers.proxyUsageRequestIntervalHours': {
    title: 'Full quota refresh interval',
    description:
      'Hours between parked Codex full quota reads and the maximum wait between enabled Codex or Claude quota reads. Enabled Codex and Claude can refresh sooner at their own intervals. Failed reads back off and resume by the full refresh interval.',
    keywords: ['usage', 'codex', 'proxy', 'quota', 'cap'],
  },
  'providers.proxyUsageUrl': {
    title: 'Proxy usage management address',
    description:
      'Local CLIProxyAPI management address for pooled Codex quotas and capped requests. Its management key is kept in the secret store.',
    keywords: ['usage', 'codex', 'proxy', 'quota'],
  },
  'providers.proxyUsageProviderInstanceIds': {
    title: 'Proxy quota source instances',
    description:
      'Optional enabled Codex instances whose allowance comes from the proxy account group. Selecting an instance pauses its native quota collection. Proxy accounts also appear independently.',
    keywords: ['usage', 'codex', 'proxy', 'quota'],
  },
  'providers.instances': {
    description:
      'Your agent providers, such as Codex and Claude, in the order the model picker shows them.',
    keywords: ['provider', 'agent', 'codex', 'claude', 'model'],
  },
  'models.hidden': {
    // Stored as a denylist because that is the only shape where a model the
    // provider starts offering next week appears on its own. An allowlist would
    // have to materialise every other model the first time one was turned off,
    // and then go quiet about everything added afterwards.
    title: 'Models',
    details:
      'Only turned-off models are stored, so a model a provider adds later appears in the picker on its own.',
    description:
      'Which models the picker offers, and in what order. Turn one off to keep it out of the picker.',
    keywords: ['model', 'hide', 'show', 'visible', 'order', 'sort', 'picker'],
  },
  'models.order': {
    description:
      'Explicit leading order for the picker. Models named by neither list stay visible after these, in provider order.',
    keywords: ['model', 'order', 'sort', 'picker'],
  },
  'models.favorites': {
    description:
      'Models starred as favorites. The picker lists them first and gathers them under Favorites.',
    keywords: ['model', 'favorite', 'star', 'pin', 'picker'],
  },
  'keybindings.preset': {
    optionTitles: { ours: 'Ours', zed: 'Zed', vscode: 'VS Code' },
    title: 'Keyboard mode',
    description:
      'The shortcuts your contextual bindings build on. Ours starts with Zed’s keys; Zed tracks its defaults; VS Code uses its editing and app shortcuts.',
    keywords: ['keybinding', 'shortcut', 'preset', 'zed', 'vscode', 'keymap'],
  },
  'keybindings.overrides': {
    title: 'Shortcuts',
    description: 'Shortcuts and the focus contexts where they apply.',
    details:
      'An ordered list of {keys, command, context?} or {keys, unbind, context?}. A null command reserves the keys; unbind removes the named key and command pair. Context is a focus predicate such as Editor or Workspace > Terminal. User bindings win at equal depth; deeper bindings take precedence.',
    keywords: ['keybinding', 'shortcut', 'hotkey', 'chord', 'keymap'],
  },
} satisfies { readonly [K in SettingId]: SettingDocumentation }

export function presentSetting<K extends SettingId>(
  id: K,
): SettingsRegistry[K] & SettingPresentation & SettingDocumentation {
  const documentation: SettingDocumentation = SETTINGS_DOCUMENTATION[id]
  return { ...descriptorFor(id), ...presentationFor(id), ...documentation }
}
