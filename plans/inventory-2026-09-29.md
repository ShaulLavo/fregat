# Plan inventory and execution order — 2026-09-29

Status: Approved planning work, requested by the owner. This run inventories and
reconciles plans and merges reviewed planning PRs. It does not execute the product
projects. [PLAN.md](../PLAN.md) owns the current order; individual plans own scope,
authorization and acceptance. Sizes are estimates of remaining work: S hours, M about
a day, L several days, XL a program. Recorded delivery requires current evidence
before retirement; this audit does not certify every feature or production release.

Inspected Fregat through `f01c4bb91`, including merged hotkeys PR 197 and TUI PR 198;
Editor main plus the E056 reconciliation of PR 20; Ghostty's active plan index; parser
and TUI companion PR diffs; the native client roadmap. Recheck heads before execution.

## Run checklist

- [x] Inventory all numbered Fregat plans and cross-project execution owners.
- [x] Check every open PR under ShaulLavo, including unrelated repos and drafts.
- [x] Merge the four connected TUI ownership updates after reviewing their diffs/checks.
- [x] Repair the workspace plan number/formatting/conflicts and merge PR 195 as plan 209.
- [x] Repair and merge Editor PR 20 as E056, preserving completed E047 and its parked status.
- [x] Reconcile dependency conflicts and write the execution order in PLAN.md.
- [x] Verify document format, links, coverage and diff; commit by path and push.

## What the mountain contains

Fregat has 55 numbered plan files after 209. They include implementation programs,
research, delivered work awaiting checks and historical alternatives. They are not
55 equally ready projects. Strong delivery/retirement candidates are 110, 112, 145,
180, 181, 182 and 203. Conditional closeout candidates include 141, 147, 166, 169,
174, 177, 184, 191 and 192. Preserve residual work, owner/device checks and incoming
contracts before retiring anything. No plan was deleted in this inventory run.

Editor main's ledger before PR 20 contains 59 entries: 42 Completed, two Moved,
12 Approved and three In progress. E056 adds the parked portability program after
reconciliation. E011 and E023 are parked; E015, E052 and E058 need reconciliation
with recorded delivered large-file, wrap and spellcheck work. Ghostty has one active
milestone, 016; 009–015 are superseded, deferred or retired. Native has an editor-first
roadmap, not a finished native editor established by its benchmark/design spike.

## Immediate order and the freeze

1. Finish 207's source import and mirror proof. Settle or park sibling PRs, refresh the
   rehearsal against final heads and coordinate the owner/session write hold.
2. Reconcile delivered residues and run the existing narrow closeout queue:
   132 → 179 → 099 units 0–1 → 114 → 126 → 156 P0–P2. Independent proof work can start now.
3. Prepare 204/205 together, then complete 206 adoption and old-API deletion as one
   verified consumer cutover. 203 already landed.
4. Prove 198's landed lifetime/acquisition contracts with 099 publication; implement
   197 independently; then migrate 200 against the exact contracts it uses.
5. Finish bounded product lanes: Markdown authoring before composer replacement;
   app-local TUI controls with parser-gated Markdown; measured typing and tree slices;
   Ghostty standalone readiness. Avoid opening all architectural programs at once.
6. Run 208 by catalog, transport, domain migration and locale units. Keep 209's design
   gates, native's core/transport gates and 087 → 088 interoperability gates explicit.

No active global code freeze was confirmed. 207 requires a scoped write hold in Editor
and ghostty from final-head capture through first verified mirror push. Release it
when Fregat is canonical. Audit/docs, read-only measurements, independent Platform
closeout, local TUI work and localization design can continue. Package/CI layout and
sibling API migrations wait for canonical locations. npm bootstrap is separate from
source import; force-push and checkout deletion retain explicit owner gates.

## Conflicts resolved and remaining handoffs

