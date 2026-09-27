# @singapore-editor/core

Core runtime for the Singapore code editor.

This package contains the editor class, document model, selection and anchor primitives, syntax
session contracts, rendering types, plugin APIs, themes, keymaps, and the core stylesheet.

## Install

```sh
npm install @singapore-editor/core
```

Singapore packages publish TypeScript source and CSS assets. Use them with a bundler or runtime that
can transpile TypeScript from dependencies.

## Basic Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const editor = new Editor(document.querySelector('#editor')!)

editor.openDocument({
  documentId: 'example.ts',
  text: 'const value = 1;\n',
  languageId: 'typescript',
})
```

## Main Entry Points

- `@singapore-editor/core` exports the public editor, document, rendering, syntax, keymap, and plugin APIs.
- `@singapore-editor/core/editor` exports the `Editor` runtime and editor-specific types.
- `@singapore-editor/core/document` exports document sessions, snapshots, piece-table helpers, anchors, and
  text edit primitives.
- `@singapore-editor/core/extensions` exports plugin contribution contracts.
- `@singapore-editor/core/rendering` exports themes and rendering types.
- `@singapore-editor/core/syntax` exports syntax provider and syntax token helpers.
- `@singapore-editor/core/style.css` is the base editor stylesheet.

## Theme colors

Pass `theme` when constructing an editor, or call `editor.setTheme(theme)` to update it in place.
Themes work with `new Editor(element)` and `setText(text)` without a document session.

```ts
editor.setTheme({
  type: 'dark',
  backgroundColor: '#1e1e1e',
  foregroundColor: '#d4d4d4',
  gutterBackgroundColor: '#252526',
  caretColor: '#ffffff',
  selectionColor: '#264f78',
  inactiveSelectionColor: '#3a3d41',
  popupBackgroundColor: '#252526',
})
```

`selectionColor` paints focused selections; `inactiveSelectionColor` paints them after blur.
`popupBackgroundColor` supplies the popup background used by hover, completion and rename.
Plugins can register more colors with `registerEditorColor` from the rendering entry point;
set these through `theme.colors`, keyed by the registered id. The [diff theme documentation](../diff/README.md#theme)
lists its palette and the public replacements for the removed diff base CSS hooks.

## Gutter inset

`gutterLeadingInset` puts empty pixels at the gutter's leading edge, before the first lane: room
between a screen edge and the line numbers. The lanes keep their widths and move right; the text
starts after the widened gutter. Row decorations and diff tints paint the gutter row, so they cover
the inset and a tinted row runs from the pane's edge to its text. With `cursorLineHighlight`
`gutterBackground: true`, the cursor line's gutter band covers it too.

```ts
const editor = new Editor(container, { gutterLeadingInset: 12 })
editor.setGutterLeadingInset(0) // back to a flush gutter
```

It defaults to 0, and at 0 the gutter is unchanged. An editor with no gutter lanes ignores it.

## Chords and host keymaps

Declare shortcuts as a non-empty `chord` array. Single strokes use the same field.
Each Editor owns its sequence state and cancels it when focus leaves the editor.

```ts
const editor = new Editor(container, {
  keymap: {
    layers: [
      {
        id: 'comments',
        bindings: [
          {
            chord: ['Mod+K', 'Mod+C'],
            command: 'editor.action.commentLine',
            when: ['writable'],
          },
        ],
      },
    ],
  },
})
```

`keymap.preset` selects `default` or `vscode`. The default pack puts folding under
`Mod+K`; the VS Code pack uses its folding shortcuts and adds supported language
navigation, formatting, hover, and comment chords. Packs contain only commands
implemented by this Editor. They do not supply VS Code workbench commands.

Later layers precede earlier layers. Rows within a layer retain declaration order,
including rows with the same chord and different `when` conditions. At each stroke,
the runtime captures one context and tries eligible terminal candidates in order
until one dispatch claims the event. A declined candidate runs once, then falls
through. Explicit `preventDefault: true` or `stopPropagation: true` retains event
ownership even when every eligible command declines. An eligible single stroke wins over a longer sequence with the same prefix.

An available prefix consumes the event immediately and starts a five-second timer.
After that prefix, completion and unmatched keys stay consumed even if availability
changes. Held keys remain owned through release. Repeats do not extend the timer.
`setKeymap()` replaces bindings and cancels pending state. `enabled: false` disables
shortcuts while native typing, selection, composition, and clipboard handling stay
active. Disabling retains ownership of consumed keys until release.

Hosts combining Editor and application commands can import `createKeymapRuntime`
from `@singapore-editor/core/keymap`, supply a DOM root and ordered generic bindings, and
provide synchronous context, availability, and dispatch callbacks. The returned
runtime mounts immediately and exposes `claimKeybinding`, `updateBindings`,
`setEnabled`, `cancel`, and `dispose`. Hosts must call `cancel()` when their exact
command target changes and `dispose()` when its owner unmounts. Embedded editors
then use `keymap: { enabled: false }`; their public commands remain available.

The keymap entry point imports without a DOM. `getKeymapContext()` exposes the
Editor facts used by pack conditions. `getInputElement()` identifies the native
editor input so a host can distinguish it from local widget inputs. Local widgets
handle their own idle key events before the runtime; a widget that stops an event
also prevents an application bubble listener from seeing it.

### Row presentation handles

View contributions can call `context.getRowPresentation(displayRow)` to acquire the mounted row
and an abort signal. The signal fires synchronously before logical text replacement, recycling,
provisional paint, or view disposal, while the old text and attached element are still available.
Acquisition returns `null` for an unmounted row or during its invalidation callback.

Decoration, position, and horizontal chunk-window updates preserve a handle. Plugins whose effects
depend on viewport geometry should cancel them in `updateViewport`. Call `handle.dispose()` to
release a handle. Release is idempotent and does not abort the signal, so abort listeners only
report invalidation by the editor.
