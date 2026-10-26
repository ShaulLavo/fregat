# Package notes at the standalone switch-over

These pending Changesets notes came from Fregat before package ownership moved to the standalone repositories. They are preserved here as historical release-note input. Fregat now pins published artifacts and has no public workspace packages to version. The original files and their originating commits remain in Git history.

## calm-host-snapshots.md

```markdown
---
'@singapore-editor/collab': patch
---

Fixed `Host.submit()` to preserve queued edits and deliver committed messages when a supplied engine's `snapshot()` throws. Later submissions, including retries of accepted edits, retry queued work without duplicate delivery. Callback failures retain their first thrown value and take precedence over settlement errors.
```

## compiled-terminal-shaders.md

```markdown
---
'ghostty-webgpu-shaders': patch
---

Added `createShaderAddon` for optional compiled WGSL and GLSL terminal effects. The separate package supports shader replacement, pause, and disposal without loading a compiler or changing terminal core dependencies.
```

## custom-touch-selection.md

```markdown
---
'@singapore-editor/core': patch
'@singapore-editor/plugin-ui': patch
---

Changed touch selection to use editor-owned word, line and document selections with double, triple and quadruple taps, long-press dragging and edge scrolling. Added input gesture events and selection commands for optional plugins. Added `createTouchSelectionPlugin` in `@singapore-editor/plugin-ui` with Cut, Copy, Paste, Select all, available Undo/Redo actions, custom items and optional supported haptic feedback.
```

## decode-reveal-overlay.md

```markdown
---
'@singapore-editor/file-animation': patch
---

Improved the `createFileTransitionPlugin` reveals: they start the moment a file opens instead of waiting for highlighting, take colours as highlighting lands, keep playing through scrolls, and run as compositor animations. Autoregressive, parallel and token modes now write token by token behind a caret; diffusion resolves scrambled tokens in clusters. Morphs and reveals keep a repainted row hidden until they finish.
```

## file-animation-rename.md

```markdown
---
'@singapore-editor/file-animation': patch
---

Breaking: `@singapore-editor/decode` is now `@singapore-editor/file-animation`. Rename imports: `createDecodePlugin` is `createFileTransitionPlugin`, `DecodeMode` is `FileTransitionMode`, `DecodePluginOptions` is `FileTransitionPluginOptions`, `createMorphPlugin` is `createFileEditAnimationPlugin` and `MorphPluginOptions` is `FileEditAnimationPluginOptions`. The `editor-decode-*` CSS classes are now `editor-file-transition-*`.

Added the `magicMove` file transition mode: opening a file slides the text it shares with the previous file from where it stood on screen to its new place, while the rest fades out and in.
```

## ghostty-short-line-height.md

```markdown
---
'ghostty-webgpu': patch
---

Added support for `font.lineHeight` values down to 0.5. Shorter lines centre glyphs vertically and clip them to their cell spans in WebGPU, WebGL2, Canvas2D and DOM renderers.
```

## history-viewer-restoration.md

```markdown
---
'@singapore-editor/core': patch
---

Fixed `createHistoryViewer()` refreshing its graph when `restoreHistory()` loads saved history into an attached buffer, including after `clearHistory()`.
```

## morph-every-edit.md

```markdown
---
'@singapore-editor/core': patch
'@singapore-editor/file-animation': patch
---

Breaking: `createFileEditAnimationPlugin` now morphs every text change except keyboard text input, including small commands such as indenting and toggling comments; remove the `minEditChars` option from calling code. Added `typing` to `EditorContributionChange`, true when a change is typed text, Enter, Backspace or Delete at a caret, or IME composition.

Fixed lines that swap places in a morph: each line now slides whole to its new spot, where shared words and punctuation used to fade out and back in.

Fixed Markdown preview briefly showing raw source after every edit: replacements from a provider that needs syntax now carry through an edit until the next parse, following lines the edit only moved. `createFileEditAnimationPlugin` now animates documents with inline replacements: rows it can draw morph as before, and rendered rows slide or fade in as whole rows.
```

## osc-predicate-reentrancy.md

```markdown
---
'ghostty-webgpu': patch
---

Fixed `subscribeCustomOsc` payload corruption when its capture predicate writes to the same terminal. Each observation preserves the original OSC payload through reentrant terminal writes.
```

## qualified-markdown-parser.md

