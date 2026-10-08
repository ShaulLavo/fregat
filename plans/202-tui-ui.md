# Plan 202: Terminal UI in Fregat

Status: APPROVED, revised by the owner on 2026-09-29. This change updates plans only;
implementation, package changes and runtime verification remain work to execute.
[PLAN.md](../PLAN.md) owns cross-project order.

## Decision and outcome

Build the existing React terminal app on upstream `@opentui/core` and `@opentui/react`.
Keep reusable terminal controls, themes and interaction behavior in `apps/tui/src/ui/`.
Keep Fregat's existing backend, shared TypeScript application logic and terminal product layout.
Charm and the pinned Crush experience remain the visual and interaction references.

The owner has dropped the bubli name, separate toolkit and permanent OpenTUI-fork assumption.
There is no new UI package, package namespace, React reconciler or native-release pipeline to
maintain. A second real consumer can justify extraction later; it is not a prerequisite now.
Engine changes remain possible when an actual limitation is demonstrated.

The owned `tree-sitter-md` + `tree-sitter-x` direction and Singapore work are unchanged.
The local Markdown component must use our semantic engine and support trusted application-defined
React components. Matching the experience remains the requirement; owning the engine is a means
we only choose when necessary.

## Ownership and retained research

Fregat owns the local UI and its application integration. Upstream OpenTUI owns the renderer,
React host integration and published native artifacts. tree-sitter-md owns shared Markdown
semantics; Singapore owns its existing browser-editor consumer. Shared application data, drafts,
commands, settings, palettes, documents and backend clients stay with their existing owners.

[Coordination and reference index](../docs/tui-research/ui-plan-links.md) links the parser/editor
plans and the immutable source research, 83-capability catalog, visual recipes, measured-from-source
constants, source ledger and acceptance matrix. Their old fork/package ownership is superseded by
this plan; their source observations and behavior targets remain useful. A capability is not
necessarily a new widget. Keep existing primitives where they satisfy the contract.

The former toolkit units are absorbed here: B0 into F0; B1/B2 into F2; B3 into F3; B4/B5 into F4;
B6 into F1/F4; B7 into F5. Publication of a separate toolkit, changes to the upstream Markdown
implementation and migration of upstream Solid callers are removed from scope. No parser/editor
unit or required extension is cancelled by this ownership change.

Use the existing `components/`, `hooks/`, `state/` and `utils/` conventions inside the local UI
when each directory has content. Pure helpers remain renderer-independent where useful. App-only
session, approval and filesystem policy stays with its feature or host adapter. Do not create an
empty framework scaffold, second application store or web-to-terminal component abstraction.

## Existing plans and current baseline

- Plans [176](176-markdown-parser.md) and [189](189-tree-sitter-md-improvement.md) retain parser
  integration, correctness, extensions and performance ownership. CommonMark/GFM and selected
  Goldmark/Glamour compatibility, definition lists, source mapping and streaming still need their
  semantic gates. Historical normalized-construct scores are not rendered-output certification.
- Plan 189's footnotes, math, CJK flanking, wiki links, callouts/alerts and highlights remain
  required under their explicit profiles. They are not all initial Crush-profile prerequisites.
- Plans [108](108-markdown-modes.md), [111](111-editor-decorations.md),
  [171](171-composer-on-our-editor.md), [179](179-isolating-foreign-content.md),
  [197](197-editor-highlighting-service.md), [198](198-document-owned-editor-analysis.md),
  [099](099-document-contributions.md) and [200](200-document-backed-content-views.md) keep their
  existing authoring, isolation, highlighting and document responsibilities. Consume only the
  exact contracts required; do not gate the whole TUI on unrelated units or invent another owner.
- Plans [203](203-fregat-hotkeys.md) and [206](206-platform-one-keymap.md) own keymap infrastructure.
  Local UI controls integrate with that route and supply focus, commands and hints. Until its TUI
  adoption lands, preserve the current command owner. Do not add a competing global dispatcher or
  schedule adoption of `@opentui/keymap` as another workstream.
