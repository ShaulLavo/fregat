# Plan 180: File icon variants

## Status and authorization

- Status: RESEARCH DONE 2026-09-26 — no new glyphs upstream (our 93 are the whole pack, byte-identical);
  the gain is a generator, a hue-token file, two live colour bugs fixed, three two-hue icons, a
  stronger light palette and wider file coverage (5.6% → 2.1% generic). Three owner questions.
  Nothing here authorizes implementation.
- Planned at: Platform `0de7f2212`, 2026-09-26; researched at `c130dd35a`. Origin: [Plan 178](178-tree-in-the-app.md)
  Q1, where the tree's icon colours looked better than the app's in places.
- Size: S–M in total. Phase 1 can land before Plan 178's [icons](178-tree-in-the-app/icons.md) sub-plan,
  which then consumes its tokens instead of writing its own.

## Question

Can we get more from the icon pack we already use: more glyphs, coloured or alternate variants of
the same glyphs, or a different colour per mode (one palette for dark, another for light)? The
generator script is public, so the plan vendors and adapts it instead of reverse engineering it.

## Evidence

Everything below was measured on 2026-09-26. Probes and the comparison sheet are in
`/work/tmp/research2/180/`: `sheet.ts` builds `site/index.html` from the upstream sources and our
files at origin/main, `shoot.ts` screenshots it with Playwright (Chromium, 1700px wide) into
`section-*.png` and `sheet-full.png`. Sections: 1 hue palettes, 2 per file (app today, tree today,
pack, proposed, proposed light at 3:1), 3 one hue vs two, 4 variant families, 5 hues from theme
bundles.

Upstream clones: `references/pierre` (`cc4963a`), `references/pierre-vscode-icons` (HEAD `04a9028`
= tag `v0.0.9`), `references/pierre-theme` (`7169333`, new, for the full colour scales).

## Findings

### The generator and its licences

- The generator is `packages/trees/scripts/generate-built-in-icons.ts` in `pierrecomputer/pierre`,
  **Apache-2.0**. It reads `@pierre/vscode-icons` (SVGs plus `scripts/themes/*.mjs`), maps ~50
  tokens to icon names in two tiers, and writes `builtInIcons.ts`: symbol strings, file-name and
  extension maps, and a resolver. **It emits no colours.** The hues live in the trees package's
  `style.css` (`--trees-icon-*`), which is where our tree copy got them.
- The pack `@pierre/vscode-icons` is **MIT**. The npm tarball (0.0.9: 112 files, 98 KB) ships
  `svgs/`, `scripts/palette.mjs` and `scripts/themes/`, so a pinned dev dependency is enough; the
  Pierre generator itself resolves it the same way.
- The pack's own build (`scripts/build-icon-theme.mjs`) is the part that knows colour: it stamps
  `color(hue)` (one hue, 400 dark / 600 light) or `duoColor(fg, bg)` (a `<style>.bg{fill}` for the
  back layer), applies an optional whole-icon `opacity`, and writes VS Code theme JSON. Only the
  `complete` tier is coloured; `default`'s colours are never shown.
- What survives of Pierre's generator in ours is small (SVG inner extraction, the theme walk). Our
  script is new code modelled on it, with a provenance header naming the file and commit.
  `packages/tree` already holds an Apache-2.0 fork with no licence copy in the repo; worth fixing
  before any release, not a blocker for a private build.

### Upstream has nothing we lack

