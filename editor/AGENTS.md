# AGENTS.md

Instructions for AI coding agents working with this codebase.

## Project Overview

Browser-based code editor targeting ultra-low latency typing (<1-2ms perceived). Balanced-tree piece table with persistent immutable snapshots, CSS Highlight API rendering, and optional Tree-sitter syntax plugins.

## The Simple API Comes First

Every feature works on an editor that was only given text: `new Editor(element)` and `setText(text)`, or a plugin built from plain options. Documents — an `openDocument` id, a shared `DocumentSession`, a `LanguageServerDocument` — add identity and sharing: persistence, one buffer or one protocol state behind several views. They are supported, and no feature may require one.

- When a feature needs something a document usually supplies, such as a language server's URI, take it as a plain option on the simple path and let a document fill it in when there is one.
- A new capability must not add required setup to the one-line use. If it cannot work without a document, the design is wrong, not the caller.
- Test the simple path. A feature covered only through documents has not proven it works without one.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the high-level system design: main thread vs worker split, core systems, data flow, and remaining open questions.

## Design Documents

### Storage

- [Piece Table](docs/storage/piece-table.md) — Tree-backed piece table, buffers, snapshots, aggregate maintenance, enrichment roadmap, Phase 1 prerequisites (opaque BufferId, chunked append buffer)

### Positions

- [Types & Conversions](docs/positions/types-and-conversions.md) — Offset, Point, Anchor hierarchy; line-break augmentation; conversion functions
- [Anchors](docs/positions/anchors.md) — Durable position references, creation, deletion/bias rules, resolution architecture (reverse index + enriched treap), snapshot consistency

### Editing

- [Selections & Undo](docs/editing/selections-and-undo.md) — Anchor-based selections, multi-cursor, lazy normalization, batch edits, edit/patch representation, snapshot-based undo

### Display

- [Transforms](docs/display/transforms.md) — Layered transform hypothesis, layer interface, invalidation protocol, FoldMap validation, decoration constraints
- [Browser Quirks](docs/display/browser-quirks.md) — Browser-specific workarounds: symptom, root cause, fix rationale, repro, upstream bug for each (e.g. WebKit style-containment counter bug behind Safari line numbers rendering "0")

### Syntax

- [Tree-sitter](docs/syntax/tree-sitter.md) — Committed syntax engine for highlighting, folds, structural selection, indentation, injections, and query-driven features

## Codebase

### Packages

| Package                          | Purpose                                                                                          | Key files                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `packages/editor`                | Core editor: document sessions, CSS Highlight API renderer, and Shiki highlighter                | `src/editor.ts`, `src/documentSession.ts`, `src/tokens.ts`, `src/shiki/*`                 |
| `packages/textbuffer`            | Persistent text storage, snapshots, anchors, and line mapping                                    | `src/index.ts`, `src/pieceTableTypes.ts`, `src/tree.ts`                                   |
| `packages/tree-sitter`           | Optional Tree-sitter runtime, worker client, language registry, and structural selection helpers | `src/session.ts`, `src/treeSitter/workerClient.ts`, `src/treeSitter/treeSitter.worker.ts` |
| `packages/tree-sitter-languages` | First-party lazy Tree-sitter language plugins                                                    | `src/index.ts`, `src/queries/*`                                                           |
| `examples/app`                   | Demo app with file browser                                                                       | `src/app.ts`, `src/main.ts`                                                               |

### What's Implemented

- **Piece table** — Persistent AVL tree with snapshots, insert/delete/read, structural sharing
- **CSS Highlight API renderer** — Token-based syntax highlighting via `Highlight` objects
- **Anchors and selections** — Durable anchor resolution, selection sets, and snapshot-aware history helpers
- **Tree-sitter syntax path** — Optional worker-backed parsing/query support and structural selection integration
- **Display transforms and virtualization** — FoldMap, row virtualization, long-line chunking, and mounted-range highlight painting
- **Shiki highlighter** — Optional highlighter/tokenizer module inside `packages/editor`
- **Example app** — File System Access API browser + editor integration

### Still Evolving

- Worker transaction ownership and scheduling boundaries
- Decoration system beyond current syntax/selection highlight paths
- Performance validation for very large files, dense decorations, and rapid editing

### Key Types (in code)

| Type                                                                     | Location                                     |
| ------------------------------------------------------------------------ | -------------------------------------------- |
| `Piece`                                                                  | `packages/textbuffer/src/pieceTableTypes.ts` |
| `PieceBufferId`                                                          | `packages/textbuffer/src/pieceTableTypes.ts` |
| `PieceTreeNode`                                                          | `packages/textbuffer/src/pieceTableTypes.ts` |
| `PieceTableSnapshot`                                                     | `packages/textbuffer/src/pieceTableTypes.ts` |
| `EditorToken`, `EditorTokenStyle`, `TextEdit`                            | `packages/editor/src/tokens.ts`              |
| `EditorTokenStore` (the document's tokens; object tokens are input only) | `packages/editor/src/syntax/tokenStore.ts`   |
| `TreeSitterLanguageContribution`, `TreeSitterBackend`                    | `packages/tree-sitter/src/index.ts`          |
| `TokenPatch`, `IncrementalTokenizer`                                     | `packages/editor/src/shiki/tokenizer.ts`     |
| `Editor` (class)                                                         | `packages/editor/src/editor.ts`              |

### Terminology

- **Piece** — the fundamental text-slice record. Other editors sometimes call this a "fragment" (e.g., Zed). In this codebase, it's always a Piece.

## Build & Test

Monorepo managed by Turborepo with Bun.

Run tests through package scripts with `bun run test`. Do not use `bun test`; it bypasses the configured Vitest environments for this repo.

### Formatting

Run `bun run format` (oxfmt via Turborepo). It formats the **entire repo**, so when there is pre-existing format drift it will touch files unrelated to your change. This is expected and fine — **do not revert those incidental reformats**. `bun run format:check` must pass before committing.

### Dead-code checks

`bun run knip` (config in `knip.ts`) finds unused files, exports, and dependencies across the workspace. Each package's entry points are computed from its `exports` map, so a new export needs no config and only genuinely-internal dead code is reported. A few real deps are referenced in ways knip can't see statically (wasm build tooling, the vitest playwright provider) and are listed under `ignoreDependencies` with the reason inline.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

- Firefox/WebKit Playwright runs on the Arch dev machine need `/work/projects/platform/scripts/playwright-webkit-arch.sh` after any `playwright install` that downloads a new WebKit.
