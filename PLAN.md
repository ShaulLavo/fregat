# Execution roadmap

Updated 2026-09-29. This file owns cross-project ordering. Each [plan](plans/README.md)
owns its scope, decisions, status and acceptance checks. [AGENTS.md](AGENTS.md) owns execution
rules; [docs](docs/README.md) holds architecture, research and delivery evidence.

## Current execution order

The [September 29 inventory](plans/inventory-2026-09-29.md) reconciles the remaining
work across Fregat, Editor, Ghostty, the parser and native clients. It is a dated
snapshot; this file remains the scheduler and each plan remains its scope authority.

1. **Finish source consolidation in 207.** Draft PR #199 imports both histories, consolidates workspaces and tooling, and relocates CI. Final source pulls under the owner's freeze, mirrors and publishing remain with the coordinator. Reconcile open sibling work, capture final
   heads, obtain the scoped session hold, import the packages and verify the first
   mirrors. The rehearsal is complete. Publication bootstrap is a separate gate.
2. **Close delivered residues and the existing wave-2 queue.** Verify before retiring
   implemented plans. Keep **132 → 179 → 099 units 0–1 → 114 → 126 → 156 P0–P2** as
   the default closeout order. Independent proofs and Platform-only slices can run
   during consolidation; package-layout changes wait for their canonical locations.
3. **Complete one keymap cutover: 204 + 205 → 206.** 203 has landed. Prepare the
   producer APIs in parallel, migrate every consumer, then remove obsolete APIs in
   the same verified release. Align E026 command metadata; Platform owns the shadow report.
4. **Finish document guarantees and shared highlighting.** Prove landed 198 contracts
   alongside 099 publication; implement 197 independently. Then migrate 200 consumers
   against the exact contracts they need. 099 units 2–7 remain explicitly gated.
5. **Take bounded product slices.** Prefer finishing an active lane before opening a
   second architecture program. Markdown block/range authoring in 111/108 precedes
   171's composer swap. 202's local controls can proceed independently; its semantic
   Markdown cutover waits for parser producer/consumer gates. 201 owns measured typing
   improvements, 178 owns remaining tree slices, and Ghostty 016 owns standalone readiness.
6. **Run broad migrations and later programs by unit.** Establish 208's catalog and
   package contract after 207, coordinate command/settings extraction with 206, then
   migrate stable domains. 209 design work can proceed earlier but retains its design
   and implementation gates. Native stays editor-first; 088 follows 087 interoperability.

The default is one active structural cutover plus independent closeout/proof work.
This order schedules Approved work; it does not expand any plan's authorization.

## Scope of the package hold

No active blanket code freeze was confirmed. 207 requires Editor and ghostty writes
paused from final-head capture through the first verified mirror push, with the owner
coordinating other sessions. Release the hold once Fregat is canonical and standalone
mirror checks pass. Documentation, read-only baselines, independent Platform fixes,
TUI local work and localization design can continue. Avoid starting sibling API/layout
migrations during the cutover. Do not delete old checkouts or rewrite mirror history.

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
- [182](plans/182-search-view-rendering.md) owns the selected recycled-editor search rendering;
  one-editor/multibuffer alternatives remain unscheduled.
  [171](plans/171-composer-on-our-editor.md) owns the composer migration. Neither moves into 200.
- Markdown authoring and rendered blocks follow [108](plans/108-markdown-modes.md),
  [111](plans/111-editor-decorations.md) and [176](plans/176-markdown-parser.md). Reconcile landed
  authoring/parser work before scheduling their remaining parts. [189](plans/189-tree-sitter-md-improvement.md)
  owns subsequent parser correctness and performance work.

## TUI UI workstream

[202: terminal UI in Fregat](plans/202-tui-ui.md) owns the Charm-inspired experience in
`apps/tui/src/ui/` on upstream OpenTUI. The owner's 2026-09-29 decision supersedes the bubli
name, standalone toolkit and permanent renderer-fork assumption. Keep the existing backend and
shared React/TypeScript logic. The wave-2 queue above is unchanged.

- Prove upstream package/runtime resolution and the risky Markdown, focus and scrolling seams
  first. Use public composition and extension points; carry only demonstrated, version-pinned
  patches with regression tests and removal conditions. A maintained fork needs a separate
  evidence-backed decision. No toolkit package or native-release pipeline is scheduled.
- Keep tree-sitter-md + tree-sitter-x and Singapore's semantic work. Parser semantic,
  conformance, streaming and package gates precede the app's production Markdown cutover;
  local controls can proceed in parallel. The app's Markdown path does not use Marked or its
  token types; removal of Marked from upstream's own package is not a prerequisite.
- Plan 202 owns local React Markdown overrides and terminal profile/copy/lifecycle tests.
  Plans 176/189 retain parser ownership and required extensions; 171/179/197/198/200 keep their
  existing scope. Only exact consumed contracts are prerequisites, not unrelated whole plans.
- Plans 203/206 own keymap infrastructure. Plan 202's controls integrate with that dispatcher;
  they do not introduce a second one. Respect 207's canonical Editor source when it moves.
- The [coordination and research index](docs/tui-research/ui-plan-links.md) links the retained
  catalog, source evidence, companion plans and implementation handoffs. These are plans, not
  delivered package changes; the existing fork overrides remain until the verified cutover.

## Keymap workstream

[Keymap architecture](docs/keymap/architecture.md) records the owner's 2026-09-29 decisions.
[203: @fregat/hotkeys](plans/203-fregat-hotkeys.md) landed in PR 197. [204: Editor](plans/204-editor-on-fregat-hotkeys.md)
and [205: ghostty-webgpu](plans/205-ghostty-on-fregat-hotkeys.md) then run in parallel, and
[206: Platform owns one keymap](plans/206-platform-one-keymap.md) adopts both. 206's TUI step is
infrastructure only and takes OpenTUI key events through the integration owned by 202.
This workstream does not reorder the wave-2 queue above.

[207: one repo with mirrors](plans/207-one-repo-with-mirrors.md) moves the Editor and
ghostty-webgpu into Fregat and mirrors them (and `hotkeys/`) to their public repos. Run it before
204 and 205 so their work lands in Fregat; 203 does not wait for it.

## Localization

[208: all app text in JSON](plans/208-all-text-in-json.md) is Approved. Break execution
into catalog/package ownership and typed generation, structured-error transport,
bounded caller extraction/migration, then locale/plural/RTL acceptance. Prove standalone
family catalog installation after 207 and coordinate command/settings metadata with 206.
New UI work uses the catalog contract once available. Keep native adapter proofs separate
from JavaScript generation. The approved full scope remains; this is its delivery order.

## Unified workspace design

[209: one workspace for chat and code](plans/209-unified-workspace.md) is Approved
for design review. Resolve its D1–D6 gates before the affected implementation units;
production implementation retains its separate owner authorization. Use the existing
tab/group and session owners. Schedule command changes against 206, preserve 200
content ownership, and apply 208 catalogs to new copy. It follows the package cutover
for implementation; its design work can proceed during the scoped freeze.

## Zed parity workstream

Plans 220–280 implement the Zed actions Fregat lacks, from the 2026-09-29 triage
(`/work/reports/keymap-wave/zed-feature-triage.md`: 432 input actions plus Zed's Vim keymap, 46
groups). They bind through [206's keymap](plans/206-platform-one-keymap.md), so 206 comes first
for their bindings; each plan lists its own dependencies. Vim is plans 274–280. Plans 272–273 only
record Zed actions that do not apply.

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
