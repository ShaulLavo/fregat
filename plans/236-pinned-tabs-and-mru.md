# Plan 236: Add pinned tabs, MRU switching and close variants

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-17, size L. Depends on Plan 206, Plan 220, Plan 234.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.

## Outcome

Pin or reorder tabs, switch by recent use and close clean, neighboring or inactive tabs with dirty-file handling.

## Zed actions and behavior

### Activation and history

`pane::ActivateItem`, `pane::ActivateLastItem`, `pane::AlternateFile`, `pane::GoToOlderTag`.

ActivateItem uses a zero-based tab index, ActivateLastItem selects the final tab, AlternateFile returns to the previous active file, and GoToOlderTag navigates symbol-jump tag history. [crates/workspace/src/pane.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/pane.rs#L108), [crates/workspace/src/pane.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/pane.rs#L632), [crates/workspace/src/pane.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/pane.rs#L954).

### Order and pinning

`pane::SwapItemLeft`, `pane::SwapItemRight`, `pane::TogglePinTab`.

Zed swaps adjacent tabs and keeps pinned items in the pinned section with explicit close policy. [crates/workspace/src/pane.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/pane.rs). Preserve pin payloads.

### Closing

`pane::CloseAllItems`, `pane::CloseCleanItems`, `pane::CloseItemsToTheLeft`, `pane::CloseItemsToTheRight`, `pane::CloseOtherItems`, `workspace::CloseAllItemsAndPanes`, `workspace::CloseInactiveTabsAndPanes`.

Zed computes targets by pane/workspace scope, preserves pinned tabs unless `close_pinned` is true, and applies dirty-save intent during closure. [crates/workspace/src/pane.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/pane.rs#L121), [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs#L577).

### MRU picker

`tab_switcher::CloseSelectedItem`, `tab_switcher::OpenInActivePane`, `tab_switcher::Toggle`.

Zed orders by activation history and cycles while modifiers are held, preserving `select_last`. OpenInActivePane deduplicates file items across panes, reuses a resident item, clones splittable files or moves other items. [crates/tab_switcher/src/tab_switcher.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/tab_switcher/src/tab_switcher.rs#L39), [crates/tab_switcher/src/tab_switcher.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/tab_switcher/src/tab_switcher.rs#L529), [crates/tab_switcher/src/tab_switcher.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/tab_switcher/src/tab_switcher.rs#L676).

## Existing implementation

[apps/web/src/lib/documents/utils/groups.ts](../apps/web/src/lib/documents/utils/groups.ts) owns stable tab placement and selection.
[apps/web/src/features/workspace/utils/tab-close-targets.ts](../apps/web/src/features/workspace/utils/tab-close-targets.ts) computes close/others/saved/right
sets; [apps/web/src/features/workbench/utils/editor-tab-close-targets.ts](../apps/web/src/features/workbench/utils/editor-tab-close-targets.ts) supplies dirty status.
[apps/web/src/features/workspace/hooks/use-unsaved-work-guard.ts](../apps/web/src/features/workspace/hooks/use-unsaved-work-guard.ts) handles dirty decisions.
[packages/client-core/src/commands/workspace.ts](../packages/client-core/src/commands/workspace.ts) already exposes tab selection and a tab picker.
`EditorTabRecord` in [apps/web/src/lib/documents/utils/types.ts](../apps/web/src/lib/documents/utils/types.ts) currently has no pin state.

## Design

Extend the group/tab owner with pin state and activation history by stable tab ID. Keep MRU,
previous-file and tagged navigation histories separate; record tagged source jumps at the
navigation coordinator and retain their ranges. Add typed `tab.activateIndex`,
`tab.activateLast`, `tab.swap`, `tab.togglePin`, `tab.closeGroup`, `workspace.closeItems`, and
`tabSwitcher.toggle/openInActivePane/closeSelected` commands. Publish Pane and TabSwitcher contexts;
the picker owns held-modifier completion and restores the starting tab on cancellation.
Compute all close targets with one pin/dirty policy, including Plan 234's untitled buffers and
shared documents appearing in multiple views. Preserve `close_pinned`, `save_intent`, `select_last`
and pin payloads from presets. A canceled dirty decision retains that document's tabs. Route
cross-pane copy/move through existing placement capabilities and Plan 209's lifetime owner.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Steps

- [ ] Add failing ten-tab index/last, pin-aware close and MRU modifier-release fixtures.
- [ ] Extend the group model with pinning/order/MRU and tagged navigation entries; use existing placement and dirty guard.
- [ ] Implement all close scopes and the TabSwitcher picker, including active-pane deduplication and capability-based copy/move.
- [ ] Register the seventeen actions and preset payloads; add `zed-pinned-tabs-and-mru`.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Focused group/close-target tests cover pinned boundaries, both `close_pinned` values, dirty
save/cancel, shared buffers, untitled tabs, and index 8 versus last with ten tabs.
`zed-pinned-tabs-and-mru` pins/reorders tabs, cycles/accepts/cancels MRU, closes from the picker,
opens in the active pane and exercises pane/workspace bulk closes. A tagged symbol jump returns
to its source location independently of MRU selection.

Run heavy checks through `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run install-release`, adding `--server --restart` when server code changes.

## Out of scope

Pane geometry, Plan 237; Vim registers/marks/macros; TUI parity.
