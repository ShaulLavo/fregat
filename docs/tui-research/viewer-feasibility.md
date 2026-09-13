# Viewer tokenizer feasibility

Tested on 2026-09-07 with Bun 1.4.0, `@singapore-editor/core` 0.1.2,
`@singapore-editor/tree-sitter` 0.1.1, `@singapore-editor/tree-sitter-languages` 0.1.1, and Shiki 4.2.0.

The viewer uses `createIncrementalTokenizer` from `@singapore-editor/core/shiki` with a
Shiki Oniguruma highlighter. The production implementation in
`apps/tui/src/viewer/state/syntax.ts` produced eight tokens and five distinct colors
for `const answer: number = 42;` under Bun and in a standalone `bun build --compile`
binary. Both token streams reconstructed the original source exactly. Grammar and
WASM inputs were bundled; the binary fetched no grammar assets.

Importing the Shiki package root produced `ReferenceError: bundle_full_exports is
not defined` in the compiled binary. The implementation imports `shiki/core`,
`shiki/langs`, `shiki/themes`, and `shiki/engine/oniguruma` directly. The same
compiled experiment passed after that change.

The tree-sitter experiment resolved the installed TypeScript language contribution,
registered it with `TreeSitterWorkerClient`, and requested a parse of a real
`createPieceTableSnapshot`. The published worker failed during initialization with
`Cannot find module './__vite-browser-external-eJplwgzj.js' imported from /blob:…`.
This package's worker contains a Vite external-module reference that the Bun blob
worker cannot resolve. A compiled binary reproduces the same initialization failure.

Shiki is the v1 tokenizer. Unknown extensions remain readable as plain text. The
viewer does not import the DOM editor or download tree-sitter grammars at runtime.
LSP features use `@singapore-editor/lsp` independently of syntax coloring.

The file tree imports `@workspace/tree/model`, a direct export of
`FileTreeController`, without the package's React or DOM rendering entry point.