- `references/pierre-vscode-icons` HEAD is the `v0.0.9` tag; no other branches; npm `latest` is
  0.0.9. The source has 93 SVGs and so do we (the plan's "92" was a miscount).
- `diff-glyphs.ts` compares every glyph after whitespace normalisation: **92 identical, 1 differs
  only by our gradient-id prefix** (`nextjs`). History deleted one SVG (`ruby.svg`, replaced by
  `lang-ruby`).
- So "more glyphs" from the pack means **more mappings onto the 93**, which is what the pack itself
  does: `lang-cpp`, `lang-csharp` and `lang-objc` reuse the `lang-c` glyph under other hues.

### Colours today

- **Hues**: pack 14 (`gray red vermilion orange yellow green mint teal cyan blue indigo purple pink
brown`); ours 13 (no `mint`, no `brown`, plus a local `mauve` that the pack does not have).
- **Live bug — vermilion is swapped per mode** in both copies (`style.css` and `globals.css`):
  light gets `#ff8c5b` (the dark value, contrast 2.10 on the Graphite light background) and dark
  gets `#d5512f`. Only `git` uses it. Pierre's upstream `style.css` has the same swap.
- **Live bug — C, C++ and Objective-C are grey.** `ICON_TOKENS` in `lib/file-icons.ts` has no entry
  for `lang-c`, so it falls to `default`. The pack colours C and C++ blue, C# purple.
- **`bun`**: the pack colours `bun-duo` **brown**, not pink (the pink/brown pair is commented out
  in `complete.mjs`); the app's pink matches neither. The tree's mauve is local. Plan 178 Q1 picks
  mauve.
- The tree and the pack agree on every other hue value. Where they differ is **which icons get a
  hue**: the pack leaves `braces` (json), `lang-markdown`, `image-duo`, `file-table-duo`,
  `file-zip-duo`, `server-duo` and `mcp` neutral and draws `bash-duo` grey; the tree colours them.
  The pack also dims `npm`, `lang-ruby`, `vite` and `svg-2` to 0.75 opacity.
- **Per mode**: every copy already pairs a dark (400) and a light (600) value. The weak side is
  light. Contrast on the Graphite light background (`contrast.ts`): yellow 2.02, mint 2.70, teal
  2.73, cyan 2.76, orange 3.00, green 3.16; WCAG's bar for graphics is 3:1. Dark is 5.5–13.9 for
  every hue except the tree's mauve (3.88).
- The Pierre colour theme (MIT) publishes full 050–950 scales. At the **700** level yellow, orange,
  mint, teal and cyan reach 3.06–4.32 (`levels.ts`, `light-floor.json`); every other hue already
  passes at 600.
- **Hues from the theme bundle** (sheet section 5): palettes carry 6 ANSI hues. Mapping 14 hues onto
  them merges orange/yellow, blue/indigo, purple/pink and teal/cyan, so TypeScript, CSS, Go and
  React would share two blues. Rejected on that evidence (see Decisions).

### Two hues

- 21 source SVGs carry a `class="bg"` back layer; 24 are named `-duo`. Seven `-duo` glyphs have no
  `bg` class (`code-block-duo folder-plus-duo image-duo lang-css-duo npm-duo server-duo wasm-duo`)
  and would need their back paths classed before a second hue could reach them.
- **The pack draws a second hue on three icons only**: `lang-python` (blue over yellow), `astro`
  (purple over pink), `webpack` (blue over cyan). Everything else, the pack included, is one hue
  with the back layer at its baked opacity (0.2–0.8), exactly like ours.
- Sheet section 3 renders all 21 both ways. The three pack pairs read as the brands' own colours;
  a neutral grey back under a hue helps `file-table-duo` and `file-zip-duo` a little and makes
  `browserslist-duo` worse.

### Variants

Sheet section 4 lays out the families the pack already ships: `typescript` / `lang-typescript` /
`lang-typescript-duo`, the same three for JavaScript and CSS, five HTML variants, `bash`/`bash-duo`,
`npm`/`npm-duo`, `wasm`/`wasm-duo`, `svg`/`svg-2`, `oxc`/`oxc-fill`, `server`/`server-duo`,
`image`/`image-duo`, eleven file and eight folder shapes. A variant is a per-type choice in the
rules table, not new art. Today's picks and the pack's differ for `.ts` (`typescript` vs
`lang-typescript-duo`), `.tsx`/`.jsx` (the `-duo` language glyphs vs `react`), `.js`, `.css`, `.html`,
`.md`, `.svg`, `.xlsx`, `package-lock.json` and `bunfig.toml` (sheet section 2, highlighted rows).

### Coverage

Measured with the app's own resolver (`iconForEntry` imported from `lib/file-icons.ts`) over
`git ls-files` of real checkouts:

| Corpus                                  | Files   | Generic today | With pack maps + ~30 aliases |
| --------------------------------------- | ------- | ------------- | ---------------------------- |
| `/work/projects/*` (7 repos)            | 7,727   | 156 (2.0%)    | 83 (1.1%)                    |
| `references/*` (41 real upstream repos) | 142,307 | 7,950 (5.6%)  | 3,030 (2.1%)                 |

- The pack's maps alone cover 834 of the 7,950: `.sql`/`.sqlite` (`server-duo`), `.mts`/`.cts`,
  `.icns`/`.tiff`, `.cs`, `.jsonl`/`.json5`, `.less`, `.prettierignore`, `.npmignore`, `.ini`,
  `.rst`, `.code-workspace`. The pack lists `LICENSE`, `AUTHORS`, `CHANGELOG` as _extensions_, a
  bug upstream; our table moves them to file names.
- The rest of the gain is aliases onto existing glyphs: `.toml`/`.nix`/`.gradle`/`.service` →
  `gear`, `.xml`/`.plist`/`.scm` → `code`, `.ps1`/`.bat`/`.cmd` → `bash`, `.patch`/`.diff`/`.lock`/
  `.snap` → `file-text-duo`, `LICENSE`/`NOTICE`/`CODEOWNERS` → `file-text-duo`, `.ipynb` →
  `lang-python`, `.webmanifest`/`.map` → `braces`.
- What is left needs art: `.mp3`/`.mp4` (8 and 5 repos), `.pdf`, Java, Kotlin, PHP, Lua, Julia, Perl,
  Dart, R, Clojure, `Makefile`. Phosphor (already a dependency) has `FileAudio`, `FileVideo`,
  `FilePdf`, `FileLock`, `GitDiff`, but in an outline style that does not match the pack's solid
  16px shapes.

### Stem rules

- `lib/file-icons.ts` has 45 stem rules. Half are glyph names (`lang-css-duo`, `folder-zip`, …) that
  only ever match files named after a glyph. The rest are words: `config`, `settings`, `server`,
  `extension`, `code`, `file`, `stack`, `layer(s)`, `react`, `bun`, `claude`, `mcp`, `vscode`.
- A stem beats the extension, so `server.ts` shows a database glyph, `config.ts` a gear,
  `extension.ts` a puzzle piece and `vscode.d.ts` the VS Code logo. `stems.ts`: **1,664 of 150,034
  files (1.1%) lose their language icon to a stem**, led by `vscode.*` 522, `config.*` 243,
  `settings.*` 196, `extension.*` 184, `server.*` 115. The pack and VS Code match exact names and
  extensions only. The tree does the same today, because it is fed `iconNameForFile` per path.

## Decisions

- **Generator location and inputs.** Decided 2026-09-26: research recommendation. `scripts/icons/generate.ts`
  plus a hand-written `scripts/icons/rules.ts`; `@pierre/vscode-icons` pinned at `0.0.9` as a root dev
  dependency. Precedent: `scripts/themes/generate-palette-css.ts` with its `--check` mode in
  `generated:check`. A pack update becomes a version bump and one run.
- **Glyph per type.** Decided 2026-09-26: research recommendation. Keep today's picks. The tree
  look the owner prefers (178 Q1) already renders these glyphs; the pack's differing picks are in
  sheet section 2 for any single row the owner wants to change.
- **Drop stem rules.** Decided 2026-09-26: research recommendation. A file named `server.ts` is
  TypeScript; exact file names (`package.json`, `vite.config.ts`, `CLAUDE.md`) stay.
- **No 0.75 opacity.** Decided 2026-09-26: research recommendation. The tree look has none, and it
  lowers contrast further on the light side.
- **Hue assignment.** Decided 2026-09-26: research recommendation. The tree's hue per icon (so json,
  markdown, images, tables, zips, mcp and databases stay coloured), `bun` in mauve per 178 Q1,
  vermilion un-swapped, `lang-c` blue, pack values for every hue.
