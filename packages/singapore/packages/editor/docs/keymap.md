# keymaps

Editor uses `@fregat/hotkeys` for key parsing, predicates, chords, and browser event ownership. Command metadata lives in the Editor catalog; shortcuts live in explicit pack data.

## Standalone editors

`new Editor(container)` installs the base text controls and the named `defaultEditorPacks`. Markdown shortcuts are opt-in. Pack values contain `linux`, `mac`, and `windows` binding arrays.

```ts
import { Editor } from '@singapore-editor/core/editor'
import { defaultEditorPacks, markdownPack } from '@singapore-editor/core/keymap'

const editor = new Editor(container, {
  keymap: {
    packs: [...defaultEditorPacks, markdownPack],
    bindings: [
      {
        keys: ['Mod+K', 'Mod+C'],
        command: 'editor.action.commentLine',
        context: 'Editor && !EditorWidget && writable',
      },
    ],
  },
})
```

`packs: []` keeps the minimal base controls. `bindings` appends custom rows at user precedence. A `command: null` row unbinds matching keys. `setKeymap()` updates the standalone dispatcher live and cancels a pending chord when its table changes. Equivalent tables leave the current table in place.

The named packs are `vscodeNavigationPack`, `vscodeSelectionPack`, `vscodeEditingPack`, `vscodeAdvancedEditingPack`, `vscodeMultiCursorPack`, `vscodeFindPack`, `vscodeFoldingPack`, `vscodeLspNavigationPack`, `vscodeLspEditingPack`, `vscodeInlineSuggestPack`, `suggestPack`, `markdownPack`, and `readonlyDiffPack`. `baseEditorKeymap` supplies minimal controls and widget rows.

## Hosted editors

The host owns the window dispatcher and installs all bindings. A hosted Editor contributes a node, live context, and handlers without installing any binding listener or table.

```ts
import { createBrowserDispatcher, detectPlatform } from '@fregat/hotkeys'
import { baseEditorKeymap, vscodeEditingPack } from '@singapore-editor/core/keymap'

const platform = detectPlatform()
const hotkeys = createBrowserDispatcher({ root: document })
const windowNode = hotkeys.createNode({ context: 'Workspace' })
hotkeys.attachElement(windowNode, document.body)
hotkeys.setKeymap([
  ...baseEditorKeymap[platform],
  ...vscodeEditingPack[platform],
  { keys: 'Mod+B', command: 'sidebar.toggle', context: 'Workspace' },
])
const editor = new Editor(container, {
  hotkeys,
  hotkeysParent: windowNode,
  keymapContext: { mode: 'full', extension: 'ts' },
})
```

`editor.getHotkeysHost()` exposes the dispatcher and Editor node. `editor.registerKeymapNode()` attaches a child widget element and its command handlers. Plugins use the same method through `EditorViewContributionContext`; contribution disposal removes its nodes. Editor disposal removes its node and listeners and leaves a host dispatcher running.

## Context and command policy

The Editor node always identifies as `Editor`. It samples `writable`, `hasSelection`, `tabFocusMode`, and `inlineSuggestionVisible` on each dispatch capture. Plugins contribute identifiers through `registerKeymapContextKey`: Find supplies `findVisible`, Markdown supplies `markdown`, and LSP supplies `suggestWidgetVisible`, `parameterHintsVisible`, and `parameterHintsMultipleSignatures`. Metadata values are `mode` (`full`, `single_line`, or `diff`) and `extension`; an explicit extension takes precedence over the document filename.

Find, replace, rename, tooltip, and rendered Markdown links have child nodes with `EditorWidget` and their local identity. Pack predicates address descendants with `Editor > FindWidget`, for example. Field navigation remains native, and host commands still bubble through the focus tree. Tooltip controls publish `TooltipControl` so scrolling shortcuts address only the tooltip body. Command handlers enforce mutation policy on readonly views for keyboard, direct, and contributed command dispatch.

## Chords and text input

The dispatcher captures context once per stroke and resolves each chord prefix through the current focused path. A mismatch replays the current stroke; an ambiguous prefix waits for its continuation or timeout. Focus changes cancel pending state. Pack order and later row precedence are defined by `@fregat/hotkeys`.

Text entry, composition, browser clipboard events, and completion commit characters stay in their native input paths. Enter and clipboard shortcuts invoke Editor commands through the dispatcher; the newline command uses the same indentation, pair, list, and multi-cursor edit pipeline as text input. Clipboard command rows allow trusted browser clipboard events to complete.
