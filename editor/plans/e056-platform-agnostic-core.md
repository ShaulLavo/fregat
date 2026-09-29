# E056: Extract a platform-agnostic core and prove a Strict DOM host

- Status: Approved
- Kind: Implementation
- Owner: Cross-repo
- Priority: P3
- Effort: XL
- Dependencies: [E001](../examples/stress/README.md), [E002](../docs/performance/input-latency.md)
- Inspected baseline: `45e22a495902c577243334586bc391f04201a827`, 2026-09-20.

Requested on 2026-09-20. Approved work, parked by the owner on 2026-09-25.
Implementation has not started. Plan 207 must establish the canonical source layout before
package relocation or producer/consumer cutover. Baseline research may proceed while parked. Fregat was inspected at
`43d3ac1762d4eb01f4521554967e666336858e33`; React Strict DOM at
`abd34bbf22bb468ffdc0baaf606f172c3a583487`. Reconcile actual HEADs and full dirty diffs before work.
The [research and detailed delivery units](../docs/architecture/e056-platform-agnostic-core.md)
and [57-source evidence ledger](../docs/architecture/e056-platform-agnostic-core-sources.json)
are supporting design evidence, not passing implementation results.

## Outcome

One platform-neutral document and editing implementation serves the existing fast DOM host and
an independently proven React Strict DOM host. For example, two views retain independent
selections and scroll while editing and undo use the same canonical buffer/history semantics.
Fregat's main editor, diff, search, transaction, prepared-open and headless consumers keep working.
Headless/DOM extraction can ship independently; editable native support cannot be claimed from
a readonly viewer, a WebView, a typecheck or cached selection getters.

## Current code

[Document sessions](../packages/editor/src/documentSession.ts) already own buffers, view sessions,
history graphs, logical revisions, leases and reversible prepared transactions. Preserve them.
[Editor](../packages/editor/src/editor/Editor.ts) constructs the DOM view while coordinating
shared behavior. [InputSelectionController](../packages/editor/src/editor/inputSelectionController.ts)
mixes native browser events and hidden input with autoclose, snippets and linked-edit policy.
[Viewport calculations](../packages/editor/src/virtualization/fixedRowVirtualizer.ts) mix numeric
window planning with DOM attachment; [geometry](../packages/editor/src/virtualization/virtualizedTextViewGeometry.ts)
uses mounted text and DOM Range. [Plugins](../packages/editor/src/plugins.ts) expose host elements
and snapshot serializers; the [React adapter](../packages/react/src/index.tsx) has concrete DOM
mounting, deferred disposal and generation-guarded presentation. The [worker reference](../docs/architecture/worker-topology.md)
confirms current document authority remains local/main-thread, not an authoritative document worker.
The research records exact Fregat consumers and RSD source/API mismatches. It is a targeted audit,
not a complete transitive import census, a fresh benchmark or native runtime certification.
On 2026-09-29, rebasing the plan onto `ec87a104` restored every current backlog entry and
updated the React adapter link to `index.tsx`. Re-audit the source before implementing P00;
the pinned 2026-09-20 research remains historical evidence.

## Scope

