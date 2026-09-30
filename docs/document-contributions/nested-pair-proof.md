# Nested pair typing and Undo proof

Typing `((a))` through the real editor input controller produced `((a)))`.
Typing the burst function produced an extra `)}`. Tracking a newly inserted pair
adopted the new snapshot and discarded the outer pairs that this editor had inserted.
The store now receives the snapshot before and after the insertion. It preserves
outer pairs only when the before snapshot matches its owned snapshot; a foreign
snapshot clears those pairs. Undo grouping is unchanged.

## Reproduction and repair

Evidence root: `/work/tmp/foundations-undo-proof`.

- `known-good-pairs.log`: the original 41 input-controller controls passed.
- `red-nested.log`: both added nested typing regressions failed; 41 controls passed.
- `green-pairs.log`: 57 input-controller and pair-store tests passed, including
  preservation across owned insertions and invalidation across foreign snapshots.
- `green-history.log`: focused input, pair-store, history and document-session checks.

The exact app fixture uses `CODE_THEME_PREVIEW_SAMPLE` in `use-events.ts`,
Ctrl+End, Enter, then five burst functions at 5ms per character. Copied selected
text establishes known-good document observability before editing.

The pre-repair diagnostic at `evidence/20260930T181715Z-scenario-editor-type-burst`
records exact typed text with trailing `)})})})})}`, the document after six Undo
commands, and every subsequent document state until restoration at 106 commands.
Six Undo commands therefore cannot assert restoration for this typing path.
Immediate painted rows also lagged behind copied document text.

The repaired existing burst scenario asserts the complete typed text, then presses
Undo until the original text is restored, bounded by the number of inserted
characters including Enter. It records all three text states and the Undo count in
`inspection.json`. It waits for two paint frames before the restored screenshot.

`evidence/20260930T182854Z-scenario-editor-type-burst` completed with exact inserted
text, no extra closers, and complete restoration after 106 Undo commands.
The typed and restored screenshots were read back. There were no failed responses,
page errors, or application warn/error logs; fixture/GPU console warnings remained.

Commands from this isolated checkout (with the heavy wrapper and local TMPDIR):

```sh
cd editor/packages/editor
bun --bun vitest run test/autoClose.test.ts src/editor/autoCloseStore.test.ts test/history.test.ts test/documentSession.test.ts
cd ../../..
WEB_PORT=5277 bun run agent:browser scenario editor-type-burst --workspace work/tmp/foundations-undo-proof/fixture --file use-events.ts
```

## Limits and interrupted verification

The first doctor recorded a cold Vite dependency-optimizer 504. An early diagnostic
had a transient fixture git-status 500; the later reproduction and final proof did
not. `green-surface.log` was interrupted when source formatting caused Vite to
reload during the drive. `green-surface-stable.log` reached the final screenshot
wait, which incorrectly awaited the editor's infinite caret-blink animation. Those
runs are retained as failed verification; the final run uses two paint frames.

The Settings preview scenario from PR212, history policy, calibration package sets,
and performance baselines remain unchanged. This proves the tiny TypeScript fixture
in Chromium; it makes no throughput, long-line, or cross-browser performance claim.
