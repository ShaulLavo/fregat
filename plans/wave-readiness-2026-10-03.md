# Wave readiness review, October 3, 2026

Status: Approved. The owner requested cleanup and reconsideration of large additions before
starting the next implementation wave. This pass changes planning only. [PLAN.md](../PLAN.md)
owns the resulting schedule; individual plans retain authorization and acceptance.

Inspected Fregat `0154cd9cc`, current plan contracts, canonical publication code, workspace
setup and a read-only snapshot of open work. Existing terminal and gateway sessions keep their
changes and active ownership. This pass runs no product prototypes or performance measurements.

## Ordering decisions

Keep command foundation, then exact document contracts, then coherent feature batches.
The new plans add opportunities for shared code, but source review found no dependency requiring
completion of an async runtime, virtualizer replacement or full workspace redesign first.

| Large addition                                                  | Evidence and consequence                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [328–334 async runtime](328-async-runtime-master.md)            | 332 preserves public domain APIs and explicitly separates transport migration from 099 common source delivery. Qualification and a spellcheck pilot precede wider adoption when this deferred program starts. It can later sit beneath document adapters without redefining 200's product API. |
| [327 virtualization](327-virtualization-and-two-axis-tables.md) | Required CSV column/row windowing is a bounded geometry unit against current document ownership. Search/editor tuning needs current attribution; an engine replacement is conditional. Keep the requested later timing.                                                                        |
| [172 shared undo](172-shared-undo-stack.md)                     | Uses existing TanStack execution scopes and preserves independent histories and server transactions. Core/session extraction can follow keymap; coordinate workspace unit 4 with document/transaction edits. No new async-runtime dependency.                                                  |
| [335 icons](335-stroke-icons.md)                                | Roughly 330 web/UI files plus keymap icon prop types and Vite/manifests overlap the next cutover. Prepare the registry/mapping independently; give the broad swap a separate structural window after keymap and before broad UI additions. Packs remain later.                                 |
| [320 compile-time data](320-compile-time-data.md)               | G0 must qualify build/test/watch invalidation and package consumption. The four qualified units can ship separately. Coordinate shared build/lockfile edits; tentative file icons remain distinct from 335 UI icons.                                                                           |
| [208 localization](208-all-text-in-json.md)                     | Catalog ownership, typed generation and error transport are useful early contracts. Extraction proceeds by consumer. The complete all-client/RTL program need not precede keymap or every feature.                                                                                             |
| [209 workspace](209-unified-workspace.md)                       | Design review is approved; production implementation needs its separate decision. Settle affected pane/region/keyboard contracts early. 237/238 consume the relevant decisions and delivered owners rather than treating the whole shell program as one prerequisite.                          |
| [293/294 Mesh scheduling](294-mesh-job-coordination.md)         | Durable state, quorum and failover form a separate substantial program. 295 explicitly requires a usable manual collector before the scheduler exists; recurring execution follows those guarantees.                                                                                           |

These are dependency and overlap judgments. No measurements quantify time saved by moving
one program ahead of another. Revisit a placement when a concrete contract or measured rework
cost changes; plan size alone does not establish priority.

## Launch handoff cleanup

- [x] Record current versus deferred programs in the root delivery-wave table.
- [x] Retarget 205 to 286's hotkeys extension and 287's synchronous host claim/pass contract.
- [x] Add that input boundary to 206's coordinated cutover and acceptance.
- [x] Refresh 198/200 to canonical monorepo builds and delivered 099 publication.
- [x] Label 099's superseded pre-delivery audit without dropping its gated units.
- [x] Scope 237/238 to actual workspace decisions and authorized delivered hosts.
- [x] Separate 088's native MCP prerequisites from M2/M3 transferred to 174.
- [x] Remove old scratch-runner commands from selected excerpt/pane launch handoffs.
- [x] Preserve active 286/287 work and the shared checkout's other sessions.

## Entry conditions still requiring execution evidence

| Next work                         | Required receipt at launch                                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keymap cutover                    | Current 203 API, exact standalone installation and required hotkeys publication under 207; agreed landed terminal host/input/extension seam; known-good chord, composition and shell-input cases.   |
| Document units                    | Required 198 acquisition/attachment/retention proofs. 099 units 2–7 additionally need accepted 282 evidence and an explicit owner request. Publication unit 1 is already delivered.                 |
| Pane/dock features                | Accepted relevant 209 design decisions, real target owners, preserved host lifetime and separate authorization for new shell units. Source-only group work does not prove mixed-content acceptance. |
| Native agent intelligence         | 087 M0 real-provider interoperability, native M1 scope/authentication and relevant M4 conformance/isolation. Preserve unresolved approval and live-account boundaries.                              |
| Broad build/data or UI migrations | Qualified tool/domain output or registry contract, baseline, shared-path owner agreement and the relevant product acceptance cases.                                                                 |

A wave launch names exact units, owners, shared paths, prerequisite receipts, acceptance cases
and exclusions. Freeze that batch's scope while retaining new work in the shared backlog.
Close delivered engineering separately from an outstanding owner-only account/device receipt.

## Verification and limits

`bun run plans:check` passes with all 216 top-level plan documents indexed. Formatting and
local-link validation pass across the roadmap and 283 root/nested plan documents. Independent
read-back confirmed the schedule and caught two residual checklist contradictions; the 087
and 238 completion steps now preserve their scoped dependencies. The index includes this record.
No deferred program is started by publishing it. Product readiness remains unproved until the
entry receipts above are supplied by the appropriate implementation run.
