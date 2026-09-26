# Plan 178: The file tree in the app

## Status and authorization

- Status: PROPOSED, a plan of plans. Research done 2026-09-26; the owner answers Q1–Q5 before the
  first sub-plan past the harness. Nothing here authorizes implementation.
- Planned at: Platform `bfc48ef17`, 2026-09-26. Rewritten the same day from a single four-phase
  plan after the owner widened it (below).
- Effort: eleven sub-plans, S to L. Each ships and deploys on its own and leaves the tree working.
- Companion: [Plan 179](179-isolating-foreign-content.md) looks at where a shadow root does help.

## Outcome

The file tree looks and behaves as it does today, and every part of it is app machinery: it renders
in the app's React root, is styled in Tailwind with theme tokens, rows are `ListRow`, windowing is
`VirtualList`, keys go through `useListbox` and the keymap, the menu is `MenuSurface`, drag is
dnd-kit, icons are the app's. Where the app lacks something the tree does, the app gains it as a
shared primitive, and at least one other surface adopts it to prove it is general. `packages/tree`
keeps only the DOM-free model the TUI also uses.

## Owner direction

- 2026-09-26: the shadow root has no reason to exist for us. The tree is a core part of the app,
  and sharing styles and state with it takes constant work.
- 2026-09-26, widening the plan: **parity** — the tree's look and feel is "basically perfect" and
  must stay. **Reuse** — rebuild it from everything the app already has: dnd-kit like everywhere
  else, the same icons, the same styles, Tailwind, the app's virtualization. The work is large and
  splits into several plans.

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
   Drift fails the sub-plan unless the owner accepted it in Q1 or Q2.
2. **Reuse before build.** Each tree capability maps to an app primitive. When the primitive falls
   short, extend it in `packages/ui` or `lib/`; do not keep a tree-private copy.
3. **Prove the primitive general.** Each extension lands with the tree and at least one other
   adopter named in its sub-plan.
4. **The model stays DOM-free.** `FileTreeController` and the path store keep working for the TUI
   through `@workspace/tree/model`.
5. **Measure.** Scroll, render and drag claims cite `trace` and `renders` against the harness
   baseline.

## Sub-plans

| Sub-plan                                                                | Outcome                                                                              | Size | Depends on           | Other adopters                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---- | -------------------- | ----------------------------------------------------------------------------- |
| [parity-spec](178-tree-in-the-app/parity-spec.md)                       | The look and behaviour contract, with the quirks and rule conflicts to decide        | —    | —                    | —                                                                             |
| [parity-harness](178-tree-in-the-app/parity-harness.md)                 | Matrix capture, pixel and style diff, a test for every uncovered behaviour           | M    | —                    | any rebuilt surface                                                           |
| [out-of-the-root](178-tree-in-the-app/out-of-the-root.md)               | Custom element, shadow root and second React root gone; nothing changes on screen    | M    | harness              | —                                                                             |
| [app-owned-state](178-tree-in-the-app/app-owned-state.md)               | View moves into `features/workspace`; props and state replace the imperative facade  | L    | out-of-the-root      | —                                                                             |
| [rows](178-tree-in-the-app/rows.md)                                     | Rows on `ListRow` + a shared `TreeRowLead`, Tailwind and tokens                      | L    | app-owned-state      | git group headers, chat turn files, folder picker, search groups, diagnostics |
| [icons](178-tree-in-the-app/icons.md)                                   | One icon path and sprite for every file row; icon hues as tokens                     | S–M  | app-owned-state      | every `FileTypeIcon` user                                                     |
| [chrome](178-tree-in-the-app/chrome.md)                                 | `FilterField`, `InlineRenameInput`, shared scrollbar, real-row skeleton              | M    | app-owned-state      | five filter fields, session and terminal rename                               |
| [context-menu](178-tree-in-the-app/context-menu.md)                     | `useListContextMenu` over `MenuSurface`                                              | S–M  | app-owned-state      | git changes, session rail, search results                                     |
| [virtualization](178-tree-in-the-app/virtualization.md)                 | `VirtualList` gains count mode, kept rows, sticky chains, scroll padding, settlement | L    | app-owned-state      | search, git changes, diagnostics headers; logs, chat                          |
| [keyboard-and-selection](178-tree-in-the-app/keyboard-and-selection.md) | Shared selection model, multi-select `useListbox`, tree commands in the keymap       | L    | virtualization       | session rail                                                                  |
| [drag-and-drop](178-tree-in-the-app/drag-and-drop.md)                   | Tree on dnd-kit through a workspace drag layer; typed drops on composer and editor   | L    | virtualization, rows | editor tabs, session rail sensors, composer                                   |
| [cleanup](178-tree-in-the-app/cleanup.md)                               | Stylesheet, bridges and exemptions gone; package is model-only                       | S    | all                  | —                                                                             |

