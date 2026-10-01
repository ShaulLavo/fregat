# Shared Markdown semantics for Editor and Fregat TUI

Source paths in this document are relative to [`editor/`](../editor/) unless qualified.

Status: proposed cross-repository integration work package, requested by the owner on 2026-09-28. Documentation only; no editor, dependency, worker or build changes are made in this PR. This is part of Fregat Plan 202, coordinated with existing Plans 176/189/099/197/198, not a second independent Editor roadmap or a replacement for the numbered backlog.

Owner revision, 2026-09-29: the terminal UI lives in Fregat's `apps/tui/src/ui/` on upstream OpenTUI. The bubli name, standalone toolkit and permanent renderer-fork assumption are superseded. Singapore's S0-S4 work and the parser's semantic, compatibility, streaming and package gates remain in scope. The existing plan filename is retained for link stability, not as a toolkit dependency.

## Outcome

Singapore and Fregat's local terminal renderer consume the same owned Markdown engine and renderer-neutral semantic contract. Singapore keeps its browser editor, incremental authoring/decorations and existing document/worker lifetimes. Fregat owns its React UI above upstream OpenTUI. Shared semantics do not require shared DOM/terminal components or one WASM heap across workers. No standalone toolkit release or OpenTUI fork is a prerequisite for this editor work.

## Connected plans and sources

