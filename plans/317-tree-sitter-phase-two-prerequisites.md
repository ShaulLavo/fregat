# Plan 317: prepare structural pins and a held-out corpus

## Status and ownership

Status: APPROVED, deferred. Sources [Fregat #339](https://github.com/ShaulLavo/fregat/issues/339) and [#340](https://github.com/ShaulLavo/fregat/issues/340). They were filed in Fregat because tree-sitter-x issues are disabled. Implementation belongs in `ShaulLavo/tree-sitter-x`.

The owner stopped the scope-compatibility wave after Phase 1. This plan records the approved preparation work for later scheduling. It does not resume Phase 2, authorize a Markdown pilot, tune mapping packs, or change Fregat's production highlighter. Root [PLAN.md](../PLAN.md) owns scheduling.

## Outcome

Before a later pilot or promotion gate, the harness names the exact product parser, resolver, and query bytes. Its independent evaluation split has licensed, attributable inputs and honest per-language/theme coverage denominators.

## Current evidence

The inspected tree-sitter-x `origin/master` is `d67670fc147103ccb0cd0f6d6fbfb41977e49c56`. Its [owning compatibility plan](https://github.com/ShaulLavo/tree-sitter-x/blob/d67670fc147103ccb0cd0f6d6fbfb41977e49c56/docs/plans/textmate-scope-compatibility.md) marks Phases 0 and 1 complete and Phase 2 unstarted. The harness remains pinned to Node 26.7.0 after its recorded Bun gate failed.

The [structural manifest](https://github.com/ShaulLavo/tree-sitter-x/blob/d67670fc147103ccb0cd0f6d6fbfb41977e49c56/test/highlight-compat/manifest/tree-sitter-languages.json) records an older product identity. #339 identifies Markdown package 0.1.1 and revision `ff455a7dd3dc6177ddaf6879de462cecc34df73f`. Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb` uses `tree-sitter-md#9ca896688749f4043f6ddf7ffc00993cd781e434` in [the package manifest](../editor/packages/tree-sitter-languages/package.json). Select the actual later product revision at execution time and verify asset closure, rather than replacing only a version label.

The [fixture coverage report](https://github.com/ShaulLavo/tree-sitter-x/blob/d67670fc147103ccb0cd0f6d6fbfb41977e49c56/test/highlight-compat/reports/fixtures.md) has 16 runnable source fixtures and zero evaluation sources. Its 545 VS Code expectations, 1,603 TypeScript expectations, and 55 capture expectations have different denominators. Stored expectations, runnable input, supported native language, complete reference output, and completed comparisons must remain distinct.

## Preparation contracts

Re-pin structural identity as one closure of product revision, grammar bytes, Markdown resolver, queries, capture mappings, relevant source hashes, and injection dependencies. Use the existing `manifest/extract-product-profile.mjs` and platform drift tests. A content mutation must fail `--check`; unrelated movement of product HEAD must retain the existing content-based rule. Refresh only structural baselines and receipts that changed. Unchanged TextMate assets retain their profile and baseline identity.

Select evaluation inputs before tuning a pack. Every source needs exact bytes, SHA-256, provenance, explicit file-level license clearance, attribution, split, language, and relevant theme/injection scope. A repository license alone cannot clear borrowed samples. Use public licensed source or owned originals; never private repositories. Development and evaluation hashes are disjoint. Record unsupported, skipped, unavailable, and incomplete cases with reasons.

Define promotion scope and numerical coverage/quality gates before running evaluation. Include representative languages, themes, embedded languages, and adversarial cases for that scope. Artificial grammar conformance fixtures remain a separate category and cannot establish real-language coverage. Once an evaluation failure informs tuning, move that source to development and replace the affected holdout. Preserve the original provenance and failure receipt.

## Ordered execution checklist

Execute these units only when the deferred preparation is scheduled. Each ends in a check before the next unit.

- [ ] Refresh committed tree-sitter-x and selected Fregat references. Record both exact revisions and confirm the Phase 1 stop remains respected.
- [ ] Reproduce structural drift in an owned product snapshot using `extract-product-profile.mjs --check --platform-root <checkout>`. Record changed assets separately from unchanged TextMate content.
- [ ] Update the structural manifest, parser/resolver/query closure, and affected receipts. Extend content-drift tests with a fail-first mutation of each relevant asset class.
- [ ] Verify unchanged TextMate extraction and reference receipts stay identical. Publish the selected product/parser revisions and any genuinely changed baseline identities.
- [ ] Define the later promotion scope and gates, then review evaluation candidates for provenance and file-level licenses. Pin exact source bytes and attribution in `fixture-sources.json`.
- [ ] Extend `src/fixtures/manifest.ts`, loader, and reporting only as needed to express evaluation identity and split completeness. Add non-empty evaluation and cross-split hash checks.
- [ ] Regenerate the fixture report and review per-language/theme/injection denominators. Leave unsupported and missing coverage visible. Stop after preparation; record the still-pending pilot gate.

## Verification and acceptance

Run focused extractor tests from `test/highlight-compat`, then `npm run test:platform` with an explicitly supplied fixture product checkout using the existing test seam. New committed tests obtain paths from fixtures or checkout discovery and do not add machine-specific defaults. Preserve the pinned Node runtime and npm lockfile.

Run the fixture loader/registry tests, `npm run fixtures:check`, and the relevant artifact check after corpus changes. A duplicate hash across splits, missing attribution, unknown license, or empty evaluation denominator must fail the preparation gate. Publish the coverage report and exact command/revision receipts. These checks establish reproducibility and corpus readiness; they make no native parity or generalization claim.

## Delivery

Use a tree-sitter-x worktree and its repository instructions. Run heavy checks through Fregat's installed heavy wrapper. Commit owned paths, push a reviewed PR, and link its evidence from this central plan and the fork's compatibility plan. Update root scheduling with preparation completion and the remaining owner-controlled stop before Phase 2. No application deployment, pilot, mapping optimization, or new oracle campaign is part of this preparation.
