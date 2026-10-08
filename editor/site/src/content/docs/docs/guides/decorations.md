# Decorations

Add visual marks without changing document text. You need a mounted editor and UTF-16 ranges for the text you want to mark.

## 1. Paint a range

```ts
import { Editor } from '@singapore-editor/core/editor'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!)
editor.setText('Remember to save\n')
editor.setRangeDecorations([{ start: 0, end: 8, style: { backgroundColor: '#315066' } }])
```

The first word gets a background colour. Ranges use UTF-16 offsets. Set `zIndex` when several decoration layers need a stable paint order.

## 2. Choose a longer-lived range

`EditorDecorationStore` in the extensions entry point stores owned ranges and projects them through edits. Start and end biases determine whether inserted text at each edge enters the range. Clear a feature's decorations when its owner closes.

## 3. Choose the right presentation

Text paint, row presentation, gutter cells, minimap marks and inline widgets have separate contribution contracts. Use a row or widget contribution when you need DOM content. The CSS Highlight API can paint text colours and backgrounds but cannot change its layout or font weight.

## If it doesn't work

### A mark points to the wrong text after an edit

A raw offset belongs to a specific text version. Use tracked ranges or anchors and resolve them against the current version before painting.

### The mark changes paint order when scrolling

Give overlapping layers explicit ordering and check that the plugin removes its old contribution on disposal.

Continue with [anchors](../concepts/anchors.md), [highlighting](../concepts/highlighting.md) and [writing a plugin](plugins.md).
