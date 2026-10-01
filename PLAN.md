# Execution roadmap

Updated 2026-10-02. This file owns cross-project ordering. Each [plan](plans/README.md)
owns its scope, decisions, status and acceptance checks. [AGENTS.md](AGENTS.md) owns execution
rules; [docs](docs/README.md) holds architecture, research and delivery evidence.

## Shared planning home

All package and client plans live in the root [plans/](plans/README.md) folder.
This roadmap schedules Fregat, Editor, Ghostty, hotkeys and native-client work together.
The [Editor inventory](plans/editor-backlog.md) preserves E-numbered scopes, dependencies,
completed references and the [original wishlist](plans/editor-wishlist.md).
The [native work breakdown](plans/native-plan-of-plans.md) retains its editor-first gates.
Package roadmap files link here. Create and update plans in root `plans/`.

## Current execution order

The [September 29 inventory](plans/inventory-2026-09-29.md) reconciles the remaining
work across Fregat, Editor, Ghostty, the parser and native clients. It is a dated
snapshot; this file remains the scheduler and each plan remains its scope authority.

1. **The foundations wave is closed.** 132, 179, 197, 099 unit 1, 198's foundation contracts
   and 126's bounded proofs are delivered. Worker cleanup, exact typing/Undo restoration,
   browser health, long-line fallback and offset repairs have landed. PR #224 records 099
   unit 0 as partial: 5/10 configurations calibrated. [282](plans/282-fast-paired-input-latency-check.md)
   supersedes the unfinished absolute-threshold calibration; units 2–7 remain gated on the
   replacement input-latency proof and an explicit owner request. The
   [wave record](docs/next-wave.md#foundations-wave-2026-09-30) records delivery, the served
   release and remaining follow-ups. Closure authorizes no additional work.
2. **Continue the owner's closeout queue: 114 → 126.** 156 P0–P2 delivered 2026-10-02
   (#269/#280/#286); its Approved P3+ follow-ups retain their gates. This is a default work
   order, not a chain of prerequisites; [the closeout table](#wave-2-closeout-and-dependency-order)
   names the dependencies that matter.
3. **Take the keymap cutover (204 + 205 → 206) as the next structural cutover**, then the
   document runtime, whose 099 units stay gated. Localization and workspace implementation
   follow as broad migrations.
   The [next programs](#next-programs) table gives each program's gates and what can start now.

The default is one active structural cutover plus independent closeout/proof work. This order
schedules Approved work; it does not expand any plan's authorization.

## Next programs

Each program groups Approved plans that share owners and gates. Grouping does not merge their
scopes into one package rewrite, lift a gate or approve gated units. Sizes are in the
[inventory](plans/inventory-2026-09-29.md); each plan keeps its own checklist.

| Program              | Plans                                                                                                                                                                                | When                                                                                          | Gates and boundaries                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop shell        | [114](plans/114-polaron-shell.md) Gates 1–4                                                                                                                                          | Next in the closeout queue                                                                    | Preserve mesh-owned servers and terminals. Gate 3 needs a Mac and owns 132's vibrancy check; Mac verification precedes Gate 4's Electrobun removal.                                                                                                          |
| T3 alignment residue | [126](plans/126-t3code-alignment.md) remaining A–F/J rows, G/H/I follow-ups                                                                                                          | Server, chat and provider proofs any time; desktop rows after 114                             | LIFE-06 schema/state-loss gate, live-account checks and the frozen `7445aa73` oracle stay. Close only rows with fresh evidence.                                                                                                                              |
| Rich documents       | [156](plans/156-documents-in-the-editor.md) P0–P2 delivered 2026-10-02 (#269/#280/#286); P3+ Approved follow-up                                                                      | Wave 2 scope delivered; schedule follow-ups by format readiness                               | Uses existing file identity and 179's isolation policy. P3–P6 follow; P7 DOCX editing stays parked on Markdown and fidelity decisions.                                                                                                                       |
| Keymap cutover       | [204](plans/204-editor-on-fregat-hotkeys.md) + [205](plans/205-ghostty-on-fregat-hotkeys.md) → [206](plans/206-platform-one-keymap.md); E026 metadata                                | Next structural cutover; 204/205 producer prep can start now                                  | One verified release migrates every web and TUI caller and deletes the old APIs; Platform builds the shadow report. Before a mirror carries a hotkeys consumer, prove standalone install and publish hotkeys (207's gate). Zed/Vim 220–280 bind after 206.   |
| Document runtime     | [099](plans/099-document-contributions.md) units 2–7 and [198](plans/198-document-owned-editor-analysis.md) acceptance → [200](plans/200-document-backed-content-views.md) consumers | After the keymap cutover by default; 198 acceptance proofs and 200 baseline research any time | 099 units 2–7 need 282's replacement input-latency proof and an explicit owner request. 200 migrates each consumer against the exact 099/198 contract it uses; 197's diff service is delivered. 122's document scope follows 099; 182 and 171 stay separate. |
| TUI                  | [202](plans/202-tui-ui.md) on upstream OpenTUI                                                                                                                                       | Local controls any time                                                                       | Production Markdown cutover waits for the tree-sitter-md M1–M4 producer and Editor semantic S0–S4 consumer gates. Controls use 206's dispatcher. No toolkit package, maintained fork or native release pipeline.                                             |
| Localization         | [208](plans/208-all-text-in-json.md)                                                                                                                                                 | Broad migration, by unit                                                                      | Catalog and typed generation, then structured-error transport, bounded caller migrations, locale/plural/RTL acceptance. 207 no longer blocks the catalog contract; command/settings metadata coordinates with 206.                                           |
| Unified workspace    | [209](plans/209-unified-workspace.md)                                                                                                                                                | Design review any time                                                                        | Resolve D1–D6 before affected units. Production implementation needs a separate owner decision. Uses 206 commands, 200 content ownership and 208 catalogs.                                                                                                   |

Work that can start without waiting for another program: 114, 126's server and provider proofs,
204/205 producer prep, 202's local controls, 198's acceptance proofs, 200's baseline
research and 209's design review. Bounded product lanes continue beside them: Markdown authoring
in 111/108 before 171's composer swap (parser work in 176/189), measured typing in 201, tree
slices in 178 and Ghostty's [281](plans/281-ghostty-benchmarks-and-positioning.md) benchmarks and
positioning plus [283](plans/283-ghostty-output-and-input-latency.md) output CPU and input latency,
and its site in [285](plans/285-ghostty-site-first-frame-and-real-shell.md), done 2026-10-02: a DOM
renderer, the first frame server-rendered into the HTML, a real shell demo (the benchmarks section
waits on 283).
Each keeps its existing evidence and execution gates. Native stays editor-first; 088 follows 087.

## Package cutover delivered

This is separate from the foundations wave and from the product programs above.
[207](plans/207-one-repo-with-mirrors.md) delivered source migration on 2026-09-30.
The scoped cutover hold has ended. Develop Editor in `editor/packages/`, Ghostty in
`ghostty-webgpu/`, and hotkeys in `hotkeys/`; their standalone repositories are mirrors.
npm authentication, initial publication and trusted-publisher setup remain deferred.
Before 204/205 mirror a consumer of hotkeys, prove standalone installation and satisfy
207's required hotkeys publication gate. Old checkouts remain untouched references.

## Wave 2 closeout and dependency order

[132](plans/132-process-and-dev-ownership.md) delivered development ownership closeout on
2026-09-30: standard Vite updates, unified typechecks, cold-cache proof and explicit terminal
capture ownership. Its Mac vibrancy checks are owned by 114 Gate 3. Main `3ca862a4b` later
removed the remaining app-save hot-update interception.

The owner's closeout queue was **179 → 099 → 114 → 126 → 156**. 179 and 099 unit 1 are delivered;
099 unit 0 closed out as partial in PR #224, with its unfinished calibration superseded by 282.
**114 → 126** remains the default work order, not a chain of prerequisites. 156 P0–P2
delivered 2026-10-02 (#269/#280/#286); the whole plan remains open for Approved P3+ work.
Independent work can move earlier. See the
[remaining phase checklist](docs/next-wave.md#wave-2-closeout-reconciled-2026-09-28).

| Work                                                               | Dependency that matters                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [179: content isolation](plans/179-isolating-foreign-content.md)   | Delivered in PR #204. Its isolation policy applies to 156.                                                                                                                                                          |
| [099: document contributions](plans/099-document-contributions.md) | Unit 1 publication, with 198's retained-analysis subscriber, is delivered in PR #203. Unit 0 is partial (5/10); 282 replaces the unfinished calibration. Units 2–7 retain their explicit gate.                      |
| [114: desktop shell](plans/114-polaron-shell.md)                   | Preserve mesh-owned servers and terminals. Native host checks precede Electrobun removal.                                                                                                                           |
| [126: T3 alignment](plans/126-t3code-alignment.md)                 | Bounded proofs shipped in PR #210; the row ledger stays open. Desktop host cases consume 114; independent chat/provider/server proofs can run earlier.                                                              |
| [156: rich documents](plans/156-documents-in-the-editor.md)        | P0–P2 delivered 2026-10-02 (#269/#280/#286), using existing file/buffer identity and 179 isolation. P3 projection diffs/binary restore and later Office viewing/editing remain Approved follow-up with their gates. |

This queue does not certify other plans as complete or authorize gated implementation, account
spending, or state deletion. Their explicit decisions remain in the owning plans.

## Document and editor dependencies

The owner removed the fixed “198 first after wave 2” priority on 2026-09-28. Schedule by the
contracts a consumer needs:

- [198](plans/198-document-owned-editor-analysis.md)'s publication, range/configuration
  admission, cancellation and retention contracts are proved (PR #203), and its subscriber
  consumes 099 unit 1's frames. Its browser/memory acceptance matrix remains. No second
  analysis owner.
- [197](plans/197-editor-highlighting-service.md) is delivered (PR #202): Editor owns standalone
  highlighting and prepared diff syntax. It is independent of 198's retained-view lifetime.
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
  they do not introduce a second one. Editor source is canonical in `editor/packages/` after 207.
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

[207: one repo with mirrors](plans/207-one-repo-with-mirrors.md) delivered the Editor and
ghostty-webgpu source move and verified all three public mirrors, including `hotkeys/`.
204 and 205 now land in Fregat; their standalone hotkeys dependency retains 207's publication gate.

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
for implementation; its design work can proceed alongside closeout work.

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
- The [native client roadmap](plans/native-plan-of-plans.md) owns Swift work. The TUI designs its
  own terminal UX; web parity items wait where the TUI redesign requires it.
- Editor's [backlog](plans/editor-backlog.md) and Ghostty's plans share Fregat's root `plans/`.
  Paired changes land with their Platform integration and CI ref. Verify current package gates before scheduling from historical numbers.
- [183](plans/183-claude-ide-in-terminals.md) remains low priority. DOCX editing retains its
  Markdown/fidelity gate in 156. The `/platform` prefix removal remains deferred on mesh naming.

## Keeping this roadmap useful

Keep only current order and cross-plan dependencies here. Update a plan's own status when work
lands. Retire completed plans after preserving current contracts and updating their backlinks;
git history keeps the original plan and evidence. Historical wave coordination is linked from
[the wave record](docs/next-wave.md); it does not override current repository instructions.
