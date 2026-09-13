# Command / keymap / focus runtime — end to end

Scope: `apps/web/src/keymap/**`, `apps/web/src/lib/focus/**`, `apps/web/src/app-keymap-controller.tsx`, the command-palette feature, the `keybindings.overrides` settings entry, and plan 056. All paths below are under `/work/projects/platform/` unless absolute.

Verified by execution, not just reading: I imported the table, default bindings, override resolver, trie, chord machine, when-clauses, formatter and `CommandBus` under plain `bun --bun` with **no DOM** (`typeof document === 'undefined'`) and they all ran (`scratchpad/understand/verify-pure.ts`, `dump-bindings.ts`). Counts: **142 command rows**; default binding tables of **125 (mac) / 108 (linux) / 106 (windows)** entries, of which 9 / 8 / 8 are command-less "reserved" bindings.

---

## 1. Layer map

```
packages/contracts/src/settings.ts          keybindingChordSchema, MAX_KEYBINDING_CHORD_STROKES=2, KeybindingOverrides
packages/contracts/src/settings/keys.ts     'keybindings.overrides' registry entry (:594-608)

apps/web/src/keymap/
  define-command.ts     row types, CommandWhen union, defineCommand / defineEditorCommand
  workspace-commands.ts 57 'workspace.*' rows WITH run() handlers (pure data + closures over a Runtime interface)
  editor-commands.ts    85 'editor.*' rows, NO handlers (dispatched to a focus target's editor capability)
  table.ts              platformCommands = [...workspace, ...editor]; byId map; palette projections
  command-registry.ts   CommandSpec = "what it is called" projection (palette/menus)
  types.ts              KeyChord, PlatformKeyBinding, KeyBindingKeyboardEvent (DOM-free event shape), CommandKeyBinding
  default-bindings.ts   table rows -> PlatformKeyBinding[] per platform, plus reservedBrowserHotkeys
  active-bindings.ts    user override resolution + collision/shadow policy + per-pane arbitration + settings rows
  utils/chord.ts        stroke grammar: chordKeys, isBindableChord, parsedChord, normalizedChord, keysConflict, isChordPrefix
  utils/keymap-trie.ts  buildKeymapTrie(bindings, platform) + trieStep(node, event)   (pure matcher)
  utils/chord-machine.ts chordTransition(trie, pending, event, targetsTextEntry, now) -> ChordAction   (pure state machine)
  utils/when.ts         commandWhenDisabledReason(conditions, snapshot, target)   (pure enablement)
  utils/format-keys.ts  formatChord / commandShortcut / hotkeyTokenLabel   (pure display)
  utils/app-bindings.ts appKeyBindingsForPane = arbitrate-then-filter-out-single-stroke-editor-bindings
  utils/keyboard-event.ts eventTargetsTextEntry(KeyboardEvent)   (DOM)
  editor-keymap.ts      bridge: single-stroke editor.* bindings -> @singapore-editor/core EditorKeymapLayer[]
  state/command-bus.ts  generic CommandBus<Id,Runtime,Snapshot,Target,Invocation>: inspect() + dispatch()   (pure, injectable)
  state/runtime.ts      Platform-specific bus adapters: captureCommandSnapshot, resolveCommandTarget, dispatchEditor
  state/runtime-binding.ts  createCommandRuntimeBinding(): a mutable slot the provider binds the live Runtime into
  state/chord-session.ts    DOM listener lifecycle around chordTransition (document/window listeners, timers, keyup tracking)
  use-app-keymap.ts     React hook: builds trie per (bindings, focusedPane), owns one chord session
  providers/bus-provider.tsx    <CommandBusProvider> — constructs the bus once (main.tsx:91)
  providers/command-provider.tsx <CommandProvider> — builds the Runtime, resolves bindings, owns palette/settings-dialog state
  providers/command-context.ts  CommandContextValue (bindings, bus, claimKeybinding, palette state, pendingChord)
  hooks/use-command.ts, hooks/use-bus-binding.ts
  components/pending-chord-indicator.tsx + ../app-keymap-controller.tsx  (the "Ctrl+K pressed…" pill)

apps/web/src/lib/focus/
  state/service.ts      FocusService: target registry, ownership, request/transition protocol, resolveTarget()
  hooks/use-target.ts   useFocusTarget(): registers a DOM element as a target
  hooks/use-service.ts, hooks/use-snapshot.ts, providers/provider.tsx (installs one `focusin` capture listener)
  utils/active-surface.ts matchesActiveSurface(target, identity)   (pure)
```

Mount order (`apps/web/src/main.tsx:86-98`): `FocusProvider` > `HotkeysProvider` (TanStack; vestigial — nothing calls `useHotkey`) > `CommandBusProvider binding={application.commandBinding}`. `CommandProvider` mounts lower, inside `AppRuntimeContent` (`components/app-runtime-content.tsx:33`), because it needs editor/settings stores. The bus is app-lifetime; the runtime is re-bound per environment (`state/application-runtime.ts:22,45,58` clears the binding on environment switch, which makes `inspect()` answer `'The environment is switching.'`).

---

## 2. Command definition table shape

### 2.1 Row type (`keymap/define-command.ts:139-174`)

```ts
type CommandBase<Id> = {
  id: Id; title: string; description?: string; category: string
  aliases?: readonly string[]          // "never set today", palette keyword hook (:144)
  vscodeCommandIds?: readonly string[] // palette keywords + import/export aliases
  icon?: Icon                          // @phosphor-icons/react component (React!)
  keys?: readonly CommandKeyDefault[]  // default bindings, see 2.3
  execution: 'async' | 'sync'
  target: 'editor' | 'workspace'
  undoCategory: 'file-operation' | 'text-edit' | 'view-only' | 'workspace-operation'
  when: readonly CommandWhen[]         // closed union, see §3
  keepsPaletteOpen?: boolean           // running it only switches palette mode
  hiddenInPalette?: boolean            // not offered in the '>' list
}
WorkspaceCommand<Id, Execution> = CommandBase & { run: (ctx: WorkspaceCommandHandlerContext) => Execution extends 'sync' ? ImmediateCommandDisposition : AsyncCommandStart }
EditorCommand<Id>                  = CommandBase & { execution: 'sync'; target: 'editor' }   // no run
```

- `defineCommand` (`:176-181`) is an identity function constraining `Id extends \`workspace.${string}\``.
- `defineEditorCommand` (`:190-210`) takes a bare `EditorCommandId` from `@singapore-editor/core` (so a row can only name something the editor implements — the union is at `/work/projects/Editor/packages/editor/src/editor/commands.ts:10-127`), prefixes it to `editor.${id}`, forces `category:'Editor'`, `execution:'sync'`, `target:'editor'`, stamps `pane:'editor'` on every key, and derives `when`: `['editorTarget']`, plus `'editorWritable'` iff `undoCategory === 'text-edit'`. Pinned by test `keymap/tests/command-table.test.ts:228-236`.
- Note the double prefix: VS-Code-shaped editor ids become `editor.editor.action.deleteLines` (`command-table.test.ts:36-41`).

### 2.2 Table and projections (`keymap/table.ts`)

- `platformCommands = [...workspaceCommands, ...editorCommands]` (`:7`); `CommandEntry` is the row union; `platformCommand(id)` is a Map lookup (`:12-16`). Array order matters: it is the tie-break for equal-priority bindings on one key (plan 056 "positional, not principled").
- `commandIcons` record (`:36`), `paletteModeCommandIds` (rows with `keepsPaletteOpen`), `hiddenPaletteCommandIds` (`:53-54`).
- `command-registry.ts:4-11` `CommandSpec = {id,title,category,description?,aliases?,vscodeCommandIds?}` — the palette/menus read this "what it is called" view; `commandHotkeyMeta(id)` (`:19-28`) feeds `PlatformKeyBinding.meta`.
- Invariants pinned by `keymap/tests/command-table.test.ts`: unique ids (:189), exactly 142 rows (:197), exact async set (:210), exact undo-category sets, exact `when` sets per condition (:238-245), the 9 reserved hotkeys (:259-272), session commands hidden from palette (:274-291).

