# Plan 180: File icon variants

## Status and authorization

- Status: PROPOSED, a quick research plan. Requested 2026-09-26 (owner). Nothing here authorizes
  implementation.
- Planned at: Platform `0de7f2212`, 2026-09-26. Origin: [Plan 178](178-tree-in-the-app.md) Q1, where
  the tree's icon colours looked better than the app's in places.

## Question

Can we get more from the icon pack we already use: more glyphs, coloured or alternate variants of
the same glyphs, or a different colour per mode (one palette for dark, another for light)?

## What exists

- The glyphs are Pierre's built-in file icons. `packages/tree/src/utils/builtInIcons.ts` is generated
  by Pierre's `scripts/generate-built-in-icons.ts`, which was not vendored. It offers three sets,
  `minimal`, `standard` and `complete`, and a `colored` flag; only `complete` is coloured.
- The app keeps its own copy, `apps/web/src/lib/vscode-icon-glyphs.ts` (92 glyphs, 24 of them
  `-duo` variants with a back layer at 0.5–0.6 opacity), used by `FileTypeIcon` everywhere and fed
  to the tree as a sprite.
- Colours: 13 hues, each a light and a dark value in raw hex (`packages/tree/src/styles/style.css:
287-350`, copied into `packages/ui/src/styles/globals.css`). The two copies disagree on `bun`
  (mauve in the tree, pink elsewhere); the owner prefers the tree's.

## Research

1. **Source.** Where Pierre's glyphs come from (its generator, an upstream icon family, licence),
   and whether upstream has added glyphs or variants since the vendoring in `ed75f3c55`
   (2026-06-06). Clone Pierre under `references/` if needed.
2. **Variants.** Which glyphs have duo, filled or outline forms; whether the `minimal` and
   `standard` sets offer anything the app lacks.
3. **Colour per mode.** The hues are already split into light and dark values. Options: pick per
   hue from the tree's and the app's tables, a separate palette per mode, or icon hues derived from
   the active theme bundle.
4. **Coverage.** Which file types in real repos (`/work/projects/*`) fall back to the generic icon
   today.

## Output

A short findings section here: what the pack offers, a side-by-side of candidate palettes in light
and dark, and a recommendation for the owner. Implementation, if any, lands through Plan 178's
[icons](178-tree-in-the-app/icons.md) sub-plan, which turns the hues into tokens.
