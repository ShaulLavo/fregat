# Plan 178: The file tree in the app

## Status and authorization

- Status: PROPOSED, a plan of plans. Research done and Q1–Q5 answered 2026-09-26 (owner). Nothing
  here authorizes implementation.
- Planned at: Platform `bfc48ef17`, 2026-09-26. Rewritten the same day from a single four-phase
  plan after the owner widened it (below).
- Effort: thirteen sub-plans, S to L. Each ships and deploys on its own and leaves the tree working.
- Companion: [Plan 179](179-isolating-foreign-content.md) looks at where a shadow root does help.

## Outcome

The file tree looks and behaves as it does today, and every part of it is app machinery: it renders
in the app's React root, is styled in Tailwind with theme tokens, rows are `ListRow`, windowing is
`VirtualList`, keys go through `useListbox` and the keymap, the menu is `MenuSurface`, drag is
dnd-kit inside the window and native drag outside it, through the one drag layer every surface
uses, icons are the app's, and filter matching, path helpers and file order are the app's shared
helpers. Its files are named and sized like the rest of the app. Where the app lacks
something the tree does, the app gains it as a shared primitive and the other surfaces named in each
sub-plan adopt it. Where the tree does something better than the app, the app aligns to the tree.
`packages/tree` keeps only the DOM-free model the TUI also uses.

## Owner direction

- 2026-09-26: the shadow root has no reason to exist for us. The tree is a core part of the app,
  and sharing styles and state with it takes constant work.
- 2026-09-26, widening the plan: **parity** — the tree's look and feel is "basically perfect" and
  must stay. **Reuse** — rebuild it from everything the app already has: dnd-kit like everywhere
  else, the same icons, the same styles, Tailwind, the app's virtualization. The work is large and
  splits into several plans.
- 2026-09-26, answers to Q1–Q5 (recorded under Decisions): alignment runs both ways — some things
  the tree does better, and the app should follow it. Obvious bugs get fixed; product behaviour
  stays as it is. Drag uses dnd-kit inside the app and native drag once it leaves the window. No
  staged rollout: the app is not live, and a sub-plan is done when its adopters are done.
- 2026-09-26, after reviewing the draft: **the tree's code is good, integrate it rather than throw
  it away** — where its version is better (the virtualizer is a candidate), the app adopts it.
  **Align it with the app:** kebab-case files and no folder-name prefixes, the big files split,
  nothing left over from being a published package (presorted input, dead ids, private
  attributes, the wide public surface). **One drag layer for everything** that drags, the rail and
  terminals included, so future integrations (anything into the chat, across machines) need no
  rework. **The other duplicates** — filter matching, path helpers, sort order, errors — are part
  of this plan too.

## Why the tree is separate today

`packages/tree` is Pierre's `packages/trees` + `packages/path-store`, vendored in `ed75f3c55`
(2026-06-06) as a product-owned fork (`packages/tree/UPSTREAM.md`); 46 commits since rewrote about
36% of it. Pierre ships into pages it knows nothing about, so it isolates itself: custom element,
shadow root, its own React root, its own stylesheet with a `--trees-*` override chain, an
`unsafeCSS` escape, its own icons, virtualizer, keyboard model, drag and menu trigger. About 5k of
its ~21k lines exist for that. The app then spends another layer bridging into it: a 16-variable
token map, a 70-line injected stylesheet with its own loader, imperative refresh calls because rows
cannot read app state, a menu attribute so the tree's outside-click check leaves app popups alone, a
tooltip patch for retargeted events, a hand-mirrored skeleton, and tests and scripts that pierce the
root. The design census never scanned the tree, so it also carries middle truncation, no title
recovery, raw hex, and hand-written motion.

## Rules for every sub-plan

1. **Parity first.** The [parity spec](178-tree-in-the-app/parity-spec.md) is the contract. The
   [parity harness](178-tree-in-the-app/parity-harness.md) proves it: pixel and computed-style diffs
   across compact and cozy, light and dark, every state; a behaviour test for every interaction.
   Drift fails the sub-plan unless it is a Q1 alignment or a Q2 bug fix.
