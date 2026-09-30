# Plan 275: Vim motions and search

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-56; size L. Depends on Plan 207, Plan 204, Plan 206, Plan 274, Plan 226, Plan 225.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Vim plans also use
  `assets/keymaps/vim.json` at that commit. Preserve action identity and every payload variant.

## Outcome

Navigate text with counted Vim motions, find/search repetition, structural boundaries and viewport-relative movement.

## Zed actions and behavior

- Character/column motions include `Left`, `Right`, wrapping and column variants. `Up`/`Down`
  distinguish display lines through payloads; `LineUp`/`LineDown` follow buffer lines. Word
  start/end motions preserve word/WORD punctuation variants. Sources: [`crates/vim/src/motion.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/motion.rs).
- Line/document/paragraph/sentence motions include start/end, first non-whitespace, middle,
  next/previous line start, column and percentage targets. Count and inclusive/exclusive/linewise
  range rules depend on the motion; reversed operator ranges normalize endpoints. Source:
  [`crates/vim/src/motion.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/motion.rs) `move_point`/`range`.
- `Matching`, unmatched directions, section/method/comment and same/greater/lesser-indent
  motions use bracket, syntax and indentation boundaries. `GoToNextReference` and
  `GoToPreviousReference` use occurrence locations. Sources: [`crates/vim/src/motion.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/motion.rs), [`crates/vim/src/indent.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/indent.rs).
- `WindowTop`, `WindowMiddle`, `WindowBottom`, page/half-page and scroll actions use the
  viewport and preserve the appropriate cursor goal. Sources: [`crates/vim/src/motion.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/motion.rs), [`crates/vim/src/normal/scroll.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/scroll.rs).
- `PushFindForward`/`PushFindBackward` consume a character with before/after and multiline
  payloads; `RepeatFind`/`RepeatFindReversed` reuse it. `Search`/`SearchSubmit` save the starting
  selections and pending operator; MoveToNext/Previous and Match variants move through results
  with their direction/word-boundary semantics. Sources: [`crates/vim/src/vim.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/vim.rs), [`crates/vim/src/normal/search.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/search.rs).

All action names below have the `vim::` namespace. Preserve every argument variant in
`assets/keymaps/vim.json`, including `display_lines` and `ignore_punctuation`.

`vim::ColumnLeft`, `vim::ColumnRight`, `vim::Down`, `vim::EndOfDocument`, `vim::EndOfLine`, `vim::EndOfLineDownward`, `vim::EndOfParagraph`, `vim::FirstNonWhitespace`, `vim::GoToColumn`, `vim::GoToNextReference`, `vim::GoToPercentage`, `vim::GoToPreviousReference`, `vim::HalfPageLeft`, `vim::HalfPageRight`, `vim::Left`, `vim::LineDown`, `vim::LineUp`, `vim::Matching`, `vim::MiddleOfLine`, `vim::MoveToNext`, `vim::MoveToNextMatch`, `vim::MoveToPrevious`, `vim::MoveToPreviousMatch`, `vim::NextComment`, `vim::NextGreaterIndent`, `vim::NextLesserIndent`, `vim::NextLineStart`, `vim::NextMethodEnd`, `vim::NextMethodStart`, `vim::NextSameIndent`, `vim::NextSectionEnd`, `vim::NextSectionStart`, `vim::NextWordEnd`, `vim::NextWordStart`, `vim::PageDown`, `vim::PageUp`, `vim::PreviousComment`, `vim::PreviousGreaterIndent`, `vim::PreviousLesserIndent`, `vim::PreviousLineStart`, `vim::PreviousMethodEnd`, `vim::PreviousMethodStart`, `vim::PreviousSameIndent`, `vim::PreviousSectionEnd`, `vim::PreviousSectionStart`, `vim::PreviousWordEnd`, `vim::PreviousWordStart`, `vim::PushFindBackward`, `vim::PushFindForward`, `vim::RepeatFind`, `vim::RepeatFindReversed`, `vim::Right`, `vim::ScrollDown`, `vim::ScrollUp`, `vim::Search`, `vim::SearchSubmit`, `vim::SentenceBackward`, `vim::SentenceForward`, `vim::StartOfDocument`, `vim::StartOfLine`, `vim::StartOfLineDownward`, `vim::StartOfParagraph`, `vim::UnmatchedBackward`, `vim::UnmatchedForward`, `vim::Up`, `vim::WindowBottom`, `vim::WindowMiddle`, `vim::WindowTop`, `vim::WrappingLeft`, `vim::WrappingRight`.

