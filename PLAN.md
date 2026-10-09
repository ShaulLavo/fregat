# Execution roadmap

Updated 2026-10-06. This file owns cross-project ordering. Each [plan](plans/README.md)
owns its scope, decisions, status and acceptance checks. [AGENTS.md](AGENTS.md) owns execution
rules; [docs](docs/README.md) holds architecture, research and delivery evidence.

## Shared planning home

All package and client plans live in the root [plans/](plans/README.md) folder.
This roadmap schedules Fregat, Editor, Ghostty, hotkeys and native-client work together.
The [Editor inventory](plans/editor-backlog.md) preserves E-numbered scopes, dependencies,
completed references and the [original wishlist](plans/editor-wishlist.md).
The [native work breakdown](plans/native-plan-of-plans.md) retains its editor-first gates.
Package roadmap files link here. Create and update plans in root `plans/`.

## Reading the roadmap

Use this file to choose what runs next. The [plan index](plans/README.md) includes every
top-level plan and links package inventories and supporting records. Each owning plan keeps
its implementation checklist and acceptance gates. The [wave register](plans/waves.md) preserves
the large batches, their original membership and the plans carrying their remaining work.
An added plan joins this roadmap and the index.

The current queue below schedules closeout and the next Approved programs. Independent bounded work
can run beside it. Approved work scheduled later stays in the backlog, including native,
virtualization, async runtime, PR previews and agent UI tools. Historical parity waves retain
their scopes; newer owner decisions in the linked plans govern changed boundaries.

## Current execution order

The [October 2 issue triage](plans/issue-triage-2026-10-02.md) delivered its small confirmed
fixes. The approved [October 3 plan conversion](plans/issue-plan-conversion-2026-10-03.md)
transfers wanted larger scopes into Plans 290–318. Source issues close after published plan
links carry their remaining work. Reproduction and benchmark investigations stay in the next
review pass. The [remaining-issue pass](plans/remaining-issues-resolution-2026-10-03.md)
then closed nine reports and retained eight investigations with their missing evidence.
Use that newer record for their disposition, including the outstanding safe gateway reload
receipt; Plan 308's cut-over must account for it. Preserve the dependency gates and explicit
deferrals below.

The [September 29 inventory](plans/inventory-2026-09-29.md) reconciles the remaining
work across Fregat, Editor, Ghostty, the parser and native clients. It is a dated
snapshot; this file remains the scheduler and each plan remains its scope authority.

