# @singapore-editor/markdown

live preview and editing commands for markdown in `@singapore-editor/core`

the buffer keeps holding markdown. the preview hides the syntax and paints formatted text over it, so `**bold**` shows as **bold**, `# Title` loses its `#`, and links become anchors. put the caret inside a construct and its source comes back for editing. undo, selections, folds, find and anchors all work on the markdown itself

## try it

```sh
npm install @singapore-editor/core @singapore-editor/tree-sitter @singapore-editor/tree-sitter-languages @singapore-editor/markdown
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import { markdown } from '@singapore-editor/tree-sitter-languages'
import {
  createMarkdownAuthoringPlugin,
  createMarkdownPreviewPlugin,
} from '@singapore-editor/markdown'
import '@singapore-editor/markdown/style.css'

const editor = new Editor(element, {
  plugins: [markdown(), createMarkdownPreviewPlugin(), createMarkdownAuthoringPlugin()],
})
editor.openDocument({
  documentId: 'notes.md',
  text: '# Notes\n\nsome **bold** text\n',
  languageId: 'markdown',
})
```

both plugins read the markdown grammar's parse, so `markdown()` has to be there too

`createMarkdownPreviewPlugin({ openLink })` lets the host open link targets through its own navigation. `languageIds` widens it past plain `markdown`

`createMarkdownAuthoringPlugin()` adds commands for bold, italic, links, lists, tasks, quotes and code. Import `markdownPack` from `@singapore-editor/core/keymap` and pass `keymap: { packs: [...defaultEditorPacks, markdownPack] }` to enable Mod+B, Mod+I, Mod+Shift+K and list indentation with Tab

## more

- [authoring commands](docs/authoring.md): the full list and how they edit
- [display transforms](../../docs/display/transforms.md), the editor feature the preview paints with
- `markdownInlineReplacements(text, records, options)` returns the preview's replacements without the plugin