2. **Reuse before build.** Each tree capability maps to an app primitive. When the primitive falls
   short, extend it in `packages/ui` or `lib/`; do not keep a tree-private copy.
3. **Adopters move in the same pass.** Each extension lands with the tree and every adopter named
   in its sub-plan.
4. **Alignment runs both ways.** When the tree's version of something is better than the app's
   (its truncation, its hover-only scrollbar, its icon colours), the change goes into the app and
   its rules, through [tree-leads](178-tree-in-the-app/tree-leads.md), not into the tree.
5. **The model stays DOM-free.** `FileTreeController` and the path store keep working for the TUI
   through `@workspace/tree/model`.
6. **Measure.** Scroll, render and drag claims cite `trace` and `renders` against the harness
   baseline.
7. **App naming and size.** A file a sub-plan moves or rewrites leaves it kebab-case, without the
   folder-name prefix, one component or hook per file, and split by concern once it passes about
   500 lines ([app-owned-state](178-tree-in-the-app/app-owned-state.md) steps 2–3).

## Sub-plans

| Sub-plan                                                                | Outcome                                                                                                           | Size | Depends on           | Other adopters                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---- | -------------------- | ----------------------------------------------------------------------------- |
| [parity-spec](178-tree-in-the-app/parity-spec.md)                       | The look and behaviour contract, with the quirks and rule conflicts to decide                                     | —    | —                    | —                                                                             |
| [parity-harness](178-tree-in-the-app/parity-harness.md)                 | Matrix capture, pixel and style diff, a test for every uncovered behaviour                                        | M    | —                    | any rebuilt surface                                                           |
| [out-of-the-root](178-tree-in-the-app/out-of-the-root.md)               | Custom element, shadow root and second React root gone; nothing changes on screen                                 | M    | harness              | —                                                                             |
| [app-owned-state](178-tree-in-the-app/app-owned-state.md)               | View moves into `features/workspace`, renamed and split; props and state replace the facade; package leftovers go | L    | out-of-the-root      | —                                                                             |
| [rows](178-tree-in-the-app/rows.md)                                     | Rows on `ListRow` + a shared `TreeRowLead`, Tailwind and tokens                                                   | L    | app-owned-state      | git group headers, chat turn files, folder picker, search groups, diagnostics |
| [icons](178-tree-in-the-app/icons.md)                                   | One icon path and sprite for every file row; icon hues as tokens                                                  | S–M  | app-owned-state      | every `FileTypeIcon` user                                                     |
| [chrome](178-tree-in-the-app/chrome.md)                                 | `FilterField`, `InlineRenameInput`, shared scrollbar, real-row skeleton                                           | M    | app-owned-state      | five filter fields, session and terminal rename                               |
| [context-menu](178-tree-in-the-app/context-menu.md)                     | `useListContextMenu` over `MenuSurface`                                                                           | S–M  | app-owned-state      | git changes, session rail, search results                                     |
| [virtualization](178-tree-in-the-app/virtualization.md)                 | `VirtualList` gains count mode, kept rows, sticky chains, scroll padding, settlement                              | L    | app-owned-state      | search, git changes, diagnostics headers; logs, chat                          |
| [keyboard-and-selection](178-tree-in-the-app/keyboard-and-selection.md) | Shared selection model, multi-select `useListbox`, tree commands in the keymap                                    | L    | virtualization       | session rail                                                                  |
| [drag-and-drop](178-tree-in-the-app/drag-and-drop.md)                   | Tree on dnd-kit through the one app-wide drag layer; typed drops on composer and editor                           | L    | virtualization, rows | editor tabs, session rail, terminal list, composer                            |
| [helpers](178-tree-in-the-app/helpers.md)                               | One filter matcher, path helper set, file-order comparator and error catalog, shared with the app                 | M    | app-owned-state      | quick open, search, git, chat turn files, file picker, filter fields          |
| [tree-leads](178-tree-in-the-app/tree-leads.md)                         | The app adopts what the tree does better: truncation, scrollbar, pressed tint, and whatever the harness turns up  | M    | parity-harness       | every list with a path, every scroller                                        |
| [cleanup](178-tree-in-the-app/cleanup.md)                               | Stylesheet, bridges and exemptions gone; package is model-only                                                    | S    | all                  | —                                                                             |

