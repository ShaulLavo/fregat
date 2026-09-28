# Plan 201: The existing TUI runs on bubli

Status: proposed implementation plan, requested by the owner on 2026-09-28. This PR contains planning and roadmap documentation only. No renderer, backend, application code, dependency pin, deployed service or release changes here.

Owners: Fregat for application integration, shared palette/commands/data and its existing backend connection; bubli for the terminal engine, React renderer and reusable UI; tree-sitter-md for semantic Markdown; Singapore for its existing editor consumer. [PLAN.md](../PLAN.md) owns cross-project ordering.

## Outcome

Use our bubli fork underneath the existing `apps/tui` chat/workbench. Its controls, spacing, colors, focus, keyboard interactions, rich content and motion should feel cohesive by default, with Charm's ecosystem and pinned Crush behavior as references. This is a toolkit adoption and terminal UX refinement, not a new Crush application or a backend replacement.

Preserve the shared React/TypeScript application ecosystem: contracts, clients, data models, state, commands, palette inputs and renderer-independent presentation logic. Terminal and browser layouts remain host-specific. Crush's component behavior does not require copying its branding, app architecture, provider integrations or every screen.

Owner decisions carried into the implementation: replace Marked in bubli with `tree-sitter-md` on the owned `tree-sitter-x` runtime; require semantic CommonMark/GFM/selected Goldmark fidelity; support trusted application-defined React components in Markdown with normal hooks, context and state. Do not execute JSX/MDX supplied by Markdown content.

## Connected PRs and authoritative documents