- [Fregat architecture revision PR 198](https://github.com/ShaulLavo/fregat/pull/198), including the [coordination page](https://github.com/ShaulLavo/fregat/blob/docs/tui-ui-upstream-2026-09-29/docs/tui-research/ui-plan-links.md).
- [tree-sitter-md semantic API and compatibility plan](https://github.com/ShaulLavo/tree-sitter-md/blob/main/plans/bubli-semantic-markdown.md), originally introduced in [PR 5](https://github.com/ShaulLavo/tree-sitter-md/pull/5).
- [Fregat Plan 202](https://github.com/ShaulLavo/fregat/blob/docs/tui-ui-upstream-2026-09-29/plans/202-tui-ui.md); its [root roadmap](https://github.com/ShaulLavo/fregat/blob/docs/tui-ui-upstream-2026-09-29/PLAN.md#tui-ui-workstream) owns cross-project ordering. After merge, use those document paths on main.
- Existing Fregat plans: [176 parser](https://github.com/ShaulLavo/fregat/blob/4f587e90091cb0a74b314276a038b45685da572b/plans/176-markdown-parser.md), [189 parser improvements](https://github.com/ShaulLavo/fregat/blob/4f587e90091cb0a74b314276a038b45685da572b/plans/189-tree-sitter-md-improvement.md), [099 publication/contributions](https://github.com/ShaulLavo/fregat/blob/4f587e90091cb0a74b314276a038b45685da572b/plans/099-document-contributions.md), [197 highlighting](https://github.com/ShaulLavo/fregat/blob/4f587e90091cb0a74b314276a038b45685da572b/plans/197-editor-highlighting-service.md), [198 retained analysis](https://github.com/ShaulLavo/fregat/blob/4f587e90091cb0a74b314276a038b45685da572b/plans/198-document-owned-editor-analysis.md).

Planning baseline: Singapore `79895646ec626d03e88aca148b60b8a05d884970`; parser `5dd917ae70eea5f6a38a2ba8825ce6d3baca697d`. Recheck current source and package pins before execution. This ownership revision was read against Singapore `54e1e6488fb058d1c1a5f1692905da06ede93a20` and preserves the existing work units.

The inspected [Markdown adapter](https://github.com/ShaulLavo/singapore/blob/79895646ec626d03e88aca148b60b8a05d884970/packages/tree-sitter/src/treeSitter/markdown.ts) already initializes tree-sitter-md with grammar/resolver assets, forwards edits and converts highlights, folds, injections and decoration records. It preserves link-text companion records for viewport consumers. [markEdit](https://github.com/ShaulLavo/singapore/blob/79895646ec626d03e88aca148b60b8a05d884970/packages/markdown/src/markEdit.ts), [semanticEdit](https://github.com/ShaulLavo/singapore/blob/79895646ec626d03e88aca148b60b8a05d884970/packages/markdown/src/semanticEdit.ts), [replacements](https://github.com/ShaulLavo/singapore/blob/79895646ec626d03e88aca148b60b8a05d884970/packages/markdown/src/replacements.ts) and the authoring plugin already use Kind records. Do not schedule initial parser integration again.

The parser [README](https://github.com/ShaulLavo/tree-sitter-md/blob/5dd917ae70eea5f6a38a2ba8825ce6d3baca697d/README.md) reports completed 0.1 normalized-spec and package-loading gates. Those are repository-reported results, not tests rerun for this planning PR; semantic rendering parity needs the new producer gate.

## Boundaries

1. Preserve the simple editor API: plain text/options continue to work without a document ID or retained-analysis service. A document adds sharing and identity; it is not mandatory setup for Markdown.
2. Keep the compact decoration API for editor authoring. Consume renderer-oriented semantics where they remove reconstruction or support shared rendered views; do not force every keystroke to build a full semantic tree.
3. Parser semantics and invalidation belong to tree-sitter-md. Editor owns buffer edits, worker/session scheduling, viewport demand and projection. Fregat owns file/environment identity, acquisition, retention and product policy.
4. Existing 099/198 publication/analysis owners remain authoritative when used. Add no parallel revision journal, hidden active-editor pointer, feature-local parser singleton or second retained-analysis cache.
5. Standalone code/snippet/diff highlighting remains with 197. Do not move it into a general Markdown document cache or replace every Shiki path merely because the terminal renderer uses Tree-sitter.
6. Existing Markdown modes, authoring, composer and extension plans keep their scope. Plan 189's math, footnotes, CJK flanking, wiki links, callouts and highlights remain required under their existing owner and explicit options.
7. This plan does not import OpenTUI or terminal UI components into Singapore, and does not make the terminal app depend on a browser editor runtime.
8. Fregat Plan 207 owns any Editor move and mirror cutover. Apply later changes in the canonical source once that lands; do not independently modify a read-only mirror or make that move a blanket prerequisite for these semantics.

## Contract consumed from tree-sitter-md

Consume the semantic snapshot/range protocol agreed in parser M1: source incarnation/revision, parse options, coverage, nested blocks/inlines, decoded text, resolved link/image targets/titles, ordered starts/tightness, task/definition-list data, complete table cell/alignment data, fenced-code metadata and source correspondence.

Incremental notifications must include nonlocal changes such as reference definitions appended after earlier links. Reject results for stale revisions or disposed/replaced sessions. Source offsets stay UTF-16; DOM geometry, terminal cells and bytes remain separate coordinates. Retained typed arrays must not borrow invalid WASM views across edits or memory growth.

Stable semantic identity is a shared contract, not an application-specific array index. Editor anchors/projections may map it into existing view identity. A parser reclassification legitimately replaces semantic nodes; harmless appends should not invalidate unrelated state.

## Implementation units

### S0. Inventory actual consumers and preserve the baseline

- [ ] Enumerate Markdown record consumers in tree-sitter and markdown packages, tests, worker protocol and rendered preview hooks; include MDX masking and link companion records.
- [ ] Record package/runtime pins, real initialization paths and current 176 integration status. Identify what can remain unchanged under an additive semantic API.
- [ ] Capture existing authoring, selection, undo/redo, folds, fenced injection and first-paint behavior using the current narrow suites and real browser project.

Exit: exact consumer impact map and controls. No speculative editor rewrite.

### S1. Adopt the semantic contract through the existing session

- [ ] Extend the existing Markdown/session/worker boundary only for semantic consumers that need it. Reuse the document's parse and revision admission rather than instantiate another parser per preview.
- [ ] Preserve viewport range coverage and document-wide reference readiness; an unseen definition must not make a visible link transiently wrong.
- [ ] Keep existing decoration/authoring operations unchanged where supported; pair any unavoidable API break with all callers and update tests rather than adding lasting aliases.
- [ ] Expose a renderer-neutral typed result where needed, with cancellation/disposal and explicit partial/ready/error state.

Exit: editor decorations and one semantic consumer agree on the same revision and source spans, including a link whose definition changes outside the visible range.

### S2. Preserve authoring and projection correctness

- [ ] Test entities/escapes, code-span normalization, reference links, nested emphasis, tight/loose lists, starts other than one, tasks, definition lists and tables wider than 12 columns.
- [ ] Verify selection, mark toggles, structural edits, live-preview replacements, folds and fence injections retain correct source offsets after edit/undo/redo.
- [ ] Exercise multiple views, rapid source replacement, extension-option changes and stale worker results without leaking analysis or publishing to the wrong source.
- [ ] Keep safe rendering policy explicit: browser HTML/URL handling remains separate from parser recognition; Markdown does not execute model-provided JSX/MDX.

Exit: focused correctness cases pass through the existing simple and document-backed APIs, plus real-browser evidence where projection/copy/geometry changes.

### S3. Packaging and runtime identity

- [ ] Consume the released semantic API and assets as one pin. Validate all three WASM assets (host, grammar, resolver), bundler URLs and worker loading from a fresh install/packed consumer.
- [ ] Reuse the existing tree-sitter-x extension loader; deduplicate compatible module instances within a realm. Separate workers retain separate heaps.
- [ ] Extend initialization-order and sibling-document isolation tests with the new semantic path, including continued parsing of non-Markdown fence languages.
- [ ] Pair the exact Editor revision with Fregat's actual package/CI setup and lockfile updates. Respect Plan 207's workspace/mirror ownership if it has landed; otherwise retain the existing linked-source checks. The planning PR itself changes no pins.

Exit: package artifacts and the editor/terminal consumers resolve the intended parser/runtime versions. Fregat independently verifies its upstream OpenTUI assets; no separate UI package release is required.

### S4. Performance and paired closure

- [ ] Measure first paint, parse, semantic projection/transfer, update latency, buffer copies and memory separately, cold and warm, at existing representative sizes.
- [ ] Ensure a rendered preview does not force full-document semantic materialization on the editor's typing path. Retain relevant full-text/retention and bounded-work gates.
- [ ] Run focused package tests/typechecks; browser Vitest for worker/projection/clipboard/geometry changes; architecture health and formatting checks as directed by current AGENTS.md.
- [ ] Record source revisions, fixture IDs, exact measurements and intentional deviations. Link Fregat consumer evidence and update its coordination page.

Exit: parser producer and Editor consumer checks pass together; Fregat can adopt the released contract without a second parser implementation.

## Dependency order and non-goals

S0 can proceed alongside Fregat's local theme/control work. S1 requires the agreed parser M1 contract; production S3 requires parser conformance/packaging gates. The TUI can adopt independently once its own parser and local React/profile/runtime gates pass; unrelated browser UI work and full completion of 099/198 are not blanket prerequisites. Any exact retained-analysis guarantee used here must be verified before that dependent consumer cutover.

The TUI's selected Markdown path uses our semantics rather than Marked tokens. Removing Marked from upstream OpenTUI's package is not an editor or parser requirement. Fregat owns any measured OpenTUI extension/patch need; this plan adds no renderer-fork maintenance or toolkit publication gate.

No backend, application layout, second Markdown parser, broad document-service replacement, speculative runtime ABI change, terminal DOM emulation or duplicate numbered backlog entry is introduced. If an additive parser release leaves an existing caller correct, record its regression proof rather than rewrite it to manufacture work.
