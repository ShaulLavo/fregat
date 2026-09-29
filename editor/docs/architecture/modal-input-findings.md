# Modal input through public extensions (E028 findings)

Built 2026-09-26 in wave 2, lane E1, as Platform Plan 122 phase 5. The proof is
[`examples/app/src/modal/`](../../examples/app/src/modal/): `grammar.ts` (a pure state machine) and
`modalPlugin.ts` (the plugin). It imports only public entry points: `@singapore-editor/core/document`,
`/editor` and `/extensions`. Turn it on in the example app with `?modal`.

**Verdict: go.** The experimental `createPlugin` scope carries the bounded grammar (normal and insert
modes, `h j k l w b 0 $`, counts, `d` with a motion, `dd`, `diw`, Escape, `u`) with no internal import.
Keep the four new scope methods experimental until E025 decides stability.

## What the proof needed, and the smallest fix

| Obstacle | Fix (all on the scope, lowered onto the combined view context) |
| --- | --- |
| No way to see a key before the keymaps or text input. | `scope.keyParticipant(fn)`: asked at a capture listener on the editor element, ahead of the editor's own keymap and a host's document keymap; `consume` prevents the key and stops it there. |
| Which keys a participant gets. | Owner decision (Plan 122 Q2, c): unmodified and Shift-only keys only; Ctrl, Cmd and Alt chords stay with the host's keymap, so app shortcuts keep working in a modal view. A plugin claiming such a chord needs E026 default keys, which the catalog does not carry yet. |
| Normal mode must refuse text that arrives without a keydown: IME commits, dictation, paste, drop. | `scope.textGate(accepts)`: every text-entry path (beforeinput, EditContext `textupdate`, the hidden-input diff, the keydown fallback, paste, drop, composition commit) asks the gates where it asks whether the document is writable. |
| A composition must never become a command. | The participant is never asked while a composition is active (`isComposing` or the input state's own flag); the IME keeps Escape. |
| `applyEdits` took one selection, so a multi-caret delete could not place every caret. | `scope.applyEdits(edits, selection \| selections)`; the session already accepted a list. |
| No per-view caret shape. | `scope.cursorStyle('line' \| 'block' \| 'underline')`, reset when the scope goes; drawn by the existing caret through an attribute and CSS. |
| Mode per view. | `scope.state`: one scope per view, so two views of one buffer keep separate modes. |

## Proven in a real browser

`examples/app/test/modalInput.browser.test.ts`, on both input routes (EditContext and textarea),
with trusted keys and CDP IME input: `i`, typing, Escape, `3w`, `dw`, `u` (one undo entry); no command
letters and no dictated text in normal mode; a composition commits in insert mode and is refused in
normal mode; Escape drops a pending operator; a readonly view moves but does not delete; `diw` and
`dd`; block caret in normal mode, line in insert mode; two views of one buffer in different modes;
typing returns when the plugin is removed. `modalGrammar.test.ts` covers counts, `0`, cancellation
and the inner object.

## Limits of the proof

- `j` and `k` move by buffer line, not by display row; wrapped rows and folded ranges are not
  handled (the editor's own navigation commands are, and a later version should drive them).
- The block caret is `1ch` wide: exact for a monospace face, wrong for wide graphemes and for
  proportional fonts (E052). Drawing it from grapheme geometry belongs with the caret renderer.
- The grammar is its own state machine inside the participant. The shared keymap runtime matches
  exact chords with a timeout, which cannot hold counts or an operator waiting for its motion.
- Undo is the editor's `undo` command through `scope.editor`, which is labelled unstable.
- Registers, visual mode, dot repeat, command-line mode and Ex commands are out of scope.
