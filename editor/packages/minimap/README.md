# @singapore-editor/minimap

a zoomed-out picture of the whole file beside the editor, like vs code's. drag or click it to scroll

it draws in a web worker on an offscreen canvas, so long files cost the main thread little. syntax colors, selections and marks from other plugins (search matches, diagnostics, merge conflicts) show up on it

## try it

```sh
npm install @singapore-editor/core @singapore-editor/minimap
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createMinimapPlugin } from '@singapore-editor/minimap'
import '@singapore-editor/core/style.css'
import '@singapore-editor/minimap/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
  plugins: [createMinimapPlugin({ side: 'right', showSlider: 'always' })],
})
```

the options follow vs code's `editor.minimap.*` settings: `side`, `size` (`proportional`, `fill`, `fit`), `autohide`, `showSlider`, `renderCharacters`, `maxColumn` and `scale`

comments like `// MARK: - Parsing` become section labels on the minimap. turn that off with `showMarkSectionHeaders: false` or change the pattern with `markSectionHeaderRegex`

other plugins add marks through the core's `EDITOR_MINIMAP_FEATURE` capability

## more

- `bun run bench:update` and `bun run bench:browser` measure update and scroll cost. [browser bench notes](bench/browser/README.md)

section header detection is ported from vs code, MIT, copyright microsoft
