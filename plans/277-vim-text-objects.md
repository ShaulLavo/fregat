# Plan 277: Vim text objects

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-58; size L. Depends on Plan 207, Plan 204, Plan 206, Plan 276, Plan 224.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Vim plans also use
  `assets/keymaps/vim.json` at that commit. Preserve action identity and every payload variant.

## Outcome

Apply inside/around operators to words, quotes, pairs, paragraphs, sentences, tags, arguments and syntax objects.

## Zed actions and behavior

- `PushObject` carries `around`. Word preserves punctuation/WORD variants; Sentence,
  Paragraph, CurrentLine and EntireFile return their corresponding text ranges. Sources:
  [`crates/vim/src/vim.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/vim.rs) PushObject registration, [`crates/vim/src/object.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/object.rs) `range`/`around_word`.
- Quotes, DoubleQuotes, BackQuotes, MiniQuotes and bracket/VerticalBars objects find delimiters.
  AnyPair chooses the surrounding pair; Tag resolves matching HTML-like tags. Counts expand
  outward through enclosing pairs where supported. Inside excludes delimiters; around includes
  the pair and object-specific whitespace. Source: [`crates/vim/src/object.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/object.rs) pair and tag resolvers.
- Argument accounts for separators, nested pairs and comma ownership. Method/Class/Comment
  use syntax text-object ranges; IndentObj uses indentation blocks and its payload options.
  Source: [`crates/vim/src/object.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/object.rs) `argument`/`text_object`/`indent`.

The complete inventory below names all 22 `vim::` actions. Preserve object payloads from the
pinned modal keymap, including `around`, punctuation and indentation options.

`vim::AngleBrackets`, `vim::AnyPair`, `vim::Argument`, `vim::BackQuotes`, `vim::Class`, `vim::Comment`, `vim::CurlyBrackets`, `vim::CurrentLine`, `vim::DoubleQuotes`, `vim::EntireFile`, `vim::IndentObj`, `vim::Method`, `vim::MiniQuotes`, `vim::Paragraph`, `vim::Parentheses`, `vim::PushObject`, `vim::Quotes`, `vim::Sentence`, `vim::SquareBrackets`, `vim::Tag`, `vim::VerticalBars`, `vim::Word`.

## Existing Fregat and Editor work

Editor paths below name the canonical destination after Plan 207. At this plan's source audit,
those files live under `/work/projects/Editor/packages/`; `editor/` has not landed in Fregat.
Implement package work in `editor/packages/` after the move.

`editor/packages/editor/src/editor/selectionRanges.ts` owns the structural selection ladder;
`editor/packages/editor/src/editor/syntaxController.ts`, `editor/packages/editor/src/syntax/index.ts` and `editor/packages/editor/src/syntax/highlighter.ts` own syntax access.
`editor/packages/editor/src/editor/bracketMatching.ts` and `editor/packages/editor/src/editor/textRanges.ts` provide bracket/text helpers.
`apps/web/src/keymap/editor-commands.ts` exposes smart selection; Plan 224 extends selection.
These owners supply ranges, but have no Vim inside/around or separator-ownership contract.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Add typed commands and
availability to `apps/web/src/keymap/table.ts` through its owning command module; Editor
commands also belong in `editor/packages/editor/src/editor/commandCatalog.ts`. Put keys and argument variants in Plan 206's
`apps/web/src/keymap/presets/` data. Hosted Editor joins the window dispatcher and publishes
contexts. Standalone Editor exports the modal pack as data. Keep keys out of command metadata.
Use the existing document mutation/undo path for synchronous edits. Async reads and effects
use feature-owned TanStack query/mutation options and settle the cache before resolving.

Build a pure object resolver in `editor/packages/vim` over document snapshots and optional
syntax analysis. Return a typed range with inside/around semantics and motion kind, consumed
by Plan 276 operators and Plan 278 visual state. Share pair lookup with surrounds; make counts,
escaped delimiters and expansion direction explicit arguments. Keep syntax-query work in
Editor packages; language text-object captures belong to the language analysis owner.

Publish availability from actual text/syntax capability, and leave a pending operator safely
cancelable when an object cannot resolve. Use document-owned analysis queries; keep successful
selection/edit synchronous against the checked snapshot revision. Map every object variant in
Plan 206's modal preset without binding it in ordinary insert mode.

## Steps

- [ ] Add failing object fixtures for every named object and each pinned payload variant.
- [ ] Implement word/paragraph/sentence/line/file and inside/around whitespace rules.
- [ ] Implement quotes, nested pairs, AnyPair, mini quote rules and tags with shared surround lookup.
- [ ] Implement argument separator ownership, indentation options and syntax Method/Class/Comment captures.
- [ ] Wire pending objects to operator and selection consumers; register commands and modal rows.
- [ ] Add the text-object browser scenario and inspect its result.

## Acceptance

Run the focused package fixtures and hosted keymap tests, then `bun run gates`. Add the named
scenario under `scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`.
Use fixture providers and disposable repositories. Run `bun run agent:browser scenario vim-text-objects`
and `bun run agent:browser look`; read the screenshots and record the evidence directory.
Commit by path, push, and deploy the completed implementation through the mesh.

Fixtures prove `diw`/`daw`, nested `ci(`, escaped and empty quotes, unmatched delimiters, counts,
arguments with nested commas, tags, blank-line paragraphs, indentation options and syntax
objects. Syntax tests use real grammar analysis; missing captures produce no partial edit.
Scenario applies inside/around changes in nested TypeScript and markup, undoes each operation,
and verifies resulting selection/text. No resolver splits a grapheme or applies stale ranges.

## Out of scope

Helix object selection, new syntax providers, and Ex regex/shell operations. Visual-mode
adaptation consumes these resolvers in Plan 278.