1. **The foundations wave is closed.** 132, 179, 197, 099 unit 1, 198's foundation contracts
   and 126's bounded proofs are delivered. Worker cleanup, exact typing/Undo restoration,
   browser health, long-line fallback and offset repairs have landed. PR #224 records 099
   unit 0 as partial: 5/10 configurations calibrated. [282](plans/282-fast-paired-input-latency-check.md)
   supersedes the unfinished absolute-threshold calibration. The owner approved units 2–7 on
   2026-10-04; their runtime implementation merged in PR #787 with accepted scoped performance
   and host proof. The owner's web release is installed and read-only live-verified on October 6. The
   [wave record](docs/next-wave.md#foundations-wave-2026-09-30) records delivery, the served
   release and remaining follow-ups. Closure authorizes no additional work.
2. **126's finite closeout is complete.** Its bounded Wave 2 scope
   closed on 2026-10-02. The [finite pass](plans/126-t3code-alignment/finite-closeout-2026-10-03.md)
   reconciles stale ledger rows, records the monitoring/draft fixture check, and places
   larger follow-ons separately. It does not require completion of the whole alignment program.
   114 Gates 1–4 closed on 2026-10-03
   after approved owner Mac acceptance and old-shell removal. 156 P0–P2 delivered 2026-10-02
   (#269/#280/#286); its Approved P3+ follow-ups retain their gates. This is a default work
   order, not a chain of prerequisites; [the closeout table](#wave-2-closeout-and-dependency-order)
   names the dependencies that matter.
3. **The keymap cutover (204 + 205 → 206) is delivered in PR #603**, with the installed release
   and live verification recorded in the [delivery record](docs/keymap/command-foundation-delivery.md).
   The document runtime's 099 units 2–7 are delivered in PR #787, installed and live-verified;
   [099's delivery checkpoint](plans/099-document-contributions.md#delivery-checkpoint-2026-10-06)
   preserves the exact release and evidence limits. Localization and workspace implementation
   follow as broad migrations.
   The [next programs](#next-programs) table gives each program's gates and what can start now.

The default is one active structural cutover plus independent closeout/proof work. This order
schedules Approved work; it does not expand any plan's authorization.

### Upcoming delivery waves

The owner requested cleanup before starting the next wave on 2026-10-03. The
[readiness review](plans/wave-readiness-2026-10-03.md) records dependency and overlap decisions.
This pass updates planning; product implementation starts through each plan's existing gates.

| Wave                | Bounded scope and finish line                                                                                                                                                                 | Entry conditions                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preparation         | Reconcile launch handoffs, delivered contracts, terminal input ownership and shared-file owners. Preserve deferred work and owner-only checks separately.                                     | Current documentation pass; qualify required runtime/package proofs when the implementation wave starts.                                                                                                |
| Command foundation  | 204 + 205 → 206 merged in PR #603; caller migration, old API removal and exact standalone qualification are complete. Installed release and live verification passed.                         | Exact standalone family gate qualified under 207; npm stays deferred. Finite main-host input coexists with public 286/287 contracts; their whole programs remain independent.                           |
| Document foundation | 099 runtime merged in PR #787, installed and read-only live-verified. Each 200 consumer uses its exact 099/198 acquisition and attachment contract; 198 keeps its remaining acceptance scope. | 099 units 2–7 have accepted scoped performance, source/lifetime and host proof. Owner-instance web delivery is complete. Historical unit 0 stays partial; independent 198/200 work keeps its own gates. |
| Feature batches     | Deliver coherent interaction/editor, navigation/save/search, excerpt/review, Git, terminal, chat and Markdown/document slices in their declared dependency order.                             | Use 206 commands and the exact content contracts each slice needs. Pane/layout changes require the relevant 209 decisions and authorized delivered hosts; preserve TUI/parser/device gates.             |
| Broad migrations    | Localize consumers under 208's catalog/error contract, then separately authorized 209 workspace units.                                                                                        | Catalog and design preparation may run earlier. Complete-client translation and the whole workspace redesign are not prerequisites for every feature batch.                                             |

After 126's finite reconciliation, its named provider/forge/host follow-ons and Mesh
correctness/access work can proceed where owners and files do not overlap. An owner-only
account/device check stays visible without holding unrelated engineering delivery. Existing
terminal 286/287 work continues with its owners.

Before launching each wave, name its exact units, owners, shared paths, required receipts,
acceptance cases and exclusions in the owning plans. Fix the scope at launch; new wanted work
joins a later batch unless it fixes a blocker. Ship verified units throughout the wave.

### Placement of the large additions

| Program                         | Placement and reason                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 335 stroke icons                | Give the broad swap a separate structural window after keymap and before broad new UI batches. Registry/mapping preparation can run earlier. It touches keymap icon types and build configuration; packs remain later.  |
| 320 compile-time data           | G0 compatibility/invalidation proof is independent preparation. Run only qualified defaults/theme/bidi/search units in bounded build windows; coordinate build and lockfile edits. No demonstrated keymap prerequisite. |
| 172 shared undo                 | Contract/core/session units can follow keymap as a bounded extraction. Coordinate workspace unit 4 with document/transaction owners. Preserve the Editor undo graph and server journal; no async-runtime prerequisite.  |
| 328–334 async runtime           | Approved and deferred. Qualify one runtime and one consumer when started, then adopt beneath stable domain APIs. It does not block keymap or document contracts; current terminal ownership stays in 286/287.           |
| 327 virtualization              | Approved and deferred. Start with its fresh baseline and required CSV two-axis geometry when scheduled; tune editor/search/shared lists only with attributed evidence. Optional engine replacement is separate.         |
| 293/294 Mesh durable scheduling | Independent infrastructure program. Ship 295's manual collector first; recurring coordinated execution waits for durable/quorum/failover guarantees.                                                                    |

Other deferrals retain their owning boundaries: 288 PR previews, 319 agent UI tools, icon packs,
stopped parser work, DOCX editing and the native Swift editor-first gate. A program's size is a
reason to split its delivery; dependency evidence determines whether its foundation moves earlier.

## Approved issue work

The October 3 plans retain the existing structural-cutover limit. Mesh and application bug
work can proceed independently where their files and contracts do not overlap.

1. Address Mesh control authorization in [290](plans/290-mesh-device-authorization.md).
   Public app removal and pill extraction [291](plans/291-mesh-private-services.md) is separate.
   Update recovery [296](plans/296-mesh-update-recovery.md), installer guidance
   [297](plans/297-mesh-installer-path.md), DNS recovery
   [298](plans/298-mesh-download-dns-recovery.md), and session removal
   [299](plans/299-mesh-session-removal.md) can start in parallel.
   Machine identity [300](plans/300-mesh-machine-identity.md), owner-authorized GUI inspection
   [301](plans/301-mesh-gui-inspection.md), and private app inspection
   [302](plans/302-mesh-private-app-observability.md) follow their authentication and routing gates.
   ZeroTier [292](plans/292-mesh-zerotier.md) waits for working enrollment and revocation.
2. Preserve shipped spellcheck hardening through [303](plans/303-spellcheck-correctness.md).
   Incremental underline work [304](plans/304-spellcheck-rendering-cost.md) uses Plan 201's
   shared renderer. Language support [305](plans/305-spellcheck-language-support.md) is independent.
   JSON worker syntax [306](plans/306-bun-json-worker.md), diff topology
   [307](plans/307-diff-row-topology.md), machine controls
   [318](plans/318-machine-connection-controls.md), and heavy root ownership
   [312](plans/312-heavy-slice-ownership.md) are bounded correctness units.
3. Build Fregat's bounded usage cache and Mesh feed with [308](plans/308-account-usage-feed.md), alongside
   transcript history [309](plans/309-account-usage-history.md) and allowance visibility
   [310](plans/310-allowance-visibility.md). Plan 308 owns the cache feed; Plan 289's gateway producer is retired from source. Retained gateway tooling is independently owned outside Fregat. The verified DROP source awaits root-only installation under `/work/cli-proxy-api/src`; bundle deployment is separate.
   Quiet admission [313](plans/313-heavy-quiet-lifecycle.md) and non-cache measurements
   [314](plans/314-heavy-non-cache-memory.md) share the heavy runner but keep separate receipts.
4. Build the ordinary issue collector [295](plans/295-cross-repository-issue-collection.md)
   for manual use before scheduler integration. Durable storage
   [293](plans/293-mesh-durable-job-state.md) precedes coordinated dispatch
   [294](plans/294-mesh-job-coordination.md). Schedule recurring collector execution after those guarantees pass; its usable manual command comes first.
5. Automatic placement [311](plans/311-automatic-machine-placement.md), design-first onboarding
   [315](plans/315-local-remote-onboarding.md), device pairing [337](plans/337-device-pairing.md), and session attention
   [316](plans/316-session-attention.md) follow their owning product and verification gates.
   Grammar re-pinning and held-out corpus [317](plans/317-tree-sitter-phase-two-prerequisites.md)
   remain Approved and deferred to Phase 2 preparation. They do not start the stopped parser wave.

## Next programs

[336](plans/336-packages-as-products.md) makes Fregat, Singapore, ghostty-webgpu and hotkeys
look like products: research, pitch with proof, READMEs, Astro sites on our own domains, docs,
a release cycle, and closing the issue backlog. It touches docs, sites and package metadata,
so it runs alongside product work; Track E waits for the owner's domains.
[338](plans/338-singapore-docs-load-speed.md) is Approved for the chosen Singapore
docs-in-editor site. Profile its startup first, then slim the entry, load grammars by page
and visible demand, and improve asset delivery alongside Plan 336's site implementation.
Worker/Markdown changes follow measured need; token reuse and visible-region takeover follow
correctness proofs and unmet load targets. Preserve Plan 336's accessibility and phone gates.
[339](plans/339-singapore-full-parse-speed.md) is Approved for full-document 10 MiB
syntax throughput. Qualify the complete-file baseline, then optimize query materialization
and structural traversal before parser/compiler experiments. Its target is a complete
parse and highlight within 2 seconds on the reference machine. Viewport-first and
incremental work follows that full-file gate; Plan 338's asset work can proceed alongside it.
[340](plans/340-singapore-site-embedding.md) is Approved for editor-produced Singapore
pages with document scrolling and matching static/live paint. Editor content-height,
wrap fixes and complete responsive snapshots ship in their own PRs before site integration.
This replaces the separate Node prerenderer and owns snapshot restore qualification;
Plan 338's asset work continues alongside it.

[335](plans/335-stroke-icons.md) retains the current stroke-icon migration, shared registry
and selected morph sites. Its broad swap takes the structural window after the keymap
cutover and before broad new UI batches; registry/mapping preparation can proceed earlier.
Its icon-pack phase is Approved and scheduled after those phases ship.

[320](plans/320-compile-time-data.md) is Approved for a compatibility proof followed by
settings defaults, bundled themes, Unicode bidi derivation and a settings search index.
Compare existing compile-time tools before migrating consumers; file icons remain a
conditional feasibility unit. This bounded build/data work can be researched independently,
with implementation scheduled after its tool, dependency-invalidation and package-consumer
proofs pass. Coordinate shared build-config edits with active package cutovers.

Each program groups Approved plans that share owners and gates. Grouping does not merge their
scopes into one package rewrite, lift a gate or approve gated units. Sizes are in the
[inventory](plans/inventory-2026-09-29.md); each plan keeps its own checklist.

| Program                 | Plans                                                                                                                                                                                | When                                                                                                                           | Gates and boundaries                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop app             | [114](plans/114-installed-app.md) Gates 1–4 delivered 2026-10-03                                                                                                                     | Closeout done after approved owner acceptance                                                                                  | Installed Chromium app and native system-webview host replace the old shell. Preserve mesh-owned servers and terminals; 132's transferred Mac vibrancy gate is accepted.                                              |
| T3 alignment follow-ons | [126](plans/126-t3code-alignment.md), with exact remaining units in the [finite reconciliation](plans/126-t3code-alignment/finite-closeout-2026-10-03.md)                            | Bounded Wave 2 scope is delivered. Provider/forge batches follow keymap; relevant contract research may proceed independently. | Preserve per-session/subproject state-loss gates, pairing re-authorization, live accounts, physical-device proofs and the frozen `7445aa73` oracle. No generic A–F/J closeout is queued.                              |
| Rich documents          | [156](plans/156-documents-in-the-editor.md) P0–P2 delivered 2026-10-02 (#269/#280/#286); P3+ Approved follow-up                                                                      | Wave 2 scope delivered; schedule follow-ups by format readiness                                                                | Uses existing file identity and 179's isolation policy. P3–P6 follow; P7 DOCX editing stays parked on Markdown and fidelity decisions.                                                                                |
| Keymap cutover          | [204](plans/204-editor-on-fregat-hotkeys.md) + [205](plans/205-ghostty-on-fregat-hotkeys.md) → [206](plans/206-platform-one-keymap.md); E026 metadata                                | Merged in PR #603; installed and live-verified                                                                                 | Caller migration, old API removal, shadow reporting and exact standalone qualification are merged; installed release and live verification passed. npm stays deferred. Zed/Vim 220–280 remain separate follow-ups.    |
| Document runtime        | [099](plans/099-document-contributions.md) units 2–7 and [198](plans/198-document-owned-editor-analysis.md) acceptance → [200](plans/200-document-backed-content-views.md) consumers | 099 delivery complete; 198 acceptance proofs and 200 baseline research remain independent                                      | 099 units 2–7 delivered in PR #787 with accepted scoped proof and installed web/live verification. 200 uses each exact 099/198 contract; 197's diff service is delivered. 122 follows 099; 182 and 171 stay separate. |
| TUI                     | [202](plans/202-tui-ui.md) on upstream OpenTUI                                                                                                                                       | Local controls any time                                                                                                        | Production Markdown cutover waits for the tree-sitter-md M1–M4 producer and Editor semantic S0–S4 consumer gates. Controls use 206's dispatcher. No toolkit package, maintained fork or native release pipeline.      |
| Localization            | [208](plans/208-all-text-in-json.md)                                                                                                                                                 | Broad migration, by unit                                                                                                       | Catalog and typed generation, then structured-error transport, bounded caller migrations, locale/plural/RTL acceptance. 207 no longer blocks the catalog contract; command/settings metadata coordinates with 206.    |
| Unified workspace       | [209](plans/209-unified-workspace.md)                                                                                                                                                | Design review any time                                                                                                         | Resolve D1–D6 before affected units. Production implementation needs a separate owner decision. Uses 206 commands, 200 content ownership and 208 catalogs.                                                            |
| Async runtime           | [328](plans/328-async-runtime-master.md) master + [329](plans/329-async-lifecycle-and-transport.md)–[334](plans/334-async-runtime-verification.md)                                   | Research/planning delivered; implementation deferred at owner request                                                          | Start qualification before package adoption when execution begins. Preserve 099/282 and terminal 287/286/283 gates, exact standalone publication under 207, current domain authority and independent actors.          |

Work that can start without waiting for another program: 126's named provider contract research,
202's local controls, 198's acceptance proofs, 200's baseline
research and 209's design review. Bounded product lanes continue beside them: Markdown authoring
in 111/108 before 171's composer swap (parser work in 176/189), measured typing in 201, tree
slices in 178 and Ghostty's [281](plans/281-ghostty-benchmarks-and-positioning.md) benchmarks and
positioning plus [283](plans/283-ghostty-output-and-input-latency.md) output CPU and input latency,
and its site in [285](plans/285-ghostty-site-first-frame-and-real-shell.md), done 2026-10-02: a DOM
renderer, the first frame server-rendered into the HTML, a real shell demo (the benchmarks section
waits on 283). [286](plans/286-ghostty-extensions.md) moves non-core features into extensions,
starting with a line editor for the site's Shell. [287](plans/287-ghostty-worker-mode.md) adds a worker entry point
(OffscreenCanvas) after 283's Zig frame; Platform switches to it.
Each keeps its existing evidence and execution gates. Native stays editor-first; 088 follows 087.

## Package cutover delivered

This is separate from the foundations wave and from the product programs above.
[207](plans/207-one-repo-with-mirrors.md) delivered source migration on 2026-09-30.
The scoped cutover hold has ended. Develop Editor in `editor/packages/`, Ghostty in
`ghostty-webgpu/`, and hotkeys in `hotkeys/`; their standalone repositories are mirrors.
npm authentication, initial publication and trusted-publisher setup remain deferred.
Local development uses the neighboring workspaces. Before 204/205 mirror a consumer of
hotkeys, qualify the exact standalone dependency source under 207; npm remains deferred.
Old checkouts remain untouched references.

## Wave 2 closeout and dependency order

[132](plans/132-process-and-dev-ownership.md) delivered development ownership closeout on
2026-09-30: standard Vite updates, unified typechecks, cold-cache proof and explicit terminal
capture ownership. Its Mac vibrancy checks transferred to 114 Gate 3 and were accepted by the
owner on 2026-10-03. Main `3ca862a4b` later
removed the remaining app-save hot-update interception.

The owner's closeout queue was **179 → 099 → 114 → 126 → 156**. 179 and 099 unit 1 are delivered;
099 unit 0 closed out as partial in PR #224, with its unfinished calibration superseded by 282.
**114 closed on 2026-10-03** after approved owner acceptance and Gate 4 removal;
**126's bounded Wave 2 scope and October 3 finite pass are closed.** Its ledger is reconciled
and the bounded draft check passed; the whole alignment program retains named follow-ons.
156 P0–P2
delivered 2026-10-02 (#269/#280/#286); the whole plan remains open for Approved P3+ work.
Independent work can move earlier. See the
[remaining phase checklist](docs/next-wave.md#wave-2-closeout-reconciled-2026-10-02).

| Work                                                               | Dependency that matters                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [179: content isolation](plans/179-isolating-foreign-content.md)   | Delivered in PR #204. Its isolation policy applies to 156.                                                                                                                                                                                                            |
| [099: document contributions](plans/099-document-contributions.md) | Unit 1 and 198's subscriber are delivered in PR #203. Unit 0 is partial (5/10); 282 replaces its unfinished calibration. Units 2–7 delivered in PR #787 with accepted scoped qualification and installed web/live verification.                                       |
| [114: installed app](plans/114-installed-app.md)                   | Delivered 2026-10-03 after approved owner Mac acceptance and Gate 4 removal. The launcher/native-window paths preserve mesh-owned servers and terminals.                                                                                                              |
| [126: T3 alignment](plans/126-t3code-alignment.md)                 | Wave 2 scope closed October 2 after #210 and later batch deliveries. The [finite pass](plans/126-t3code-alignment/finite-closeout-2026-10-03.md) reconciles evidence and remaining work; larger provider/forge/host units and owner-only checks keep their own gates. |
| [156: rich documents](plans/156-documents-in-the-editor.md)        | P0–P2 delivered 2026-10-02 (#269/#280/#286), using existing file/buffer identity and 179 isolation. P3 projection diffs/binary restore and later Office viewing/editing remain Approved follow-up with their gates.                                                   |

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
  replacing that selected search renderer with one editor or a multibuffer remains unscheduled.
  Approved [229](plans/229-multibuffer-excerpt-model.md)/[230](plans/230-aggregated-source-views.md)
  retain their excerpt-engine and aggregated-view scopes and gates.
  [171](plans/171-composer-on-our-editor.md) owns the composer migration. Neither moves into 200.
- Collaborative editing (approved 2026-10-08): [E066](plans/e066-collaborative-text.md) gives
  the Editor host-ordered collaboration, [E067](plans/e067-webrtc-collaboration-plugin.md) adds a
  peer-to-peer WebRTC plugin, and the revised [Delta DB plan](plans/delta-db-implementation-plan.md)
  makes Fregat's server the host for open documents. Research: [docs/collab-editing](docs/collab-editing/README.md).
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
[203: @fregat/hotkeys](plans/203-fregat-hotkeys.md) landed in PR #197.
[204: Editor](plans/204-editor-on-fregat-hotkeys.md),
[205: ghostty-webgpu](plans/205-ghostty-on-fregat-hotkeys.md) and
[206: Platform owns one keymap](plans/206-platform-one-keymap.md) merged together in
[PR #603](https://github.com/ShaulLavo/fregat/pull/603). The
[delivery record](docs/keymap/command-foundation-delivery.md) holds exact source, CI,
standalone package and processing/presentation evidence. Installed release and live verification passed.
206's TUI delivery is command infrastructure; Plan 202 retains its own redesign.

[207: one repo with mirrors](plans/207-one-repo-with-mirrors.md) delivered the source move
and Git mirroring. The command foundation's exact standalone hotkeys installation gate is
now qualified for all three families. Local core metadata is 0.0.3; the independently hosted
consumer artifact is immutable 0.0.2. npm account setup and publication remain deferred.

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

Plans 220–271 and 274–280 implement the Zed actions Fregat lacks, from the 2026-09-29 triage
(`/work/reports/keymap-wave/zed-feature-triage.md`: 432 input actions plus Zed's Vim keymap, 46
groups). They bind through [206's keymap](plans/206-platform-one-keymap.md), so 206 comes first
for their bindings; each plan lists its own dependencies. Vim is plans 274–280. Plans 272–273 only
record Zed actions that do not apply.

## Retained product and package work

These groups make the rest of the backlog visible without creating another priority queue.
The linked plans retain their status, dependencies and remaining checks.

| Area                                 | Owning plans and retained scope                                                                                                                                                                                                                                                                                                                                                                     | Scheduling boundary                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor foundations and performance   | [Editor inventory](plans/editor-backlog.md), [201](plans/201-cheap-overlay-marks.md), [282](plans/282-fast-paired-input-latency-check.md), [native B3R mount repair](plans/native-plan-of-plans.md#b3r--recover-large-document-mount-performance), [syntax coverage](plans/native-syntax-coverage-plan.md)                                                                                          | Reproduce B3R before tuning. 099 units 2–7 are delivered with accepted scoped proof and installed web/live verification. Plan 282 retains its measurement follow-ups. |
| Agent editing and tools              | [139](plans/139-acting-on-agent-diffs.md), [140](plans/140-editor-agent-advantage.md), [169](plans/169-agent-review-mode.md), [diagnostic fixes](plans/diagnostic-ai-fix-plan.md), [087](plans/087-stateless-mcp.md), [088](plans/088-native-code-intelligence.md), [174](plans/174-external-mcp-servers.md)                                                                                        | Reconcile delivered phases before taking residual work; 088 follows 087's required contracts.                                                                         |
| Sessions and harnesses               | [126](plans/126-t3code-alignment.md), [141](plans/141-usage-and-rate-limits.md), [144](plans/144-unattended-agent-work.md), [145](plans/145-harness-controls.md), [186](plans/186-pull-request-sync-rate.md), [187](plans/187-setup-scripts-in-terminals.md)                                                                                                                                        | Preserve live-account, runtime and schema gates. Usage additions remain in 308–310.                                                                                   |
| Workbench and phone                  | [143](plans/143-phone-layout.md), [155](plans/155-site-demo-replica.md), [178](plans/178-tree-in-the-app.md), [181](plans/181-chat-timeline-end-anchoring.md), [191](plans/191-file-picker-polish.md), [192](plans/192-no-swap-flash.md), [pane zoom](plans/pane-zoom-plan.md)                                                                                                                      | Device acceptance stays explicit; 155 follows 143's relevant phone work. Tree sub-plans keep their own dependencies.                                                  |
| Commands, settings and appearance    | [166](plans/166-bare-function-keys.md), [180](plans/180-file-icon-variants.md), [195](plans/195-settings-defaults-browser.md), [196](plans/196-shared-control-polish.md), [335](plans/335-stroke-icons.md) and 220–280                                                                                                                                                                              | Bindings follow 206. File-type icons remain separate from 335's UI icons.                                                                                             |
| Research and longer product programs | [110](plans/110-workspace-indexing.md), [122](plans/122-composable-plugins.md), [Editor parity](plans/editor-parity-implementation-plan.md), [beyond parity](plans/editor-1000-parity-plan.md), [Logseq parity](plans/logseq-parity-implementation-plan.md), [Delta DB](plans/delta-db-implementation-plan.md), [semantic search](plans/structured-semantic-search-evaluation-plan.md)              | Keep the original groups and go/no-go decisions. Later approved numbered plans supersede conflicting earlier deferrals; root scheduling still applies.                |
| Delivery and observability           | [147](plans/147-log-hygiene-and-noise-gate.md), [184](plans/184-dependency-diet.md), [190](plans/190-faster-ci.md), [284](plans/284-resource-aware-heavy-jobs.md), [slice ownership](plans/312-heavy-slice-ownership.md), [quiet lifecycle](plans/313-heavy-quiet-lifecycle.md), [non-cache memory](plans/314-heavy-non-cache-memory.md), [old log-audit follow-ups](plans/log-audit-follow-ups.md) | Separate shipped infrastructure from missing acceptance receipts. Old audit prompts require current reproduction.                                                     |

The remaining unnumbered plans, supporting checklists and research handoffs stay discoverable
through the complete [plan index](plans/README.md). This grouping approves no additional scope.

## Other work and boundaries

### Deferred virtualization work

[327](plans/327-virtualization-and-two-axis-tables.md) is Approved and scheduled later,
outside the current execution queue. It requires two-axis data-table virtualization,
starting with CSV, and measures editor rewrapping, recycled search-editor work and shared-list
costs before tuning. Keep existing renderer ownership and coordinate with 156, 182 and E052.
CSV column windowing is required; a virtualizer replacement depends on a measured comparison.

[288](plans/288-pr-preview-environments.md) is Approved for later, after the owner's
greenfield-exit decision and its Mesh prerequisites. [319](plans/319-agent-ui-mcp.md) stays
far in the future. It consumes 087's MCP contracts; opening and placing content also waits
for the still-unplanned layout system. Driving an already-open view has its separate boundary.

[341](plans/341-zig-017-migration.md) is Approved and waits for Ghostty main to require
Zig 0.17 and for a ZLS release that supports it. Until then all Zig builds stay on 0.16.x.
It moves three Ghostty pins, replaces `@cImport` with `translate-c`, regenerates every
compiler receipt and re-measures the terminal on Mac, Linux and Pi.

[172](plans/172-shared-undo-stack.md) is Approved for the shared operation-history extraction.
Its local order is entry/execution contracts, shared core, session actions, then workspace
bookkeeping. Use the integrated action API by default and its lower-level composition where
explicit transaction control simplifies integration. Preserve separate domain histories, the
editor graph, and server journal ownership. This work retains the current structural-cutover
limit; coordinate lifecycle and workspace files with their active owners.

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
git history keeps the original plan and evidence. The [wave register](plans/waves.md) retains
batch membership and points to historical delivery records. Run `bun run plans:check` after changing the index or Editor inventory.
