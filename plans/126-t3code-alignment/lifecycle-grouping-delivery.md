# Lifecycle and grouping delivery — 2026-09-20

Delivered server release `20260920T135727Z-b915d3e0-plan126-lifecycle-search`, followed by web navigation correction `20260920T135934Z-b915d3e0-plan126-row-navigation`.

## Implemented

- LIFE-03/04: separate Pinned, Active, Snoozed, Settled shelves; independent runtime/attention indicator; owner-capability-gated pin, settle/resume and snooze/unsnooze actions. Archived rows hide lifecycle actions. Missing capabilities disable unsupported functionality.
- Snooze supports calendar presets, custom date/time and duration, actual running turns after provider adoption, and precise timer-only shelf changes. Queued/claimed starts, mismatched adoption and pending requests remain blocked. Settlement allows optional message questions and the server dismisses them.
- Bulk actions retain failed/skipped selection. Snooze reports success/skipped/failed counts; Undo targets only successful refs. Actions fit the 300px rail through a shared dropdown. Pending state comes from mutation state.
- LIFE-09: grouping settings default to repository; physical overrides and separate mode preserve scoped members. Preferred owner is primary, then deterministic scoped-key order. Machine/text filters constrain action members; archive enumerates displayed active session refs. Delete previews enumerate owner/path/count, preserve disconnected members as unavailable and retain uncompleted owners after partial failure. Physical actions label their owner.
- Shared settings reader and mirror moved to app-level hooks/lib; settings reference/schema regenerated. Scoped collapse keys and active-project selection no longer collide across owners.

## Evidence

- 35 focused grouping/settings/collapse/menu tests passed, including two real Elysia owners with matching repository IDs, group-wide and filtered archive/deletion, and unavailable-owner preview.
- 36 lifecycle/menu/rail tests passed, including actual commands through the real server, invalid custom values, bulk skipped retention and Undo, native versus retained message questions, and adopted-running snooze eligibility.
- Streaming regression passed with and without the selected bulk toolbar: 20 detail deltas caused zero rail/palette renders after warmup. Primitive derived selectors prevent timeline subscriptions from repainting menus/toolbars.
- Web typecheck and targeted lint passed. Root ran server lifecycle/release tests and design census.
- Live `session-lifecycle` passed in `/work/tmp/fregat-evidence/20260920T140116Z-scenario-session-lifecycle/` (12.3s): pin, settle clearing pin, active return, invalid duration, six-second timer wake without an event, bulk snooze and Undo, and snooze while the real provider runtime was confirmed running. Custom-dialog and 300px bulk-toolbar screenshots were read. No warn/error application logs in the evidence window; browser reported existing GPU/adapter warnings.
- First live attempt exposed dnd-kit drag-disabled attributes disabling normal row navigation. Root fixed the attribute ownership, added an accessible-row regression, deployed the web correction, and the same scenario then passed.

## Remaining acceptance

- LIFE-05 ordering and cross-shelf drag remain a separate ongoing unit; this document does not claim their completion.
- `repository_path` equals repository mode for currently registered Git projects: registration canonicalizes subdirectories to the checkout root. Genuine subproject acceptance needs a project-root/workspace membership entity and scoped commands; a display-only path would leave destructive actions cascading the whole repository.
- The `project-grouping` browser scenario requires two already-connected owners sharing a repository. No second live owner was available; two-owner behavior is proved by real in-process server tests, not live browser evidence.
- Bulk partial results are covered by real-server DOM tests; the live browser run proves successful bulk snooze/Undo. Multi-owner partial transport failure still needs the broader delivery matrix.
- No paired execution of upstream runtime, native macOS parity, or universal provider parity is claimed. Ledger findings remain in progress.