- Plan [207](207-one-repo-with-mirrors.md) owns any Editor relocation and mirror cutover. It does
  not turn the app-local UI into a published/mirrored package. If it lands first, apply subsequent
  Editor work in the canonical Fregat source rather than writing independently to the mirror.
- Plans [181](181-chat-timeline-end-anchoring.md), [182](182-search-view-rendering.md) and
  [192](192-no-swap-flash.md) retain their web/search and subject-switching responsibilities.
  Share scenarios and identity guarantees without importing DOM layout assumptions.

Planning was refreshed against Fregat `c510b560d3ac3f56d629f35152d13de2bc1e31af`, Singapore
`54e1e6488fb058d1c1a5f1692905da06ede93a20` and tree-sitter-md
`bbbd1a8bd36ab3d979f500a3dbe66224ba34a568`. The initial UI research used Fregat
`5a5c512a75ed635e95b0e9dcb71c28823abd71a0`, OpenTUI
`32d67005d0dd61e63dff24756d5b9061bc504325` and Crush
`06e50a330e2b05b677726737d06852a35f5ff93f`. Recheck relevant source and actual package resolution
before implementation. This documentation change does not certify runtime compatibility.

The existing TUI already has palette adaptation, select/dialog wrappers, a native composer,
streaming Markdown, timeline windowing, a Shiki-based viewer and app command/focus integration.
Its source-line height estimate and 40-item window are a baseline to measure, not a required
replacement algorithm. Preserve latest-native-value submission and existing drafts/attachments.

The inspected Fregat manifest still overrides OpenTUI core/React with fork tarballs and separately
overrides `web-tree-sitter` with tree-sitter-x. Returning to upstream therefore requires an explicit,
verified implementation change to resolution and the lockfile; this plan does not pretend that
changing the architecture text changes the installed application.

## Engine extension and patch policy

Start with supported props, React composition and public custom-renderable registration. A custom
renderable can live in the app; it does not require a fork. Keep renderer access behind a small local
adapter where that materially reduces coupling, without mirroring the whole upstream API.

If a required behavior cannot be implemented cleanly, write the minimal reproduction and name the
missing capability. Prefer an upstream bug fix or public extension point. A narrowly scoped,
version-pinned package-manager patch may bridge the gap. Record its owner, affected versions/files,
regression test, upstream issue/PR, removal condition and upgrade check. Commit the patch and its
manifest/lockfile integration; hand-edited `node_modules` is not the delivery mechanism.

A patch that requires matching JavaScript/native artifacts must carry that compatibility proof.
Patch line count alone does not measure maintenance risk. Do not bypass private internals through
an expanding chain of workarounds merely to avoid admitting an engine change.

Reconsider a maintained fork only after essential behavior repeatedly requires invasive renderer
or native changes, with evidence that public extensions and focused patches are insufficient.
That is a separate owner decision, not a standing instruction to resume fork maintenance.

## Markdown and runtime contract

The local React `Markdown` component consumes renderer-neutral semantics from tree-sitter-md and
renders terminal-compatible content with upstream primitives or public custom renderables.
It does not have to use or modify OpenTUI's built-in Markdown component. Arbitrary block overrides
are real React subtrees in the existing root, with hooks, context, effects, state, error boundaries
and events. Define inline-compatible output, stable identity and height/virtualization rules.
Markdown data never executes JSX, JavaScript or MDX.

The app's selected Markdown path uses neither Marked nor Marked token types. Removing Marked bytes
from upstream's own package is not a prerequisite. Measure installed, bundled and loaded bytes
separately; do not claim that avoiding a component removes its bundled dependencies. Remove any
now-unused app-owned parser dependency only after all its callers are migrated and verified.

