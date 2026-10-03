---
name: web-ui
description: Build and review Fregat web UI using its theme tokens, shared primitives, loading states, focus, motion, and truncation rules. Use for web views and packages/ui changes.
---

# Fregat web UI

Apply these repository rules when building, changing, or reviewing web UI, including shared UI primitives. Paths below are relative to the repository root.

## Design Language

`scripts/lint/web-design-census.mjs` enforces most of this; exceptions live in `scripts/lint/web-design-allow.json` with a reason. A case these rules do not cover needs a new token, not a local choice.

- Tailwind classes and `@workspace/ui` primitives only. No raw CSS or inline `style` except runtime-computed values. No raw `<button>`/`<input>` when a primitive exists, and no restyling primitives at the call site (no radius class, no hover on `Button`).
- Colors are theme tokens only: no palette classes, hex or `oklch()`, no hand-rolled `dark:` pairs. Status: `destructive`, `info`, `success`, `warning`; diffs: `diff-added`, `diff-removed`. Tokens take opacity (`bg-success/10`). A missing color goes into `packages/ui/src/styles/globals.css` (`:root`, `.dark`, `@theme inline`).
- Text: `text-foreground` or `text-muted-foreground`, never alpha; disabled controls may use whole-control `opacity-50`. Sizes `text-sm`, `text-xs`, `text-2xs`, `text-3xs`; no `text-[Npx]`. Bar title `text-xs font-medium`, pane section heading `text-sm font-semibold`, group label `section-label`. App words are Inter; code and short metadata (counts, times, hashes, branches, chords, diff stats) are `font-mono`. Updating numbers carry `tabular-nums`.
- Corners: controls, chips, kbd, inline code and skeleton bars `md`; floating surfaces `lg`; pills `rounded-full`; rows, bars, headers, panes and bar tabs square. Bare `rounded` and redundant `rounded-none` are banned.
- Every horizontal bar is `h-(--bar-height) px-(--bar-padding-x)`, ideally `PaneBar`; rails are `w-(--rail-width)`. Skeleton bars use the same token. Spacing uses `--density-*`; there is no `compact:` variant.
- No dividers: surfaces separate by tone (`bg-background` beside `bg-content-well`, chips `bg-muted`, callouts a status tint). No `border-border`, `border-subtle`, `divide-*` or edge borders; `border border-transparent` only as the base for a state color. Panels take `bg-background`, not `bg-card`.
- Pane surfaces follow `--surface-opacity` and are painted once: `ToolPane` paints nothing, the region owning the surface does (sidebar `aside`, chat tool panel, dialog, or a `ToolPane` that is the whole region). `backdrop-material` over wallpaper.
- Floating UI (dialogs, menus, popovers, toasts, tooltips, editor hovers) is opaque: `bg-popover-solid` or `bg-popover`, no blur. Floating surfaces keep `ring-1 ring-foreground/10`. Elevation: `shadow-xl` modal, `shadow-md` menu/popover, nothing else.
- Rows are `ListRow` with `bg-row-hover`/`-active`/`-selected` (no opacity modifier), `aria-selected`, `data-marked`. Lists focus through `useListbox`. Row windowing is `VirtualList`. Toggled controls: `bg-accent` with `aria-pressed`/`aria-selected`.
- Panes compose `ToolPane` + `ToolPaneHeader`, rendering pending before error before empty.
- Icons: `size-(--icon-size)` on controls and headings, `size-(--icon-size-sm)` in rows and text.
- Icon-only controls get a `Tooltip`; inside virtualized rows use `data-tooltip`. Truncated values get a native `title`, never both on one control.
- Scrollbars are one base-layer rule: thin, invisible at rest, shown on hover or focus-within; a call site never styles one. `no-scrollbar` for horizontal strips (census `scrollIdiom`), `scroll-gutter` on a vertical scroller that crosses the overflow threshold while watched, `scroll-fade` (default in `VirtualList`, `ToolPane` bodies, `CommandList`), `scroll-pinned` while a view follows its tail. A `ToolPane` whose body hosts its own scroller or a terminal passes `scroll={false}`.
- A key is drawn by `Kbd` and nowhere else (census `kbdSpelling`). Menus show a shortcut as a trailing chip; a tooltip on an icon-only trigger for a bound command shows it too, via `useCommandShortcut`.
- Physical motion, reduced motion and pointer sounds belong to the shared primitives; a new interactive primitive defines all three. `--shadow-key`/`--shadow-well` live only in `packages/ui` (`none` under Flat). Rows, bar tabs, editors and terminal input stay still and silent. A raw control, including `role="button"`, needs a design allow-list reason and declares its `data-feedback` policy.
- Focus: `focus-ring` (act on), `focus-ring-within` (type into), `focus-ring-inset` (full-bleed scrollers); tint with `--focus-ring-color`, never a `ring-*` class. Opt out with `focus-visible:ring-0`. Inside a wrapper that draws the field ring, use `shadow-none!` and `aria-invalid:ring-0` on the inner control. A new `@utility` that sets `box-shadow` must join the focus class group in `packages/ui/src/lib/utils.ts` (tailwind-merge cannot see custom utilities).
- `pressable` for press feedback. Motion uses the configured defaults (`--duration-enter`/`-exit`, `ease-*-strong`); never hand-write durations or curves. A transition that animates a focus ring must list `box-shadow`.
- Composite fields (leading icon, trailing button or count) are `InputGroup` with addons, never absolute icons over a padded input.

