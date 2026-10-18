---
'@singapore-editor/core': patch
'@singapore-editor/decode': patch
---

Breaking: `createMorphPlugin` now morphs every text change except keyboard text input, including small commands such as indenting and toggling comments; remove the `minEditChars` option from calling code. Added `typing` to `EditorContributionChange`, true when a change is typed text, Enter, Backspace or Delete at a caret, or IME composition.

Fixed lines that swap places in a morph: each line now slides whole to its new spot, where shared words and punctuation used to fade out and back in.
