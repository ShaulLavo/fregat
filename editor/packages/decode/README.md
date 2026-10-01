# @singapore-editor/decode

an editor plugin that makes a file look like it's being written when it opens. the text reveals itself as if a model were generating it in front of you

add the plugin to turn it on, remove it to turn it off. there's no setting or command

## try it

```sh
npm install @singapore-editor/core @singapore-editor/decode
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createDecodePlugin } from '@singapore-editor/decode'
import '@singapore-editor/core/style.css'
import '@singapore-editor/decode/style.css'

const editor = new Editor(document.querySelector('#editor')!, {
  plugins: [createDecodePlugin({ mode: 'parallel' })],
})
editor.openDocument({
  documentId: 'example.ts',
  text: 'const value = 1;\n',
  languageId: 'typescript',
})
```

## modes

- `autoregressive` (default) writes line by line from the top, with a caret riding the edge
- `parallel` writes every line left to right at once, each starting at a random offset
- `token` reveals one word-ish token at a time, at a steady rate
- `diffusion` fills the rows with noisy glyphs that settle into the real text

## options

all optional, all in milliseconds unless noted

- `perCharMs` per character, default 20
- `perTokenMs` per token in `token` mode, default 65
- `speed` multiplies whichever mode is active, default 1
- `maxDurationMs` caps the whole reveal, default 1400
- `staggerMs` is the random start window in `parallel` mode, default 420
- `maxRows` caps how many visible rows animate, default 400

## behavior

rows stay hidden from open until the first highlight settles, so the reveal is already colored. a document with no highlighter starts at once, and a failed highlight reveals uncolored

a keypress, click, wheel or any scroll cancels the reveal and shows the text. reduced motion turns the animation off
