# Plan 178: filter, path, sort and error helpers

- Status: PROPOSED. Size M. After [app-owned-state](app-owned-state.md); beside the other sub-plans.
- Owns: the pure helpers the tree carries its own copy of — filter matching, path handling, file
  ordering, errors — merged with the app's copies into one implementation each.

## Owner direction

2026-09-26: the other duplicates (filters, path helpers, sort) are part of this plan, the same as
the virtualizer, the icons and the drag layer.

## Rule

Each pair is compared by behaviour first, per AGENTS.md ("two implementations of the same-sounding
helper are not automatically duplicates"). The better one becomes the shared helper, in
`@workspace/utils` when the TUI or the server also needs it (the tree model does), in `lib/`
otherwise. Every call site gets a test before it moves. Where two behaviours must stay different,
the helper keeps one name per behaviour and a line saying why.

## File ordering

Seven comparators decide file order today, with at least three behaviours:

| Where                                                      | How                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `packages/tree/src/utils/path-store/sort.ts`               | hand-written natural tokens, folders first           |
| `features/search/utils/sort.ts`                            | collator plus an ASCII fast path, per path component |
| `features/file-picker/utils/sort-entries.ts`, `model.ts`   | `Intl.Collator` numeric; plain `localeCompare`       |
| `features/chat/utils/turn-diff-tree.ts:39,188`             | `localeCompare` numeric, sensitivity `base`          |
| `features/git/utils/change-rows.ts:37`                     | `compareStatusPaths`                                 |
| `features/git/utils/admit-mutation.ts:39`                  | plain `localeCompare` on the path                    |
| `features/editor/state/workspace-document-service.ts:1512` | `comparePaths`                                       |

- **Work:** one `compareFileNames` and one `comparePaths` (folders first as an option) in
  `@workspace/utils`. The path store keeps its presorted, allocation-free fast path, but it calls
  the shared comparator's token logic, so the tree, quick open, search, git, chat turn files and the
  picker agree on where `file10` goes. The tree's order is the parity baseline (the harness fixture
  gains names that expose the differences: digits, case, dots, underscores, non-ASCII).
- **Measure:** the path store sorts 100k paths on open; `workspace-open-large-root` `trace` must not
  regress. The prepared-input benchmark gate stays.

## Filter matching

- **Tree:** `utils/model/searchHelpers.ts` — lower-cased substring on the full relative path, over
  loaded paths only, hide non-matches.
- **App:** quick open (`project-entry-query.ts`, `field-token-ranker.ts`), the command palette
  (cmdk), `composer-command-search.ts`, `model-picker-search.ts`, and the filter fields
  [chrome](chrome.md) merges into `FilterField`.
- **Work:** one query normalizer and one match function for filter-style lists (substring, case
  folding, path separators), shared by the tree and the `FilterField` adopters. Ranked fuzzy search
  (quick open, palette) stays separate: it ranks, a filter only hides. Write the reason at both
  sites. The tree's filter behaviour is kept (Q2), including quirk 3.

## Path helpers

- **Tree:** `utils/model/pathHelpers.ts` (ancestors, parent, sibling key, canonical directory with a
  trailing slash), `utils/normalizeInputPath.ts`, `path-store/path.ts` (`parseInputPath`,
  `parseLookupPath`).
- **App:** `lib/path-formatters.ts` (`basename`, `parentPath`, `canonicalTreePath`, `toTreePath`,
  `pathLeaf`), `lib/workspace-relative-path.ts`, `tree-pane.tsx`'s `treePathBasename`, and the six
  `basename` variants AGENTS.md warns about.
- **Work:** the model-level helpers (ancestors, parent, canonical directory form) move to
  `@workspace/utils` and `lib/path-formatters.ts` imports them; `treePathBasename` and the
  tree-pane path conversions use `lib/`. The path store's parser stays private: it builds segment
  tables, not strings. Each merged helper gets a test per call site, including the empty path, the
  root, a trailing slash and a flattened chain.

## Errors

`packages/tree/src/utils/structured-errors.ts` moves with the view: view errors join
`features/workspace`'s catalog; model errors stay in the package on the same `evlog` wrapper.
`bun run errors:census` covers both.

## Delete

`searchHelpers.ts` (merged), `pathHelpers.ts` (moved), `treePathBasename`, the per-feature
comparators above once they call the shared ones.

## Verification

- Unit tests per call site for each merged helper, written before the move.
- Harness: tree order, filter results and chain labels unchanged on the fixture.
- `look` on quick open, search, git changes, chat turn files and the file picker: if their order
  changes, that is a recorded verdict here, not drift.
- `trace workspace-open-large-root --compare`.
