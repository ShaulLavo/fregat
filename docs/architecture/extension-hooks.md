# Extension hooks: the contract map

Draft from the [E027](../../plans/e027-extension-hooks.md) research pass on 2026-09-25, read from Editor
`e2fd299`. It records what the code does today. Rows marked proposed are E027's recommendations and
are not implemented. Every public type named here is exported from `@singapore-editor/core/extensions`
unless the row says otherwise.

## Scopes

| Scope          | Created by                                             | Lives until                                                                  |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Plugin object  | The host (`plugins` option, `setPlugins`, `addPlugin`) | The host drops it. It is a definition: one object may go to many editors.    |
| Plugin install | `EditorPluginHost`, one per `Editor`                   | `setPlugins` without it, `removePlugin`, or editor disposal.                 |
| Contribution   | The editor, once per editor per registered provider    | Provider disposal, plugin deactivation, a thrown update, or editor disposal. |
| Document       | `openDocument`, `attachSession`, `setText`             | The next document or `clear()`. Contributions survive it.                    |
| Ambient plugin | `registerAmbientEditorPlugin`, module-global           | Loaded once on first demand, installed per editor while demand exists.       |

Every registry a contribution reaches is per editor: the plugin host
([Editor.ts:502](../../packages/editor/src/editor/Editor.ts)), language features
([Editor.ts:316](../../packages/editor/src/editor/Editor.ts)), decorations
([Editor.ts:370](../../packages/editor/src/editor/Editor.ts)), commands, and keymap context keys.
Two views of one document share an `EditorTextBuffer` (text and undo) through separate
`createEditorViewSession` sessions, so selections stay per view. There
is no document-scoped contribution; Platform [Plan 099](../../../platform/plans/099-document-contributions.md)
owns adding one.

Rules the code already implies:

- `activate` runs once per editor for the same plugin object. State belongs in `activate` or in a
  contribution, never in the factory closure (`createBracketMatchPlugin` and
  `createMergeConflictPlugin` keep their controller in `activate`).
- Each plugin gets its own context. A registration made inside `install` or `activate` is unwound
  with that phase; one made later, from a promise or timer, belongs to the plugin's current lifetime
  (released on deactivation while active, on removal while installed) and one made after the plugin
  is gone is undone at once ([plugins.ts ownRegistration](../../packages/editor/src/plugins.ts)).
- Whatever a contribution registers through its context, at creation or later, including
  `onDidType` and keymap context keys, is released when the contribution goes, whether or not its
  own `dispose` remembers it ([Editor.ts createContributionSafely](../../packages/editor/src/editor/Editor.ts)).
- Asynchronous results carry their own freshness check. `snapshot.textVersion` increases on every
  rendered text change and every document swap in one editor, so an A-to-B-to-A swap never repeats a
  version. Edit-side contexts expose `getDocumentSyncPoint()` for the same purpose.

## Inventory