Use our tree-sitter-x runtime through normal dependency configuration first. Validate the actual
published OpenTUI worker, not just source imports: previously inspected worker builds bundled the
JavaScript bindings, and the inspected WASM subpath differed from our runtime's export. An override
alone cannot be assumed to replace embedded JavaScript or produce a matching JavaScript/WASM pair.

Test dependency overrides, public worker/client injection and existing asset-resolution hooks in
that order of suitability. A custom worker must have a bounded, tested protocol contract; copying
an upstream worker wholesale is maintenance, not a free extension. If necessary, carry the smallest
tracked asset/export/worker externalization patch and propose the general extension upstream.
Reuse the existing runtime extension loader. No speculative tree-sitter-x ABI rewrite is scheduled.
Deduplication is verified within each realm; distinct workers need not share a WASM heap.

## Implementation units

### F0. Preserve the baseline and prove the risky seams

- [ ] Record actual upstream/fork/runtime/editor resolution, assets, build paths and current source
      refs. Reconcile the retained catalog into reuse, local extension, patch or explicit defer.
- [ ] Capture the existing Agent screen and one non-chat surface using synthetic data. Record
      terminal dimensions, emulator/font, protocols, palette, locale and runtime.
- [ ] Run a bounded upstream feasibility slice: packaged owned-runtime loading, a stateful React
      Markdown override, composer/dialog focus, streaming into a long timeline, resize and copy.
- [ ] Keep a known-bad control for each automated comparison and record concrete missing
      capabilities. Finish missing observations without restarting broad research.
- [ ] Check implementation/asset licenses and provenance. Preserve Fregat branding and backend
      contracts; source research is not permission to copy all Crush implementation or assets.

Exit: reproducible baseline plus an evidence-backed list of extension/patch needs. Independent
style/control work can proceed while specific runtime or rendering seams are tested.

### F1. Return to upstream packages and integrate the owned runtime

- [ ] Select a tested upstream core/React/native package set. Prove the existing app starts,
      renders, edits, suspends and exits without intentionally changing its presentation.
- [ ] Verify the owned runtime in the distributed worker and application build: matching binding
      JavaScript/WASM, grammar/resolver assets, subpaths, initialization and ordinary code parsing.
- [ ] Try dependency configuration and supported injection before adding a tracked patch. Record
      module identity, duplicate payload and worker lifecycle results, not just a resolved version.
- [ ] Replace fork core/React tarball overrides with upstream resolution once checks pass. Update
      catalog, lockfile and CI/development setup together; keep the independent parser/runtime work.
- [ ] Verify one compatible React instance, JSX/testing exports, supported Bun/Node execution and
      native assets from clean installations. Never silently mix incompatible native and JS builds.

Exit: Fregat runs against upstream OpenTUI with our verified parsing path and a documented patch
set, possibly empty. No independent toolkit or renderer publication is needed.

### F2. App-local defaults, controls and interaction

- [ ] Consolidate reusable controls in `apps/tui/src/ui/`, building on existing wrappers and native
      primitives. Keep screen composition and feature semantics in their current owners.
- [ ] Map shared palettes to foreground/background ramps, primary/secondary/status roles,
      selection contrasts, diff bands and ANSI colors. Preserve host colors, light/dark, indexed,
      no-color and reduced-motion behavior through existing settings.
- [ ] Implement geometry-stable focused, blurred, hovered, disabled, inactive and destructive
      recipes for text, frames, separators, rails, badges, buttons, radios, checkboxes, tabs,
      inputs, secret fields, help/status, loading, empty and error presentation.
- [ ] Use one owned animation clock, deterministic test inputs and reduced/static behavior.
      The reference working animation's timing is not a renderer-wide FPS limit.
- [ ] Compose searchable selectors, pickers, completions and attachment chips from supplied data;
      keep ranking policy explicit. Derive shortcut hints from actual active bindings.
- [ ] Integrate overlays, focus return, selection and embedded-terminal precedence with the
      existing command owner and Plan 206's route. Test async-dialog input grace separately from
      ordinary immediately responsive dialogs. No second matcher or global listener.
