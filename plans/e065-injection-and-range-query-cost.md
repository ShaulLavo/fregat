# E065: Bound injection discovery and independent range-query scheduling

- Status: Approved
- Kind: Research
- Owner: Editor
- Priority: P1
- Effort: M
- Dependencies: [E001](../editor/examples/stress/README.md)
- Inspected baseline: `7d06ab6f52370b3f8bc116bd0491ffe47c1c2107` (Fregat main, 2026-10-02)

## Outcome

Measure, then reduce deferred syntax work after edits with one document analysis shared across
split views. On the 500,000-line short-lines fixture, a 24-character burst should discover
injections in affected ranges and let independent view-range queries proceed without chaining
each onto the document's mutation tail.

## Current code

[Plan 282](282-fast-paired-input-latency-check.md) and its
[measured findings](../docs/document-contributions/paired-input-latency.md#editor-product-finding-full-document-injection-discovery)
record frozen-product costs: injection discovery took 920–1,025 ms after a 24-character typing
burst versus 106–118 ms for root parsing; reset parses took 621–743 ms versus 30–40 ms.
These are coalesced edit/parse observations, not individual-keystroke timings.

- [The current worker](../editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts)
  measures `injectionDiscovery` in `appendInjectionLayers` and executes injection matches in
  `findInjections`. Unlike the frozen products, current `editDocument` already combines changed
  and edited ranges, expands enclosing ranges and carries unaffected layers. Measure those
  effective bounds first; full discovery still exists when no range restriction is supplied.
- [Document analysis](../editor/packages/editor/src/editor/documentAnalysis.ts):
  `AnalysisEntry.query` still chains requests onto `this.tail`; `StructuralEntry.range` dedupes
  identical revision/range keys, while distinct keys enter that chain.
- [Fregat's document service](../apps/web/src/features/editor/state/workspace-document-service.ts)
  owns one analysis per document and projects it into independent views. Plan 282's
  [shared-owner diagnostic](../docs/document-contributions/paired-input-latency.md#strict-shared-analysis-accounting-and-quiet-reliability-gate)
  raised post-input settle from about 3.7 s to 4.85–5.23 s, with about 30 fence/follow-up cycles
  per sample. Exact per-query identities and compute attribution were not captured.

Raw evidence: `/work/tmp/plan-282/run-20261001T153544Z-sol/composition-floor/platform-fence-details.json`
and that run's `shared-analysis/`. Recheck current source and timings before implementation.

## Scope

Research first, then implement remaining incremental injection-discovery gaps and remove
serialization of independent range queries. Editor owns the changes; Fregat supplies the paired
acceptance harness. Preserve Plan 282's frozen products and measurement rules. No parser rewrite
or additional analysis owner per split.

## Design

Keep one revision-owned parse and ordered edits. Retain unaffected injection layers; bound
rediscovery to changed/edited enclosing ranges with correct delimiter and nested-layer handling.
Separate independent queries from the edit tail after their source revision is ready, preserving
identical-key deduplication, stale-result rejection, cancellation and disposal. Measure worker
queueing as well as analysis-tail waits before choosing the scheduling change.

## Steps

1. Profile current short-lines single/multiple-view bursts and resets: root parse, discovery
   ranges/time, query keys, queue/compute time and settle cycles. Compare with the frozen finding
   and record what the existing incremental path already resolves.
2. Implement only measured discovery gaps; compare resulting injection layers with a full-discovery
   oracle. Then allow independent range queries without serializing them on the analysis tail.
3. Record paired before/after results and the remaining cost. A no-go closes research with evidence.

## Verification

Run `bun run bench:input:paired --baseline <packages> --candidate <packages>` from Fregat root
using Plan 282's frozen-package procedure and supported 500,000-line `short-lines` fixture,
covering single/multiple views. Require its unchanged correctness and blocking latency checks;
report before/after discovery, query waits and post-input settlement separately.
Targeted tests must catch missed/removed nested injections after delimiter edits, stale answers
across edits/disposal, duplicate identical queries and distinct ranges unnecessarily queued together.

## Risks and decisions

Changed syntax can invalidate distant injections; a smaller scan with incorrect layers fails.
Current main already has incremental discovery, so do not duplicate it based on frozen timings.
One worker may remain the compute bottleneck even after removing the analysis tail; claim a
scheduling benefit only after per-query attribution and paired evidence support it.