```markdown
---
'@singapore-editor/core': patch
'@singapore-editor/markdown': patch
'@singapore-editor/tree-sitter': patch
'@singapore-editor/tree-sitter-languages': patch
---

Changed the Markdown parser dependency to version 0.1.32, using the same grammar and runtime across the editor packages.
```

## quiet-terminal-input-positioning.md

```markdown
---
'ghostty-webgpu': patch
---

Improved: unfocused terminals no longer reposition their input and composition elements on every cursor move.
```

## quiet-touch-selection.md

```markdown
---
'@singapore-editor/core': patch
---

Fixed `Editor.clearDocument()`, `Editor.clear()`, and `Editor.detachSession()` retaining the previous document through touch selection state. These operations now cancel pending touch gestures.
```

## reader-coalesced-updates.md

```markdown
---
'ghostty-webgpu': patch
---

Changed `accessibility` to coalesce the displayed row list, cursor position and recent-output announcements on a 100 ms refresh delay, with immediate refreshes on enable, focus and history navigation and suspended updates in hidden documents. Intervals containing a resize or font reflow update readable text silently, including output received in that interval; the next output-only interval resumes announcements. Public `onText` subscribers continue receiving every submitted text frame.
```

## singapore-native-input-selection.md

```markdown
---
'@singapore-editor/core': patch
---

Fixed text entry over selections made directly in the editor's accessible textarea, including selections moved by assistive technology. IME commits now replace the range selected when composition started, including commits delivered through `beforeinput`.
```

## singapore-touch-caret.md

```markdown
---
'@singapore-editor/core': patch
---

Fixed the editor caret following the active end of a touch selection as native selection handles move, including backward selections and dragging onto another row. Native handle updates keep the browser highlight and batch caret painting once per frame.
```

## singapore-touch-presses.md

```markdown
---
'@singapore-editor/core': patch
'@singapore-editor/diff': patch
'@singapore-editor/lsp-plugin': patch
---

Breaking: `EditorPressParticipant` now receives `MouseEvent | TouchEvent` so plugins can claim taps and holds before selection changes. Update typed participants to accept both event types and read touch coordinates from `event.touches[0]`. Fixed touch control ownership, blank-area caret placement, repeated word-selection notifications, and backward native selections after edits.

Fixed touch press handling on diff separators and modified-touch definition links.
```

## singapore-touch-selection.md

```markdown
---
'@singapore-editor/core': patch
---

Fixed touch text selection: double-tapping and holding select words, dragging extends the selection, and tapping places the caret. Native text selection changes now update the editor's selection so copying uses the text selected on screen.
```

## terminal-immediate-presentation.md

```markdown
---
'ghostty-webgpu': patch
---

Added the `presentation` terminal option. `'immediate'` draws the first write of each display frame right away, prefers WebGL2, and asks for a desynchronized (low-latency) canvas; `diagnostics.desynchronized` reports the context's `desynchronized` attribute.
```

## terminal-output-timing.md

```markdown
---
'ghostty-webgpu': patch
---

Added the `outputTiming` terminal event. For each burst of written output it reports the last typed input before it, the first and last write, when a frame drew the output and when the browser's page update carried it, all as `performance.now()` times. Bursts end after `outputTiming.quietMs` (default 100) without output, input counts within `outputTiming.inputWindowMs` (default 2000), and timing is recorded only while a listener is attached. `TerminalDataEvent` gains `origin`: `'input'` for typed, pasted, mouse and `sendInput` data, `'reply'` for the terminal's own answers and focus reports.
```

## tidy-parsers-grow.md

```markdown
---
'@singapore-editor/tree-sitter': patch
---

Fixed parser initialization on hosts without resizable WebAssembly memory. Parser memory continues to grow while Markdown uses the same runtime as the host. Query ranges use UTF-16 code units to preserve lower-document highlights and incremental language injections.
```

## tree-sitter-stable-heap.md

```markdown
---
'@singapore-editor/markdown': patch
'@singapore-editor/tree-sitter': patch
'@singapore-editor/tree-sitter-languages': patch
---

Breaking: Tree-sitter and Markdown parsing require Node.js 26.0.0 or newer, Bun 1.2.22 or newer, Chromium 144 or newer, Firefox 145 or newer, or Safari 26.2 or newer.

Improved memory growth so retained `heap()` views stay attached and track the new heap length.

Fixed Markdown extension access above 2 GiB and semantic decoding from resizable memory by updating `tree-sitter-md` to 0.1.6.
```