Status values are stability labels: **supported** (exported and used; changes follow the usual
review), **experimental** (exported, may change without notice), **internal** (exists, not
exported), **host** (the host's API, not a plugin hook), **proposed** (lands experimental), **gap**,
**unsupported** (deliberately absent).

### Document edits

| Hook                                                    | Scope, phase, rights                                                                 | Order, cancel, dispose                                       | Consumer            | Status    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------- | --------- |
| `EditorEditContributionContext.applyEdits`              | Per editor. Any time. One batch against the current snapshot, one undo entry.        | Rejected when not editable. One optional result selection.   | find, lsp-plugin    | supported |
| `startSnippetSession`                                   | Per editor, edit context.                                                            | Ends on the snippet's own exit rules.                        | lsp-plugin          | supported |
| `materializeFullText`, `getTextSnapshot`                | Per editor, edit and decoration contexts. `TextReadSnapshot` reads rows and windows. | Full text is O(n) and gated by `check:full-text`.            | diff                | supported |
| `getDocumentSyncPoint`, `changesSinceDocumentSyncPoint` | Per editor. Recovers every edit since a point.                                       | Returns null across a gap or segment change.                 | diff, lsp           | supported |
| `Editor.edit`, `setText`, `syncText`                    | Host.                                                                                | `setText(text, { tokens })` paints atomically (E050 row 1).  | Platform            | host      |
| Edit from a view contribution                           | A view contribution has no `applyEdits`. Features bridge through a closure.          | Creation order between contribution kinds is not guaranteed. | find, bracket match | gap       |

### Selections

| Hook                                               | Scope, phase, rights                                   | Order, cancel, dispose                             | Consumer                   | Status    |
| -------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- | -------------------------- | --------- |
| `getSelections`                                    | Edit and internal feature contexts. Resolved offsets.  | Current at call time.                              | find, lsp-plugin           | supported |
| `setSelection`, `setSelections`                    | View context. Reveal options.                          | Runs in an editor operation.                       | find, lsp, diff            | supported |
| `snapshot.selections` with update kind `selection` | View contributions.                                    | Every view contribution is visited for every kind. | bracket match, occurrences | supported |
| `EditorSelectionRangeProvider`                     | Per editor. Asked on every expand; union of providers. | No invalidation event: read fresh.                 | tree-sitter                | supported |
| `trackRanges`, `trackPoint`                        | View context. Anchors that follow edits.               | Live until dropped; no disposal needed.            | find                       | supported |

### Commands

| Hook                                               | Scope, phase, rights                                                                    | Order, cancel, dispose                                                                                                                                        | Consumer                        | Status                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------- |
| `EditorCommandContributionContext.registerCommand` | Per editor. IDs are the closed `EditorCommandId` union. Handler gets `{ event? }` only. | One handler per ID; a duplicate throws. A registered handler runs before the built-in and a `false` does not fall through (`closeFind` is the one exception). | find, lsp, hover, bracket match | supported                                    |
| `Editor.dispatchCommand`                           | Host.                                                                                   | Runs in one editor operation.                                                                                                                                 | Platform command bus            | host                                         |
| Command metadata, custom IDs, typed arguments      | —                                                                                       | —                                                                                                                                                             | —                               | [E026](../../plans/e026-command-metadata.md) |

### Input

| Hook                       | Scope, phase, rights                                                                | Order, cancel, dispose                                                    | Consumer                         | Status      |
| -------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------- | ----------- |
| `registerPressParticipant` | View context. Asked before a press becomes a caret; `true` claims it (E050 row 5).  | Registration order; first claim wins; the editor prevents the default.    | diff, definition links           | supported   |
| `registerNonCaretRows`     | View context. Caret moves step over the rows.                                       | Claimed during creation only.                                             | diff                             | supported   |
| `registerKeymapContextKey` | View context. Read when a key is matched (E050 row 6).                              | Unregistered keys read false.                                             | find, completion, signature help | supported   |
| `onDidType`                | View context. After the typed edit lands.                                           | Not claimed by the editor; the contribution must dispose it.              | auto-close consumers             | supported   |
| `EDITOR_PASTE_HANDLER`     | Language feature token. First handler that answers takes the paste.                 | Selector score, then priority, then registration order.                   | built-in paste handlers          | supported   |
| Keymap bindings            | Host only, through `EditorKeymapOptions.layers`. A plugin cannot add a binding.     | Later layers first; `when` conditions; mutating commands need `writable`. | Platform disables it             | host        |
| Key participant            | View context. Consume or delegate a key before the editor keymap and default input. | See the input section below.                                              | E028                             | experimental |
| Text commit gate           | View context. Allow or reject text from every source before it commits.             | See the input section below.                                              | E028                             | experimental |
| Replace the input loop     | —                                                                                   | Rejected below.                                                           | —                                | unsupported |

### Syntax and language features

| Hook                                                                   | Scope, phase, rights                                                      | Order, cancel, dispose                                               | Consumer                       | Status    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------ | --------- |
| `registerSyntaxProvider`                                               | Per editor. Creates a session per document.                               | First provider returning a session wins; change reloads the session. | tree-sitter                    | supported |
| `registerHighlighter`                                                  | Per editor. Session per document; `initialHighlightStatus` (E050 row 11). | First provider returning a session wins.                             | shiki                          | supported |
| `createEditorLanguageFeatureToken`, `registerProvider`, `getProviders` | Library-defined, many providers.                                          | Language match, then priority, then registration order.              | lsp-plugin, hover              | supported |
| `createEditorCapabilityToken`, `registerFeature`, `getFeature`         | Library-defined, one owner per editor.                                    | A second owner throws. No change subscription.                       | find, minimap, merge conflicts | supported |
| Provider-change subscription                                           | `EditorLanguageFeatureRegistry.subscribe` exists but is internal.         | Used by ambient plugins.                                             | hover demand                   | internal  |

### Display projection

| Hook                                | Scope, phase, rights                                             | Order, cancel, dispose                                             | Consumer                 | Status    |
| ----------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------ | --------- |
| `EditorInjectedTextRowProvider`     | Per editor. Rows derived from a `TextReadSnapshot`.              | `onDidChangeInjectedTextRows` invalidates.                         | diff, merge conflicts    | supported |
| `EditorInlineReplacementProvider`   | Per editor. Called when the parse settles; providers compose.    | Outermost span first.                                              | markdown                 | supported |
| `EditorGutterContribution`          | Per editor. Cells created, updated, disposed by the gutter.      | Unique `id`; `interactive` cells take pointer events (E050 row 9). | line, fold, diff gutters | supported |
| `getRowPresentation`                | View context. Element handle with an abort signal (E050 row 10). | Aborts before text replacement, recycling and view disposal.       | decode                   | supported |
| Fold map, word wrap, `setInlineMap` | Host methods.                                                    | —                                                                  | Platform                 | host      |
| `DisplayProjectionRegistry`         | Internal composition point.                                      | —                                                                  | —                        | internal  |

### Decorations

| Hook                                                 | Scope, phase, rights                                                    | Order, cancel, dispose                                                | Consumer            | Status    |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------- | --------- |
| `EditorDecorationContribution` + `decorations` store | Per editor. Entries follow edits; `handleEditorChange(change \| null)`. | Entries owned per source; a throwing update removes the contribution. | diff                | supported |
| `setRowDecorations`, `clearRowDecorations`           | Decoration context. Keyed by `sourceId`.                                | A second owner of a source ID is rejected.                            | diff                | supported |
| `setRangeHighlight`, `clearRangeHighlight`           | View context. CSS highlight by name.                                    | Names are not owned; prefix with `highlightPrefix`.                   | bracket match, find | supported |

### Frame work

| Hook                                 | Scope, phase, rights                                                     | Order, cancel, dispose                                 | Consumer               | Status      |
| ------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------- | ----------- |
| `EditorViewContribution.update`      | One snapshot per pass; measure first, then write.                        | Reentrant requests queue, depth capped at 32.          | all view contributions | supported   |
| `requestViewUpdate`                  | View context. Schedules a `layout` pass.                                 | Coalesced into the queue.                              | minimap, sticky scroll | supported   |
| `captureVisiblePaint`, `snapshotKey` | Paint restoration.                                                       | A pending capture at restore removes the contribution. | scope lines            | supported   |
| Frame callback, work scheduler       | `scheduleFrame`, `workScheduler`, `secondaryWorkScheduler` are internal. | —                                                      | —                      | unsupported |

### Scrolling

| Hook                                                     | Scope, phase, rights                                  | Order, cancel, dispose                         | Consumer               | Status    |
| -------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- | ---------------------- | --------- |
| `updateViewport`                                         | View contribution. Display rate, no snapshot rebuild. | Only contributions that define it are visited. | minimap, sticky scroll | supported |
| `setScrollPosition`, `revealLine`                        | View context. Updates both axes (E050 row 8).         | —                                              | find, diff             | supported |
| `reserveOverlayWidth`, `onDidChangeReservedOverlayWidth` | View context (E050 row 7).                            | Never coalesced.                               | find, minimap          | supported |
| `registerWheelScrollTarget`                              | External overlay joins native scrolling.              | Dispose with the contribution.                 | find widget            | supported |
| `Editor.onDidScroll`                                     | Host.                                                 | After the virtualizer folds the scroll in.     | Platform               | host      |

### Document lifecycle

| Hook                                                 | Scope, phase, rights                                 | Order, cancel, dispose                                      | Consumer                | Status    |
| ---------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- | ----------------------- | --------- |
| Update kinds `document` and `clear`                  | View contributions, after the new document renders.  | No will-change phase; row handles abort before replacement. | every view contribution | supported |
| `handleEditorChange(null)`                           | Decoration and feature contributions on replacement. | —                                                           | diff, merge conflicts   | supported |
| `onChange`, `onInitialPaint`, `onPresentationChange` | Host options.                                        | —                                                           | Platform                | host      |
| Open, save, dirty state, file identity               | Host.                                                | —                                                           | Platform                | host      |
| Document-scoped contributions                        | —                                                    | —                                                           | —                       | Plan 099  |

### View lifecycle

| Hook                                                                  | Scope, phase, rights                                           | Order, cancel, dispose                                                   | Consumer         | Status    |
| --------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------- | --------- |
| `EditorPlugin.install`, `activate`, `update`, `deactivate`, `dispose` | Per editor.                                                    | Phase registrations unwind with the phase; a throw unwinds partial work. | every plugin     | supported |
| Contribution providers (view, command, capability, edit, decoration)  | Created per editor, late providers get an initial update.      | A throwing factory or update removes the contribution and logs it.       | every plugin     | supported |
| `registerEditorFeatureContribution`                                   | Internal combined context (DOM, edits, commands, decorations). | Reached by a cast from `mergeConflictPlugin`.                            | merge conflicts  | internal  |
| `registerAmbientEditorPlugin`                                         | Module-global demand-loaded plugin.                            | Installed while a provider of `demand` exists.                           | hover            | supported |
| `registerLogger`, `log`                                               | Per editor.                                                    | A throwing logger is ignored.                                            | Platform logging | supported |

## Input: event order and the contract

Keydown for a key typed into the hidden input (textarea or EditContext host, both inside the scroll
element `el`):

1. Document capture. A keymap runtime with a chord pending or a key held claims first. Both the
   editor's runtime and a host's runtime rooted at `document` do this.
2. `el` capture: `holdKeyForComposition` stops propagation while composing, so nothing after sees the
   key ([inputSelectionController.ts:3003](../../packages/editor/src/editor/inputSelectionController.ts)).
3. `el` bubble: the editor keymap runtime (installed first, [Editor.ts:721](../../packages/editor/src/editor/Editor.ts)),
   then the keydown fallback, which ignores keys aimed at the hidden input.
4. Listeners a contribution added on its own container, in whatever order they were attached.
5. Document bubble: a host keymap rooted at `document`. Platform's is here and the editor keymap is
   disabled there (`HOSTED_EDITOR_KEYMAP`).
6. Default action: `beforeinput` (textarea) or `textupdate` (EditContext), then the editor commits.

Text reaches the document from five sources, the `pendingTextSource` values in
[inputState.ts](../../packages/editor/src/editor/inputState.ts): `beforeinput`, `composition`,
`deduced`, `paste` and `drop`. A key filter alone cannot stop the last four.

### Key participant (experimental)

`scope.keyParticipant(participant)` on a `createPlugin` scope; `EditorKeyParticipant` is
`(event, context) => 'consume' | 'delegate'` from `@singapore-editor/core/extensions`.

- Asked at an `el` capture listener registered after `holdKeyForComposition`, so ahead of the editor
  keymap (step 3) and a host keymap (step 5), and never while a composition is active.
- Only unmodified and Shift-only keys (owner decision, Plan 122 question 2, c). Ctrl, Cmd and Alt
  chords go to the host's keymap; claiming one waits for E026 default keys in the catalog.
- Registration order; the first `consume` wins, and the editor calls `preventDefault` and
  `stopPropagation`, so no `beforeinput` or `textupdate` follows. `delegate` changes nothing.
- `context` is the editor's keymap context, widget keys included.
- A throwing participant counts as `delegate` and is logged. Readonly views still ask participants;
  their edits are refused by `applyEdits`.

This is the keyboard twin of `registerPressParticipant` (E050 row 5).

### Text commit gate (experimental)

`scope.textGate(accepts)`: while any gate's `accepts()` answers false, text from every source is
refused at the same points readonly refuses it: `beforeinput`, `textupdate`, the hidden-input diff,
the keydown fallback, paste, drop and composition commit. It carries no source or text: the one
consumer, modal normal mode, refuses all of it. Proven on both routes in
[modal-input-findings.md](modal-input-findings.md).

### Rejected: replacing the input loop

VS Code lets an extension overwrite the `type` command and keeps `default:type` for delegation
([coreCommands.ts:2153](https://github.com/microsoft/vscode/blob/c1c5b32e3fd5a2f3922ea20d7d65055b8b4c47e2/src/vs/editor/browser/coreCommands.ts#L2153)).
Here the loop is `InputSelectionController`, 3,758 lines owning two input routes, composition,
hidden-input reconciliation, auto-closing, snippets and linked editing. A replacement inherits all of
that or breaks it, and two owners of one `beforeinput` is the failure E027 must rule out. The two
narrow hooks above express the bounded E028 grammar without it.