Singapore owns extraction, host contracts, feature-package partitioning, builds and tests. Fregat
owns paired import/link migration, application regression checks, files, save/recovery, retained
documents and command/focus routing. Initial native scope is an explicit iOS/Android feasibility
lane, not a Fregat native-app or desktop-native rewrite. Keep storage, synchronous document
publication and the working DOM renderer. Do not consolidate workers, create a second plugin
runtime, rewrite DOM rendering in React or invent a JavaScript text shaper.
[Fregat's roadmap](https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/PLAN.md)
remains the cross-project scheduler. Coordinate publication/synchronization with its Plan 099
and plugin authoring/selectivity with Plan 122; neither entire future runtime blocks relocation
of the existing owner. This plan does not reorder those lanes.

## Scheduling and canonical source

The owner reserved E056 for this plan on 2026-09-25; completed E047 remains the point-query
contract. Preserve the parked schedule until the cross-project roadmap schedules a delivery unit.
[Fregat Plan 207](https://github.com/ShaulLavo/fregat/blob/main/plans/207-one-repo-with-mirrors.md)
moves Singapore into Fregat's `editor/` folder and makes this repository a public mirror.
After that cutover, implement here through Fregat's canonical `editor/` sources and root
workspace/CI; do not start an independent mirror branch or restore sibling links and `editor-ref`.
Reconcile every source path, command and release handoff below against that layout first.
Plan 208 owns user-facing copy catalogs; hosts resolve catalog text through that contract.
The native client roadmap keeps its Swift/macOS gates. E056's iOS/Android proof certifies only
its declared host and does not select a replacement for the native macOS editor or shell.

## Design

Keep `@singapore-editor/core` as the eventual portable package. Establish portable source islands
inside the current package first, then extract proposed `@singapore-editor/dom`; retain
`@singapore-editor/react` as the web binding and add proposed `@singapore-editor/strict-dom`.
Hosts depend on core, never the reverse. Remove browser core exports at a paired breaking
cutover; no permanent `core -> dom -> core` facade or duplicated engine implementation.
Shared code owns document/view state, editing policy and semantic projections. Hosts own actual
input observation, mounting, shaping/geometry, painting, scrolling and accessibility. Preserve
powerful DOM-specific plugins behind explicit host contracts rather than narrowing all plugins.
Normalized input carries attachment/acknowledgement identity, a base sync point, replacement,
selection and composition information. Stale derived results may be dropped; unacknowledged
user text must be reconciled or explicitly recovered, never silently discarded. Preserve
commit-once composition, mirror updates, mutation leases and undo grouping.
Geometry uses plain coordinates with explicit space, layout generation and affinity. Report
ready/pending/unavailable honestly; preserve synchronous DOM measurement without requiring
unmounted native text to fabricate an answer. Measure the text that is actually drawn.
Reuse execution-provider contracts, prepared match/take/dispose ownership, concrete DOM React
types, and bounded renderer-specific paint replay. Paint is never document/revision authority.

## Steps

The detailed P00-P14 units define owners, prerequisites, exit evidence and rollback. All are open.

1. **P00-P01: baseline and contracts.** Record paired checkout/build identities, complete the
   transitive source/type/CSS/worker import census, freeze the reference dependency closure and
   encode Fregat surface contracts. Settle ownership, input, geometry and export decisions.
2. **P02: early native proof, alongside extraction.** Pin actual runtime/device versions and
   test built-package styling, input, physical composition, actual selection and glyph geometry.
   Select public RSD or an explicit narrow native service; keep unavailable capabilities unshipped.
3. **P03-P04: portable document owner.** Add ECMAScript-only compiler and built-import fences;
   relocate existing buffer/view/history/edit-chain code. Replay all mutation, logical-only,
   lease, prepared-sequence and compensation paths without DOM. No second publication bus.
4. **P05-P07: behavior, projection and DOM host.** Split observation from editing policy and
   numeric window planning from host measurement. Preserve mirrors, row/source identity,
   source/peer callback order and textarea-write-before-caret-measurement behavior.
5. **P08-P10: execution, contributions and bindings.** Isolate browser factories; partition
   host-specific contribution types without another lifecycle. Preserve the TUI tokenizer,
   provider precedence, React store modes, prepared ownership and provisional paint handoff.
6. **P11: paired package cutover.** Move browser exports/CSS into the explicit DOM package;
   migrate first-party packages and Fregat together. Test the exact producer SHA through the
   canonical Fregat workspace after Plan 207 and actual built exports. Before 207,
   record the existing `editor-ref` only as baseline integration evidence. Check declarations, assets, singleton
   identity, `.tsx`/platform entry handling and an acyclic package graph.
7. **P12: native host.** Reuse shared projections/behavior, first readonly then genuinely
   editable, through proven input/geometry services. Complete N0-N8 for the declared scope.
8. **P13-P14: certify and close.** Run paired regression, calibrated performance and lifetime
   checks; remove superseded paths and publish support limits. Revert to a recorded compatible
   producer/consumer pair on web failure; disable only the native host on native failure.

## Verification

- Domain traces catch lost revisions, broken anchors/history, lease bypasses, duplicate commits,
  listener-order regressions and accidental shared selection/scroll state across views.
- Real browser/Fregat scenarios catch diff expansion scroll resets, incorrect comment row
  identity, search source-line drift, readonly mutation, duplicate hosted commands, stale
  prepared/paint callbacks and WorkspaceEdit compensation/recovery failures. Include A-to-B-to-A
  environment switches, hidden retained views, Markdown/Decode and headless tokenizer/diff imports.
- Native **N0-N8** cover packaging, input, physical composition, actual selection, glyph geometry,
  viewport/reveal, stale-work/input races, accessibility and sustained interaction. Verify native
  selection by observing the control and inserting afterward, not merely reading cached fields.
  Include mixed Hebrew/English, Arabic, combining marks, emoji, tabs, wrapping and ligatures.
- Preserve E002's controls, independent unchanged holdout and delayed-event negative control;
  measure complete dispatch including peer views. Freeze/hash every relocated dependency, not
  just old core plus new DOM. No retuned limits, unbounded queues or document-wide render payloads.
- Check built core declarations without DOM/React ambients, real DOM/RSD package resolution,
  worker/CSS exclusion on native, explicit disposal and no unintended listeners or retained owners.
- Run `node scripts/check-editor-backlog.mjs` for plan inventory changes. Implementation uses
  existing `bun run build`, `bun run health`, `bun run typecheck`, `bun run test`, `bun run lint`
  and `bun run format:check`, plus provisioned Fregat's `bun run verify`. Run package scripts,
  never `bun test`. Replay `bun run --cwd examples/stress input:proof` as saved-evidence validation;
  use documented fresh `bun run bench:input` collection for the candidate, not replay as a timing result.

## Risks and decisions

Exact native targets, complete import closure, composition/external-edit conflict policy, parser
execution, required plugin subset and native accessibility remain open evidence gates. Public RSD
API documentation and native source differ in places; neither proves full editor behavior.
Native services may be required for composition, acknowledged input or authoritative text geometry.
A failed native proof does not block useful headless/DOM extraction, but cannot close editable
native delivery. Every gate records not-run/passed/failed and retains failed experiments.
Completion requires one canonical implementation, preserved Fregat contracts and browser gates,
no permanent migration facade, and separately named native support backed by device evidence.
No build, test, benchmark or physical-device result is claimed by this plan's source research.
