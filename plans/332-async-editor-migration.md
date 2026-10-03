# Plan 332: Editor adoption of the shared async runtime

Status: Approved, 2026-10-03. Execution deferred; no editor product work in this session.
Owner: Editor worker owners and Platform retained document/highlighting services. Parent: [328](328-async-runtime-master.md).
Dependencies: qualified [329](329-async-lifecycle-and-transport.md) and [330](330-async-scheduling-and-admission.md), [334](334-async-runtime-verification.md); source synchronization changes inherit [099](099-document-contributions.md)'s separate gate.

## Outcome

Editor workers share lifecycle, settlement and reusable scheduling while preserving their retained state, public domain APIs, independent execution and current document authority. Migrate real callers and delete the superseded implementations in bounded units.

## Inventory and keep contracts

| Owner                  | Keep in domain                                                                                  | Shared package responsibility                                   | Restart/disposal                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Spellcheck             | Dictionaries, accepted words, document/request semantics                                        | Lazy owned worker, request records and failure cleanup          | Restore accepted words on new worker; dispose service scope               |
| Shiki                  | Themes/languages, incremental tokenizers, per-document ordering, packed stores                  | Typed request transport, generation, pending settlement         | Lazy new generation; terminate busy worker and reject pending             |
| Tree-sitter            | Grammar/query/parse caches, source chunks, runtime sessions, exact revision, atomic checkpoints | Channel lifetime, settlement, transport ownership/diagnostics   | Lazy new generation, invalidate source retention; immediate busy teardown |
| Minimap                | Clipped projections, two canvases, coalesced rendering, colors/layout/render token              | Owned endpoint, render/control event lifecycle, bounded cleanup | New contribution after failure; acknowledge or bounded forced teardown    |
| Browser TypeScript LSP | Project/service state, JSON-RPC, server-exit contract                                           | Worker-shaped lifecycle endpoint only                           | New owner/connection; preserve exit notification                          |

The [current inventory](../docs/async-runtime/inventory.md) and [architecture](../docs/async-runtime/architecture.md) include broader Platform consumers. The Platform highlighting service shares Tree-sitter/Shiki across editors, diffs, previews and code fences. Its lifetime outlives a view; standalone services still have explicit owners. Add no package worker singleton or per-view duplicate service.

## Ownership and API boundary

Expose the existing Editor domain APIs backed by the shared package. Domain adapters retain grammar/document/cache semantics and interpret their structured worker replies. LSP JSON-RPC stays intact. Keep exact runtime-session identity and document incarnation/revision/configuration validity distinct from worker generation and generic request ID.

Canonical main-thread buffer publication remains synchronous. Common document delivery and synchronization cursors remain in 099, analysis acquisition in 198, standalone highlighting in 197 and content subject ownership in 200. Do not implement a second generic document mirror or duplicate full text on the main thread to simplify a message API.

Keep source strings/chunks/incremental edits and packed transferable token results. Unchanged chunks remain retained. Preserve cache caps/limits or explicit lifecycle scoping and per-session cleanup. Atomic cancellation remains a capability-dependent Tree-sitter adapter mechanism; aborting a Shiki wait still does not prove tokenizer computation stopped.

Editor work classes remain domain policy. Reuse latest-work/FIFO primitives; introduce scope-wide admission only where 334 demonstrates competing demand. A slow remote LSP cannot block local syntax, terminal work or synchronous typing.

Package delivery must satisfy 207: public dependency arrangement works in root and exact singapore mirror with no sibling checkout. Initial publication is a separate unit. No unpublished root-only dependency in a mirrored consumer; no compatibility aliases in a greenfield cutover. Consumer changes patch-bump only affected packages.

## Execution order

1. Freeze current worker counts, retained-state/source transfer counters and lifecycle semantics. Restore known-good observability before measuring a failure. Record current tree and any live edits.
2. Pilot the lazy dictionary worker through the shared owner/channel with its public API unchanged. Prove crash, recreate, pending failure and accepted-word restoration; remove duplicate broker.
3. Adopt one retained syntax owner, then the second, using existing domain commands. Prove independent documents/views, disposal during busy work, late replies, generations, token stores and retained caches. Transport-only changes cannot claim 099's common source-delivery completion.
4. Factor scheduler mechanisms under 330 without changing task-class meaning/deadlines. Measure before any admission or cadence tuning.
5. Adopt minimap endpoint/event cleanup and bounded disposal. Reproduce [#487](https://github.com/ShaulLavo/fregat/issues/487) with a real nonacknowledging worker before changing its contract. Preserve normal acknowledgment cleanup and frame coalescing.
6. Adapt TypeScript worker lifecycle behind the existing JSON-RPC transport. Prove server-exit reporting, pending request failure, new-owner restart and shutdown without project leaks.
7. Integrate the package beneath 099's contribution adapters only when units 2–7 are explicitly started and 282's acceptance gate is qualified. Delete common duplicated source-progress logic through that owner, never in a parallel runtime.
8. Verify all first-party surfaces with retained service sharing, build affected workspaces, commit by path, push and deploy the web consumer. Mark each migrated owner complete only after its evidence lands.

## Execution checklist

- [ ] Qualified core and exact mirror dependency delivery available.
- [ ] Baseline and public API/cache/lifecycle fixtures captured.
- [ ] Spellcheck pilot migrated and its duplicate broker deleted.
- [ ] Shiki retained owner migrated with per-document ordering/packed results.
- [ ] Tree-sitter owner migrated with chunk retention, generations and real cooperative cancellation.
- [ ] Shared scheduler mechanisms migrated and old implementations removed.
- [ ] Minimap event/render lifecycle migrated with bounded missing-ack teardown proof.
- [ ] TypeScript lifecycle adapter migrated while LSP protocol stays intact.
- [ ] Gated contribution delivery integrated by 099 after its existing authorization/evidence conditions.
- [ ] First-party surfaces, standalone installs, typing acceptance and live consumer delivery recorded.

## Verification

Use existing suites that can catch each owner's plausible failure: spellcheck service tests; Shiki worker cache/client/browser tests; Tree-sitter registration/runtime/source-retention and real-worker tests; minimap client/browser/disposal/render tests; TypeScript owner/LSP exit tests; highlighting disposal browser proof. Re-read package scripts for actual commands and build affected workspaces before checking consumers.

Drive ordinary editor, diff, Markdown fences, theme preview, retained/hidden document, two views and large-file feature tiers. Preserve loading/error identity and cache settlement. Use the existing verify-fregat scenarios and add only an uncovered real path. Read screenshots; pair traces/renders/caches with the specific claim.

Timing changes inherit 282's current qualified controls and remaining rejection. A transport pilot may proceed as future bounded work without declaring 282 passed, but performance acceptance and 099's gated units cannot use a stale or failed proof. Freeze payload/order/algorithm across transport arms and do not attribute parser changes to the package.

Done means useful in-scope duplication is migrated, documented no-adoption decisions preserve native/dependency protocols where an adapter would only forward calls, their domain guarantees pass, superseded plumbing is deleted, cross-family installs work, and Platform's served consumer uses the verified release. The planning-only delivery creates no package/source/version or live-runtime change.