### 2.3 Default-key entry (`define-command.ts:50-58`)

```ts
CommandKeyDefault = { chord: KeyChord; pane?: FocusArea | 'any'; platforms?: ('linux'|'mac'|'windows')[]; preventDefault?; stopPropagation?; vscodeCommandId? }
KeyChord = readonly [RegisterableHotkey, ...RegisterableHotkey[]]   // types.ts:51 — a plain hotkey is a chord of one
```

### 2.4 Handler context (`define-command.ts:60-137`)

`WorkspaceCommandHandlerContext = { invocation, runtime: WorkspaceCommandRuntime, snapshot: WorkspaceCommandSnapshot, target: PlatformCommandTarget }`.

- `WorkspaceCommandSnapshot` (`:60-75`): `activeDocumentSavable, activeFilePath, activeTabId, chatMode, chatModePanels, diffViewMode, rootPath, uiMode, wallpaperEnabled, workbenchPanels, workspaceOpen, workspaceEditRedoable, workspaceEditUndoable, workspaceMutable`. Captured per dispatch by `state/runtime.ts:41-66` from the Zustand workspace store, the document store, the settings mirror and the workspace-edit service.
- `WorkspaceCommandRuntime` (`:77-117`): `documents{queryClient,store}`, `editor: EditorCommands` (tab/file ops), `files.openFileAtRef`, `focus: FocusService`, `settings{readSnapshot,setDiffViewMode,setTheme,setWallpaperEnabled}`, `shell{openPicker,openWorkspaceRoot,showCommandPalette,showSettings}`, `tabs.requestCloseTab`, `workspace: EditorWorkspaceStoreApi`, `workspaceEdits`. Built once in `providers/command-provider.tsx:181-250` with every method routed through a `adaptersRef` so the object identity is stable while hooks re-render.
- `PlatformCommandTarget` (`:119-130`): `{kind:'workspace', logIdentity:'workspace'}` or `{kind:'editor', focusTarget: ResolvedFocusTarget, token, writable, logIdentity}`.

### 2.5 Dispositions (`state/command-bus.ts:32-61`)

`ImmediateCommandDisposition = handled | deferred('dirty-close') | unhandled('handler-declined')`; `AsyncCommandStart` adds `{status:'started', completion: Promise<AsyncCommandSettlement>}`; settlements add `cancelled('domain-discarded')` and `failed({owner:'command-bus'|'domain'})`. `CommandOutcome` adds `disabled(reason)` and `unhandled('target-unavailable')`. `dispatch()` returns `CommandDispatchTicket = { claimed: boolean; completion: Promise<CommandOutcome> }` — **`claimed` is decided synchronously** and is what lets the key listener `preventDefault` in the same tick (`command-bus.ts:302-311`, `chord-session.ts:126-131`).

Handler idioms in `workspace-commands.ts:91-297`: `handled`/`declined` constants, `operationStart(promise<boolean>)`, `focusStart(runtime, destination, intent)` (command completes when the FocusService acknowledges the transition; `superseded` -> `cancelled`, `rejected` -> `declined`, `:189-199`), `settingStart(submission)` (`:201-220`, maps settings mutation settlement to bus settlement), `focusActiveSurface` (`:222-258`), `focusWorkbench` (`:272-283`, uses `lastCommandTarget`).

---

## 3. Enablement: `when` clauses and the inspect pipeline

### 3.1 The `CommandWhen` union (`define-command.ts:29-39`)

Ten closed conditions, no expression language: `chatMode | editorTarget | editorWritable | fileBackedTab | saveableTab | tabOpen | workspaceOpen | workspaceEditRedoable | workspaceEditUndoable | workspaceMutable`. Plan 056 §"Architecture boundary" forbids adding "a context-expression evaluator"; extend the union when a command needs a new fact.

### 3.2 Evaluation (`utils/when.ts`)

`commandWhenDisabledReason(conditions, snapshot: CommandWhenSnapshot, target: CommandWhenTarget): string | null` (`:36-47`) returns the **first** failing condition's user-facing reason from `commandWhenDisabledReasons` (`:23-34`, e.g. `'No workspace open.'`, `'The active editor is read-only.'`). `CommandWhenSnapshot` (`:7-16`) is a narrow subset of the full snapshot; `CommandWhenTarget = {kind, writable?}` (`:18-21`). `fileBackedTab`/`saveableTab` delegate to `features/editor/utils/file-backed-document.ts:20-50` (prefix tests on synthetic document ids — pure strings, but it drags in seven feature prefix constants).

### 3.3 `CommandBus.inspect` (`state/command-bus.ts:239-268`)

Order: `lookup(id)` (unknown -> `'Command is not registered.'`) -> `captureRuntime()` (null -> `'The environment is switching.'`) -> `captureSnapshot(runtime, invocation)` -> `resolveTarget({entry, invocation, runtime, snapshot})` (null or kind mismatch -> `'No compatible command target is available.'`) -> `commandWhenDisabledReason(entry.when, snapshot, target)`. Returns `ReadyCommandInspection | DisabledCommandInspection` (`:132-168`).

`dispatch` (`:270-311`): inspect; if disabled -> `{claimed:false}`; `targetIsAvailable(target, runtime)` (Platform: `target.kind==='workspace' || focus.isRegistered(token)`, `bus-provider.tsx:29-30`) else `unhandled('target-unavailable')`; then `#execute` — editor rows go through `dispatchEditor(entry, ctx)` (boolean -> handled/handler-declined), workspace rows call `entry.run(ctx)`. Every path ends in `#finish` which emits **one wide event** `action:'command.dispatch', area:'command'` with `commandId, execution, commandSource, menuSurface|sourceCaller, targetIdentity, targetKind, undoCategory, outcome, durationMs, disabledReason|reason|errorCategory` (`:446-510`). Bus-owned failures are also passed to `reportError` (default: toast via `lib/client-error-taxonomy.ts`).

`CommandBusOptions` (`:194-218`) — everything is injected: `captureRuntime, captureSnapshot, createEvent?, dispatchEditor, lookup, now, reportError?, resolveTarget, targetIsAvailable, toClientError?`. My verify script built a bus with a fake runtime and no DOM and got `claimed:true, {status:'handled'}`.

### 3.4 `CommandSource` / invocation (`command-bus.ts:20-30`)

`source: keybinding | menu{surface: MenuSurfaceId} | palette | programmatic{caller}`; `invocation.event?` (the KeyboardEvent, used as a focus-path source) and `invocation.origin?` (a `FocusTargetToken` captured when the palette/menu opened). `MenuSurfaceId` is the 15-value union at `types.ts:34-49`.

### 3.5 Platform target resolution (`state/runtime.ts:72-96`)

Workspace commands always get `{kind:'workspace'}`. Editor commands ask `focus.resolveTarget({compatible: editorTarget, exact: exactActiveEditor(snapshot), origin: invocation.origin, path: invocation.event})` and require `capabilities.editor`; `writable` comes from the capability. `exactActiveEditor` (`:144-158`) matches the target's `tabId`/`layout`/diff key against the snapshot. `dispatchEditor` (`:98-113`) strips the `editor.` prefix and calls `capability.dispatch(editorId, {event})`.

---

## 4. Bindings: parse, resolve, arbitrate, match, chord

### 4.1 Binding record (`types.ts:53-63, 81-87`)

```ts
PlatformKeyBinding = { keys: string /* canonical, space-joined, platform-normalized */; chord: KeyChord; command: PlatformCommandId | null; pane?: FocusArea|'any'; source: 'default'|'user'; vscodeCommandId?; preventDefault?; stopPropagation?; meta? }
ParsedPlatformKeyBinding = { binding; firesWhileTyping: boolean /* first stroke has ctrl|meta or key==='Escape' */; steps: [ParsedHotkey, ...] }
```