- [ ] Refine the native prompt editor: measured wrapped height, latest-value submit, undo/redo,
      prefix states, paste, selection, history boundaries and completion anchoring. Keep app drafts.
- [ ] Apply the same controls to the Agent screen and a settings/file-picker surface. Theme changes
      invalidate all affected content/control caches without introducing another theme registry.

Exit: cohesive defaults and keyboard/pointer behavior across two real surfaces, with no lost final
keystroke, duplicate action, accidental approval or input stolen from an embedded terminal.

### F3. Owned Markdown with real React overrides

- [ ] Consume parser M1's revisioned semantic contract; require M1-M4's relevant semantic,
      conformance, streaming and package gates before production cutover. Singapore S0-S4 remain
      the parallel editor-consumer work, not a prerequisite for unrelated terminal styling.
- [ ] Implement standard, user, quiet/thinking and plan profiles. Preserve authored user newlines,
      list tightness/starts, decoded text, references, definition lists, table alignment across all
      supported columns, code metadata and original UTF-16 source correspondence.
- [ ] Mount custom components through React, with stable document-local identity or correspondence
      across harmless appends and earlier insertions. Define legitimate reclassification/remounts,
      inline layout, fallback/error output and virtualized state retention explicitly.
- [ ] Prove hooks/context/state, interaction and error-boundary behavior in the existing React root;
      never call hook-bearing components as ordinary functions or create one isolated root per block.
- [ ] Reject stale parse/highlight results after source/profile/theme replacement or disposal.
      Later reference definitions must update earlier uses. Final streamed output equals fresh output.
- [ ] Implement safe activation, HTML/control-character policy and source-faithful copying. Keep
      display text, source offsets, graphemes and terminal cells distinct.
- [ ] Migrate the app's Markdown callers and remove app-owned Marked types/dependencies where
      unused. Leave upstream's built-in Markdown implementation and other framework callers alone.

Exit: semantic, streaming, React lifecycle, rendered-profile and copy fixtures pass for the local
renderer. Upstream package-wide Marked removal and a separate UI release are not exit criteria.

### F4. Conversation, rich content and existing workbench

- [ ] Refine user/assistant/thinking/plan surfaces, tool cards, header/sidebar and working states
      with local recipes. Record intentional Fregat layout differences from the pinned reference.
- [ ] Keep session identity, reconnects, failed-submit drafts, activity expansion and model/session
      selection connected to the existing backend/client-core model.
- [ ] Render pending/permission/running/success/error/cancelled tool states and missing versus empty
      output. Cover file, diff, search, shell, nested task, diagnostic and unknown-tool fallback.
      Preserve operation provenance; provider, MCP, LSP and execution backends are unchanged.
- [ ] Reuse code/diff/image/embedded-terminal primitives where correct. Preserve full-source syntax
      context, unified/split views, hunk identity, code/sign/gutter colors, horizontal overflow,
      synchronized scrolling and source copy. Do not parse a displayed patch as a complete file.
- [ ] Reconcile viewer Shiki and owned-runtime highlighting through deliberate semantic roles and
      Plan 197's relevant service boundary. No blanket engine replacement merely for consistency.
- [ ] Measure actual row/block height before replacing timeline windowing. Track stable item/source
      anchors, intra-item offset and follow intent; handle very tall blocks and custom React resizes.
- [ ] Preserve reading position across prepend, streaming, expansion, highlights, image load and
      resize; scrolling away disables follow and returning to the end follows the chosen contract.
      Bound visible work and avoid full-history remeasurement on every resize frame.
- [ ] Cover cross-message selection, Unicode and hidden/expanded content without copying UI rails
      or losing source meaning. Bound caches and release stale parsing/rendering work.
- [ ] Keep clipboard/image/external-editor operations in host adapters with explicit unsupported
      outcomes. Remote paths and local clipboard paths remain distinct. Preserve terminal focus,
      raw input, attachment, resize, suspension and cleanup ownership.