## Loading, Empty And Error States

- Three loaders from `@workspace/ui`, nothing hand-rolled: `LoadingState` (skeleton for a region with no content yet, mirroring the loaded view's primitives, one placeholder per element), `Spinner` (anything else; `size` `xs` rows, `sm` control icon, `md` panel, `lg` surface; none inside `Button`; no `text-*` class), `Shimmer` (inline in a running sentence only).
- Branch on pending before empty; loading and empty must never look alike. Do not defeat `LoadingState`'s 120ms delay or add `motion-reduce:` at call sites.
- A view that switches subjects (selection, commit, session, tab, theme) keeps the old subject whole, header and body, until the new one can paint, then swaps in one frame; the wait is a `Spinner` in the header. Skeletons are for a region's first load. Hold with `useHeldUntilReady` (`hooks/use-held-until-ready.ts`) or `placeholderData` that carries its subject, never with a header from the new subject over the old body; no `key={subject}` on a view whose data loads.
- Render failures: `RenderErrorBoundary` (`@workspace/ui/patterns/render-error-boundary`) at each seam `ToolPane` does not cover, with `resetKeys` set to the shown identity. Local boundaries do not log (the root's `onCaughtError` does). Query and mutation failures stay state; no `throwOnError`. Keep boundaries below anything that must stay mounted (terminals).
- Content that must outlive its layout (terminals) goes through `lib/keep-alive` (`KeepAliveProvider`, `KeepAliveSlot`, `useKeptIds`); kept content sees the provider's context, and stands down via `attached`. Connection notices overlay the retained host (`features/terminal/components/panel.tsx`).
- Observe rendered children with a Fragment ref and `observeUsing` (`editor-tab-bar.tsx`); keep wrappers that own layout. Text in a height-capped `pre` changes its scroll boundary without resizing, so `activity-detail-section.tsx` keeps a mutation observer.

## Truncation

- `truncate`/`line-clamp` on a value the app did not author (path, branch, title, model, host, excerpt) needs a native `title` on the element spanning the row, adding what the row cannot show (full path behind a basename). The census gates this as `truncationRecovery`; `packages/ui` and static labels are exempt.
- No middle truncation: basename first, muted directory second (`components/file-label.tsx`, `basename`/`parentPath` in `lib/path-formatters.ts`).
