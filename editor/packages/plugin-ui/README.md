# @singapore-editor/plugin-ui

the hover and popups that editor plugins share. language servers, diff hovers and character warnings all answer into one hover tooltip, rendered from markdown, so the editor shows one surface per position

## try it

```sh
npm install @singapore-editor/core @singapore-editor/plugin-ui
```

a plugin adds to the hover by registering a participant. this one shows the word under the pointer

```ts
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { EDITOR_HOVER_PARTICIPANT } from '@singapore-editor/plugin-ui/hover-participant'

export const wordHover: EditorPlugin = {
  name: 'word-hover',
  activate: (context) =>
    context.registerViewContribution({
      createContribution: (view) => {
        const registration = view.registerProvider(
          EDITOR_HOVER_PARTICIPANT,
          { language: '*' },
          {
            computeSync: ({ anchor, snapshot }) => {
              const word = snapshot.textSnapshot.readRange(anchor.range.start, anchor.range.end)
              return [{ ordinal: 0, range: anchor.range, markdown: `**${word}**` }]
            },
          },
        )
        return { update: () => undefined, dispose: () => registration.dispose() }
      },
    }),
}
```

pass it in `plugins` when you create the editor. the hover itself loads the first time a participant registers, so importing the token costs little. slow answers go in `computeAsync`, which can emit parts as they arrive

## other pieces

- `createTooltipController` draws the same tooltip anywhere you have a `DOMRect` to anchor it to
- `createAnchoredSurface` places any popup next to an anchor. every surface it places carries `data-editor-popup`, so one selector styles them all
- `renderTooltipMarkdown` is the markdown renderer the tooltip uses
- `hoverTargetRange` and `identifierRangeAtOffset` find the text a hover is about

each has its own subpath (`/tooltip`, `/anchored-surface`, `/markdown-tooltip`, `/offset-range`) as well as the root export

## more

- [core](../editor/README.md), for the plugin api
- [lsp-plugin](../lsp-plugin/README.md), the biggest participant
