# Plan 335: Stroke icons, Hugeicons by default, morphing icons, icon packs later

## Status and authorization

- Status: Approved. Owner decision 2026-10-03, after comparing Phosphor, Lucide, Tabler, Hugeicons, Iconoir, Solar Linear and Mynaui side by side at app size.
- Four parts: stroke icons only, Hugeicons as the default, morphing icons, icon packs. Phases 1–3 (swap, MorphIcon, morph sites) are the current work. Phase 4 (icon packs) is Approved and scheduled later; it starts after Phase 3 ships, and may split into its own plan once its design is written.
- Scheduling: [root roadmap](../PLAN.md#placement-of-the-large-additions) puts the broad swap after the keymap cutover and before broad new UI batches. Registry/mapping preparation can proceed earlier; Phases 1–3 remain the current approved scope.
- Priority: P2. Effort: L (about 330 files touch an icon). Risk: low per file, concentrated in the filled/duotone call sites and the morph timing rules.
- Planned against Fregat `4799803b7`. Before execution, rerun the counts below; they drift as features land.

## Decisions

1. **Stroke icons only.** Every icon the app draws is a stroked centerline (`fill="none"`, color through `stroke`). No filled, duotone or bold variants. A state that Phosphor showed with a filled glyph (favorite, pinned, active) is shown with a theme token tint or a different icon.
2. **Hugeicons is the default set**, from `@hugeicons/core-free-icons` (MIT, free "stroke rounded" style, about 6,000 icons) at a 1.5 stroke. At `--icon-size` (16px) that draws a 1px line, the same weight as Phosphor regular.
3. **Call sites name an icon by meaning, not by set.** `packages/ui` owns one registry from `IconName` (`close`, `branch`, `send`, …) to icon data; the app renders `<Icon name="branch" />`. This is the seam icon packs replace in Phase 4, so a pack is data and touches no call site.
4. **Morphing comes from [morphicons](https://github.com/guillermolg00/morphicons)** (MIT, zero dependencies, about 8 KB gzip for the React binding), wrapped once as `MorphIcon` in `packages/ui`. Morphs only where the icon change is the feedback. Rows, bar tabs, editors and terminal input stay still.

## Current code

- `@phosphor-icons/react` is imported by about 330 files in `apps/web/src` and `packages/ui/src`; 170 distinct icons. `editor/`, `ghostty-webgpu/` and `apps/tui` import none.
- Weight props: `fill` 16, `duotone` 17, `bold` 10, `regular` 2 call sites (about 30 files, e.g. `features/chat/components/chat-input-submit-button.tsx`, `features/file-picker/components/pin-folder-button.tsx`, `packages/ui/src/components/sonner.tsx`, `packages/ui/src/patterns/render-error-state.tsx`).
- Phosphor's `type Icon` is used as a prop type (`keymap/editor-title-actions.ts`, `features/file-picker/utils/sidebar-locations.ts`, menu models under `keymap/menus/utils/`).
- `apps/web/scripts/phosphor-weight-plugin.ts` (+ test) prunes unused Phosphor weights at build, wired in `apps/web/vite.config.ts:131`; `apps/web/vitest.browser.config.ts:64` pre-bundles `@phosphor-icons/react`.
- File-type icons (`scripts/icons/generate.ts`, `apps/web/src/lib/file-icons.ts`) are a separate system and stay out of scope.

Comparison evidence: mock sources in `/work/tmp/icons-mock/` (`src/icons.ts` and `map.json` hold the Phosphor → Lucide/Tabler/Hugeicons/… name mapping for the 44 most-used icons).

## Phase 1: Registry and the swap

- [ ] Add `@hugeicons/core-free-icons` to `packages/ui`. Confirm per-icon tree-shaking in the production build. Bundle size is not gated; investigate size when it causes a real problem.
- [ ] `packages/ui/src/icons/registry.ts`: `IconName` union and the name → Hugeicons node map. `packages/ui/src/icons/icon.tsx`: `Icon` renders a node as an inline `<svg>` sized `size-(--icon-size)` by default, `stroke-width` 1.5, `aria-hidden` unless labelled. Export both through the package entry.
- [ ] Replace every Phosphor import with `Icon`/`IconName`, Phosphor's `type Icon` props with `IconName`. Write the 170-row mapping table into this plan as it is made; pick by drawing, check each at 16px.
- [ ] Resolve each `fill`/`duotone`/`bold` site by intent (state → token tint such as `text-warning` or `bg-accent` on the control; emphasis → the plain stroke icon). List each site and its resolution here.
- [ ] Delete `phosphor-weight-plugin.ts`, its test and its Vite wiring; drop the Vitest pre-bundle entry; remove `@phosphor-icons/react` from both `package.json` files. Update third-party notices (`scripts/licenses/`).
- [ ] Gate: `scripts/lint/web-design-census.mjs` rule `strokeIcons` fails on any `@phosphor-icons/*` or other icon-library import outside `packages/ui/src/icons/`, and on a registry entry whose data contains a fill.

## Phase 2: MorphIcon

- [ ] `packages/ui/src/icons/morph-icon.tsx` over `morphicons/react`, taking `IconName`s. `reducedMotion="user"` always. Map its spring to the configured motion defaults (`--duration-enter`, `ease-*-strong`); if the spring cannot follow those, record a design allow-list exception with the reason.
- [ ] Confirm morphicons accepts Hugeicons nodes directly (their attributes are camelCase `strokeWidth`); otherwise convert once in the registry, not per render.
- [ ] Static icons pay nothing: only `MorphIcon` loads the morph runtime.

## Phase 3: Morph sites

- [ ] Composer send ↔ stop (`features/chat/components/chat-input-submit-button.tsx`).
- [ ] Copy → check after copying (`components/copy-button.tsx`), then back.
- [ ] Sidebar and panel show/hide toggles; light/dark toggle (`components/ui-mode-toggle.tsx`); play/pause where present.
- [ ] Expand/collapse chevrons in pane headers and section headers only; tree and list rows keep a still chevron.
- [ ] Evidence: `bun run agent:browser look` of the chat composer, git panel, file tree, settings and command palette before and after; a short recording of each morph site. Name the evidence directory here.

## Phase 4: Icon packs (Approved, scheduled later)

- A pack is data: a map from `IconName` to stroke icon nodes, plus name, author and license. Bundled packs: Hugeicons (default) and at least Lucide and Tabler, whose mappings already exist from the comparison.
- A setting in `packages/contracts/src/settings/keys.ts` selects the pack. Missing names fall back to the default pack; a pack that draws fills is rejected at load with a structured error (morphicons' morphability scan provides the check).
- Open design questions, to settle before building: whether user packs install from a file, from theme bundles (`lib/appearance`), or both; whether a pack can set its own stroke width; how the settings UI previews a pack.

## Acceptance

- No `@phosphor-icons` import or dependency remains; `bun run gates` passes with the new `strokeIcons` rule.
- Every icon renders from the registry at a 1.5 stroke; no filled glyph remains.
- Morph sites animate, and swap instantly under reduced motion.
- Web bundle size equal or smaller than the Phosphor baseline, numbers recorded above.
- Look evidence read back for each surface listed in Phase 3.
