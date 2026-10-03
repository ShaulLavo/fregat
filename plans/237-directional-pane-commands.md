# Plan 237: Complete directional pane focus, split and swap commands

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-18, size L. Depends on Plan 206 and Plan 234, plus the relevant Plan 209
  pane/focus/content-capability design contracts. Mixed-content units also need their authorized,
  delivered hosts; unrelated 209 shell work is not a blanket prerequisite.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.
- Plan 234 is an added dependency for untitled creation in NewFileSplitHorizontal.

## Outcome

Split in any direction, focus arbitrary neighboring panes, swap or move them and maximize the active pane.

## Zed actions and behavior

### Splitting

`pane::SplitDown`, `pane::SplitHorizontal`, `pane::SplitLeft`, `pane::SplitRight`, `pane::SplitUp`, `pane::SplitVertical`, `workspace::NewFileSplitHorizontal`.

Zed splits relative to the active pane and clones splittable content; horizontal is left/right and vertical is up/down. NewFileSplitHorizontal creates a fresh untitled editor in a horizontal split. [crates/workspace/src/pane.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/pane.rs), [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs). Preserve the split `mode` payload and configured horizontal/vertical direction.

### Focus

`workspace::ActivateNextPane`, `workspace::ActivatePane`, `workspace::ActivatePaneDown`, `workspace::ActivatePaneLeft`, `workspace::ActivatePaneRight`, `workspace::ActivatePaneUp`, `workspace::ActivatePreviousPane`.

Zed supports zero-based pane activation, pane-order cycling and geometric neighbor selection. Directional focus can target an adjacent dock or workspace sidebar. [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs#L5800), [crates/workspace/src/pane_group.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/pane_group.rs). Preserve focus fallback payloads.

### Arrangement

`workspace::MovePaneDown`, `workspace::MovePaneLeft`, `workspace::MovePaneRight`, `workspace::MovePaneUp`, `workspace::SwapPaneAdjacent`, `workspace::SwapPaneDown`, `workspace::SwapPaneLeft`, `workspace::SwapPaneRight`, `workspace::SwapPaneUp`, `workspace::ToggleZoom`.

MovePane places the active pane at the outer edge. SwapPane exchanges pane positions with a neighbor; adjacent chooses the first available neighbor in down/up/right/left order. Zoom toggles the active pane's expanded view while retaining its layout. [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs#L5924), [crates/workspace/src/pane_group.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/pane_group.rs).

## Existing implementation

[apps/web/src/lib/documents/utils/groups.ts](../apps/web/src/lib/documents/utils/groups.ts) has nested splits, stable groups, edge
placement, copy/move and normalization. [apps/web/src/lib/documents/utils/group-types.ts](../apps/web/src/lib/documents/utils/group-types.ts)
types the tree and placements. [apps/web/src/features/workbench/hooks/use-group-split-availability.ts](../apps/web/src/features/workbench/hooks/use-group-split-availability.ts)
checks current content capabilities; [packages/client-core/src/commands/workspace.ts](../packages/client-core/src/commands/workspace.ts) already
has right/down splits. Plan 209 defines chat/terminal pane ownership and requires design review.
Its design direction does not establish shipped mixed-content panes.

## Design

Extend the existing group tree and Plan 209's content model. Implement geometric focus against
rendered group bounds, deterministic ties and leaf-order next/previous/index activation. Swap
whole leaves with IDs and content intact; edge moves restructure the tree and normalize shares.
Zoom records the active group and restores the exact split tree/sizes without remounting content.
Use the existing retained-host lifecycle for terminals and chat. Copy only content that advertises
clone capability; move retained single-instance content by host placement. Register typed
`pane.split`, `workspace.activatePane`, `workspace.movePaneToEdge`, `workspace.swapPane`, and
`workspace.toggleZoom` commands in Workspace/Pane contexts. Include adjacent dock/sidebar targets
through the layout focus owner. Plan 234 supplies untitled creation for NewFileSplitHorizontal.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Scoped workspace dependency

Review focus destinations, clone/move capability, retained host placement and maximize/restore
with 209 before affected units. File-only operations extend the current group owner after
that contract review. Chat/terminal acceptance requires the relevant mixed-content owners to
be authorized and delivered; resolving a design question grants no 209 production permission.
Keep unavailable targets disabled and full mixed-content acceptance open. Preserve 209's D1–D6
review and separate implementation decision without waiting for unrelated column/locale work.

## Steps

- [ ] Resolve the relevant 209 pane/focus/content-capability contracts and record required host
      receipts; add failing nested-group direction/swap/edge-move fixtures against the current owner.
- [ ] Extend pure group operations and geometry selection; preserve IDs, tab state, sizes and focus.
- [ ] Wire split and zoom with retained terminal/chat hosts and Plan 234 untitled creation.
- [ ] Register all twenty-four actions and exact direction/focus payloads; add `zed-directional-panes`.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Run focused group model and geometry tests with asymmetric nested splits, boundary targets,
zero-based activation and swaps versus edge moves. `zed-directional-panes` splits in four
directions, cycles/focuses indexed and geometric targets, swaps, moves to an edge and zooms back.
Terminal fixture process identity and chat state survive layout changes; NewFileSplitHorizontal
creates an unsaved buffer. Focus reaches an adjacent available dock/sidebar through its owner.

Run heavy checks through the current heavy wrapper in [AGENTS.md](../AGENTS.md#dev-gates-verification).
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run deploy`, adding `--server --restart` when server code changes.

## Out of scope

Plan 209 product design choices; dock resizing, Plan 238; Vim pane-resize key semantics; TUI parity.
