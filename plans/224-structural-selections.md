# Plan 224: Add previous-occurrence and structural selections

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 204, Plan 206. Size: M. Triage item: ZT-05.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Add the previous matching cursor, select lines or enclosing symbols and walk sibling syntax nodes.

## Covered Zed actions and behavior

`editor::MoveToEndOfLargerSyntaxNode`; `editor::MoveToStartOfLargerSyntaxNode`; `editor::SelectEnclosingSymbol`; `editor::SelectLine`; `editor::SelectNextSyntaxNode`; `editor::SelectPrevious`; `editor::SelectPreviousSyntaxNode`; `editor::SplitSelectionIntoLines`.

- `editor::SelectPrevious` searches backward, wraps once, and selects a matching
  occurrence. Its `replace_newest` payload replaces the newest selection when true.
  Wordwise matching and selection order persist across repetitions. See
  [crates/editor/src/selection.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/selection.rs#L385).
- `SelectLine` expands selections to complete buffer lines. `SplitSelectionIntoLines`
  creates one range per line when `keep_selections` is true; the default collapses
  each to a cursor. A multiline selection ending at column zero excludes that final
  line. See [crates/editor/src/selection.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/selection.rs#L212).
- `SelectEnclosingSymbol` grows to the next enclosing symbol. `SelectNextSyntaxNode`
  and `SelectPreviousSyntaxNode` walk siblings, preserving orientation and retaining
  the selection when no sibling exists. `MoveToStartOfLargerSyntaxNode` and
  `MoveToEndOfLargerSyntaxNode` move the caret to an enclosing node boundary. See
  [crates/editor/src/selection.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/selection.rs#L578) and the sibling/motion methods in that file.

## Existing Fregat and Editor work

Editor source below was verified in `/work/projects/Editor/packages/` before Plan 207.
Implement it in Fregat `editor/packages/` after that cutover; the external checkout is
read-only for this wave.

[packages/editor/src/selections.ts](/work/projects/Editor/packages/editor/src/selections.ts) and
[packages/editor/src/documentSession.ts](/work/projects/Editor/packages/editor/src/documentSession.ts) already maintain anchored selections
and their identities. [packages/editor/src/editor/selectionRanges.ts](/work/projects/Editor/packages/editor/src/editor/selectionRanges.ts) builds
expand/shrink ladders from range providers and preserves reversed selections.
[packages/editor/src/editor/commandCatalog.ts](/work/projects/Editor/packages/editor/src/editor/commandCatalog.ts) exposes next-occurrence selection.
Fregat has [document-symbols.ts](../apps/web/src/lib/document-symbols.ts) and hosted
commands; these foundations do not supply previous occurrences or sibling AST navigation.

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Implement selection semantics in `editor/packages/editor/`; extend syntax range
providers with explicit enclosing/sibling queries. Keep AST lookup in the syntax
package and pass ranges through the plugin contract. A fold range alone cannot
answer sibling syntax navigation. Use symbol ranges from an existing symbol
provider, with snapshot revisions carried through asynchronous results.

Preserve selection IDs, direction, anchor tracking, and newest-selection identity.
Use typed `replaceNewest` and `keepSelections` arguments translated from Zed's
payloads. Modal-only rows remain preset data until the Vim/Helix owner provides its
context. These commands remain available to host APIs and the command palette.

## Steps

- [ ] Add failing fixtures for previous-match replacement, sibling selection, and line splitting.
- [ ] Implement backward occurrence traversal on the existing text snapshot and selection owner.
- [ ] Implement line expansion/splitting with final-column-zero and reversed-selection rules.
- [ ] Extend syntax/symbol providers and add the four structural selection/motion handlers.
- [ ] Register commands and translate payloads/contexts in the Plan 206 presets.
- [ ] Add `structural-selections` with nested syntax and repeated words, read screenshots, and ship the change.

## Acceptance

Run focused selections and selectionRanges tests plus the changed syntax-provider
fixtures. Cover wraparound exhaustion, duplicate prevention, `replaceNewest` both
ways, multiple/reversed selections, empty lines, EOF, Unicode, parse errors, stale
symbols, and missing siblings. In `agent:browser scenario structural-selections`,
add a previous matching caret, replace it, grow to an enclosing symbol, walk siblings,
and split selected lines. Assert source offsets and selection count; read screenshots.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
`bash /work/tmp/wave-heavy/run.sh "zt-05" -- env PATH="$PATH" <command>`.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run deploy`, or
`bun run deploy --server --restart` when server code changes. Confirm the served release.

## Out of scope

Vim/Helix mode engines, rectangular visual-block editing, workspace symbol search,
and the document outline from Plan 231.
