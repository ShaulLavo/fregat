# Plan 225: Add paragraph editing, reflow and kill-ring commands

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 204, Plan 206. Size: M. Triage item: ZT-06.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Move and select by paragraph, delete to line boundaries, transpose characters, reflow prose and yank a kill ring.

## Covered Zed actions and behavior

`editor::DeleteToBeginningOfLine`; `editor::DeleteToEndOfLine`; `editor::KillRingCut`; `editor::KillRingYank`; `editor::MoveToEndOfParagraph`; `editor::MoveToStartOfParagraph`; `editor::Rewrap`; `editor::SelectToEndOfParagraph`; `editor::SelectToStartOfParagraph`; `editor::Transpose`.

- `editor::MoveToStartOfParagraph` and `MoveToEndOfParagraph` move across runs of
  nonblank buffer lines to blank-line/document boundaries. Selection variants keep
  the anchor and move the head. Soft wraps do not create paragraphs. See
  [crates/editor/src/navigation.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/navigation.rs#L583) and
  [crates/editor/src/movement.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/movement.rs#L527).
- `DeleteToBeginningOfLine` and `DeleteToEndOfLine` delete a selection or extend an
  empty selection to the requested boundary through the existing line motion rules.
  Preserve action defaults for soft wraps and indentation. See
  [crates/editor/src/input.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/input.rs#L1114) and `actions.rs` in the same directory.
- `Transpose` swaps adjacent characters around an empty caret, with an end-of-line
  adjustment, and groups edits in one transaction. See
  [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L7869).
- `Rewrap` splits work at paragraph, indentation, and comment-prefix boundaries and
  preserves those prefixes while wrapping to the configured column. See
  [crates/editor/src/rewrap.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/rewrap.rs#L4).
- `KillRingCut` cuts the selection or the remaining display line, then its newline
  at line end. Compatible consecutive cuts append to one retained entry.
  `KillRingYank` pastes that entry and stops append mode. This pinned implementation
  retains one entry with selection metadata. See
  [crates/editor/src/clipboard.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/clipboard.rs#L426).

## Existing Fregat and Editor work

Editor source below was verified in `/work/projects/Editor/packages/` before Plan 207.
Implement it in Fregat `editor/packages/` after that cutover; the external checkout is
read-only for this wave.

[packages/editor/src/editor/commandCatalog.ts](/work/projects/Editor/packages/editor/src/editor/commandCatalog.ts) contains word/subword deletion,
line edits, and undo commands. [packages/editor/src/documentSession.ts](/work/projects/Editor/packages/editor/src/documentSession.ts) supplies
anchored selection changes and transactions; [packages/editor/src/textRanges.ts](/work/projects/Editor/packages/editor/src/textRanges.ts)
contains word boundaries. Fregat's hosted command adapter can reuse these operations.
Paragraph boundaries, comment-aware reflow, transpose, and a kill-ring owner need additions.

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Add pure range/transform helpers in `editor/packages/editor/` and route edits through
DocumentSession transactions. Reuse display-line and indentation motion helpers
for deletion and kill operations; paragraph motion uses logical buffer lines.
Track one kill entry across editor views in an exposed zustand store owned by the
editing service. Include source identity and append position so unrelated cuts replace
it. Standalone Editor gets the same service contract without Fregat feature imports.

Use syntax/language metadata for comment prefixes and the registry's wrapping setting.
Register any missing wrap-column setting in `packages/contracts/src/settings/keys.ts`
in the same change, then regenerate `settings:reference`. Readonly commands decline
before changing text or the kill entry.

## Steps

- [ ] Write failing fixtures for paragraph ranges, transpose, prefix-preserving reflow, and consecutive kill cuts.
- [ ] Implement paragraph motion/selection and line-boundary deletion using existing range helpers.
- [ ] Add transpose and reflow as single document transactions across selections.
- [ ] Implement the shared kill-entry owner, append conditions, metadata-preserving yank, and reset conditions.
- [ ] Register command declarations and Plan 206 preset rows; register any missing wrapping setting.
- [ ] Add `paragraph-and-kill-ring-commands`, read screenshots, and ship the change.

## Acceptance

Run focused range/transform fixtures and transaction tests. Cover blank-line runs,
CRLF, Unicode graphemes, soft wraps, EOF, reversed/multiple selections, comment/list
prefixes, readonly refusal, and one undo per edit. Verify consecutive compatible cuts
append, a cut elsewhere replaces the entry, and yank disables append. In
`agent:browser scenario paragraph-and-kill-ring-commands`, reflow a fixture comment,
select a paragraph, transpose at line end, and kill/yank across two hosted views.
Check actual text and undo, then read screenshots back.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
`bash /work/tmp/wave-heavy/run.sh "zt-06" -- env PATH="$PATH" <command>`.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run install-release`, or
`bun run install-release --server --restart` when server code changes. Confirm the served release.

## Out of scope

A history of kill entries or yank cycling, Vim registers/macros, formatting-server
integration, and TUI editing UX.
