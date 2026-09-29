# @singapore-editor/plugin-ui

The floating surfaces editor plugins share: an anchored popup, a hover tooltip, and the Markdown
renderer the tooltip paints with. Language servers, diff hovers and character warnings all show the
same tooltip, so it lives here rather than in any one of them.

```ts
import { createTooltipController, HOVER_REQUEST_DEBOUNCE_MS } from '@singapore-editor/plugin-ui'

const tooltip = createTooltipController({
  document,
  themeSource: editorElement,
  reentryElement: editorElement,
  classNamespace: 'my-plugin',
})

tooltip.show({
  anchor: rect,
  hoverText: '**Ambiguous character** U+2013',
  notes: [{ label: 'warning', color: 'var(--editor-warning)', text: 'Looks like a hyphen' }],
  actions: [{ label: 'Adjust settings', run: openSettings }],
  theme,
})
```

Every surface placed by `createAnchoredSurface` carries `data-editor-popup`, so a host styles all of
them with one selector instead of one class per plugin.