| Finding                                          | Evidence and consequence                                                                                                        | Resolution / required proof                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TUI toolkit ownership changed                    | Old 202/root roadmap scheduled a separate bubli fork/toolkit. PRs Fregat 198/parser7/Editor66/bubli 3 change that decision.     | Merged all four. Local UI lives in Fregat on upstream OpenTUI; retain parser semantic, streaming, packaged-runtime and React lifecycle gates. Existing fork overrides remain until verified replacement. |
| Workspace plan reused 202                        | PR195 added another 202 and failed docs format.                                                                                 | Renumbered 209, merged current main, formatted and passed CI. Approved design review retains D1–D6 and separate production implementation authorization.                                                 |
| Portability plan reused E047                     | Editor already completed E047 point queries; PR20 still used that number and conflicted with the ledger.                        | Reconcile to reserved E056, preserve all existing ledger entries and park the program. Keep 207 canonical-source and native/JS boundaries explicit.                                                      |
| Keymap producer deletion preceded callers        | 204 offered sibling/additive implementation but deleted exports still imported by web/TUI; root order requires207 first.        | 204/205 now require canonical Fregat paths. Coordinate all consumer migrations and old API removal with 206 in one verified cutover.                                                                     |
| 206 expected a nonexistent library report        | 203 explicitly moved shadow-report construction to Platform using `bindingsForInput`.                                           | Updated 206 to own the report and Settings presentation. E026's remaining command metadata must keep chords in packs/presets.                                                                            |
| Exact mirrors need cross-family dependency proof | 207 mirrors folders exactly; `workspace:*` rewriting at npm publish does not make a mirror resolve an absent hotkeys workspace. | Added clean standalone-folder install/build proof and release ordering before dependent mirror commits. Select the manifest arrangement during207; do not assume source import proves publishing.        |
| Composer scheduled before authoring primitives   | 111's historical phase list put composer before block widgets; 171 now explicitly requires authoring acceptance first.          | Updated111: range/block work feeds108/171 authoring, then composer migration, then Lexical deletion. Preserve wrap/spellcheck gates.                                                                     |
| Search alternatives looked active                | 182 selected recycled editors and recorded pool/cap fixes, while200 still called its decisions unresolved.                      | Updated182's current direction,200's boundary and root roadmap. One-editor/multibuffer alternatives remain unscheduled.                                                                                  |
| Delivered plans still looked unstarted           | 180's header left phase 5 next despite its delivery record; 203's steps are complete.                                           | Updated these headers to recorded/implemented delivery. Other candidates remain visible for evidence-backed closeout.                                                                                    |
| Localization lacked delivery units               | 208 spans every client/package, error transport, metadata and RTL.                                                              | Root roadmap sequences catalog/package contract, error transport, bounded migrations and locale acceptance. Establish catalog ownership after 207; coordinate commands/settings with 206.                |

## Fregat inventory

This table is a dated remaining-work snapshot. The linked plan overrides it when updated.