- **Hues from the active theme bundle.** Decided 2026-09-26: research recommendation. No: 6 ANSI
  hues cannot keep 14 apart (sheet section 5). Because the hues become tokens, a palette can still
  override them later without code changes.

## Owner questions

- **Q1. Two hues.** (a) One hue everywhere, as today. (b) The pack's three pairs: Python blue over
  yellow, Astro purple over pink, webpack blue over cyan. (c) (b) plus a neutral grey back layer on
  the file and language `-duo` glyphs. **Recommendation: (b).** They are the brands' own colours, the
  pack already draws them, and the cost is one custom property on three glyphs.
- **Q2. Light-mode palette.** (a) Pack 600 for every hue, as today. (b) The 700 level for yellow,
  orange, mint, teal and cyan, so every hue clears 3:1 on a light background; dark unchanged.
  **Recommendation: (b).** The JavaScript icon is 2.0:1 in light today; see sheet section 2's last
  column for the look.
- **Q3. File types with no glyph** (media, PDF, Java, Kotlin, PHP, Lua and similar; 2.1% of files
  after aliasing). (a) Leave them generic. (b) Draw about six glyphs in the pack's style (audio,
  video, PDF, Java, Kotlin, one generic "source" shape). (c) Borrow Phosphor's fill glyphs.
  **Recommendation: (a) for now.** Aliasing already takes the generic share from 5.6% to 2.1%; (b)
  is Phase 5 whenever the owner wants it, and (c) clashes with the pack's shapes.

