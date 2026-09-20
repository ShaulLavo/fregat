# LIFE-10 navigation delivery

Web archive and delete now have separate follow-up policies. Archiving the current session opens a draft in its owning project. A background archive leaves the current route alone. Delete chooses the first surviving project session using the configured sort, excluding confirmed successful deletions from the same batch by scoped key.

`chat.sessionSortOrder` defaults to `updated_at`, matching the pin. It controls web and TUI palette order and web deletion fallback; modern shelf ordering remains independent. `chat.confirmSessionDelete` defaults to true and controls the web confirmation dialog. Both are registered, consumed and documented in the generated settings reference.

Deletion failures retain their scoped selections while later entries continue. Mutation success is recorded before navigation; a missing destination produces a distinct navigation failure message and does not turn a successful deletion into a failed selection. Batch summaries include navigation failures. The navigation coordinator rechecks the current route, preserving a route change during a pending archive.

## Pinned source and verification

Reference: `7445aa733ada33e45289e5aa5055f79142556513`.

- `useThreadActions.ts:269–295` defines archive-to-owner-project draft; `Sidebar.logic.ts:1119–1142` defines configured-sort deletion fallback. `threadSort.ts` defines latest-user/activity fallback and descending-ID timestamp ties. `Sidebar.logic.ts:405–428` and `Sidebar.tsx:4005–4029` distinguish successful deletions and retained selections.
- Web focused batch: 17 tests passed across `use-session-removal`, `session-order`, `session-menu`, and `session-rail-streaming`. These use real in-process servers, including two owners with the same session ID. Transport interruption rejects one middle deletion; later deletion still succeeds. A real concurrent deletion removes the navigation destination and verifies the follow-up failure message without losing mutation success.
- The route-change test deliberately holds an actual archive request, navigates elsewhere, releases the request, and verifies that the newer route survives. This is additional local safety, not an upstream equivalence claim.
- TUI palette tests: 3 passed. Web and TUI typechecks passed; changed-file lint and scripts typecheck passed.
- `scripts/parity/ordering.ts` now includes 64 configured navigation-sort permutations against the actual pinned module, bringing the bounded pure-policy comparison to 1,621 cases. The CI job runs this and the 10,095-case snooze comparison after checking out the same pin.

## Delivery limits

Live `session-navigation` passed on release `20260920T142351Z-b915d3e0-plan126-ordering-questions`. Evidence: `/work/tmp/fregat-evidence/20260920T142811Z-scenario-session-navigation/`. All three screenshots were inspected: current archive opens New session, background archive keeps the selected conversation, and deletion opens the surviving fixture. All three disposable sessions were removed in the completed cleanup. No application warn/error logs occurred; headless graphics warnings remained. Two earlier attempts were corrected instrumentation assertions around async URL publication and canonicalization; both cleaned their fixtures. Two-owner live evidence still requires another connected mesh owner; the two-server tests do not replace that proof.

The native source followup shipped in `20260920T143358Z-b915d3e0-plan126-reply-ordering`. The native controller now opens an owning-worktree draft after current archive, preserves background selection, applies the configured deletion sort, consumes the confirmation setting, continues after per-row failures and retains their marked rows. Twenty focused real-server/OpenTUI rail tests pass, including a failed middle delete and active reorder materialization without pinning. The latter fixes the native command's mismatch with newly enabled active reorder capability; it uses the shared allocator and reserves retained hidden keys. TUI typecheck and changed-file lint pass. This is renderer/in-process evidence, not a claim of a live interactive terminal run. Reconciliation of a failed delete whose row was independently removed, interruption semantics, and the full upstream navigation matrix remain outside the evidence above. LIFE-10 must not be marked fully verified from this delivery alone.