- [ ] Share semantics/types and renderer-neutral transformations with web/editor consumers where
      useful. Preserve browser isolation, document authority and Plan 207's canonical-source rules.

Exit: complete chat and non-chat flows retain existing behavior while using local presentation;
each catalog capability has evidence or an explicit disposition, not an assumed rewrite.

### F5. Verification, upgrade policy and closure

- [ ] Run focused TUI regressions, then its suite/typecheck/build using current manifest commands.
      Use headless/native renderer and PTY checks for frame, input and lifecycle assertions.
- [ ] Read visual evidence at narrow/wide and boundary sizes, truecolor/indexed/no-color, Unicode,
      keyboard/pointer, overlays, streams, tall content, empty/error/disconnect and embedded-terminal
      cases from the retained validation matrix.
- [ ] Measure parser, semantic conversion, React, layout/output, cold/warm startup and memory
      separately. Record before/after and installed/bundled/loaded payload with failing controls.
- [ ] Check upgrades against a pinned supported OpenTUI set and the next candidate; verify runtime
      assets, patch application and regression cases. Do not auto-merge dependency bumps because
      the renderer is upstream. Remove patches when the required upstream release is adopted.
- [ ] Verify clean packaged app installation and CI, with the actual upstream/runtime/editor refs.
      No toolkit publication, paid model request, backend migration or data reset is needed.
- [ ] Record delivered commits, exact fixtures, skipped platform checks and all catalog
      dispositions. Update this plan and root roadmap; preserve permanent evidence before retiring
      execution text. Merging documentation is not implementation completion.

Exit: reproducible upstream-backed app, explicit and maintainable patch cost, preserved app
behavior and an accurate roadmap. Performance and visual claims require their own evidence.

## Order, handoff and recovery

F0/F1 target the uncertain extension and package seams first. F2 can proceed alongside parser work.
F3 prototypes against M1 while M2/M3 run, but production Markdown cutover waits for the parser
package and local React/profile checks. F4 integrates the capabilities it uses rather than waiting
for every possible control. F5 closes each delivered slice. The existing wave queue is unchanged.

Record upstream core/React/native versions, parser semantic schema/profile and source revision,
built tree-sitter-x package and native-source revisions separately, WASM/worker hashes, patches,
Editor source ownership/ref when affected, Fregat lockfile/CI changes and actual consumer results.
A package pin or local link alone is not evidence.

Keep the last working coherent installation until a failed gate is repaired. Existing fork assets
remain available for recovery while F1 proves their replacement; this plan does not delete or
archive a repository or release. Do not ship an unnoticed fallback parser, incompatible asset
pair, private-internals workaround chain or lost drafts/history. A future maintained fork requires
its own evidence-backed decision. Singapore and parser delivery continue independently.

## October 2026 issue follow-ups

Status: Approved, retained by [Plan 336 closeout](issue-closeout-2026-10.md).
These are remaining execution items. Closing their tracker records does not certify a fix
or change acceptance of an earlier delivered milestone. Each original thread retains its
full reproduction, comments and historical artifacts. Source links below pin the reviewed
main revision; recheck them before implementation.

### Issue 623

Source: [#623: TUI: unconfirmed asynchronous settlement warnings flood a passing CI test job](https://github.com/ShaulLavo/fregat/issues/623), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/623#issuecomment-5996055131).
Current owner: [apps/tui/src/agent-rail/tests/rail.test.tsx](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/apps/tui/src/agent-rail/tests/rail.test.tsx).

A passing TUI job emitted 1,498 act-warning matching lines. PR #763 fixed one rail case but 1,165 wider warnings remained; PR #771 later settled Undo/Redo selection inside act. A separate later archive Undo palette assertion expected a non-null value and got null, with no proven shared cause. Inventory the remaining warning owners and capture that assertion with its actual state transition. Keep current assertions and deadlines. This is test-settlement work in the terminal-first redesign, not a request to port web notices or dialogs.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.
