---
'@singapore-editor/core': patch
---

Fixed text entry over selections made directly in the editor's accessible textarea, including selections moved by assistive technology. IME commits now replace the range selected when composition started, including commits delivered through `beforeinput`.