`keys` is the collision key, stored value, search haystack and display source (plan 056 "Contract change"). On linux/windows `Control+Y` normalizes to `Mod+Y` (seen in the dump), so `keys` is platform-specific; `chord` keeps the authored spelling.

### 4.2 Defaults (`default-bindings.ts`)

`defaultPlatformKeyBindings(platform = detectPlatform())` (`:23-30`) flattens every row's `keys[]` filtered by `platforms` (`:84-88`), computing `keys = chordKeys(chord, platform)` (`utils/chord.ts:22-24`, `normalizeRegisterableHotkey` per stroke joined with `' '`), `pane ?? 'any'`, `source:'default'`. Then appends `reservedBrowserHotkeys` (`:94-108`): 9 command-less bindings with `preventDefault+stopPropagation` that swallow browser-hostile keys (`Control+Tab, Control+Q, Mod+Alt+Tab(mac), Mod+Shift+T, Mod+1/2/3, Mod+W, F12@editor`). A no-op binding is dispatched as "claimed" without a command (`chord-session.ts:126-128`).

### 4.3 Stroke grammar (`utils/chord.ts`)

TanStack `@tanstack/hotkeys@0.8.0` supplies the grammar only: `parseHotkey`, `normalizeRegisterableHotkey`, `validateHotkey`, `rawHotkeyToParsedHotkey`, `isModifierKey`, `normalizeKeyName`, `PUNCTUATION_CODE_MAP`, `detectPlatform`. Its dispatchers (`HotkeyManager`, `SequenceManager`, `matchesKeyboardEvent`) are deliberately **not** used (plan 056 "Why not the library's SequenceManager"; `matchesKeyboardEvent` rejected for regressing Hebrew/Cyrillic fallback).

- Hotkey spelling: `Mod+Shift+K`, `Control+J`, `Alt+ArrowUp`, `F1`, `Escape`, `Mod+[`, `Mod+\\`. `Mod` = Meta on mac, Control elsewhere. Modifier order canonicalized Mod/Control, Alt, Shift.
- Chord string: strokes joined by a single space; `MAX_CHORD_STROKES = MAX_KEYBINDING_CHORD_STROKES = 2` (`chord.ts:14`; contract `settings.ts:108`), `CHORD_TIMEOUT_MS = 5000` (`:15`, a constant by design — no inert setting).
- `isBindableChord(keys)` (`:26-34`): each stroke passes `validateHotkey` with zero warnings (unknown key names are fatal), at most 2 strokes, and a multi-stroke chord's **first stroke must carry Ctrl or Meta** (hygiene rule 3a — a bare-key prefix could never arm inside a text field).
- `keysConflict(a,b)` (`:46-51`): equal, or one is a space-delimited prefix of the other. `isChordPrefix(keys, table)` (`:53-57`) is what the recorder uses to wait for a second stroke.
- `parsedChord`/`normalizedChord` (`:37-44`) re-spell a user string canonically; `parsedChord` is "call only after `isBindableChord`".

### 4.4 User overrides and collision policy (`active-bindings.ts`)

Settings value `KeybindingOverrides = Record<commandId, string | null>` (contract `settings.ts:120-123`; regex shape `/^\S+(?: \S+)?$/` at `:111`, max 64 chars, command-id regex). `resolvedPlatformKeyBindings(defaults, overrides, platform)` (`:49-55`):

1. `appliedOverrides` (`:219-233`) drops overrides naming a command not in this build or a chord that fails `isBindableChord`.
2. If no overrides: **early return of the defaults untouched** (`:109`) — the collision fold never runs for default users; the trie arbitrates instead (rule 2/4).
3. An override **replaces all defaults** of its command (`:112`); `null` unbinds (`:253`). The user binding inherits pane/preventDefault/stopPropagation/vscodeCommandId from the first default as a template (`:257-272`), else `pane` = `'editor'` for editor-target commands, `'any'` otherwise (`:275-277`).
4. `liveKeyBindings` (`:132-163`): a user binding claims its key; any binding it conflicts with (`keysConflict` AND same pane, `:172-176`) is **dropped** and recorded in `shadowedBy` (loser -> winner). Later override in document order wins between two overrides. Rationale in the comment `:120-131`: the matcher reaches exactly one binding per pane+key, so a kept loser would be advertised everywhere and do nothing.
5. `commandKeyBindings(defaults, overrides)` (`:76-101`) produces the settings rows `CommandKeyBindingRow = {command, defaultKeys[], keys|null, source, effectiveKeys[], shadowedBy|null}` read back from the resolved table so the editor shows what is in force. Verified: overriding `saveFile` to `Mod+B` yields `toggleSidebarVisibility` row `{keys:'Mod+B', effectiveKeys:[], shadowedBy:'workspace.saveFile'}`.

### 4.5 Per-pane arbitration (`active-bindings.ts:57-68, 191-217`)

