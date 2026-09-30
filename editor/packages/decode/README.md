# @singapore-editor/decode

Opt-in editor plugin that animates a file _writing itself_ when it opens — the text reveals as if
it were being generated in front of you. The plugin's presence is the switch: include
`createDecodePlugin(...)` in the editor's plugin list to turn it on, remove it to turn it off.

```ts
import { createDecodePlugin } from '@singapore-editor/decode'
import '@singapore-editor/decode/style.css'

createDecodePlugin({ mode: 'autoregressive' }) // or 'parallel'
```

## Modes

- `autoregressive` — writes line by line from the top (classic typewriter), a caret riding the edge.
- `parallel` — every line writes itself left→right at once, with a short top-down cascade.

- `token` reveals one token at a time.
- `diffusion` fills a glyph overlay until the real text takes over.

## How it works

The plugin acquires row presentation handles and animates the mounted text with a WAAPI
`clip-path` reveal. Carets and diffusion glyphs live in plugin-owned overlays. Row invalidation
cancels the reveal before the editor replaces or recycles the text. Keypresses, clicks, wheel input,
and every viewport update cancel an active reveal, including horizontal and sub-row scrolling.
All completion and cancellation paths release the row handles. Reduced motion disables animation.

Rows stay hidden from document open until the initial highlight settles. A viewport restoration
while highlighting is pending preserves that wait; the reveal acquires the current visible rows
when highlighting settles. A document without a highlighter settles as `plain` at once; a failed
highlight settles as `error` and reveals uncoloured. Input during the wait shows the document
straight away.