| Plan                                         | Remaining deliverable / readiness                                               | Dependencies or gates                                                                            | Size                         |
| -------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------- |
| [087](087-stateless-mcp.md)                  | Native MCP provider proof and M4; M0/M1 recorded built                          | Only M0 approved in its decision; reconcile recorded M1 delivery before further execution        | M                            |
| [088](088-native-code-intelligence.md)       | Semantic retrieval, edits/refactors, knowledge and debugging; unstarted program | Native087 interoperability; document/mutation ownership                                          | XL                           |
| [099](099-document-contributions.md)         | Refresh baseline and canonical publication (units 0–1)                          | Include 198 subscriber; units 2–7 remain gated                                                   | M–L now; XL total            |
| [108](108-markdown-modes.md)                 | Visual/source-revealing authoring and block widgets                             | 111 layout and176 semantics; independent style/pane settings delivered                           | L                            |
| [110](110-workspace-indexing.md)             | Research complete; preserve decision record before retirement                   | Census belongs to170                                                                             | S closeout                   |
| [111](111-editor-decorations.md)             | Mapped ranges and block widgets; phase 1 delivered                              | Feed 108/171 authoring before composer swap                                                      | L                            |
| [112](112-large-file-ceiling.md)             | All five phases recorded shipped                                                | Preserve ceiling contracts; analysis-on typing belongs to 201                                    | S closeout                   |
| [114](114-installed-app.md)                  | Desktop host gates 1–4 after prototypes                                         | 132 plumbing; native/macOS proof before Electrobun deletion                                      | L                            |
| [122](122-composable-plugins.md)             | Input classification, Platform attachment/commands, document scope and loader   | 099 publication/runtime for document scope; do not repeat Editor phases 1–5                      | XL                           |
| [126](126-t3code-alignment.md)               | Lifecycle/provider/protocol proofs and residual behavior                        | Desktop cases use114; account/schema gates remain                                                | XL; small proof slices first |
| [132](132-process-and-dev-ownership.md)      | Typecheck/HMR disposal/filtering and cold-start/memory proof                    | Schema collapse delivered; no repeated reset; before 114 cutover                                 | M                            |
| [139](139-acting-on-agent-diffs.md)          | Comment re-anchoring plus owner acceptance                                      | Hunk actions/review drafts landed; 169 owns review mode                                          | M                            |
| [140](140-editor-agent-advantage.md)         | Codex hook proof/integration and later symbol steering                          | Claude handoff/diagnostics recorded; symbol work follows 088                                     | M now                        |
| [141](141-usage-and-rate-limits.md)          | Live redemption acceptance                                                      | Owner account-resource check; implementation recorded complete                                   | S proof                      |
| [143](143-phone-layout.md)                   | Real-device and follow-up release checks                                        | iPhone/Android toolbar, keyboard, safe areas                                                     | M proof                      |
| [144](144-unattended-agent-work.md)          | Cross-harness agent tools; reconcile delivered phases 1–3                       | 087 M1+ authorization and agent-control contracts                                                | L                            |
| [145](145-harness-controls.md)               | Reconcile directly owned completed subplans                                     | Compact delegated to126; preserve that obligation                                                | S closeout                   |
| [147](147-log-hygiene-and-noise-gate.md)     | Post-deploy 24h noise census                                                    | Implementation recorded done; owner closeout remains                                             | S proof                      |
| [155](155-site-demo-replica.md)              | Replica stage/replay/agent section                                              | Phone demo follows143; lower priority                                                            | M–L                          |
| [156](156-documents-in-the-editor.md)        | Binary guard, PDF and CSV first; Office/editing later                           | 179 isolation; PPTX/XLSX/DOCX fidelity and authoring gates                                       | M–L now; XL total            |
| [166](166-bare-function-keys.md)             | Preserve/test bare-function-key contract                                        | Backlink to retired166 plan needs reconciliation; 206 keeps behavior                             | S                            |
| [169](169-agent-review-mode.md)              | Owner review and native `review/start` disposition                              | Native method remains unimplemented; do not silently drop it                                     | S–M                          |
| [170](170-language-census.md)                | Remaining production-byte/worker-busy/reference measurements                    | Phases1–4 recorded done; 197 later owns warm-up                                                  | M proof                      |
| [171](171-composer-on-our-editor.md)         | Authoring acceptance, composer/mentions/paste and Lexical removal               | 111/108 authoring first; wrap/spellcheck recorded landed                                         | L                            |
| [172](172-shared-undo-stack.md)              | Reconcile core/adapter extraction and remaining notices                         | Web routing delivered; TUI correction follows 202 redesign                                       | M                            |
| [174](174-external-mcp-servers.md)           | Reconcile live/OAuth acceptance and retirement                                  | Phases1–6 recorded landed; no second MCP manager                                                 | S–M proof                    |
| [176](176-markdown-parser.md)                | Remaining rendered-consumer migration                                           | Recheck current producer/package/streaming evidence; initial Editor integration exists           | L                            |
| [177](177-prefetch-every-press.md)           | Measure conditional chat-detail lease                                           | Only implement if production firstSnapshotMs p90 exceeds 50ms; 197 owns syntax warm-up           | S                            |
| [178](178-tree-in-the-app.md)                | Remaining app-state/row/chrome/virtualization/selection/DnD slices              | Subplans own accurate status; 181 baseline; serialize shared row edits                           | XL                           |
| [179](179-isolating-foreign-content.md)      | Instruments, Mermaid/CSS and final policy                                       | Measure before claims; 156 consumes policy; editor shadow root declined                          | M–L                          |
| [180](180-file-icon-variants.md)             | Reconcile phase 1–5 release evidence before retirement                          | Tree icon adoption separately belongs to178                                                      | S closeout                   |
| [181](181-chat-timeline-end-anchoring.md)    | Reconcile implementation/review release evidence                                | Supplies178 virtualization baseline                                                              | S closeout                   |
| [182](182-search-view-rendering.md)          | Selected recycled-editor acceptance and residual measured costs                 | Pool/cap recorded delivered; alternative rewrite unscheduled                                     | S–M closeout                 |
| [183](183-claude-ide-in-terminals.md)        | Low-priority placeholder/protocol scope                                         | Explicitly no implementation authorization                                                       | L later                      |
| [184](184-dependency-diet.md)                | Current merge/deploy/platform acceptance                                        | Eight slices recorded implemented; preserve web push                                             | S–M proof                    |
| [186](186-pull-request-sync-rate.md)         | Off switch, state-aware polling/backoff and rate limits                         | Existing 126 PR-sync ownership                                                                   | M                            |
| [187](187-setup-scripts-in-terminals.md)     | Visible PTY setup execution/completion                                          | Terminal host; retain turn/cancel/retry gates                                                    | M                            |
| [189](189-tree-sitter-md-improvement.md)     | Correctness/extensions, memory/bundle and speed ratchets                        | Reconcile newer producer evidence before repeating historical release failures                   | XL ongoing                   |
| [190](190-faster-ci.md)                      | Lint profiling and Editor CI residuals                                          | Rebase split-repo mechanics after 207; cache/runner gates                                        | M                            |
| [191](191-file-picker-polish.md)             | Reconcile deployed routes and acceptance                                        | Header disagrees on web/server deploy; inspect actual release                                    | S proof                      |
| [192](192-no-swap-flash.md)                  | Classify remaining chat rows/intentional immediacy                              | Most rows recorded fixed; preserve whole-subject contract                                        | S–M                          |
| [195](195-settings-defaults-browser.md)      | Registry Defaults UI/JSON view                                                  | Independent Settings feature; preserve focus/held-state fixes                                    | M                            |
| [196](196-shared-control-polish.md)          | Sliders/switches/triggers and toolbar-toggle assessment                         | Independent shared UI; reconcile concurrent appearance work                                      | M                            |
| [197](197-editor-highlighting-service.md)    | Highlight/diff service and bounded consumer migration                           | Independent198 lifetime; canonical package paths after 207                                       | L                            |
| [198][198-document-owned-editor-analysis-md] | Acquisition/admission/cancel/retention/attachment proofs and gaps               | Landed analysis owner; coordinate 099 publication                                                | L                            |
| [200][200-document-backed-content-views-md]  | Comparison/conflict/preview acquisition migration                               | Exact099/198 contracts; 197 diff service; baseline can start earlier                             | L                            |
| [201](201-cheap-overlay-marks.md)            | Calibrated overlay/diagnostic fast path and tier remeasurement                  | Measure before optimizing; LSP/highlighter policy decisions remain                               | L                            |
| [202](202-tui-ui.md)                         | Upstream resolution, local controls/Markdown/workbench                          | Parser semantic/stream/package gates; 206 dispatch; no toolkit release                           | XL                           |
| [203](203-fregat-hotkeys.md)                 | Library landed in PR197; consumers/publication elsewhere                        | 204–206 integration; 207 mirrors/releases                                                        | S closeout                   |
| [204](204-editor-on-fregat-hotkeys.md)       | Editor nodes, standalone packs and coordinated old-API removal                  | 203 delivered; 207 source move; 206 consumer cutover                                             | M–L                          |
| [205](205-ghostty-on-fregat-hotkeys.md)      | Terminal nodes, standalone/shell packs                                          | 203 delivered; 207 source move; 206 hosted adoption                                              | M                            |
| [206](206-platform-one-keymap.md)            | Presets/focus/overrides/report/raw handlers/TUI matcher                         | 204/205 integration; Platform constructs report                                                  | L                            |
| [207](207-one-repo-with-mirrors.md)          | Import/tooling/CI/mirrors and publishing                                        | Scoped owner session hold; final heads; standalone deps; npm bootstrap; no unapproved force-push | L                            |
| [208](208-all-text-in-json.md)               | Catalogs/generation/error transport/extraction/locales                          | Package ownership after 207; metadata coordination206; native adapter proof                      | XL in units                  |
| [209](209-unified-workspace.md)              | Approved design review of unified workspace                                     | D1–D6 and separate production authorization; 206/200 ownership                                   | L after design               |

