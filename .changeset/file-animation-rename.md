---
'@singapore-editor/file-animation': patch
---

Breaking: `@singapore-editor/decode` is now `@singapore-editor/file-animation`. Rename imports: `createDecodePlugin` is `createFileTransitionPlugin`, `DecodeMode` is `FileTransitionMode`, `DecodePluginOptions` is `FileTransitionPluginOptions`, `createMorphPlugin` is `createFileEditAnimationPlugin` and `MorphPluginOptions` is `FileEditAnimationPluginOptions`. The `editor-decode-*` CSS classes are now `editor-file-transition-*`.

Added the `magicMove` file transition mode: opening a file slides the text it shares with the previous file from where it stood on screen to its new place, while the rest fades out and in.
