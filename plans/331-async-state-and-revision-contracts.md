# Plan 331: Async state, revisions and recovery

Status: Approved, 2026-10-03. Execution deferred; research and planning only now.
Owner: shared runtime recovery contracts, document contributions and terminal execution owners. Parent: [328](328-async-runtime-master.md).
Dependencies: [329](329-async-lifecycle-and-transport.md), [330](330-async-scheduling-and-admission.md), existing [099](099-document-contributions.md), [document analysis](../docs/document-backed-content-views.md) and [287](287-ghostty-worker-mode.md) authority contracts.

## Outcome

Specify and verify how typed commands refer to exact state, how receivers acknowledge applied progress, and how replaceable mirrors recover. Preserve the authority each domain already selected. Factor shared recovery code only after two real consumers demonstrate the same invariant.

## Evidence and current authority

[Coaction research](../docs/async-runtime/coaction.md) pins the epoch/sequence/full-sync protocol, stale-connection guards and action settlement after mirror catch-up. Its JSON-only shared contract excludes our buffers/canvases/ports. Patch sequence order does not serialize awaited methods, and destroying a client does not stop an action already executing.

Editor documents keep the main-thread buffer as sole text authority. Document publication, journal, contribution source delivery and freshness belong to 099; retained analysis/leases belong to 198 and content subjects to 200. Units 2–7 of 099 remain explicitly gated. Do not create a second journal, source synchronization runtime, document analysis handle or worker-owned text authority in this package.

Plan 287 chooses worker authority for native terminal state. Its host reads one copied submitted-frame summary for synchronous geometry/IME/hit-testing. The terminal domain defines native/layout/frame identity and processed port sequences. Native authoritative reads remain async.

The completed [SAB text deletion](../editor/docs/performance/sab-transport-2026-09-12.md) remains accepted. Keep strings/chunks and incremental changes, packed result transfers and the separate atomic cancellation flag. New shared-memory representations need a separately identified consumer, correctness proof and measured benefit; they are outside the initial package.

## Chosen contract

Distinguish these identities and barriers:

| Identity/barrier                      | What it proves                                       | Owning layer                              |
| ------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| Owner/worker generation               | Which execution lifetime handled traffic             | Shared lifecycle                          |
| Operation ID                          | Which command/result/effect receipt is correlated    | Shared channel plus domain effect receipt |
| Domain incarnation and revision       | Which document/terminal/configuration state was used | Domain                                    |
| Stream sequence and processed fence   | Which lossless ordered data reached execution        | Stream plus domain actor                  |
| Projection epoch/base/target sequence | Which copied mirror update is applicable             | Optional recovery helper                  |
| Domain applied acknowledgment         | Source/configuration actually installed              | Domain contribution/actor                 |
| Submitted frame                       | A coherent frame was submitted                       | Renderer/terminal domain                  |
| Presented frame                       | Compositor presentation of that exact frame          | Qualified measurement instrument          |

An enqueued message is never an applied acknowledgment. A mirror caught up to projection sequence N is not proof that a document revision or GPU frame is complete unless its payload includes the domain's trustworthy receipt. No universal `flush()` hides several different barriers.

Optional projection recovery uses one authority per projection, immutable atomic full snapshots, current generation/epoch, validated base/target sequence, duplicate suppression and coalesced full-sync recovery. Invalid/late snapshots leave prior valid state intact. A newer generation cannot publish through an old subscription.

Full-state snapshots are replaceable. Patch chains require exact bases; collapse them only through valid composition or replace with a full snapshot. Lossless events/bytes/edits use bounded delivery and credits, never latest-only dropping. Full-sync retries have a finite give-up and resource budget.

The same-thread adapter uses the same logical command barriers without serializing live domain objects. Cross-thread payloads use operation-specific encodings and structured clone/transfers. Store-like JSON is useful for small metadata; it is not the universal bulk protocol.

A failed/cancelled/timed-out action may have already committed. If dispatch occurred and no trustworthy effect receipt exists, the outcome remains unknown. A reconnect restores observation, not the previous authority's lost native/parser/GPU state. The domain reconstructs state according to its restart policy; mutating replay requires idempotency/receipts.

Publish diagnostics or metadata into the caller's existing vanilla Zustand store. React uses useStore/selectors; TanStack owns reads/mutations and cache settlement. Coaction, observer tracking and SharedWorker topology remain optional integration candidates, never requirements of scheduler/lifecycle modules.

## Package factoring decision

Initial implementation keeps document source delivery and terminal frame summaries domain-owned. Add a tiny optional projection helper only if both demonstrably share epoch/base/target validation and atomic replacement. The helper owns recovery correctness, not domain snapshots, cache schemas or mutation policy.

Full Coaction adoption is a separate bounded comparison for a small JSON metadata authority if a real consumer benefits. It must qualify released artifact behavior, async action ordering, slow subscribers, error/unknown outcomes and our React Compiler/Zustand integration. No full-store dependency or reactive migration follows from studying its protocol.

## Execution checklist

- [ ] Write the domain-specific identity/barrier table from actual source and approved terminal contract; distinguish observation, application, submission and presentation in all command signatures.
- [ ] Implement local/real-worker fixtures for generation replacement, duplicate/gapped updates, old snapshots and failed validation, using exact expected snapshots rather than log absence.
- [ ] Verify one captured document revision remains synchronously published and independently acknowledged by two adapters. Work extending 099's common contribution synchronization waits for its owner gate and qualified 282 evidence.
- [ ] Verify terminal two-port output/control fences and one coherent submitted summary under reorder, resize, theme/font changes, restart and suspended page rAF.
- [ ] Prove unknown outcomes around dispatch/commit/reply/apply boundaries and forbid unsafe automatic mutation replay.
- [ ] Compare two actual recovery consumers; factor only the common epoch/sequence/atomic install code and delete their duplicated implementation in that unit.
- [ ] If optional Coaction/SharedWorker integration has a qualified consumer, run only its targeted correctness and footprint comparison from 334; otherwise keep it out of shipped dependencies.
- [ ] Verify immutable store publication/subscription cleanup with our compiler and retained views, then record only the claimed settled/applied barriers in telemetry.

## Acceptance and risks

Done means exact provenance survives transport and restart; stale/invalid updates never publish; acknowledged source/frame semantics remain honest; updates stay bounded under a stalled consumer; cancellation/recovery never imply rollback; and factoring removes duplication without relocating authority.

Unresolved implementation details are parameterized boundaries, not another research program: each domain chooses its payload/receipt, the package validates only its envelope, and release metadata compares published dependencies against inspected source. If common recovery is shallow or forces domain fields into generic types, keep it in adapters and mark the factoring unit complete with that decision.