## Package and client follow-through

| Owner                         | Current remaining scope                                                | Scheduling decision                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Editor E011/E023              | Packed-piece representation and instrumentation panel                  | Parked. E011 only rises when measured piece memory dominates.                                       |
| Editor E014/E016              | Parallel snapshot search and bounded structural parsing                | Measure current immutable-source/worker behavior first; coordinate 099/198; no assumed SAB rewrite. |
| Editor E015/E052/E058         | Massive-file/wrap/spellcheck ledger residues                           | Reconcile112/171 delivery and exact remaining checks before new implementation.                     |
| Editor E021/E024              | Styled clipboard and syntax-tree inspector                             | Bounded independent package work after canonical source exists.                                     |
| Editor E025/E027/E029         | Runtime plugins, hook contract and runtime/serialized boundaries       | Finish contracts; E025 follows E026/E027/E028; align 122 contribution ownership.                    |
| Editor E026                   | Remaining contributed-command catalog exposure                         | Finish with 204/206; metadata owns command semantics, packs/presets own chords.                     |
| Editor E056                   | Platform-agnostic/Strict DOM portability                               | Approved, parked. Preserve current DOM product and native gates; follow207 canonical source.        |
| Editor E063/E064              | Query features and one highlight pipeline                              | Coordinate197/201 shared files; measure analysis, overlay and paint separately.                     |
| Ghostty 016                   | Standalone replacement-readiness fixtures and package/browser evidence | Active sole milestone; 205 handles input migration; historical009–015 add no automatic queue.       |
| tree-sitter-md semantic M0–M4 | Semantic/source/profile/stream/package producer                        | M1 enables consumer prototypes; production cutover requires relevant M1–M4 proof.                   |
| Editor semantic S0–S4         | Existing Markdown consumer/worker/package/performance                  | Consume agreed parser contract; no terminal toolkit/browser UI prerequisite.                        |
| Native client                 | Core editor/bench,typed REST+WS,Tree-sitter/LSP,then shell             | Editor-first gates remain; Mac evidence cannot be obtained on this Linux host.                      |