## Proposed phases

1. **Generator and hue tokens (M).** `scripts/icons/generate.ts` and `rules.ts`;
   `@pierre/vscode-icons@0.0.9` dev dependency; `icons:generate` and `icons:generate:check` scripts,
   the check added to `generated:check`. `rules.ts` lists per glyph: file names, extensions, hue,
   optional back hue; local hues (`mauve`, values from the tree) live there. Outputs:
   - `apps/web/src/lib/vscode-icon-glyphs.ts`, regenerated: same 93 glyphs, gradient ids
     namespaced by the generator, `class="bg"` paths filled with `var(--file-icon-back, currentColor)`.
   - `apps/web/src/lib/file-icon-rules.generated.ts`: file-name and extension maps and each icon's
     hue. `lib/file-icons.ts` resolves through them; `VSCODE_ICON_NAMES`, `VSCODE_ICON_RULES`
     and `colorForFileIcon` go. `ICON_TOKENS` stays only for the tree's remap until 178 icons deletes
     that path.
   - `packages/ui/src/styles/file-icons.generated.css`, imported by `globals.css`: `--file-icon-<hue>`
     for 15 hues and `--file-icon-neutral` on `:root` and `.dark`, plus `--color-file-icon-<hue>` in
     `@theme inline`. The 97 `--trees-file-icon-color-*` declarations leave `globals.css`.
   - `components/file-type-icon.tsx` takes a literal `text-file-icon-<hue>` class from a generated
     record, so Tailwind sees it; no inline colour.
   - `components/tests/file-type-icon.test.tsx` follows the class change.
     This phase carries the two bug fixes (vermilion, C) and the mauve `bun` into every app surface.
     The tree keeps its own `:host` colours until 178 icons. Verify: `look` on quick open, git changes
     and an editor tab strip in light and dark; the generator's `--check` in CI.
2. **Coverage (S).** Drop the stem rules; add the pack's maps and the aliases listed under Coverage to
   `rules.ts`, with `LICENSE`-style names as file names. Owner: `apps/web/src/lib/file-icons.ts`
   tests gain one case per alias family. Verify: rerun `/work/tmp/research2/180/alias-cover.ts`
   (expect ≤2.1% generic over `references/`).
3. **Two hues (S), after Q1.** `rules.ts` gives `lang-python`, `astro` and `webpack` a back hue; the
   generated record adds `[--file-icon-back:var(--color-file-icon-<hue>)]` to their class. Works
   through `<use>` too, because custom properties inherit into the sprite's shadow tree.
4. **Light palette (S), after Q2.** The generator takes light values per hue from `rules.ts`
   (yellow, orange, mint, teal, cyan at the Pierre theme's 700). Dark untouched.
5. **New glyphs (M), only if Q3 is (b).** `scripts/icons/svgs/` overlay read after the pack; drawn
   16×16 with `fg`/`bg` classes like the pack's sources.

## Coordination with Plan 178

- [icons](178-tree-in-the-app/icons.md) step 2 ("hue tokens") becomes: use the tokens Phase 1
  generates. Its steps 1, 3 and 4 are unchanged; step 4's deletions now include `ICON_TOKENS`.
- If 178 icons runs first, it lands Phase 1 as its step 2 instead of hand-writing 13 tokens.
- Parity for 178's harness: after Phase 1 the app and the tree already agree on `bun` (mauve); they
  differ on `git` (fixed in the app only) and on C (blue in the app only) until the tree moves onto
  `FileTypeIcon`.
