# ghostty-webgpu-line-editor

Readline-style editing for local shells hosted by ghostty-webgpu. Working package name and initial version `0.0.1`. This package is under development and has not been published.

The editing checkpoint provides a browser-independent model, keymap, history and read lifecycle. Native terminal rendering and the `readline()` extension are the next integration unit. The current checkpoint does not attach to a terminal or replace the site's Shell editor.

## Editing model

`EditModel` edits grapheme boundaries and exposes a snapshot containing `text`, a UTF16 `cursor` offset, `revision` and reverse-search state. `keyCommand()` maps keyboard keys and modifiers to typed editing commands. Displayed cell widths and wrapping belong to the terminal's native API; this model computes neither.

`ReadSession` accepts `SessionOptions` and an event callback. `read({ prompt, secondaryPrompt, signal })` allows one active read. `dispatch()` processes editing commands and resolves a typed result on submission, interruption or end-of-input. Abort and disposal reject with structured errors. Completion and completeness callbacks receive an abort signal; their stale results are discarded after edits, later requests and read cancellation.

```ts
import { ReadSession } from 'ghostty-webgpu-line-editor'

const session = new ReadSession({
  complete: (text, cursor, signal) => host.complete(text, cursor, signal),
  isComplete: (text) => host.isComplete(text),
})
const pending = session.read({ prompt: '$ ', signal })
await session.dispatch({ kind: 'insert', text: 'echo hello' })
await session.dispatch({ kind: 'submit' })
const result = await pending
```

Completion candidates are replacements for the whitespace-delimited token before the cursor. A common grapheme prefix extends that token. A second Tab at the same revision emits the candidate list. Hosts that need shell-aware quoting can implement candidate formatting in their callback.

`History` keeps the most recent 100 entries by default and restores the draft after navigation. A host can provide a `HistoryStore` with `load()` and `save(entries)`, call `history.load()` before reading, and use `history.flush()` to await saves. Snapshots passed to the store are frozen, bounded arrays. The package chooses no browser storage key.

## Verification

From this directory, run `bun run verify`. Tests run in Node through Vitest. From the repository root, the package is included in `build:workspaces`, workspace lint/typecheck/test commands and the Ghostty CI job.

The approved delivery work lives in [Plan 286](../plans/286-ghostty-extensions.md), under the root [roadmap](../PLAN.md).
