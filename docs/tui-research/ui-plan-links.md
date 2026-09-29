# Terminal UI plans and retained references

Owner decision, 2026-09-29: terminal UI implementation lives in `apps/tui/src/ui/` on upstream
OpenTUI. The former bubli toolkit and renderer-fork workstream is superseded. The parser and
Singapore work continue. [Plan 202](../../plans/202-tui-ui.md) owns implementation and
[root PLAN.md](../../PLAN.md#tui-ui-workstream) owns cross-project scheduling.

## Active owners

- Fregat Plan 202: local themes, controls, overlays, Markdown/React composition, rich content,
  timeline behavior, upstream integration and a bounded patch/upgrade policy.
- [Semantic Markdown plan](https://github.com/ShaulLavo/tree-sitter-md/blob/main/plans/bubli-semantic-markdown.md):
  M0-M4, shared semantics, CommonMark/GFM/selected Goldmark compatibility, streaming, lifetime
  and packaged grammar/resolver artifacts on tree-sitter-x.
- [Singapore consumer plan](https://github.com/ShaulLavo/singapore/blob/main/plans/bubli-markdown-consumer.md):
  S0-S4, current browser-editor integration, authoring/source correspondence, worker/session
  lifetime, package checks and performance. The two existing filenames are retained for link
  stability; they do not imply an active bubli dependency.
- Fregat Plans 176/189 retain parser integration and required extensions; 203/206 own keymap
  infrastructure; 207 owns any Editor relocation and public mirror. Follow the canonical source
  after that move, without independently editing the mirror.

The active consumer graph is tree-sitter-md + tree-sitter-x into Singapore and Fregat's local
Markdown renderer, with upstream OpenTUI below the latter. There is no toolkit release between
the parser and Fregat, and no requirement that Singapore depend on the terminal renderer.

## Retained source research

These immutable snapshots preserve the original measurements, references and acceptance cases:

- [83-capability catalog](https://github.com/ShaulLavo/bubli/blob/62ef77483e7e2289b70a5d45e0b90500c7b53776/docs/bubli/component-catalog.md).
- [Reference specification and source ledger](https://github.com/ShaulLavo/bubli/blob/62ef77483e7e2289b70a5d45e0b90500c7b53776/docs/bubli/reference-spec.md).
- [Former B0-B7 toolkit plan](https://github.com/ShaulLavo/bubli/blob/62ef77483e7e2289b70a5d45e0b90500c7b53776/plans/bubli-experience.md),
  retained as history, not an additional execution queue.

Interpretation: appearance, interaction, semantic fidelity and acceptance fixtures are retained;
old ownership, branding, package names and fork-release requirements are not. B0 maps to F0,
B1/B2 to F2, B3 to F3, B4/B5 to F4, B6 to F1/F4 and B7 to F5. Engine capabilities are supplied
by upstream or a demonstrated extension/patch; reusable terminal presentation is app-local;
application semantics remain in their existing features. Reclassify each catalog entry explicitly
rather than treating every old core owner as a request to rewrite upstream.

The selected Markdown path must use our parser and expose its semantics, not Marked token types.
Upstream's built-in Markdown implementation may remain in its package. Byte removal is a separate
measured concern. A component override is trusted application code, never execution of Markdown
as JSX/MDX. Parser/editor fidelity gates and Plan 189's required extensions are unchanged.

## Handoff and verification

F0/F1 prove package/runtime identity and risky seams. F2 proceeds alongside parser work. Parser M1
enables F3 and Singapore prototypes; production semantic cutover requires the producer's relevant
M1-M4 gates and each consuming renderer's tests. F4 integrates actual app surfaces; F5 verifies
rendering, focus, copy, anchors, upgrades and distribution. Full completion of unrelated browser,
document-service or mirror work is not a blanket TUI prerequisite.

Every implementation handoff records upstream core/React/native versions, parser schema/profile,
source and built runtime revisions, worker/WASM artifact hashes, patches with removal conditions,
Editor source/ref when affected, Fregat lockfile/CI changes, fixtures and actual results. A runtime
override is not evidence that bundled worker JavaScript or WASM asset resolution changed.

The original planning discussions remain at [Fregat #194](https://github.com/ShaulLavo/fregat/pull/194),
[parser #5](https://github.com/ShaulLavo/tree-sitter-md/pull/5),
[Singapore #62](https://github.com/ShaulLavo/singapore/pull/62) and
[former toolkit #1](https://github.com/ShaulLavo/bubli/pull/1). The current revision PRs link one
another in their descriptions. This index supersedes the former review-branch coordination page.

This revision changes documentation only. No package cutover, runtime tests, benchmark, release,
repository archival, deletion of release assets or implementation completion is claimed.
