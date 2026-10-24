# Design documents

How Singapore works inside, for people who change it or embed it deeply. The [documentation site](https://singapore.shaulavo.dev/docs/start-here/introduction/) has the guides and the generated API reference. Start with [Architecture](../ARCHITECTURE.md), then read the page for the layer you are touching.

## Decisions

- [ADR 001](adr/001-persistent-avl-piece-table.md): store text in a persistent piece table on an AVL tree.
- [ADR 002](adr/002-anchors-into-immutable-buffers.md): track positions with anchors into immutable buffers.
- [ADR 003](adr/003-document-on-main-thread.md): keep the canonical document on the main thread.
- [ADR 004](adr/004-browser-layout-and-css-highlights.md): let the browser lay out text and paint it with CSS highlights.

## Design

- **Storage:** [Piece table](storage/piece-table.md), [Piece tree inspection](storage/piece-tree-inspection.md).
- **Positions:** [Types and conversions](positions/types-and-conversions.md), [Anchors](positions/anchors.md).
- **Editing:** [Selections and undo](editing/selections-and-undo.md), [Branching undo](editing/undo-graph.md), [Jump history](editing/jump-history.md).
- **Display:** [Browser layout and virtualizer](display/browser-virtualization.md), [Transforms](display/transforms.md), [Diagnostic overlays](display/diagnostic-overlays.md).
- **Syntax:** [Tree-sitter](syntax/tree-sitter.md).
- **Platform:** [Worker topology](architecture/worker-topology.md), [Extension hooks](architecture/extension-hooks.md).

## Reference

- [Known limits](limitations.md): measurement ceilings, analysis budgets and bounded package behavior.
- [Browser quirks](display/browser-quirks.md): engine bugs, each with symptom, cause, fix and upstream report.
- [Editor commands](commands.md): generated from the command catalog. Run `bun run commands:reference` in `editor/` to regenerate it, and `bun scripts/command-reference.ts --check` to test that it is current.
- [Development](development.md): build, test and check the packages.

Each package keeps its own guides in `packages/<name>/docs/`. The package READMEs link to them.

## Records

The files below are the written record of finished work: reports, measurements and research, mostly named for a plan ID such as `E040`. They are not guides. They stay at these paths because tests, scripts and the Fregat plans link to them by path, so renaming one breaks a check. Read them when you need the evidence behind a design.

- [`performance/`](performance/README.md): benchmark reports and the raw data behind them. Tests read some of the data.
- [`storage/`](storage/e006-text-reclamation.md) `e006-*`: text reclamation and tombstone compaction (E006).
- [`editing/`](editing/undo-graph-viewer.md) `e018`, `e062`, `undo-graph-viewer`, `spellcheck-research`: persisted undo, spellcheck hardening and research, the undo graph viewer.
- [`display/`](display/e036-monaco-geometry-comparison.md) `e036`, `e047`, `e048`, `e051`: geometry comparison with Monaco, point queries, minimap line mapping, fast-path equivalence tests.
- [`architecture/`](architecture/e049-no-silent-misses.md) `e049`, `e050`, `e054`, `e056`, `modal-input-findings`, `typescript-parity-baseline`: error contracts, host obligations, TypeScript worker parity, platform-agnostic core research, modal input.
- [`architecture/phase-0/`](architecture/phase-0/README.md): architecture health baselines. `bun run health` reads the JSON files.
- [`parity-monaco-codemirror.md`](parity-monaco-codemirror.md): a 101-finding audit of gaps against Monaco and CodeMirror 5.