| Repository | Planning PR | Owns |
| --- | --- | --- |
| bubli | [PR 1](https://github.com/ShaulLavo/bubli/pull/1) | Toolkit units B0-B7, full capability catalog, reference specification and validation |
| tree-sitter-md | [PR 5](https://github.com/ShaulLavo/tree-sitter-md/pull/5) | Semantic API, compatibility, streaming and package handoff, units M0-M4 |
| Singapore | [PR 62](https://github.com/ShaulLavo/singapore/pull/62) | Existing editor consumer, authoring/worker compatibility and paired pins, units S0-S4 |
| Fregat | This PR / Plan 201 | TUI adoption and cross-project roadmap, units F0-F5 |

The [coordination index](https://github.com/ShaulLavo/bubli/blob/docs/bubli-plans-2026-09-28/docs/bubli/README.md) records reciprocal PR links and producer/consumer order. The [reference specification](https://github.com/ShaulLavo/bubli/blob/docs/bubli-plans-2026-09-28/docs/bubli/reference-spec.md) consolidates the source-backed research, 30 relevant dependency/support modules, 41 original file references, palette/interaction rules, 32 measured-from-source constants and validation cases. The [83-capability catalog](https://github.com/ShaulLavo/bubli/blob/docs/bubli-plans-2026-09-28/docs/bubli/component-catalog.md) separates reusable building blocks from Fregat compositions. These capabilities are not 83 new widgets to write.

Review-branch links allow navigation before merge. Preserve PR links and normalize cross-repository document links to main once the planning series lands. Planning PRs can merge independently; implementation dependencies below remain explicit.

## Existing owners and boundaries

| Existing work | Boundary retained by Plan 201 |
| --- | --- |
| [176 Markdown parser](176-markdown-parser.md), [189 improvements](189-tree-sitter-md-improvement.md) | Initial integration and ongoing correctness/extensions remain with those owners. Reconcile the new parser release evidence before repeating old blockers. The new parser plan specifies renderer-facing semantic work. |
| [108 Markdown modes](108-markdown-modes.md), [111 decorations](111-editor-decorations.md) | Browser authoring and live preview keep their scopes; shared semantics do not force terminal presentation rules into the editor. |
| [171 composer](171-composer-on-our-editor.md) | Its browser composer migration stays there. The terminal composer continues on the native terminal editor primitive; this plan does not port the DOM editor. |
| [099 contributions](099-document-contributions.md), [198 document analysis](198-document-owned-editor-analysis.md) | Reuse their publication/acquisition/revision/retention guarantees where a consumer needs them. Do not create another document or analysis owner. Unrelated gated units are not prerequisites. |
| [197 highlighting](197-editor-highlighting-service.md), [200 content views](200-document-backed-content-views.md) | Standalone highlighting/diff analysis and document-backed browser content retain their owners. Plan 201 consumes relevant released contracts and owns terminal presentation. |
| [179 foreign content](179-isolating-foreign-content.md) | Browser isolation and safe content policy remain authoritative for any shared rendered-Markdown adoption. Terminal control handling needs its own explicit host policy. |
| [181 timeline anchoring](181-chat-timeline-end-anchoring.md), [182 search](182-search-view-rendering.md) | Keep their web/search implementation ownership. Terminal anchoring tests may share scenarios, not DOM assumptions or a second backend model. |
| [192 subject switching](192-no-swap-flash.md) | Preserve subject identity with content through asynchronous switches; stale results cannot repaint a new subject. |
| TUI strategy and AGENTS.md | Keep terminal-native UX. Charm/Crush is the reusable component and interaction reference for this work; existing product-layout references are not mechanically replaced. |

Plan 189 explicitly requires footnotes, math, CJK-friendly flanking, wiki links, callouts/GitHub alerts and highlights. They remain required in that plan with explicit options. They are not all initial Crush-profile prerequisites, and this plan does not make them optional or cancel them.

## Source baseline and drift

Initial UI research inspected Fregat `5a5c512a75ed635e95b0e9dcb71c28823abd71a0`. Planning reconciled the roadmap at `4f587e90091cb0a74b314276a038b45685da572b`; this PR branches from `40d32de345c7d29655b6e65c9d664944ae87f3b8`. Recheck code and package/CI refs before executing; a planning snapshot is not a runtime result.

- [TUI manifest](https://github.com/ShaulLavo/fregat/blob/5a5c512a75ed635e95b0e9dcb71c28823abd71a0/apps/tui/package.json) already uses OpenTUI core/React, shared client-core/contracts, Singapore packages, Shiki, Zustand and TanStack query core. Keep those owners unless a specific dependency becomes unused.
- [Theme adapter](https://github.com/ShaulLavo/fregat/blob/5a5c512a75ed635e95b0e9dcb71c28823abd71a0/apps/tui/src/theme/utils/theme.ts) maps shared app palettes into terminal color modes and motion preferences. Extend its semantic role mapping, not a second independent app palette registry.
- [Select](https://github.com/ShaulLavo/fregat/blob/5a5c512a75ed635e95b0e9dcb71c28823abd71a0/apps/tui/src/components/select.tsx) already adds wrap selection and navigation from search input. [Dialog](https://github.com/ShaulLavo/fregat/blob/5a5c512a75ed635e95b0e9dcb71c28823abd71a0/apps/tui/src/components/dialog.tsx) already portals, clamps to terminal size and derives dismissal hints from app commands.
- [Composer](https://github.com/ShaulLavo/fregat/blob/5a5c512a75ed635e95b0e9dcb71c28823abd71a0/apps/tui/src/agent-stage/components/composer.tsx) combines a native textarea/editor with drafts, paste handling, completion triggers and app commands. Preserve latest-native-value submission and existing draft/attachment behavior while extracting generic controls.
- [Timeline](https://github.com/ShaulLavo/fregat/blob/5a5c512a75ed635e95b0e9dcb71c28823abd71a0/apps/tui/src/agent-stage/components/timeline.tsx) already windows messages and uses sticky scrolling; [rows](https://github.com/ShaulLavo/fregat/blob/5a5c512a75ed635e95b0e9dcb71c28823abd71a0/apps/tui/src/agent-stage/components/timeline-row.tsx) already render streaming Markdown. [Layout estimation](https://github.com/ShaulLavo/fregat/blob/5a5c512a75ed635e95b0e9dcb71c28823abd71a0/apps/tui/src/agent-stage/state/timeline-layout.ts) estimates source-line height and caps windows at 40 items. Test actual rendering and anchors before choosing a replacement algorithm.
- [Viewer syntax](https://github.com/ShaulLavo/fregat/blob/5a5c512a75ed635e95b0e9dcb71c28823abd71a0/apps/tui/src/viewer/state/syntax.ts) uses Shiki/Oniguruma and dark-plus/light-plus separately from native Markdown highlighting. Define a deliberate role/fallback policy rather than silently switching every code surface.
- bubli `57e5924e4e9813b31af336371b53c26577d46695` already uses the owned runtime and preserves its native dependency pins. Package names still use `@opentui/*` at that snapshot. A repository name, package version string or local link alone does not prove the installed app uses the fork.
- tree-sitter-md `5dd917ae70eea5f6a38a2ba8825ce6d3baca697d` reports 676/676 normalized cases and package-consumer checks. Earlier 674/676 and failure notes are historical. The parser plan still needs full semantic/profile evidence beyond construct counts.

## Implementation units

### F0. Reconcile current integration and capture a baseline

- [ ] Record TUI source, manifests/catalog, lockfile, actual resolved package paths/versions, local linking and CI setup refs. Preserve concurrent changes and use targeted file commits.
- [ ] Inventory existing theme, select/dialog, composer, timeline, file/diff viewer, clipboard, host and terminal integrations against the shared capability catalog. Assign every app composition a keep/adapt/defer disposition.
- [ ] Capture the existing Agent screen and one non-chat surface with synthetic data; record terminal dimensions, emulator/protocol, palette, runtime and source refs.
- [ ] Capture key routing, draft persistence, stream completion, scroll/follow, selection/copy, reconnect and exit/suspend behavior. Use the narrowest existing tests and deliberate failing controls.
- [ ] Review the reference license/provenance ledger before any implementation/asset reuse. Keep Fregat/bubli branding and existing backend contracts.

Exit: reproducible baseline and exact integration map. Complete missing observations without restarting the broad research phase or inventing a greenfield app.

### F1. Integrate fork packages and shared bridges

Catalog: B079-B080 and the foundation/control subset being adopted.

- [ ] First run the existing app against a coherent bubli package/asset set without intentionally changing its appearance. Verify actual resolution, one React instance, JSX/testing exports, native assets, Tree-sitter modules and worker/WASM paths.
- [ ] Make development and CI resolution reproducible. Local cache symlinks are development convenience, not the release contract. Update catalog/lockfile/setup scripts together when implementation reaches this unit.
- [ ] Map the shared palette into bubli's richer role contract, preserving light/dark, host colors, indexed/no-color and reduced-motion behavior. Keep theme ownership in the existing app settings/palette model.
- [ ] Bridge app commands and focus into the chosen toolkit routing path. Keep one owner for event consumption, focus restoration and shortcut hints; do not run a competing global key dispatcher.
- [ ] Replace local generic control implementations with bubli primitives when their contracts are ready; retain app adapters for theme, commands and supplied data. No permanent duplicated wrappers or old/new runtime switches without a demonstrated need.

Exit: fork resolution and ordinary controls work through the existing app data/command model. Package naming changes, if chosen, update all callers in one paired change rather than permanent aliases.

### F2. Refine the existing Agent screen

Catalog: B029-B036, B044, B046-B053 and B059-B065/B075/B082.

- [ ] Keep composer draft/history/attachment ownership. Adopt the reusable prompt editor with measured wrapped height, prefix states, paste/completion behavior and current-native-value submission.
- [ ] Adopt standard, user, quiet/thinking and plan Markdown profiles through bubli's owned semantic engine after parser M1-M4 and bubli B3 gates pass.
- [ ] Add custom Markdown components as real React children in the existing tree. Prove hooks/context, interactions, error boundaries and state survive harmless stream updates and earlier inserts. Keep app UI data separate from untrusted Markdown.
- [ ] Refine user/assistant/reasoning/plan surfaces, rails, spacing, header/sidebar and working states using shared defaults. Record intentional Fregat layout differences instead of assuming full Crush screen identity.
- [ ] Replace or refine timeline windowing only after actual-height/anchor tests justify it. Preserve follow intent, old-content reading position, preload/prepend, expansion, resize and very tall blocks.
- [ ] Preserve conversation/session identity, reconnect behavior, failed-submit drafts, activity expansion and model/session selection through the same backend/client-core adapters.

Exit: one complete chat flow uses the shared primitives and profiles without changing backend behavior. Source-faithful copy and scroll/React lifecycle tests pass alongside visible evidence.

### F3. Tool cards, overlays and workbench surfaces

Catalog: B037-B043, B054-B058 and B066-B078/B083.

- [ ] Adapt existing tools into generic presentation surfaces: pending/permission/running/success/error/cancelled, missing versus empty output, collapsed/expanded and truncation. Preserve tool identity and operation provenance.
- [ ] Cover file/diff/search/shell/nested-task/diagnostic and unknown-tool fallback using the existing event model. No provider, MCP, LSP, command execution or permission backend is recreated.
- [ ] Integrate searchable pickers, completion overlays, approvals, question forms and confirmation flows with the app command system. Async arriving prompts use tested input grace; ordinary dialogs remain immediately responsive.
- [ ] Use the same Select/Dialog/Input/help recipes in an existing non-chat surface such as settings or the file picker. This proves cohesive defaults beyond one customized Agent screen.
- [ ] Keep clipboard/image/external-editor operations on their proper host. Remote server file paths and local clipboard paths remain distinct. Handle unsupported capabilities explicitly.
- [ ] Preserve embedded terminal ownership: inner control bytes, focus, resize, raw attach/detach and suspension must not be intercepted by chat or picker bindings.

Exit: the existing app's interactions and workbench remain functional while generic presentation moves into bubli. Each actual Fregat flow has acceptance evidence or an explicit deferred disposition.

### F4. Shared semantics and highlighting policy

Catalog: B081-B082, coordinated with Singapore S0-S4.

- [ ] Consume the parser's semantic contract without introducing another document/parser owner. Share pure types/profile inputs and renderer-independent transformations where useful; do not require one physical parser instance across separate apps or workers.
- [ ] Coordinate Singapore's existing Markdown authoring/decorations with the same parser release. Changes to Editor pins require its producer tests and Fregat CI linked-source checks, not a speculative DOM editor dependency for the TUI.
- [ ] Reconcile the existing viewer Shiki pipeline with code/diff/Markdown semantic roles. Keep deliberate language/fallback differences explicit and use 197's released highlighting boundary where relevant.
- [ ] Where web rendered Markdown adopts the shared semantics, keep web components, isolation/sanitization and document identity under their existing owners. Do not transplant the terminal theme or replace every browser Markdown consumer solely to unblock the TUI.
- [ ] Preserve Plan 189's configured extension work and separate its delivery from the initial Crush-profile cutover. The new semantic schema must accommodate it without another parser fork.

Exit: producer/consumer contract and pins agree, with no silent renderer/parser divergence or duplicate analysis service. Independent web UI work does not block a verified terminal slice.

### F5. Verification, distribution and roadmap closure

- [ ] Run focused TUI regressions, then its suite/typecheck/build. Current TUI entry points include `cd apps/tui && bun --bun vitest run`, `bun run typecheck` and `bun run build`; recheck the manifest first.
- [ ] Use existing headless/native renderer and PTY tests for lifecycle, input and frame assertions. Read actual terminal visual evidence for changed layouts, interactions and supported protocols.
- [ ] Exercise narrow/wide and boundary sizes, truecolor/indexed/no-color, Unicode source-copy, keyboard/pointer, overlays, streaming, tall content, empty/error/disconnect and embedded terminal scenarios from the reference matrix.
- [ ] Benchmark parsing, semantic conversion, React, layout/output and memory separately. Record cold/warm history and before/after counters; do not infer a performance win from parser-only figures.
- [ ] Verify clean installation and CI build with intended fork/editor/runtime assets. No credentials, paid model requests, backend migration, data reset or deployment is needed for the planning PR.
- [ ] Check every catalog disposition, source/profile deviation, reciprocal PR link and release handoff. Record exact implementation commits, fixtures and skipped platform checks before marking a unit complete.
- [ ] Update Plan 201 status and root PLAN.md with delivered units/dependencies. Preserve permanent contracts and evidence before retiring completed execution text under repository policy.

Exit: paired release/consumer evidence, no lost app behavior and an accurate roadmap. Planning merge is not implementation completion.

## Order and release handoff

F0 and bubli B0 establish compatible fixtures. Themes/controls/focus work (B1/B2 and relevant F1 adapters) may run alongside parser work. Production Marked removal and Fregat Markdown cutover require parser semantic/conformance/streaming/package gates and bubli React/profile tests. F2/F3 proceed by the subset of toolkit capabilities they consume. Singapore integration verifies the same semantic release without making unrelated browser or full 099/198 completion a prerequisite. F4 pairs any relevant shared-package changes; F5 closes each delivered slice.

The existing root roadmap's wave-2 queue remains unchanged. No new fixed priority ahead of it is implied by this plan. Any required contract that is gated in another plan stays gated; record that specific dependency rather than implementing an alternate owner.

A handoff names parser semantic schema and package revision, built runtime and native source revisions, grammar/resolver hashes, bubli/core/native/React refs, Singapore ref if changed, Fregat catalog/lockfile/CI changes, shared fixture versions and actual check results. A local link or untested version string is not acceptance evidence.

## Recovery and completion boundary

Keep the last working coherent package set while a failed gate is repaired. Revert a failed implementation slice as a targeted change when needed; do not ship a mixed upstream/fork runtime, silent fallback parser or guessed degraded output. Preserve drafts, stored conversations, existing server identity and retained terminal sessions. No data deletion is authorized by this plan.

No PR is opened in Crush, its dependencies or upstream OpenTUI for research references alone. tree-sitter-x already supplies the required extension path; a demonstrated missing ABI/lifetime capability gets a minimal reproduction and separately linked implementation work, not a speculative runtime rewrite.