`activePlatformKeyBindings(bindings, focusedPane)` keeps, per `keys`, the binding with highest priority: focused-pane match = 2, `any`/unset = 1 (the `0` branch is unreachable). Ties (`>` strict) resolve to the later array entry, i.e. editor rows beat workspace rows on equal priority. Then `appKeyBindingsForPane` (`utils/app-bindings.ts:6-17`) removes **single-stroke `editor.*` bindings** (those go to the Editor's own keymap layer via `editor-keymap.ts`) but keeps multi-stroke editor chords for the app trie. **Order is load-bearing**: arbitrate then filter, or `Mod+[`/`Mod+]` (workspace navigateBack/Forward) resurrect inside the editor pane and break indent/outdent (plan 056 rule 6, measured).

### 4.6 Trie (`utils/keymap-trie.ts`)

`buildKeymapTrie(bindings, platform): {root, dropped}` (`:58-71`): inserts shorter chords first so a complete binding wins over a chord that would only swallow its prefix (`:64-69`, `insertBinding` refuses to descend through a node that already holds a binding `:114`); dropped chords are logged as `keymap.prefix-conflict` (`use-app-keymap.ts:56-65`). Node: `next: Map<key, StrokeEdge[]>` keyed by normalized key name with a per-edge modifier bitmask (alt=1, ctrl=2, meta=4, shift=8, `:168-170`), `binding`, `continuations` (count of reachable bindings — shown as "N available" in the indicator).

`trieStep(node, event: KeyBindingKeyboardEvent)` (`:73-85`): match on `normalizeKeyName(event.key)` + mask; if no edge and the printed key is **not** a Latin letter, fall back to the physical key from `event.code` via `physicalKeyName` (`active-bindings.ts:356-371`: `KeyZ`->`Z`, `Digit1`->`1`, punctuation map). AZERTY guard: Latin letters own their printed value so `Z` never activates physical `W` (`:78-79`). Returns `miss | arm{keys,node,firesWhileTyping} | run{binding,firesWhileTyping}`.

### 4.7 Chord state machine (`utils/chord-machine.ts`) — pure

```ts
chordTransition(trie, pending: PendingChord|null, event: KeyBindingKeyboardEvent, targetsTextEntry: boolean, now: number): ChordAction
ChordAction = ignore | swallow | arm{pending} | run{binding, fromChord} | cancel{outcome: 'unmatched'|'timeout'}
PendingChord = { matched: [string,...], node, armedAt }
```

Rules (`:38-87`, mirroring plan 056 §Semantics rules 7-14): IME (`isComposing || keyCode===229`) -> ignore; modifier-only key -> swallow while armed, ignore otherwise; unarmed: trie miss -> ignore, `!firesWhileTyping && targetsTextEntry` -> ignore, run -> run, repeat -> ignore, else arm; armed: repeat -> swallow, `now - armedAt >= 5000` -> cancel(timeout), miss -> cancel(unmatched) (Escape falls out of this with no special case), run -> run(fromChord), else arm deeper. Verified chain: `Ctrl+K` -> arm `['Mod+K']`; `Ctrl+X` -> run `workspace.saveFile` (after overriding it to `Mod+K Mod+X`); `q` -> cancel unmatched; 6 s later -> cancel timeout; `Ctrl+P` in a text field -> run (Mod chords fire while typing); bare `Escape` in the global pane -> ignore.

### 4.8 Chord session (`state/chord-session.ts`) — DOM

Wraps the machine with everything browser-specific: `document keydown` bubble listener (`:238`) for the unarmed path; a `document keydown` **capture** listener installed synchronously when armed or while a chord-claimed key is held (`:38-45`, so the continuation is consumed before React renders and before the editor's inner listeners); `keyup` capture to swallow the release of a key whose press was claimed (Kitty keyboard protocol in Ghostty would otherwise deliver it, `:139-146`); a real `setTimeout` (`:81`); cancellations on `window blur`, `visibilitychange` hidden, `pointerdown` capture, and a synchronous `FocusService.subscribe` that disarms when the owner token changes (`:209-211`, rule 15); a `WeakMap<KeyboardEvent, boolean>` so the terminal capture and the document listener share one decision per event (`:35, :137`, rule 22); per-`code` ownership map (`'binding' | 'chord'`) so a held key stays claimed until release even after the chord expires (`:164-168`). One wide event per chord lifecycle `keymap.chord` with `prefix, pane, candidateCount, outcome, elapsedMs, strokeCount, command` (`:58-64, :72-77`). The completing/arming strokes call `preventDefault + stopPropagation(+Immediate)` unconditionally; a single-stroke run only suppresses the event if `dispatch(...).claimed` is true (`:126-131`).

`use-app-keymap.ts` builds the trie via `useMemo` per `(bindings, focusedPane, platform)` and owns one session for the provider lifetime; `CommandProvider` passes `focusedPane = focusSnapshot.currentOwner?.area ?? 'global'` and `focusedTarget` (`command-provider.tsx:259-265`). `claimKeybinding(event)` is exported on the context so the terminal host can call it from its own capture listener before Ghostty encodes input (`features/terminal/hooks/use-keybindings.ts:5-26`).

### 4.9 Editor layer bridge (`keymap/editor-keymap.ts`)

Single-stroke `editor.*` bindings are converted to `@singapore-editor/core` `EditorKeyBinding {hotkey, command, preventDefault?, stopPropagation?}` (`Editor/packages/editor/src/editor/keymap.ts:33-38`) grouped into pack layers by `editorKeymapLayersForBindings(..., {idPrefix:'platform', source:'app'})` (`:249-268`); consumed by `components/app-workspace.tsx:18` and, readonly-filtered by pack (`readonlySafeEditorCommandPacks`, `keymap.ts:216-223`), by `features/search/components/result-editor-surface.tsx:67`. The editor mounts with `defaultBindings:false` so Platform authors 100% of editor keys. Chords cannot be expressed as an `EditorKeyBinding` (`editor-keymap.ts:29-30`), so multi-stroke editor commands dispatch through the bus to the focused editor target's capability instead.

---

## 5. Focus: targets, registration, ownership, transitions (`lib/focus/state/service.ts`)

### 5.1 Vocabulary

- `FocusArea` (`:14-26`): `chat | command-palette | dialog | editor | file-tree | git | global | logs | problems | search | settings | terminal`. This is the `pane` axis of bindings.
- `FocusTargetId` (`:30-57`): discriminated union — `app-shell`, `chat-composer{key}`, `command-palette`, `editor{key, surface:'diff'|'document'|'search-result'|'settings', side?, tabId?}`, `file-tree{rootPath}`, `git{rootPath}`, `logs`, `problems`, `search{rootPath, surface:'editor'|'sidebar'}`, `settings-dialog`, `settings-page{tabId}`, `terminal{rootPath, sessionId}`, `unsaved-dialog{dialogTarget}`. Equality in `focusTargetIdsEqual` (`:205-231`).
- `FocusLayout = 'chat' | 'workbench'` (`:28`), derived per snapshot from the DOM: `element.closest('[data-chat-mode]')` / `'[data-workbench]'` (`:270-275`).
- `FocusTargetCapabilities` (`:64-67`): `editor?: {dispatch(EditorCommandId, ctx) => boolean; writable}`, `overlay?: boolean` (overlays never become `lastCommandTarget`, `:486-488`).
- `FocusIntent = 'focus' | 'open-search' | 'reveal-active'` (`:69`) — a target's `onIntent(intent, element)` may implement more than plain focus (file tree filter, reveal active file).
- `FocusTargetToken` / `FocusRequestToken` are branded frozen empty objects (`:186-192`) — identity handles, not ids.

### 5.2 Registration

`service.register({area, capabilities?, element: HTMLElement, id, onIntent})` -> `{token, unregister, update}` (`:389-406`). React side: `useFocusTarget<E>(input, enabled)` (`hooks/use-target.ts:17-63`) returns `{ref, token, focused}`; registers in a layout effect once the DOM ref commits and calls `update(input)` every render (so `writable`, `id` changes propagate). All 17 registration sites (grep, none direct): `components/app-runtime-content.tsx:41` (`global`/app-shell), `features/chat/components/chat-input.tsx:118` (chat-composer), `features/command-palette/content.tsx:121` (overlay), `features/editor/components/editor.tsx:197` (editor, capability with `writable: liveDocument.editability === 'editable'`), `diff-pane.tsx:105` (editor, writable:false), `diagnostic-peek.tsx:27` (editor overlay), `unsaved-changes-dialog.tsx:52` (dialog overlay), `features/git/components/panel.tsx:39`, `features/logs/components/panel.tsx:21`, `features/search/components/result-file-editor.tsx:134` (editor, writable:false), `features/settings/components/dialog.tsx:31` (overlay) and `page.tsx:64`, `features/terminal/components/panel.tsx:116`, `features/workbench/components/diagnostics-panel.tsx:28` (problems), `features/workspace/components/search-pane.tsx:19`, `tree-pane.tsx:273`.

### 5.3 Ownership and snapshot

`FocusProvider` installs one `focusin` capture listener (`providers/provider.tsx:17-22`); `handleFocusIn` resolves the event's composed path to the deepest registered element (`:364-374`, `resolvePath` `:595-618`, `deepestContaining` `:339-359`, shadow-DOM aware via `composedParent` `:330-337`). Snapshot (`:108-114`): `currentOwner, lastCommandTarget, requested, result, revision`; consumed via `useSyncExternalStore` (`hooks/use-snapshot.ts`).

### 5.4 Transition protocol

`request(destination, intent='focus'): {completion: Promise<FocusTransitionOutcome>, token}` (`:408-427`). `FocusDestination` is `{kind:'target', token}` or `{kind:'match', matches(snapshot), isValid?()}` (`:132-138`; helpers `focusTargetById`, `registeredFocusTarget` `:233-242`). `tryPendingTransition` (`:648-683`) finds the unique matching registration (ambiguous -> rejected `destination-invalid`; none -> wait, unless by token -> `unregistered`), calls `onIntent`, and only settles `acknowledged` when a real `focusin` lands on that registration (`acceptActualOwner` `:484-504`) — "never turns elapsed time into acknowledgement" (test `:298`). A newer request supersedes the pending one (`:638-646`). Outcomes: `acknowledged{targetId} | rejected{destination-invalid|refused|unregistered} | superseded{by}`. Commands turn these into bus settlements (§2.5).

### 5.5 `resolveTarget` order (`:429-458`, test `:241`)

path (the invocation's KeyboardEvent composed path) -> `origin` token (captured when a palette/menu opened) -> current owner -> `exact` predicate (unique) -> `lastCommandTarget` -> unique compatible registration -> null. Ambiguity at path/exact stages returns null rather than guessing.

### 5.6 `captureOrigin(source?)` (`:460-473`) — token of the owner or of the deepest registration containing an element/path; used so the palette can restore focus to where it was opened from (`command-provider.tsx:385-397`).

---

## 6. Consumers of the runtime

| Consumer         | How                                                                                                                                                                                                                                                      | File                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Keyboard         | `chordTransition` -> `bus.dispatch(id, {event, source:{kind:'keybinding'}})`                                                                                                                                                                             | `keymap/state/chord-session.ts:126-128`                                                                   |
| Terminal host    | capture `keydown/keyup` -> `claimKeybinding(event)`; claimed -> `stopImmediatePropagation`                                                                                                                                                               | `features/terminal/hooks/use-keybindings.ts`                                                              |
| Command palette  | rows = `commandPaletteItems(platformCommandSpecs, bindings)` minus `hiddenPaletteCommandIds`; `disabledReasonForCommand` = `bus.inspect(...).reason`; select = `bus.dispatch(cmd, {origin: paletteOrigin, source:{kind:'palette'}})`, success = `handled | deferred`, record recency, close unless `keepsPaletteOpen`                                                | `features/command-palette/content.tsx:118-120, :230-271`, `command-palette-utils.ts:45-52, :454-464` |
| Palette modes    | prefix grammar `>` commands, `@` symbols, `:` goto line, `view `, `color `, `theme `, `edt `, `run `, `sess `, else files (`quickAccessMode` `:279-289`); sub-picker scopes pushed by commands (`paletteScopeForPrefix` `:341-346`)                      | `command-palette-utils.ts`                                                                                |
| Menus            | `resolveMenu(menu, {bindings, dispatch, inspect})` fills label from `platformCommandSpec`, trailing text = shortcut or disabled reason                                                                                                                   | `features/menus/utils/resolve.ts:147-169`, `hooks/use-resolved-menu.ts`                                   |
| Settings editor  | `commandKeyBindings(defaultPlatformKeyBindings(), overrides)` rows; `ChordRecorder` records `Mod`-normalized strokes, waits for a 2nd stroke when the first is an existing prefix                                                                        | `features/settings/components/keybinding-section.tsx`, `widgets/chord-recorder.tsx`, `utils/recording.ts` |
| Programmatic     | `bus.dispatch('workspace.revealChat', {source:{kind:'programmatic', caller}})`                                                                                                                                                                           | `features/chat/hooks/use-attach-to-composer.ts:25`                                                        |
| Editor           | single-stroke layers via `editorKeymapLayersFromPlatform(bindings)`                                                                                                                                                                                      | `components/app-workspace.tsx:18`                                                                         |
| Shortcut display | `commandShortcut(id, bindings)`, `formatChord(keys, platform)` (`⌘K ⌘S` / `Ctrl+K Ctrl+S`, thin-space separator)                                                                                                                                         | `keymap/utils/format-keys.ts`                                                                             |

Other DOM keyboard owners that bypass the keymap (plan 056 "Other keyboard owners"): `features/chat/hooks/use-prompt-stash.ts:42` (window capture `Mod+S`, documented double-dispatch with `workspace.saveFile`), `messages-timeline.tsx:482`, palette highlight navigation `use-highlighted-palette-value.ts:68`, the Editor's own `EditorKeymapController` on its scroll element, Ghostty's handler.

---

## 7. Settings registry entry

`packages/contracts/src/settings/keys.ts:594-608`: `'keybindings.overrides'` — `schema: keybindingOverridesSchema`, `default: {}`, `scope: 'application'` ("a binding can invoke any app command, which puts this on the execution side of the scope rule"), `widget: 'keybindings'`, `category: 'Keyboard shortcuts'`, `merge: 'record'` (the one key that merges across layers), keywords `keybinding, shortcut, hotkey, chord, keymap`. Read in React via `useSettingValue('keybindings.overrides')` (`command-provider.tsx:95`) and resolved once per change (`:255-258`). Only one user chord per command, no per-pane user overrides (docs/vscode-keymap-development.md:64-66).

---

## 8. Pure vs DOM-bound — what a TUI can share

### 8.1 Pure today (verified running under Bun with no `document`)

| Module                                                                                                        | Notes for extraction                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keymap/types.ts`                                                                                             | `KeyBindingKeyboardEvent` is already the DOM-free event shape: `{altKey, ctrlKey, metaKey, shiftKey, key, code?, repeat?, isComposing?, keyCode?}`. Type-only import of `FocusArea`.                                                                                                                                                                                   |
| `keymap/define-command.ts`                                                                                    | Types only at runtime except two identity functions. Type imports reach into features (`EditorCommands`, stores) — the TUI needs its own `Runtime` type; the generic bus does not care.                                                                                                                                                                                |
| `keymap/workspace-commands.ts`, `editor-commands.ts`, `table.ts`, `command-registry.ts`                       | Loaded fine without DOM. But: rows import `@phosphor-icons/react` components at module scope (`icon`), and `run` bodies close over web-only APIs at call time (`history.back()` `:955`, `navigator.clipboard` `:925`, `fetchFile` `:122`). Metadata (id/title/category/description/keys/when/execution/target/undoCategory/flags) is 100% shareable; handlers are not. |
| `keymap/default-bindings.ts`                                                                                  | Pure given an explicit `platform`. `detectPlatform()` default reads `navigator` (`node_modules/@tanstack/hotkeys/dist/constants.js:17-24`, returns `'linux'` when undefined; Bun defines `navigator`, so pass the platform explicitly in a TUI).                                                                                                                       |
| `keymap/active-bindings.ts`                                                                                   | Pure. Note `physicalKeyName`/`LATIN_LETTER_PATTERN` live here and are imported by the trie — move them to a leaf so the matcher does not pull in the table.                                                                                                                                                                                                            |
| `keymap/utils/chord.ts`, `keymap-trie.ts`, `chord-machine.ts`, `when.ts`, `format-keys.ts`, `app-bindings.ts` | Pure. `when.ts` depends on `features/editor/utils/file-backed-document.ts` (string prefix tests); `app-bindings.ts` depends on `editor-keymap.ts` (string prefix test, but that module imports `@singapore-editor/core` runtime helpers).                                                                                                                                      |
| `keymap/state/command-bus.ts`                                                                                 | Pure and fully injectable. Two module-scope imports to cut for a shared package: `lib/client-error-taxonomy.ts` (imports `sonner`) and `lib/wide-event-scope.ts` (evlog + `lib/client-logging`). Both are already overridable per instance via `reportError`/`toClientError`/`createEvent`.                                                                            |
| `lib/focus/utils/active-surface.ts`                                                                           | Pure.                                                                                                                                                                                                                                                                                                                                                                  |
| TanStack `@tanstack/hotkeys` `parse.js`, `validate.js`, `format.js`, `constants.js`                           | No DOM at runtime (only `detectPlatform`'s `navigator` probe and doc comments). `match.js`/managers/recorders/`KeyStateTracker` touch DOM.                                                                                                                                                                                                                             |

### 8.2 DOM-bound (must be reimplemented)

| Module                                                                                                   | DOM dependence                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keymap/state/chord-session.ts`                                                                          | `document`/`window` listeners, capture phase, `KeyboardEvent` methods (`preventDefault`, `stopImmediatePropagation`), `event.code`, keyup tracking, `visibilitychange`, `pointerdown`, `setTimeout`.                                                                                                              |
| `keymap/utils/keyboard-event.ts`                                                                         | `eventTargetsTextEntry` inspects `HTMLInputElement`/`isContentEditable`/`composedPath`. In a TUI "targets text entry" must come from the TUI focus model (is the composer/editor widget focused?).                                                                                                                |
| `keymap/use-app-keymap.ts`, providers, hooks, `pending-chord-indicator.tsx`, `app-keymap-controller.tsx` | React.                                                                                                                                                                                                                                                                                                            |
| `keymap/state/runtime.ts`                                                                                | Zustand stores, TanStack Query, the web FocusService.                                                                                                                                                                                                                                                             |
| `keymap/editor-keymap.ts`                                                                                | `@singapore-editor/core` (DOM editor). Irrelevant for a TUI unless the terminal editor reuses the core.                                                                                                                                                                                                                   |
| `lib/focus/state/service.ts` + hooks/provider                                                            | Registrations carry `element: HTMLElement`; ownership from `focusin`; path resolution via `composedPath()`/`Node`; layout via `closest('[data-chat-mode]')`. **The protocol is portable** (ids, areas, capabilities, request/acknowledge/supersede, `resolveTarget` precedence), the element plumbing is not.     |
| `features/command-palette/*`                                                                             | cmdk + React; the item builders and prefix grammar in `command-palette-utils.ts` are pure and reusable (`commandPaletteItems`, `groupedCommandItems`, `quickAccessMode`, `quickAccessQuery`, `paletteCommandSucceeded`, recency ranking). `recent-commands-store.ts` uses `localStorage` behind a `typeof` guard. |
| `features/settings/utils/recording.ts`                                                                   | Pure over `KeyBindingKeyboardEvent`; the recorder component is React.                                                                                                                                                                                                                                             |

### 8.3 Terminal-specific gaps the TUI must design around

1. **Event synthesis**: build `KeyBindingKeyboardEvent` from the terminal key parser. `key` must use DOM key names (`'ArrowUp'`, `'Escape'`, `'k'`, `'['`); `code` can be omitted (only used for non-Latin layout fallback, which terminals do not expose); `repeat`/`isComposing`/`keyCode` are unavailable — pass `false`/`undefined`.
2. **Modifiers**: Cmd is invisible to most terminals; on macOS the TUI should treat `Mod` as Control (i.e. resolve bindings with `platform:'linux'`-style semantics or map Meta->Ctrl), which changes the shipped defaults' meaning (e.g. `Mod+K Mod+S` becomes `Ctrl+K Ctrl+S`, colliding with shell/readline as the docs already note for Linux). Ctrl+Shift+letter and Ctrl+punctuation are often indistinguishable without the Kitty keyboard protocol (OpenTUI supports it — see `references/opencode/packages/tui`).
3. **Keyup** does not exist outside Kitty protocol — the session's claimed-key release tracking can be dropped.
4. **Reserved browser hotkeys** are meaningless in a terminal (`Control+Tab`, `Mod+W`, ...); filter `command === null` bindings out, or replace with terminal-hostile reservations (`Ctrl+C`, `Ctrl+Z`, `Ctrl+D`?).
5. **Alt/Escape ambiguity** (ESC prefix vs Alt+key) interacts with the chord timeout; the machine treats Escape as "unmatched -> cancel" only when armed.
6. **`firesWhileTyping`** currently means "first stroke has Ctrl/Meta or is Escape"; in a TUI where the composer is nearly always focused, this gate decides whether plain-letter bindings ever work — same semantics as the web (they do not in text fields).

---

## 9. Every command with its default binding

Format: `id | title | category | mac default (linux/windows if different) | execution target undoCategory when flags`. `@editor`/`@file-tree` = pane-scoped; `—` = no default key (palette/menu only). Source of truth: `dump-bindings.ts` run against the live table.

### Workspace (57 rows, `keymap/workspace-commands.ts`)

| id                                | title                           | default keys              | meta                                                                      |
| --------------------------------- | ------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| workspace.undoWorkspaceEdit       | Undo workspace edit             | —                         | async · workspace-operation · when=[workspaceOpen, workspaceEditUndoable] |
| workspace.redoWorkspaceEdit       | Redo workspace edit             | —                         | async · workspace-operation · when=[workspaceOpen, workspaceEditRedoable] |
| workspace.showQuickAccess         | Quick Open                      | `Mod+P`                   | async · view-only · when=[workspaceOpen] · keepsPaletteOpen               |
| workspace.showCommandPalette      | Show command palette            | `Mod+Shift+P`, `F1`       | async · view-only · when=[] · hidden · keepsPaletteOpen                   |
| workspace.showSettings            | Settings                        | `Mod+,`, `Mod+K Mod+S`    | async · view-only · when=[]                                               |
| workspace.openFilePicker          | Open file picker                | —                         | sync · view-only · when=[]                                                |
| workspace.openSearchEditor        | Open Search Editor              | —                         | async · view-only · when=[workspaceOpen]                                  |
| workspace.quickOpenPreviousEditor | Quick open previous editor      | —                         | async · view-only · when=[tabOpen]                                        |
| workspace.quickOpenView           | Open view                       | —                         | async · view-only · when=[workspaceOpen] · keepsPaletteOpen               |
| workspace.gotoSymbol              | Go to symbol in editor          | `Mod+Shift+O`             | async · view-only · when=[fileBackedTab] · keepsPaletteOpen               |
| workspace.showAllEditors          | Show all editors                | —                         | async · view-only · when=[workspaceOpen] · keepsPaletteOpen               |
| workspace.saveFile                | Save                            | `Mod+S`                   | async · file-operation · when=[saveableTab, workspaceMutable]             |
| workspace.saveAllFiles            | Save all                        | —                         | async · file-operation · when=[workspaceOpen, workspaceMutable]           |
| workspace.compareWithSaved        | Compare with saved              | —                         | async · view-only · when=[fileBackedTab]                                  |
| workspace.openFileAtHead          | Open file at HEAD               | —                         | async · view-only · when=[fileBackedTab]                                  |
| workspace.revertFile              | Revert file                     | —                         | async · file-operation · when=[fileBackedTab]                             |
| workspace.reopenClosedEditor      | Reopen closed editor            | —                         | async · view-only · when=[workspaceOpen]                                  |
| workspace.toggleSidebarVisibility | Toggle Files pane               | `Mod+B`                   | async · view-only · when=[workspaceOpen]                                  |
| workspace.togglePanel             | Toggle panel                    | `Mod+J`                   | async · view-only · when=[workspaceOpen]                                  |
| workspace.focusFirstEditorGroup   | Focus first editor group        | —                         | async · view-only · when=[tabOpen]                                        |
| workspace.focusSecondEditorGroup  | Focus second editor group       | —                         | async · view-only · when=[tabOpen]                                        |
| workspace.focusThirdEditorGroup   | Focus third editor group        | —                         | async · view-only · when=[tabOpen]                                        |
| workspace.focusEditor             | Focus editor                    | —                         | async · view-only · when=[tabOpen]                                        |
| workspace.focusFileTree           | Focus file tree                 | `Mod+Shift+E`             | async · view-only · when=[workspaceOpen]                                  |
| workspace.findInFileTree          | Filter files in tree            | `Mod+F` @file-tree        | async · view-only · when=[workspaceOpen]                                  |
| workspace.revealActiveFileInTree  | Reveal active file in tree      | —                         | async · view-only · when=[fileBackedTab]                                  |
| workspace.focusGit                | Focus Git                       | —                         | async · view-only · when=[workspaceOpen]                                  |
| workspace.copyAddress             | Copy address                    | —                         | async · workspace-operation · when=[workspaceOpen]                        |
| workspace.navigateBack            | Back                            | `Mod+[`                   | sync · view-only · when=[workspaceOpen]                                   |
| workspace.navigateForward         | Forward                         | `Mod+]`                   | sync · view-only · when=[workspaceOpen]                                   |
| workspace.revealChat              | Show chat                       | —                         | async · view-only · when=[workspaceOpen]                                  |
| workspace.revealTerminal          | Show terminal                   | —                         | async · view-only · when=[workspaceOpen]                                  |
| workspace.newIsolatedSession      | New session in its own worktree | —                         | async · workspace-operation · when=[workspaceOpen]                        |
| workspace.closeCurrentTab         | Close current tab               | —                         | async · view-only · when=[tabOpen]                                        |
| workspace.toggleDiffViewMode      | Toggle diff view mode           | `Mod+Shift+D`             | async · workspace-operation · when=[workspaceOpen]                        |
| workspace.toggleUiMode            | Toggle Chat mode                | `Mod+Shift+M`             | async · view-only · when=[workspaceOpen]                                  |
| workspace.showChatMode            | Chat mode                       | —                         | async · view-only · when=[workspaceOpen]                                  |
| workspace.showWorkbenchMode       | Workbench mode                  | —                         | async · view-only · when=[workspaceOpen]                                  |
| workspace.selectColorMode         | Choose color mode               | —                         | async · view-only · when=[] · keepsPaletteOpen (Appearance)               |
| workspace.selectColorTheme        | Choose color theme              | —                         | async · view-only · when=[] · keepsPaletteOpen (Appearance)               |
| workspace.setDarkTheme            | Dark color mode                 | —                         | async · workspace-operation · when=[] · hidden (Appearance)               |
| workspace.setLightTheme           | Light color mode                | —                         | async · workspace-operation · when=[] · hidden (Appearance)               |
| workspace.setSystemTheme          | System color mode               | —                         | async · workspace-operation · when=[] · hidden (Appearance)               |
| workspace.toggleWallpaper         | Toggle wallpaper                | —                         | async · workspace-operation · when=[] (Appearance)                        |
| workspace.newSession              | New session                     | `Mod+Alt+N`               | sync · workspace-operation · when=[workspaceOpen, chatMode] · hidden      |
| workspace.nextSession             | Next session                    | `Mod+Alt+]`               | sync · view-only · when=[workspaceOpen, chatMode] · hidden                |
| workspace.previousSession         | Previous session                | `Mod+Alt+[`               | sync · view-only · when=[workspaceOpen, chatMode] · hidden                |
| workspace.toggleSessionRail       | Toggle session rail             | `Mod+Alt+B`               | sync · view-only · when=[workspaceOpen, chatMode] · hidden                |
| workspace.jumpToSession1 … 9      | Go to session N                 | `Mod+Alt+1` … `Mod+Alt+9` | sync · view-only · when=[workspaceOpen, chatMode] · hidden                |

### Editor (85 rows, `keymap/editor-commands.ts`; all `sync · target editor · pane editor`; `when=[editorTarget]`, plus `editorWritable` for text-edit)

| id (after `editor.`)                       | title                                  | mac                                              | linux                                    | windows                    | undo               |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------ | ---------------------------------------- | -------------------------- | ------------------ |
| undo                                       | Undo                                   | Mod+Z                                            | =                                        | =                          | text-edit          |
| redo                                       | Redo                                   | Mod+Shift+Z                                      | Mod+Shift+Z, Mod+Y                       | Mod+Shift+Z, Mod+Y         | text-edit          |
| find                                       | Find                                   | Mod+F                                            | =                                        | =                          | view-only          |
| findReplace                                | Find and replace                       | Mod+Alt+F                                        | Mod+H                                    | Mod+H                      | view-only          |
| findNext                                   | Find next                              | F3, Mod+G                                        | F3                                       | F3                         | view-only          |
| findPrevious                               | Find previous                          | Shift+F3, Mod+Shift+G                            | Shift+F3                                 | Shift+F3                   | view-only          |
| goToDefinition                             | Go to definition                       | —                                                | —                                        | —                          | view-only          |
| editor.action.goToImplementation           | Go to implementation                   | —                                                | —                                        | —                          | view-only · hidden |
| editor.action.goToTypeDefinition           | Go to type definition                  | —                                                | —                                        | —                          | view-only · hidden |
| editor.action.peekDefinition               | Peek definition                        | —                                                | —                                        | —                          | view-only · hidden |
| editor.action.revealDefinitionAside        | Open definition to the side            | —                                                | —                                        | —                          | view-only · hidden |
| editor.action.showHover                    | Show hover                             | —                                                | —                                        | —                          | view-only          |
| editor.action.goToReferences               | Find references                        | Shift+F12                                        | =                                        | =                          | view-only          |
| closeFind                                  | Close find                             | Escape, Shift+Escape                             | =                                        | =                          | view-only          |
| toggleFindCaseSensitive                    | Toggle case sensitive find             | Mod+Alt+C                                        | Alt+C                                    | Alt+C                      | view-only          |
| toggleFindWholeWord                        | Toggle whole word find                 | Mod+Alt+W                                        | Alt+W                                    | Alt+W                      | view-only          |
| toggleFindRegex                            | Toggle regex find                      | Mod+Alt+R                                        | Alt+R                                    | Alt+R                      | view-only          |
| toggleFindInSelection                      | Toggle find in selection               | Mod+Alt+L                                        | Alt+L                                    | Alt+L                      | view-only          |
| togglePreserveCase                         | Toggle preserve case                   | Mod+Alt+P                                        | Alt+P                                    | Alt+P                      | view-only          |
| replaceOne                                 | Replace                                | Mod+Shift+1                                      | =                                        | =                          | text-edit          |
| replaceAll                                 | Replace all                            | Mod+Alt+Enter                                    | =                                        | =                          | text-edit          |
| selectAllMatches                           | Select all matches                     | Alt+Enter                                        | =                                        | =                          | view-only          |
| selectAll                                  | Select all                             | Mod+A                                            | =                                        | =                          | view-only          |
| addNextOccurrence                          | Add next occurrence                    | Mod+D                                            | =                                        | =                          | view-only          |
| clearSecondarySelections                   | Clear secondary selections             | —                                                | —                                        | —                          | view-only          |
| deleteWordLeft                             | Delete word left                       | Alt+Backspace                                    | Mod+Backspace                            | Mod+Backspace              | text-edit          |
| deleteWordRight                            | Delete word right                      | Alt+Delete                                       | Mod+Delete                               | Mod+Delete                 | text-edit          |
| editor.action.deleteLines                  | Delete line                            | Mod+Shift+K                                      | =                                        | =                          | text-edit          |
| editor.action.copyLinesUpAction            | Copy line up                           | Alt+Shift+ArrowUp                                | Mod+Alt+Shift+ArrowUp                    | Alt+Shift+ArrowUp          | text-edit          |
| editor.action.copyLinesDownAction          | Copy line down                         | Alt+Shift+ArrowDown                              | Mod+Alt+Shift+ArrowDown                  | Alt+Shift+ArrowDown        | text-edit          |
| editor.action.moveLinesUpAction            | Move line up                           | Alt+ArrowUp                                      | =                                        | =                          | text-edit          |
| editor.action.moveLinesDownAction          | Move line down                         | Alt+ArrowDown                                    | =                                        | =                          | text-edit          |
| editor.action.insertLineBefore             | Insert line above                      | Mod+Shift+Enter                                  | =                                        | =                          | text-edit          |
| editor.action.insertLineAfter              | Insert line below                      | Mod+Enter                                        | =                                        | =                          | text-edit          |
| editor.action.commentLine                  | Toggle line comment                    | Mod+/                                            | =                                        | =                          | text-edit          |
| editor.action.blockComment                 | Toggle block comment                   | Alt+Shift+A                                      | Mod+Shift+A                              | Alt+Shift+A                | text-edit          |
| editor.action.indentLines                  | Indent line                            | Mod+]                                            | =                                        | =                          | text-edit          |
| editor.action.outdentLines                 | Outdent line                           | Mod+[                                            | =                                        | =                          | text-edit          |
| editor.action.insertCursorAbove            | Add cursor above                       | Mod+Alt+ArrowUp                                  | Alt+Shift+ArrowUp, Mod+Shift+ArrowUp     | Mod+Alt+ArrowUp            | view-only          |
| editor.action.insertCursorBelow            | Add cursor below                       | Mod+Alt+ArrowDown                                | Alt+Shift+ArrowDown, Mod+Shift+ArrowDown | Mod+Alt+ArrowDown          | view-only          |
| editor.action.selectHighlights             | Select all occurrences                 | Mod+Shift+L                                      | =                                        | =                          | view-only          |
| editor.action.changeAll                    | Change all occurrences                 | Mod+F2                                           | =                                        | =                          | view-only          |
| editor.action.jumpToBracket                | Go to bracket                          | Mod+\                                            | =                                        | =                          | view-only          |
| cursorWordPartLeft                         | Cursor word part left                  | Control+Alt+ArrowLeft                            | —                                        | —                          | view-only          |
| cursorWordPartRight                        | Cursor word part right                 | Control+Alt+ArrowRight                           | —                                        | —                          | view-only          |
| editor.action.trimTrailingWhitespace       | Trim trailing whitespace               | —                                                | —                                        | —                          | text-edit          |
| editor.action.sortLinesAscending           | Sort lines ascending                   | —                                                | —                                        | —                          | text-edit          |
| editor.action.sortLinesDescending          | Sort lines descending                  | —                                                | —                                        | —                          | text-edit          |
| editor.action.joinLines                    | Join lines                             | Control+J                                        | —                                        | —                          | text-edit          |
| editor.action.duplicateSelection           | Duplicate selection                    | —                                                | —                                        | —                          | text-edit          |
| editor.action.transformToUppercase         | Transform to uppercase                 | —                                                | —                                        | —                          | text-edit          |
| editor.action.transformToLowercase         | Transform to lowercase                 | —                                                | —                                        | —                          | text-edit          |
| editor.action.transformToTitlecase         | Transform to title case                | —                                                | —                                        | —                          | text-edit          |
| editor.action.rename                       | Rename symbol                          | F2                                               | =                                        | =                          | text-edit          |
| editor.action.formatDocument               | Format document                        | Alt+Shift+F                                      | =                                        | =                          | text-edit          |
| editor.action.toggleWordWrap               | Toggle word wrap                       | Alt+Z                                            | =                                        | =                          | view-only          |
| editor.action.moveSelectionToNextFindMatch | Move last selection to next find match | —                                                | —                                        | —                          | view-only          |
| deleteBackward                             | Delete backward                        | Backspace, Shift+Backspace, Control+H            | Backspace, Shift+Backspace               | Backspace, Shift+Backspace | text-edit          |
| deleteForward                              | Delete forward                         | Delete, Control+D                                | Delete                                   | Delete                     | text-edit          |
| indentSelection                            | Indent selection                       | Tab                                              | =                                        | =                          | text-edit          |
| outdentSelection                           | Outdent selection                      | Shift+Tab                                        | =                                        | =                          | text-edit          |
| cursorLeft                                 | Move cursor left                       | ArrowLeft, Control+B                             | ArrowLeft                                | ArrowLeft                  | view-only          |
| cursorRight                                | Move cursor right                      | ArrowRight, Control+F                            | ArrowRight                               | ArrowRight                 | view-only          |
| cursorUp                                   | Move cursor up                         | ArrowUp, Control+P                               | ArrowUp                                  | ArrowUp                    | view-only          |
| cursorDown                                 | Move cursor down                       | ArrowDown, Control+N                             | ArrowDown                                | ArrowDown                  | view-only          |
| selectLeft                                 | Select left                            | Shift+ArrowLeft                                  | =                                        | =                          | view-only          |
| selectRight                                | Select right                           | Shift+ArrowRight                                 | =                                        | =                          | view-only          |
| selectUp                                   | Select up                              | Shift+ArrowUp                                    | =                                        | =                          | view-only          |
| selectDown                                 | Select down                            | Shift+ArrowDown                                  | =                                        | =                          | view-only          |
| cursorWordLeft                             | Move cursor word left                  | Alt+ArrowLeft                                    | Mod+ArrowLeft                            | Mod+ArrowLeft              | view-only          |
| cursorWordRight                            | Move cursor word right                 | Alt+ArrowRight                                   | Mod+ArrowRight                           | Mod+ArrowRight             | view-only          |
| selectWordLeft                             | Select word left                       | Alt+Shift+ArrowLeft                              | Mod+Shift+ArrowLeft                      | Mod+Shift+ArrowLeft        | view-only          |
| selectWordRight                            | Select word right                      | Alt+Shift+ArrowRight                             | Mod+Shift+ArrowRight                     | Mod+Shift+ArrowRight       | view-only          |
| cursorLineStart                            | Move cursor to line start              | Home, Mod+ArrowLeft, Control+A                   | Home                                     | Home                       | view-only          |
| cursorLineEnd                              | Move cursor to line end                | End, Mod+ArrowRight, Control+E                   | End                                      | End                        | view-only          |
| selectLineStart                            | Select to line start                   | Shift+Home, Mod+Shift+ArrowLeft, Control+Shift+A | Shift+Home                               | Shift+Home                 | view-only          |
| selectLineEnd                              | Select to line end                     | Shift+End, Mod+Shift+ArrowRight, Control+Shift+E | Shift+End                                | Shift+End                  | view-only          |
| cursorPageUp / cursorPageDown              | Move cursor page up/down               | PageUp / PageDown                                | =                                        | =                          | view-only          |
| selectPageUp / selectPageDown              | Select page up/down                    | Shift+PageUp / Shift+PageDown                    | =                                        | =                          | view-only          |
| cursorDocumentStart                        | Move cursor to document start          | Mod+ArrowUp                                      | Mod+Home                                 | Mod+Home                   | view-only          |
| cursorDocumentEnd                          | Move cursor to document end            | Mod+ArrowDown                                    | Mod+End                                  | Mod+End                    | view-only          |
| selectDocumentStart                        | Select to document start               | Mod+Shift+ArrowUp                                | Mod+Shift+Home                           | Mod+Shift+Home             | view-only          |
| selectDocumentEnd                          | Select to document end                 | Mod+Shift+ArrowDown                              | Mod+Shift+End                            | Mod+Shift+End              | view-only          |

### Reserved (command = null, `default-bindings.ts:94-108`)

`Control+Tab`, `Control+Q`, `Mod+Alt+Tab` (mac only), `Mod+Shift+T`, `Mod+1`, `Mod+2`, `Mod+3`, `Mod+W` (all panes), `F12` (@editor). Each carries a `vscodeCommandId` naming the desktop action Platform cannot perform in a browser.

Unbound Editor capabilities the table does not reach at all (the `EditorCommandId` union has them, the table does not): the folding family (`editor.fold*`, 15 ids), `cursorUndo/Redo`, `smartSelect.*`, `marker.next/prev`, `autoFix`, `inlineSuggest.*`, `toggleTabFocusMode`, `reindent*`, `deleteWordPart*`, `cursorWordPart*Select`, column-select family — plan 057 ("Blocked on 056") is the takeover that binds them via `Mod+K` chords.

---

## 10. Plan 056 in one paragraph

Chords are a non-empty stroke tuple; `keys` stays the canonical space-joined string. Prefix arbitration lives in a per-pane trie built from the already-arbitrated, already-filtered list; a complete shorter binding always beats a chord that would swallow its prefix; the arming stroke is always suppressed; unmatched continuations are swallowed and never replayed; timeout is a real 5 s timer; modifiers and repeats neither advance nor cancel; IME (`isComposing || keyCode 229`) is ignored; focus-owner change cancels; the terminal shares the same `claimKeybinding`; depth cap 2 is product policy (trie is N-capable); TanStack's grammar helpers are kept, its `SequenceManager`/`matchesKeyboardEvent` rejected (prefix not swallowed, lazy timeout, layout-fallback regression). Implemented and reconciled 2026-09-05 in Platform commit `0f5b0618`. See the [shared runtime delivery](../keymap/delivery.md) for the subsequent implementation.
