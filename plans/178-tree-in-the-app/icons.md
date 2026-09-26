# Plan 178: icons

- Status: PROPOSED. Size S–M. After [app-owned-state](app-owned-state.md).
- Owns: one icon path for every file row in the app, and icon colours as tokens.

## Outcome

Tree rows render file icons through the same `iconForEntry` / `FileTypeIcon` path as every other
file row, from one document-level sprite. Icon hues are theme tokens. The tree's icon resolver,
built-in sets and sprite injection are gone.

## Today

- `lib/file-icons.ts` turns the app's 93 glyphs into a sprite string for the tree
  (`vscodeIconSpriteSheet`, `:606-614`) and `fileTreeIconsForPaths` rebuilds a `byFileName` map over
  every path on every render (`tree-pane.tsx:157`, `file-icons.ts:369-377`). So the tree already
  shows the app's glyphs; only paths missing from the map fall through to the tree's built-in set.
- Stems are registered as exact file names, which differs from `stemForName`.
- `FileTypeIcon` injects each icon with `useId` and `dangerouslySetInnerHTML`, rewriting gradient
  ids. That costs more per row than the tree's `<use href>` in a 100k-row scroll.
- Colours: 13 hue pairs in raw hex (`style.css:287-350`), copied onto `:root` in `globals.css`
  (97 declarations). Inside the tree the host copies win; the only value that differs is `bun`
  (mauve in the tree, pink elsewhere).
- `components/file-type-icon.tsx` takes its colours from the tree's `getBuiltInFileIconColor`.
- Folders show no glyph, only the chevron. The sparkle and change dot come from the tree's own
  small sprite.

## Work

1. **Sprite mode.** Mount the app glyph sprite once in the document; `FileTypeIcon` gains a `<use>`
   mode that rows use. Gradient ids are unique once, so the per-instance rewrite is not needed.
2. **Hue tokens.** Thirteen hue tokens (light and dark) in `globals.css`, replacing the per-icon
   hex. The colour table (`getBuiltInFileIconColor`) moves to `lib/file-icons.ts` and maps each icon
   to a hue. The owner picks `bun`'s colour (Q1).
3. **Rows.** Tree rows call `iconForEntry` with the real stem logic. `FileLabel` gains a folder kind
   so it can render the chevron-only lead the tree uses today.
4. **Delete** `builtInIcons.ts` (781 lines), `iconResolver.ts`, `Icon.tsx`, `iconConfig.ts`,
   `sprite.ts`, `fileTreeIconsForPaths`, `vscodeIconSpriteSheet`, `treeIconReference`, and the
   `--trees-file-icon-color-*` variables. The sparkle comes from Phosphor like every other icon.

## Parity

Same glyph and colour for every file in the fixture (the harness pixel diff), `bun` excepted if the
owner picks one colour.

## Verification

- Harness pixel diff on the fixture and on the platform repo.
- `trace` on a 100k-path scroll (`workspace-open-large-root`) against the baseline.
- `look` on the file picker, git changes and quick open: they use the same icons and must not change.
