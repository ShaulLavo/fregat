# Execution roadmap

Updated 2026-09-28. This file owns cross-project ordering. Each [plan](plans/README.md)
owns its scope, decisions, status and acceptance checks. [AGENTS.md](AGENTS.md) owns execution
rules; [docs](docs/README.md) holds architecture, research and delivery evidence.

## Wave 2 closeout and dependency order

The owner's remaining closeout queue is **132 → 179 → 099 → 114 → 126 → 156**. This is a
default work order, not a chain of prerequisites. Independent work can move earlier. See the
[remaining phase checklist](docs/next-wave.md#wave-2-closeout-reconciled-2026-09-28).

| Work                                                                 | Dependency that matters                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [132: dev/process ownership](plans/132-process-and-dev-ownership.md) | Reconcile development plumbing; the schema collapse is deployed. No repeat database reset. Transfer obsolete Electrobun vibrancy work to 114.                                  |
| [179: content isolation](plans/179-isolating-foreign-content.md)     | Instrument style costs before Mermaid/CSS performance claims. Its isolation policy also applies to 156.                                                                        |
| [099: document contributions](plans/099-document-contributions.md)   | Units 0–1 refresh the consumer baseline and implement canonical publication. Include 198's landed retained-analysis subscriber. Units 2–7 retain their explicit gate.          |
| [114: desktop shell](plans/114-polaron-shell.md)                     | Preserve mesh-owned servers and terminals. Native host checks precede Electrobun removal.                                                                                      |
| [126: T3 alignment](plans/126-t3code-alignment.md)                   | Reconcile delivered batches first. Desktop host cases consume 114; independent chat/provider/server proofs can run earlier.                                                    |
| [156: rich documents](plans/156-documents-in-the-editor.md)          | P0–P2 use existing file/buffer identity and the isolation policy. Binary guards and PDF viewing do not need all of 099 or 126. Later format/editing phases retain their gates. |

This queue does not certify other plans as complete or authorize gated implementation, account
spending, or state deletion. Their explicit decisions remain in the owning plans.

## Document and editor dependencies

The owner removed the fixed “198 first after wave 2” priority on 2026-09-28. Schedule by the
contracts a consumer needs:

- [198](plans/198-document-owned-editor-analysis.md) has retained-analysis code. Prove its
  acquisition, range/configuration admission, cancellation, retention and attachment guarantees
  against that implementation. Coordinate its subscriber with 099 unit 1; no second analysis owner.
- [197](plans/197-editor-highlighting-service.md) owns standalone highlighting and diff analysis.
  It is independent of 198's retained-view lifetime.
- [200](plans/200-document-backed-content-views.md) consumes the relevant 099 publication and
  198 acquisition/attachment guarantees. Comparison integration also needs 197's diff service.
  Its baseline research can run before those contracts land.
- [182](plans/182-search-view-rendering.md) owns search rendering and multibuffer work;
  [171](plans/171-composer-on-our-editor.md) owns the composer migration. Neither moves into 200.
- Markdown authoring and rendered blocks follow [108](plans/108-markdown-modes.md),
  [111](plans/111-editor-decorations.md) and [176](plans/176-markdown-parser.md). Reconcile landed
  authoring/parser work before scheduling their remaining parts. [189](plans/189-tree-sitter-md-improvement.md)
  owns subsequent parser correctness and performance work.

## bubli TUI workstream

[202: the existing TUI runs on bubli](plans/202-bubli-tui.md) owns Fregat's adoption of the
OpenTUI fork and Charm-inspired terminal experience. Keep the existing backend and shared
React/TypeScript application logic. This workstream does not reorder the wave-2 queue above.
Its status and acceptance checks live in 202; these are coordinated plans, not delivered features.

- [bubli PR 1](https://github.com/ShaulLavo/bubli/pull/1) owns toolkit defaults, controls,
  focus/overlays, arbitrary React Markdown components and terminal rendering. Theme/control work
  can proceed alongside parser work; Fregat first proves coherent fork/package resolution.
- [tree-sitter-md PR 5](https://github.com/ShaulLavo/tree-sitter-md/pull/5) owns the renderer-facing
  semantic API and CommonMark/GFM/selected Goldmark, streaming and packaging gates. Those gates
  precede bubli's production Marked removal and Fregat's Markdown cutover. Reconcile the now-reported
  676/676 normalized baseline; do not repeat older release failures or treat it as rendering parity.
- [Singapore PR 62](https://github.com/ShaulLavo/singapore/pull/62) coordinates its existing
  Markdown consumer with that semantic release. Pair any Editor/runtime pin changes with Fregat's
  lockfile and CI setup. Unrelated browser UI and full 099/198 completion are not blanket TUI
  prerequisites; verify only the exact publication/analysis contracts a consumer uses.
- Plans 176/189 retain parser integration/improvement ownership and 189's required extensions.
  Plans 171/179/197/200 keep composer, isolation, highlighting and document-view scope. The
  [coordination index](https://github.com/ShaulLavo/bubli/blob/docs/bubli-plans-2026-09-28/docs/bubli/README.md)
  links the full series, reference specification, capability catalog and producer/consumer handoffs.

## Keymap workstream

[Keymap architecture](docs/keymap/architecture.md) records the owner's 2026-09-29 decisions.
[203: @fregat/hotkeys](plans/203-fregat-hotkeys.md) comes first. [204: Editor](plans/204-editor-on-fregat-hotkeys.md)
and [205: ghostty-webgpu](plans/205-ghostty-on-fregat-hotkeys.md) then run in parallel, and
[206: Platform owns one keymap](plans/206-platform-one-keymap.md) adopts both. 206's TUI step is
infrastructure only and takes its key events from whatever 202 has landed (bubli or OpenTUI).
This workstream does not reorder the wave-2 queue above.

## Other work and boundaries

The [plan index](plans/README.md) lists the remaining numbered plans without duplicating their
statuses here. In particular:

- [088 native code intelligence](plans/088-native-code-intelligence.md) follows the required
  [087 native MCP](plans/087-stateless-mcp.md) contracts. External MCP management stays in
  [174](plans/174-external-mcp-servers.md).
- The [native client roadmap](docs/native-plan-of-plans.md) owns Swift work. The TUI designs its
  own terminal UX; web parity items wait where the TUI redesign requires it.
- Editor and ghostty-webgpu keep package-local backlogs. Paired changes land with their Platform
  integration and CI ref. Verify current package gates before scheduling from historical numbers.
- [183](plans/183-claude-ide-in-terminals.md) remains low priority. DOCX editing retains its
  Markdown/fidelity gate in 156. The `/platform` prefix removal remains deferred on mesh naming.

## Keeping this roadmap useful

Keep only current order and cross-plan dependencies here. Update a plan's own status when work
lands. Retire completed plans after preserving current contracts and updating their backlinks;
git history keeps the original plan and evidence. Historical wave coordination is linked from
[the wave record](docs/next-wave.md); it does not override current repository instructions.