## Existing Fregat and Editor work

Editor paths below name the canonical destination after Plan 207. At this plan's source audit,
those files live under `/work/projects/Editor/packages/`; `editor/` has not landed in Fregat.
Implement package work in `editor/packages/` after the move.

`editor/packages/editor/src/graphemes.ts`, `editor/packages/editor/src/editor/textRanges.ts` and `editor/packages/editor/src/editor/navigationTargets.ts`
provide boundary and navigation helpers. `editor/packages/editor/src/editor/lineMap.ts` and display projection code map
wrapped/folded positions. `editor/packages/editor/src/editor/findFeature.ts` owns find; `editor/packages/editor/src/editor/bracketMatching.ts` owns
bracket matching. `editor/packages/editor/src/editor/commandCatalog.ts` includes word/line movement and selection commands.
`apps/web/src/keymap/editor-commands.ts` exposes find and navigation. Plans 225–226 extend
transforms/view actions, but these lack Vim range-kind/count semantics.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Add typed commands and
availability to `apps/web/src/keymap/table.ts` through its owning command module; Editor
commands also belong in `editor/packages/editor/src/editor/commandCatalog.ts`. Put keys and argument variants in Plan 206's
`apps/web/src/keymap/presets/` data. Hosted Editor joins the window dispatcher and publishes
contexts. Standalone Editor exports the modal pack as data. Keep keys out of command metadata.
Use the existing document mutation/undo path for synchronous edits. Async reads and effects
use feature-owned TanStack query/mutation options and settle the cache before resolving.

In `editor/packages/vim`, define a pure motion resolver returning destination, cursor goal and
a typed range kind. Keep buffer offsets distinct from display coordinates. Resolve standalone
movement and operator range construction from the same motion; special cases such as `dw` at
line end and exclusive motion to column zero belong in that resolver. Use grapheme boundaries
for caret movement and preserve virtual column goals across short lines.

Use Plan 274 contexts for normal/operator/visual commands and waiting find operands. Viewport
movement reads the focused Editor's projection/geometry. Search UI adds a child context that
wins while active, uses the find owner's queries, and restores prior selections on cancellation.
Read document-owned syntax/occurrence analysis for structural/reference targets; unavailable
analysis declines safely. Register search payloads and repeat direction without inline chords.

## Steps

- [ ] Port failing fixtures from pinned motion.rs and normal/search.rs, with expected offsets and range kinds.
- [ ] Implement character/word/line/document/paragraph/sentence and count/percentage resolvers.
- [ ] Implement bracket, syntax, reference and indentation targets against existing analysis owners.
- [ ] Implement viewport/scroll adapters using Plan 226 geometry and cursor goals.
- [ ] Connect find/search waiting state, direction repetition, operator search ranges and cancellation.
- [ ] Register commands and all modal preset variants; add the hosted motions/search scenario.

## Acceptance

Run the focused package fixtures and hosted keymap tests, then `bun run gates`. Add the named
scenario under `scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`.
Use fixture providers and disposable repositories. Run `bun run agent:browser scenario vim-motions-search`
and `bun run agent:browser look`; read the screenshots and record the evidence directory.
Commit by path, push, and deploy the completed implementation through the mesh.

Fixtures cover word/WORD, f/F/t/T, `;`/`,`, count prefixes, failed finds, reverse ranges,
Unicode graphemes, EOF, folds and soft wraps. Scenario checks `w`, counted buffer/display-line
movement, `%`, `/`/`?`, `n`/`N`, and Escape restoring a cancelled search. Viewport fixtures
verify page/half-page, horizontal movement and scroll cursor goals. Every covered action has a
resolved owner and availability predicate.

## Out of scope

Operator editing, text-object selection, macro execution and Ex commands. This plan supplies
the typed motion/range contracts consumed by Plans 276–279.
