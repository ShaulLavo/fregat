# @singapore-editor/markdown

Markdown authoring and live preview for the Singapore editor. Markdown text stays the document — this renders it as
formatted text without ever converting it into another model.

```ts
import {
  createMarkdownAuthoringPlugin,
  createMarkdownPreviewPlugin,
} from '@singapore-editor/markdown'
import '@singapore-editor/markdown/style.css'

new Editor(container, {
  plugins: [markdown(), createMarkdownAuthoringPlugin(), createMarkdownPreviewPlugin()],
})
```

The plugin's presence is the switch. It needs a markdown language plugin alongside it (for example
`markdown()` from `@singapore-editor/tree-sitter-languages`), because it reads that grammar's current syntax records.

## What it does

| Source                  | Rendered        |
| ----------------------- | --------------- |
| `# Title`               | `Title`         |
| `a **bold** b`          | `a bold b`      |
| `an _em_ word`          | `an em word`    |
| ``use `code` here``     | `use code here` |
| `[docs](https://x.dev)` | `docs`          |
| `![alt](img.png)`       | `alt`           |
| `- item`                | `• item`        |

Ordered lists, block quotes, escapes, and fenced code blocks are deliberately left as written.

## How it works

There is no second document model. The buffer holds markdown text and the editor's inline display
transform paints something else over parts of it — see [Display: Transforms](../../docs/display/transforms.md).
Because the text never changes, undo, selections, folds, find, and anchors all keep working on the
markdown itself, and there is no round-trip to lose fidelity to.

Constructs reveal as you reach them: put the caret anywhere inside `**bold**` and both fences come
back, so it stays editable as plain text.

`markdownInlineReplacements(text, captures)` is exported on its own if you want the derivation
without the plugin.

## Authoring

`createMarkdownAuthoringPlugin()` works in plain source and live preview. It registers
commands for bold, italic, strikethrough, inline code, links, level-two headings,
bullet and numbered lists, tasks, quotes and fenced code. The default keymap binds
Mod+B, Mod+I and Mod+Shift+K to bold, italic and links. Tab and Shift+Tab indent
and outdent list items. Commands operate on one selection in a writable Markdown
document and preserve the source buffer's undo history.

Current parser records let a command remove the surrounding mark at the caret or
select an existing link destination. Each command edits source directly; rich-text
editing with permanently hidden syntax remains a separate interaction policy.

Semantic commands wait for current parser records. A pending command is canceled if
its document, source, selection or writability changes. Toggling a nonempty selection
removes intersecting marks within that selection while preserving formatting outside
it; an unmarked selection receives marks on each nonblank line. Italics use asterisks
so partial-word selections remain valid Markdown. Numbered tasks support the same
completion command as bulleted tasks.
