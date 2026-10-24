# @singapore-editor/core

The browser editor at the core of Singapore, with text editing, selections, undo history, themes, and plugins.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)
const editor = new Editor(host)
editor.setText('const value = 1\n')
// Call editor.dispose() when removing the view.
```

## Content-height embedding

Use content mode for a code sample or document that scrolls with its page. Give the host its width and leave its height automatic.

Create the view with `new Editor(host, { scrollMode: 'content', wordWrap: true })`, then load the sample with `setText()`.

Content mode paints every display row and grows after edits, font changes, preview replacements and resizing. Caret and search reveal scroll outside ancestors. `setScrollMode('content')` switches an existing view to this layout. `static` keeps its existing all-row layout with horizontal editor scrolling; `virtualized` keeps a bounded window of rows.

Content mode supports up to 10,000 display rows, 1,048,576 UTF-16 source units and 1,000,000 CSS pixels of content height. Exceeding a limit throws an error with code `EDITOR_CONTENT_LAYOUT_LIMIT`. Refused replacements and edits preserve the attached document, selections and undo history. Use `virtualized` for larger documents.

## Touch selection

Status: experimental, in the source only. The npm releases (`core` 0.1.2, `plugin-ui` 0.1.0) have no touch code, and mobile is not a supported target.

Hold a word or double-tap it, keep that contact down, and drag by words across rows. Triple-tap selects a whole line and its held contact drags by lines. Four taps select the document. Ordinary swipes scroll. These gestures use the same document selections and boundaries as desktop clicks.

Touch menu chrome is opt-in through `createTouchSelectionPlugin` from `@singapore-editor/plugin-ui/touch-selection-plugin`. The plugin owns its menu, extension items and optional haptics. Core view contributions expose `onDidTouchSelection`, `getTouchSelectionAnchor`, `getSelectedText`, `getInputCommandState` and `runInputCommand` for input-aware plugins. Clipboard commands retain active paste providers and browser clipboard authorization.

What tests cover it:

- Unit tests for the gesture recognizer (`test/touchSelection.test.ts` in this package) and the menu and plugin (`packages/plugin-ui/test/touchSelection*.test.ts`).
- Playwright specs in `examples/app/test/mobile-*.spec.ts`, which run in Chromium and WebKit with an iPhone 13 profile. The repository's CI workflows do not run them. Run them with `bun run --cwd packages/singapore/examples/app test:e2e`.
- Notes on a Mobile Safari run on the iOS 26.5 simulator in [Browser quirks](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/docs/display/browser-quirks.md#ios-native-long-press-selection).

The automated tests above do not run on a physical phone, and [Browser quirks](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/docs/display/browser-quirks.md#touch-haptic-availability) lists physical-device haptic feedback as unverified.

## Shiki entry point

`@singapore-editor/core/shiki` is a subpath export of this package. It holds the Shiki-based tokenizer that runs in a worker (`createShikiWorkerOwner`, `ShikiWorkerOwner`), `createShikiHighlighterPlugin` for editors that bring their own Shiki grammar and theme loaders, and theme converters such as `editorThemeFromVscodeTheme`. The [Themes guide](https://singapore.shaulavo.dev/docs/guides/themes/) uses the converters. For editor syntax colors, use the [`tree-sitter`](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/packages/tree-sitter/README.md) package instead. The unpublished `highlighting` package builds on this entry point for snippets and diffs. Worker details are in [Worker topology](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/docs/architecture/worker-topology.md#shiki-tokenizer-worker).

## API highlights

- `Editor.setText()` loads text into a view.
- `openDocument()` gives a document its own identity.
- `dispose()` releases the view and its plugins.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/core/overview/)

## In the Singapore family

Start with `@singapore-editor/core`. Add optional packages for gutters, search, syntax, or language server features.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/LICENSE)
