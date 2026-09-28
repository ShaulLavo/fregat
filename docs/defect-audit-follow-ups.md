# Remaining questions from the September 12 defect audit

The root scratch audit and its test baseline are retired. They describe old source paths and
failures that cannot be used as today's baseline. The
[original audit](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/AUDIT-FINDINGS-PLAN.md)
and [baseline](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/BASELINE.md) remain in git history.

Units 1, 2, 3 and 8 were recorded as delivered. Unit 4's cross-client generation and index
ownership moved to the delivered [workspace index scopes](workspace-indexing.md). The three
remaining questions below are retained for investigation, not asserted as current defects or
newly authorized implementation.

| Original unit                 | Current evidence and next check                                                                                                                                                                                                    | Constraints to retain                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5: provider command queue     | `orchestration/provider-command-reactor.ts` still constructs one `SerialWorker`. Measure cross-session blocking and check downstream scheduling before proposing a change.                                                         | Preserve same-session order, checkout/checkpoint exclusion and rewind isolation. Decide interrupt bypass semantics explicitly. Coordinate with Plan 126's lifecycle work. |
| 6: TUI draft attachment bytes | `agent-stage/state/drafts.ts` stores drafts and pending commands as JSON using the upload schema, which permits image `dataUrl`. Measure actual persisted bytes and trace staging before deciding whether bytes still need moving. | Decide restart durability and pending-command rehydration together. Do not delete user drafts or add a second attachment store. The TUI owns its UX.                      |
| 7: session snapshot bounds    | `orchestration/tests/read-model-bounds.test.ts` and the current snapshot/read-model code supersede the audit's old paths. Reconcile messages, activities, turns, plans and checkpoint navigation against those tests.              | Preserve history paging, current selection and pending-question visibility. Missing history must remain distinguishable from empty history.                               |

The audit also reported a TUI job-control test matching multiword labels against raw PTY writes.
If it still fails, inspect the current test/parser and reproduce first; the old failure is not a
current-suite waiver. Historical absolute test totals and the old “main is red” claim are removed.

Promote a confirmed remaining defect into its owning numbered plan before implementation. The
cleanup did not run these investigations or establish a new test baseline.
