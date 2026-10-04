# @singapore-editor/minimap

## 0.2.2

### Patch Changes

- 8d4694a: Queue capped background minimap publication through the existing deferred scheduler so an expired burst deadline keeps derived worker updates outside the synchronous edit callback. Preserve latest ordered edits, summary payloads and the existing deadline.
- 58065a4: Keep queued source-summary edits anchored to the last admitted document source when selection,
  layout or viewport updates arrive before the content notification.
- Updated dependencies [219bebd]
- Updated dependencies [8d4694a]
- Updated dependencies [0f6a1ed]
- Updated dependencies [dd900b4]
- Updated dependencies [2fc90ad]
- Updated dependencies [7f18c08]
- Updated dependencies [508fa33]
  - @singapore-editor/core@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [8bd0e75]
  - @singapore-editor/core@0.2.1
