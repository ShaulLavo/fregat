# Plan 280: Vim insert entry and control keys

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-61; size M. Depends on Plan 207, Plan 204, Plan 206, Plan 274, Plan 275, Plan 222, Plan 223.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Vim plans also use
  `assets/keymaps/vim.json` at that commit. Preserve action identity and every payload variant.

## Outcome

Enter insertion at Vim positions, open lines, insert adjacent characters or digraphs, and run one temporary normal command.

## Zed actions and behavior

- InsertBefore/After, InsertFirstNonWhitespace, InsertEndOfLine and InsertAtPrevious enter
  insertion at the requested caret/line/previous-insert position. InsertLineAbove/Below opens
  indented lines and enters insert mode. InsertEmptyLineAbove/Below adds counted blank lines
  while retaining normal mode. Source: [`crates/vim/src/normal.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal.rs) insert handlers.
- InsertFromAbove/Below inserts the character at the adjacent buffer row/column when present.
  TemporaryNormal runs one completed normal command then resumes insertion. Source:
  [`crates/vim/src/insert.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/insert.rs), [`crates/vim/src/normal.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal.rs) `exit_temporary_normal`.
- PushDigraph waits for two characters and inserts the mapped character. Vim Enter/Tab feed
  newline/space operands to `input_ignored` in waiting/replace contexts. Insert-mode newline/tab
  commands remain Editor commands, with completion/snippet precedence. Sources: [`crates/vim/src/digraph.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/digraph.rs),
  [`crates/vim/src/digraph/default.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/digraph/default.rs), [`crates/vim/src/vim.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/vim.rs) action registration.

Keep all 15 `vim::` names below and their pinned modal context/argument variants.

`vim::Enter`, `vim::InsertAfter`, `vim::InsertAtPrevious`, `vim::InsertBefore`, `vim::InsertEmptyLineAbove`, `vim::InsertEmptyLineBelow`, `vim::InsertEndOfLine`, `vim::InsertFirstNonWhitespace`, `vim::InsertFromAbove`, `vim::InsertFromBelow`, `vim::InsertLineAbove`, `vim::InsertLineBelow`, `vim::PushDigraph`, `vim::Tab`, `vim::TemporaryNormal`.

## Existing Fregat and Editor work

Editor paths below name the canonical destination after Plan 207. At this plan's source audit,
those files live under `/work/projects/Editor/packages/`; `editor/` has not landed in Fregat.
Implement package work in `editor/packages/` after the move.

`editor/packages/editor/src/editor/editActions.ts`, `editor/packages/editor/src/editor/indentation.ts`, `editor/packages/editor/src/editor/autoClose.ts` and
`editor/packages/editor/src/editor/input.ts` implement typing/newline/indent behavior. `editor/packages/editor/src/editor/commandCatalog.ts` already lists
line insertion and completion commands. `editor/packages/editor/src/createPlugin.ts` exposes native text gates;
`editor/packages/editor/src/documentSession.ts` supplies undo groups. `apps/web/src/keymap/editor-commands.ts` routes those
commands. Plans 222–223 supply input/completion integration; Plan 274 establishes basic mode
exits. Vim position entry, temporary normal and digraph collection remain missing.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Add typed commands and
availability to `apps/web/src/keymap/table.ts` through its owning command module; Editor
commands also belong in `editor/packages/editor/src/editor/commandCatalog.ts`. Put keys and argument variants in Plan 206's
`apps/web/src/keymap/presets/` data. Hosted Editor joins the window dispatcher and publishes
contexts. Standalone Editor exports the modal pack as data. Keep keys out of command metadata.
Use the existing document mutation/undo path for synchronous edits. Async reads and effects
use feature-owned TanStack query/mutation options and settle the cache before resolving.

Extend `editor/packages/vim` using Plan 274's mode/pending model and Plan 275's caret resolvers.
Track the prior insertion mark as an anchor. Open-line operations reuse language indentation
and auto-close behavior; counted insertions and their exit share one intended undo unit.
Distinguish opening an insertion line from adding a blank line in normal mode.

Temporary normal mode finishes after one logical command, including its count, motion or
operand. An incomplete chord/operator cannot end it early; Escape/disposal has an explicit
transition. PushDigraph receives committed characters via the waiting-input path and cancels
without partial edits. Its mapping/custom entries belong to Editor package data and registered
settings. In insert mode, Enter/Tab defer to deeper completion/snippet contexts from Plan 223, then
invoke existing Editor commands. In waiting/replace contexts, Vim Enter/Tab deliver newline/space
operands to the modal controller, preserving the pinned keymap semantics. Retain IME semantics and readonly availability.

## Steps

- [ ] Add failing entry-position, blank-line and temporary-normal fixtures from pinned Zed tests.
- [ ] Implement i/a/I/A/gi/o/O entry and counted normal-mode blank-line actions through existing edits.
- [ ] Implement adjacent-character insertion with Unicode-safe buffer column resolution.
- [ ] Implement digraph collection/default mappings and optional registered custom entries.
- [ ] Implement one-command temporary normal lifetime, waiting/replace Enter/Tab operands and insert widget precedence.
- [ ] Register modal rows and command arguments; add insert/completion browser coverage.

## Acceptance

Run the focused package fixtures and hosted keymap tests, then `bun run gates`. Add the named
scenario under `scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`.
Use fixture providers and disposable repositories. Run `bun run agent:browser scenario vim-insert-controls`
and `bun run agent:browser look`; read the screenshots and record the evidence directory.
Commit by path, push, and deploy the completed implementation through the mesh.

Fixtures cover empty/end-of-line buffers, tabs/indentation, Unicode, counts, previous insertion
anchors after edits, adjacent missing/short rows and digraph cancellation. Scenario exercises
`o`/`O`, `A`, digraph entry and Ctrl-O with a counted multi-key operator; verifies insertion
resumes only after completion; and checks Tab/Enter accept completion/snippets when focused.
A browser composition test proves insert IME commits once. Mode exit lands on the preceding
grapheme, and each change-plus-insert sequence undoes in one unit.

## Out of scope

Full completion/snippet implementation, replace-mode foundations, Ex commands and Helix
insertion behavior. These remain owned by Plans 223, 274, 281 and 282 respectively.
