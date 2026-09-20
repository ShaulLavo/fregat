# LIFE-05 delivery

Source: pinned t3code `7445aa733ada33e45289e5aa5055f79142556513`.

The rail now uses shelf-specific ordering and the source-shaped allocation/drop planner. Row dragging works in the displayed logical project group, including its scoped owners. Structural pinned, active and settled targets remain available when empty. Snoozed is a source only. Project dragging remains a separate action and cannot reorder a merged project as though it had one owner.

The web command projects lifecycle changes and all assigned keys together. Commands execute sequentially against each scoped owner and stop on rejection. Canonical acknowledgement requires destination, lifecycle values and every assignment. Removal, archive, changed worktree, unrelated key or third-shelf movement cancels the preview. Superseded failures only retire their own intent. Partial failures expose successful canonical writes.

Pointer collision and keyboard coordinates share project/session target separation. A keyboard drag leaves list navigation inactive until it ends; ordinary rows remain navigable regardless of drag capability. The drag preview names the transition. Hidden rows reserve their retained keys but do not receive materialization writes. An unsupported owner in required assignments rejects the plan.

## Checks before deployment

- Web typecheck and focused lint pass.
- Eleven focused DOM tests pass, plus the dedicated pointer/overlay collision regression: keyboard reorder, empty pinned keyboard target, structural pin/settle/active/wake transitions, archived refusal, scoped keyless materialization, project order, accessible rows, two real owners with a delayed remote archive causing a later command rejection, lifecycle-before-key acknowledgement, stale intent failure, and zero rail/palette renders during twenty detail deltas with and without selected bulk actions.
- The partial rejection test delays subscription delivery at the transport boundary; both orchestration engines and commands are real. The successful first owner's key remains while the rejected remote owner keeps its prior key.
- Pure-policy parity and server lifecycle/order evidence are recorded by their owners. This report does not replace them.

## Browser proof

`session-ordering` is registered and exercises pointer promotion to empty pinned and settled shelves, active placement/key persistence after reload, and keyboard promotion into an empty pinned shelf. Initial live pointer proof exposed a real geometry bug: the smaller drag preview could select the adjacent shelf through center-distance collision. Pointer collision now uses the pointer hit; keyboard collision retains the center-distance policy. Project bands only transform during project drags. A focused regression proves pointer-over-pinned while the overlay center is over active. The clean rerun passed in 4.1 seconds on release `20260920T143358Z-b915d3e0-plan126-reply-ordering`: `/work/tmp/fregat-evidence/20260920T144130Z-scenario-session-ordering/`. Pointer transitions, canonical active key after reload, and keyboard promotion passed; settled and final pinned screenshots were read. No warn/error application logs; existing GPU adapter warnings only. Disposable sessions were deleted in `finally`.

Live multi-owner drag proof remains unavailable because only one live owner is connected. The real two-owner in-process regression covers dispatch ownership and partial failure. Cross-project relocation is not implemented: changing shelves preserves the session's logical project band and physical owner.