Order: harness → out-of-the-root → app-owned-state; then rows, icons, chrome and context-menu in
parallel with virtualization; keyboard-and-selection and drag-and-drop after virtualization;
helpers any time after app-owned-state; tree-leads any time after the harness; cleanup last. Rows, icons and chrome touch the same row component, so they land one after the
other in that lane.

## Decisions

Answered 2026-09-26 (owner).

- **Q1. Look versus rules.** The recommended split stands.
  - **Keep the look, as tokens or allowed exceptions:** compact 12.5px and cozy mono (tree font
    tokens), 1px indent guides (a `w-px` element, allowed as structure, not a divider), the
    0.8-scale geometry and 16px icons, no pressed tint.
  - **Align the tree to the app** where the change is barely visible: raw hex to tokens at the same
    values, the rounded focus ring on a square row, the ring after a mouse click (to
    `:focus-visible`), the filter input's border and extra 4px, the guide transition and shimmer (to
    motion tokens and `Shimmer`), the drag preview shadow, alpha on ignored icons and the change dot.
  - **Truncation:** the tree keeps what it does today, extension-preserving middle truncation. Whether
    the app should do the same is a [tree-leads](178-tree-in-the-app/tree-leads.md) question, and
    would change the AGENTS.md rule, not the tree.
  - **Icon colours:** the tree's look is preferred (`bun` in mauve, for one). One colour per icon,
    or different colours per mode, is [Plan 180](180-file-icon-variants.md)'s research. Until it
    lands, the tree's hues become the tokens.
- **Q2. Behaviour quirks.** Fix obvious bugs; keep product behaviour. From the parity spec's list:
  - **Fix:** F2 ignoring `mutationsEnabled` (1), the composer payload mismatch (8), the editor's
    refused drop (9). Title recovery on truncated rows is added (a `title` changes nothing on screen).
  - **Keep:** rename selecting (and opening) the file (2), punctuation not filtering (3), plain arrows
    not opening files (4), double-click on a folder (5), no drop-target highlight (6), ignored files
    lighting the change dot (7), the collapsed tree on an empty filter (10), the menu targeting one
    row despite a multi-selection. Any of these can be reopened with the owner; none changes by
    default.
- **Q3. Focus model.** `aria-activedescendant` with one tab stop, the `useListbox` model. The cursor
  row stays mounted through `keepMounted`.
- **Q4. Drag.** Both, no loss: dnd-kit inside the window, native once the drag leaves it. The drag
  starts as a native drag and a custom dnd-kit sensor reads its events, because a browser cannot
  turn a pointer drag into a native one partway through (see
  [drag-and-drop](178-tree-in-the-app/drag-and-drop.md)). dnd-kit v6; one app-wide drag context
  for every dnd-kit surface (widened the same day to include the session rail and terminal list); no new drop behaviours beyond the Q2 fixes; no keyboard drag;
  the preview stays the row clone.
- **Q5. Rollout.** None. Each sub-plan moves the tree and all its named adopters; it is done when
  they are.

## Scenarios that guard the tree

`files-tree`, `workbench-list-focus`, `tree-file-clicks`, `tree-sticky-scroll`, `editor-product`,
`file-tree-undo`, `file-tree-hover-prefetch`, `workspace-open-large-root`,
`workspace-open-unreadable-child`, `workspace-switch-click-during-open`, `copy-feedback`,
`search-file-actions`, `editor-external-edit`, `file-picker-navigation`, `chat-composer-insert`.
Feature map: `.agents/skills/verify-fregat/features/file-tree.md`.

## What this plan does not do

- No change to the controller's tree semantics or the path store.
- No new tree features beyond the Q2 fixes.
- No change to the TUI tree.
