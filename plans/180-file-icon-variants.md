# Plan 180: File icon variants

## Status and authorization

- Status: PROPOSED, a quick research plan. Requested 2026-09-26 (owner). Nothing here authorizes
  implementation.
- Planned at: Platform `0de7f2212`, 2026-09-26. Origin: [Plan 178](178-tree-in-the-app.md) Q1, where
  the tree's icon colours looked better than the app's in places.

## Question

Can we get more from the icon pack we already use: more glyphs, coloured or alternate variants of
the same glyphs, or a different colour per mode (one palette for dark, another for light)?

2026-09-26 (owner): look into reverse engineering the generator script. It turned out to be public
(below), so the plan vendors and adapts it instead.

## What exists

**Our copies.**

- `packages/tree/src/utils/builtInIcons.ts` is the output of Pierre's generator; the generator was
  not vendored. Three sets (`minimal`, `standard`, `complete`) and a `colored` flag; only `complete`
  is coloured.
- `apps/web/src/lib/vscode-icon-glyphs.ts` is the app's own copy: 92 glyphs, 24 of them `-duo`
  variants with a back layer at 0.5–0.6 opacity, used by `FileTypeIcon` everywhere and fed to the
  tree as a sprite.
- Colours: 13 hues, each a light and a dark value in raw hex
  (`packages/tree/src/styles/style.css:287-350`, copied into `packages/ui/src/styles/globals.css`).
  The copies disagree on `bun`: mauve in the tree, pink elsewhere. The owner prefers the tree's.

**The pipeline upstream** (found 2026-09-26 while scoping; clone at `references/pierre`, `cc4963a`):

- The generator is public: `packages/trees/scripts/generate-built-in-icons.ts` (455 lines). Nothing
  needs reverse engineering. It reads SVGs and theme data from `@pierre/vscode-icons`, maps ~50
  tokens to icon names by tier (preferring duo variants), builds extension and file-name maps, and
  writes `builtInIcons.ts`.
- `@pierre/vscode-icons` is a VS Code file icon theme, MIT, source at
  `github.com/pierrecomputer/vscode-icons` (HEAD `04a9028`). The latest npm release is 0.0.9
  (2026-05-08): 93 SVGs, so our 92 are nearly the whole pack.
- Its `scripts/palette.mjs` holds 14 hues, each with a dark value (400) and a light value (600), and
  a neutral fill (gray 400 dark, gray 800 light). `color(hue)` returns both.
- `duoColor(fg, bg)` colours the two layers of a duo icon with **different hues** (for example purple
  over pink). Our copy draws both layers in one colour with the back layer at reduced opacity.
- Themes `minimal.mjs`, `default.mjs` and `complete.mjs` assign a colour per icon; `complete` re-maps
  some default icons to other hues.
- The pack's `bun` is pink (`#ff678d` dark, `#d32a61` light), matching the app. The tree's mauve
  (`#79697b` / `#594c5b`) is not from the pack.

## Research

1. **Vendor the generator.** Adapt it to write our outputs directly: the glyph file, the icon map
   `lib/file-icons.ts` uses, and the hue tokens. A pack update then becomes a script run instead of
   hand-copied SVG strings. Decide where it lives (`scripts/`) and whether the pack becomes a dev
   dependency.
2. **What upstream has that we lack.** Diff the source repo's SVGs and themes at HEAD against 0.0.9
   and against our 92 glyphs: icons added since, icons we dropped, colour changes.
3. **Two-hue duo icons.** Render the 24 duo icons with `duoColor`'s two hues instead of one hue at
   reduced opacity, side by side with today's, light and dark.
4. **Colour per mode.** The pack already pairs a dark and a light value per hue. Compare three
   palettes in both modes: the pack's, the app's `globals.css`, and the tree's (with its mauve).
   Options include picking per hue, a different palette per mode, or hues from the active theme
   bundle.
5. **More icons.** 93 glyphs is the whole pack. For file types that fall back to the generic icon in
   real repos (`/work/projects/*`), find whether the source repo has them unreleased, or whether
   they would have to be drawn in the pack's style.

## Output

A short findings section here: the generator adapted (or a reason not to), the upstream diff, a
side-by-side of duo and palette options in light and dark, the uncovered file types, and a
recommendation for the owner. Implementation lands through Plan 178's
[icons](178-tree-in-the-app/icons.md) sub-plan, which turns the hues into tokens.
