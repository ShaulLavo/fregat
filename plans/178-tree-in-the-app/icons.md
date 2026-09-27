# Plan 178: icons

- Status: DONE 2026-09-27 (wave 2, lane T). Size S–M. After [app-owned-state](app-owned-state.md).
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
2. **Hue tokens.** Use the `--file-icon-<hue>` tokens and the icon → hue map that
   [Plan 180](../180-file-icon-variants.md) Phase 1 generates (tree hues, `bun` mauve per Q1). If
   180 Phase 1 has not landed, land it here instead of hand-writing tokens.
3. **Rows.** Tree rows call `iconForEntry` with the real stem logic. `FileLabel` gains a folder kind
   so it can render the chevron-only lead the tree uses today.
4. **Delete** `builtInIcons.ts` (781 lines), `iconResolver.ts`, `Icon.tsx`, `iconConfig.ts`,
   `sprite.ts`, `fileTreeIconsForPaths`, `vscodeIconSpriteSheet`, `treeIconReference`, `ICON_TOKENS`, and the
   `--trees-file-icon-color-*` variables. The sparkle comes from Phosphor like every other icon.

## Parity

Same glyph and colour for every file in the fixture (the harness pixel diff), `bun` excepted if the
owner picks one colour.

## Verification

- Harness pixel diff on the fixture and on the platform repo.
- `trace` on a 100k-path scroll (`workspace-open-large-root`) against the baseline.
- `look` on the file picker, git changes and quick open: they use the same icons and must not change.

## Landed

- `components/file-icon-sprite.tsx` mounts every glyph once as `<symbol id="app-vscode-icon-…">`, in
  `ActiveEnvironmentApplication` beside the toaster. It is hidden by size, not `display: none`,
  which would drop its gradients. `FileTypeIcon` gains `sprite`, one `<use>` per icon; the other
  surfaces keep the inline mode.
- Tree file rows render `FileTypeIcon` with `iconForEntry` and `sprite`. The hue is the rule's
  `text-file-icon-*` class, the same one every other file row uses. The tree's sheet sizes the
  icon from `--trees-icon-width`.
- The folder chevron, the changed-descendant dot and the row menu's dots are
  `components/tree-glyph.tsx`, with the tree's own paths. The dot keeps the sprite's nested
  viewport, because a flat 6px circle antialiases differently. The Fix with AI sparkle is
  Phosphor's `SparkleIcon`, which draws the same path.
- Deleted: `builtInIcons.ts`, `iconConfig.ts`, `sprite.ts`, `tree-icon.tsx`,
  `tree-icon-resolver.ts`, the `icons` option, `setIcons`, `getSpriteSheets`,
  `data-file-tree-colored-icons`, `fileTreeIconsForPaths`, `ICON_TOKENS`, the tree's hue and
  `--trees-file-icon-color-*` variables with their 48 colour rules, the git-status icon tint (the
  colour rules always outranked it), the unused lock styles, and the icon variant of
  `FileTreeRowDecoration` (the app's decorations are text).
- `FileLabel` gains no folder kind. The rows sub-plan owns the row markup, so the chevron stays a
  tree glyph until then.

### Verification

- `tree-parity`, before re-baselining: every capture drifts by about 700 pixels, all in the
  intended colours. `.gitignore` takes the app's vermilion; the tree had the light and dark values
  swapped (`#ff8c5b` light, `#d5512f` dark). The Python icon's back half takes its second hue, as it
  does in every other list. In the drag state, the dragged row keeps its hue instead of the
  untracked status tint. The style probe also loses the chevron's `href`, which is now drawn
  inline. Drift run: `/work/tmp/fregat-evidence/20260926T225701Z-scenario-tree-parity/`. After
  re-baselining there is zero drift (`/work/tmp/fregat-evidence/20260926T231347Z-scenario-tree-parity/`).
- `tree-parity-behaviour`, `tree-sticky-scroll`, `tree-file-clicks` and `file-icon-hues` pass. The
  picker, quick open and git changes are unchanged (`/work/tmp/fregat-evidence/20260926T231519Z-scenario-file-icon-hues/`).
- `trace tree-large-scroll` against the view split (`…/20260926T224331Z`): render per wheel step
  9.5 and 13.9 ms over two runs, against 12.4 ms, which is parity within run-to-run noise
  (`…/20260926T232011Z`, `…/20260926T232129Z`).