Order: harness → out-of-the-root → app-owned-state; then rows, icons, chrome and context-menu in
parallel with virtualization; keyboard-and-selection and drag-and-drop after virtualization;
cleanup last. Rows, icons and chrome touch the same row component, so they land one after the
other in that lane.

## Decisions

The owner answers these before the sub-plans they gate. Each has a recommendation.

- **Q1. Look versus rules** (gates rows, icons, chrome). The parity spec lists thirteen places where
  today's look breaks an AGENTS.md rule. Recommended split:
  - **Keep the look, express it as tokens or allowed exceptions:** compact 12.5px and cozy mono
    (tree font tokens), 1px indent guides (a `w-px` element, allowed as structure, not a divider),
    the 0.8-scale geometry and 16px icons (tree tokens, or existing density tokens if the owner
    accepts sub-2px shifts), no pressed tint.
  - **Align, where the change is barely visible and the rule is why the app looks coherent:** raw
    hex to tokens at the same values, the rounded focus ring on a square row, the focus ring after a
    mouse click (to `:focus-visible`), the filter input's border and extra 4px, the hand-written
    guide transition and shimmer (to motion tokens and `Shimmer`), the drag preview shadow (to
    `shadow-md`), alpha on ignored icons and the change dot.
  - **Owner's call:** middle truncation that keeps the extension versus end truncation with the
    full path in `title`; `bun`'s icon colour (mauve in the tree, pink elsewhere).
- **Q2. Behaviour quirks** (gates keyboard, drag, menu, chrome). The parity spec lists ten.
  Recommended: fix the bugs — F2 ignoring `mutationsEnabled`, the composer payload mismatch, the
  editor's refused drop; decide the product ones — plain arrows not opening files, rename opening
  the file, double-click on a folder, punctuation not filtering, no drop-target highlight
  (recommend adding one), ignored files lighting the change dot, the empty-filter result (recommend
  an `EmptyState`), the menu ignoring a multi-selection.
- **Q3. Focus model** (gates keyboard). (a) `aria-activedescendant` with one tab stop, the
  `useListbox` model; the cursor row stays mounted through `keepMounted`. (b) Keep a roving tab
  stop. Recommended: (a). It looks and feels the same and removes the parked-row machinery.
- **Q4. Drag** (gates drag-and-drop).
  - Drag from the tree to the OS or another window stops working on dnd-kit. Accept, or keep a
    native fallback behind a modifier? Recommended: accept.
  - Stay on dnd-kit v6 rather than the 0.x `@dnd-kit/react`? Recommended: v6.
  - One workspace drag context for the tree, editor and composer, with the rail and terminal list
    local? Recommended: yes.
  - New drops: tree → editor group opens the file there; multi-path mentions in the composer; tree →
    terminal inserts paths. Recommended: the first two.
  - Keyboard drag, and on which key, or a "Move to…" command instead. Recommended: the command.
  - Preview: today's row clone, or a shared chip with a count badge. Recommended: the row clone, for
    parity.
- **Q5. Adoption scope.** Each sub-plan migrates the tree plus the adopters named in its table row,
  or the tree plus one adopter with the rest as follow-ups. Recommended: tree plus one; the rest
  listed as follow-ups in PLAN.md.

## Scenarios that guard the tree

`files-tree`, `workbench-list-focus`, `tree-file-clicks`, `tree-sticky-scroll`, `editor-product`,
`file-tree-undo`, `file-tree-hover-prefetch`, `workspace-open-large-root`,
`workspace-open-unreadable-child`, `workspace-switch-click-during-open`, `copy-feedback`,
`search-file-actions`, `editor-external-edit`, `file-picker-navigation`, `chat-composer-insert`.
Feature map: `.agents/skills/verify-fregat/features/file-tree.md`.

## What this plan does not do

- No change to the controller's tree semantics or the path store.
- No new tree features beyond the Q2 fixes and the drops chosen in Q4.
- No change to the TUI tree.