## PR inventory and merge record

All 13 open PRs returned by the owner-wide GitHub query were inspected on September 29.
The owner selected “Merge plan updates; inventory other PRs.” No implementation PR was
merged by this run. Green checks below are the PR head checks; planning merges do not
certify their future runtime acceptance.

| Repository / PR                                                        | Disposition                           | Evidence / remaining action                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [Fregat 198](https://github.com/ShaulLavo/fregat/pull/198)             | Merged                                | Seven Markdown paths; Docs format/final CI passed; local upstream TUI ownership.                                                               |
| [tree-sitter-md 7](https://github.com/ShaulLavo/tree-sitter-md/pull/7) | Merged                                | Producer scope preserved; both check jobs passed.                                                                                              |
| [Singapore 66](https://github.com/ShaulLavo/singapore/pull/66)         | Merged                                | Consumer scope preserved; health/final CI passed.                                                                                              |
| [bubli 3](https://github.com/ShaulLavo/bubli/pull/3)                   | Merged                                | Documentation-only retirement of toolkit workstream; no CI configured; no repo/assets deleted.                                                 |
| [Fregat 195](https://github.com/ShaulLavo/fregat/pull/195)             | Merged after repair                   | Renumbered 209; conflicts resolved; Docs format/final CI passed at `caabf3abe`.                                                                |
| [Singapore 20](https://github.com/ShaulLavo/singapore/pull/20)         | Merged after repair                   | Renumbered E056; all prior ledger entries preserved; health/typecheck/core/package/final CI passed at `6befc7f9`. Approved, parked.            |
| [Singapore 65](https://github.com/ShaulLavo/singapore/pull/65)         | Left open: runtime update             | tree-sitter-x bump to `ba4f1d2`; mergeable but unstable/no reported head checks at inspection. Validate package/worker assets before adoption. |
| [fast-ulid 1](https://github.com/ShaulLavo/fast-ulid/pull/1)           | Left open: implementation             | Mergeable; no reported checks. Review timestamp/error/runtime guarantees in its project.                                                       |
| [dnd-kit 1](https://github.com/ShaulLavo/dnd-kit/pull/1)               | Left open: draft implementation       | Solid2 adapter/store migration; no reported checks; requires its own compatibility review.                                                     |
| [bot 85](https://github.com/ShaulLavo/bot/pull/85)                     | Left open: implementation             | Rust speech-to-text feature; mergeable; only reported check skipped.                                                                           |
| [bot 84](https://github.com/ShaulLavo/bot/pull/84)                     | Left open: conflicting implementation | Brave search/setup feature; resolve conflicts and verify in its project.                                                                       |
| [polymarket-bot 5](https://github.com/ShaulLavo/polymarket-bot/pull/5) | Left open: blocked implementation     | TA infrastructure; successful and cancelled test records coexist; GitHub reports blocked.                                                      |
| [sqlite-sync 4](https://github.com/ShaulLavo/sqlite-sync/pull/4)       | Left open: implementation             | Server/sync/schema changes include tracked `local.db`; no reported checks; needs current project validation.                                   |

## Verification

- Inventory coverage: all 55 numbered Fregat plan files are linked exactly once.
- Roadmap/index/inventory local links resolve; changed documents pass repository oxfmt.
- `git diff --check`, `bun run gates` and `bun run typecheck` pass against current main.
- An independent read-only review checked ordering, scope, retained authorization gates,
  search direction, producer deletion and mirror dependency proof.
- Planning PR checks are recorded above. No application source or manifest was changed
  by this run. Browser scenarios and runtime deployment were skipped because the changes
  are planning documents; physical-device and product acceptance remain future work.

## Limits and decisions retained

No general source-code defect audit, product implementation, fresh performance benchmark,
paid-agent/account action, physical phone/macOS check or sibling-session coordination was
performed. Live owner-wide searches covered open PRs; closed PR history was consulted only
where current plans referenced delivery. Historical parser scores (including older failure
notes) remain dated evidence until producer artifacts are checked; 676/676 normalized cases
alone do not prove semantic rendering parity. Retiring completed plans, deleting kept data,
force-pushing mirrors and starting explicitly gated phases were outside this run.

[198-document-owned-editor-analysis-md]: https://github.com/ShaulLavo/fregat/blob/c01c490faa37ab9a100613389c9c2a6175c7b5a3/plans/198-document-owned-editor-analysis.md
[200-document-backed-content-views-md]: https://github.com/ShaulLavo/fregat/blob/d297a23a7cfb9d7782fb74775caf22d3b9bc2f37/plans/200-document-backed-content-views.md
