---
'@singapore-editor/core': patch
'@singapore-editor/file-animation': patch
---

Breaking: `createFileEditAnimationPlugin` now morphs every text change except keyboard text input, including small commands such as indenting and toggling comments; remove the `minEditChars` option from calling code. Added `typing` to `EditorContributionChange`, true when a change is typed text, Enter, Backspace or Delete at a caret, or IME composition.

Fixed lines that swap places in a morph: each line now slides whole to its new spot, where shared words and punctuation used to fade out and back in.

Fixed Markdown preview briefly showing raw source after every edit: replacements from a provider that needs syntax now carry through an edit until the next parse, following lines the edit only moved. `createFileEditAnimationPlugin` now animates documents with inline replacements: rows it can draw morph as before, and rendered rows slide or fade in as whole rows.
