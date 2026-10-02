# E056 research: platform-agnostic core and React Strict DOM

Status: supporting design for approved E056, researched on 2026-09-20.
E056 remains parked by the owner; implementation has not started.

Execution entry: [E056](https://github.com/ShaulLavo/fregat/blob/main/plans/e056-platform-agnostic-core.md).
Machine-readable evidence: [source ledger](e056-platform-agnostic-core-sources.json).

**Proposed direction:** make Singapore's editor engine independent of React, DOM and browser worker construction; retain the existing fast DOM renderer; build a Strict DOM host only against capabilities demonstrated on the intended native runtime. Fregat remains the compatibility contract, not collateral damage.

This document preserves the detailed research, contracts and delivery units behind E056. It is not a report of implemented or passing changes. Source references resolve to pinned source URLs; the companion JSON ledger preserves all 57 source descriptions, reviewed ranges, evidence classes and research limitations. Implementation status and scheduling remain with the executable plan and the cross-project roadmap.

Reconciled on 2026-09-29: Plan 207 owns the move to canonical Fregat `editor/` sources and
public mirrors. References below to sibling links, `editor-ref` and paired repositories describe
the inspected baseline. Refresh them before implementation; package relocation and cutover
follow 207. Plan 208 owns copy catalogs. This iOS/Android proof leaves the Swift/macOS roadmap
and its benchmark, document, editor and shell gates with their existing owners.

## 1. Baseline and scope

| Repository       | Reviewed `main` commit                     |
| ---------------- | ------------------------------------------ |
| Singapore        | `45e22a495902c577243334586bc391f04201a827` |
| Fregat           | `43d3ac1762d4eb01f4521554967e666336858e33` |
| React Strict DOM | `abd34bbf22bb468ffdc0baaf606f172c3a583487` |

The RSD checkout declares version `0.0.55`, React 19 peers and React Native `>=0.82.0`. That is source-manifest evidence, not a claim that this is the latest published npm release or a sufficient native-runtime combination. The prototype must record its exact React, React Native, Hermes, Expo, RSD, operating-system and keyboard versions. [RSD01]

### What this research establishes

The audit follows the document owner, transaction API, input controller, mounted geometry, viewport calculations, plugin lifecycle, worker boundary, React wrapper, build system, main Fregat editor, diff panes, search excerpts, terminal syntax consumer and shared diff utilities. It also reconciles existing cross-project plans and primary platform documentation. The ledger contains 41 repository files and 16 official reference pages; several large files were read in relevant ranges rather than end to end.

This was connector-backed source research. Archive retrieval did not succeed, so an automated full-tree import census was not run. Local dirty worktrees were not visible. No builds, typechecks, repository tests, benchmarks, simulator runs or physical-device tests were executed. Existing test results cited in repository documentation remain historical evidence, not newly reproduced results.

### Deliverables and non-goals

The deliverable is one platform-neutral editor model and behavior implementation, an explicit DOM host, and an independently certified Strict DOM host. Existing browser behavior, package consumers, document identity and performance constraints are preserved through the extraction.

Assume **existing web support plus an iOS/Android feasibility lane**. This does not authorize a Fregat native-app rewrite, certify native desktop platforms, replace the textbuffer, move document authority into a worker, consolidate all workers, invent another plugin framework, or implement a universal text shaper in JavaScript.

A portable engine is useful even if the first native gate requires additional native code. Conversely, a working read-only Strict DOM demo does not certify native editing.

## 2. Findings that change the plan

### 2.1 The reusable core is already larger than the textbuffer

Singapore already separates shared `EditorTextBuffer` state from `EditorViewSession` selections, scroll, folds and metadata. Its document API includes prepared transactions, logical revisions, history graphs, mutation leases, provisional/sealed receipts and reversible sequences. Preserve those implementations and semantics rather than designing a smaller substitute model. [SG03], [SG04]

The textbuffer documentation describes persistent AVL storage, immutable snapshots, UTF-16 offsets and durable source-coordinate anchors. This is an extraction candidate, not a storage-rewrite opportunity. [SG02]

### 2.2 The `Editor` class is a composition root wearing too many hats

`Editor.ts` constructs the DOM view and announcer while also coordinating documents, commands, syntax, folds, contributions and input. `InputSelectionController` combines browser event handling with reusable autoclose, snippet, linked-edit and undo behavior. A new `Renderer` interface around the old class would leave most platform dependence untouched. [SG05], [SG07]

The clean split is **document state + per-view behavior + semantic projection + platform host + execution services**. A browser renderer is only one part of the host.

### 2.3 Viewport math and glyph layout are different problems

`fixedRowVirtualizer.ts` contains reusable numeric calculations beside `HTMLElement`, `ResizeObserver`, native wheel ownership and scroll restoration. Extract the math; do not declare the whole class portable. [SG10]

Actual geometry uses DOM text nodes, scratch `Range` objects and lazy mounted-row measurement. Replacing this with `column × averageCharacterWidth` would abandon the current correctness model. The platform that shapes and displays the text must supply authoritative caret and selection geometry. [SG09], [SG23]

### 2.4 The plugin boundary is also a platform boundary

`EditorViewContributionContext` exposes container and scroll elements, client-coordinate hit testing and `DOMRect`. `EditorViewSnapshot` includes browser metrics; `toJSON()` deliberately materializes full text and line starts. Neither is the universal native interface as-is. [SG11]

There are useful existing mechanisms to preserve: typed provider registries, cached provider ordering, demand-triggered ambient plugins, managed lifetimes, a viewport-only notification path and paint-restoration handling. The general view-update path still iterates its contributions. Do not erase the useful mechanisms while claiming that a generic event bus solves selectivity. [SG11], [SG12]

### 2.5 Current document authority is not the architecture diagram's future worker

The worker-topology reference explicitly says the current document engine remains authoritative on the main thread. Tree-sitter, Shiki, minimap and TypeScript services have separate execution owners and different restart/disposal policies. Portability must not silently convert local synchronous editing into asynchronous RPC. [SG16]

`TreeSitterBackend` already exists. Its contract currently sits beside the browser Worker implementation, which is a concrete extraction seam. Reuse the contract and existing source/version semantics before inventing a general-purpose worker abstraction. [SG18]

### 2.6 Fregat has substantially more than one editor mount

The main editor uses shared buffers, per-view sessions, prepared documents, provisional paint and app-owned focus/keymaps. Diff panes intentionally use `setText` rather than `openDocument` to preserve scroll. Search results use bounded readonly excerpts with different selection policy. The TUI directly consumes the Shiki tokenizer, and shared client code consumes diff utilities. Those are distinct compatibility cases. [FG02], [FG06], [FG07], [FG08], [FG09]

Fregat's WorkspaceEdit service publishes local changes before server finalization and can reverse them after a failure. Replacing that protocol with a host-level text setter would lose real product semantics. [FG05]

### 2.7 Build success is not platform compatibility

Singapore's builder infers `.ts` entrypoints from exports, copies CSS, rewrites browser Worker constructors and emits declarations using repository configuration. RSD has conditional native/web exports and a build-time styling transform. A new `.tsx` or nested platform export must not be silently skipped. [SG20], [RSD01]

Fregat consumes 17 linked Singapore packages, not simply current npm releases. Its CI already supports an explicit `editor-ref` while intentionally defaulting to `main`. Use that existing input for paired changes. Do not change the normal tracking policy merely to conceal an integration break. [FG01], [FG11]

## 3. The target ownership model

### 3.1 Five boundaries, one document truth

```text
Application ownership: files, tabs, environments, save, recovery, command/focus routing
                                  |
                 DOM host                 Strict DOM host
                    |                           |
                 React DOM binding     RSD binding + optional native services
                    |                           |
                    +---- shared editor behavior/projection ----+
                                        |
                      shared document + independent view sessions
                                        |
                              existing textbuffer

Execution services attach through typed providers.
The engine does not import a host, React, browser Worker constructors or application services.
```

The diagram describes dependency direction and responsibility, not a proposal for five new runtime objects on every keystroke.

| Owner                 | Responsibilities                                                                                                                       | Explicit exclusions                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Textbuffer            | Preserve storage, snapshots, anchors and existing text normalization policy.                                                           | It does not know about pixels, React or workspace files.                   |
| Shared document owner | Preserve transactions, history, revisions, mutation leases, change publication and document-derived state.                             | It does not own a focused element, tab or renderer.                        |
| Per-view behavior     | Own selection state, command/editing policy, view folds and semantic display projection.                                               | It does not call DOM or native widget methods directly.                    |
| Platform host         | Own mounted text, shaping/measurement, paint, input observation, focus integration, scroll observation and accessibility presentation. | It does not create a second canonical text model or own file persistence.  |
| Execution adapter     | Supply clocks/scheduling and actual parser/highlighter/worker implementations with explicit lifetimes.                                 | It does not redefine editing order or become a universal bottleneck queue. |
| Fregat                | Keep workspace identity, save/conflict recovery, filesystem transactions, retained documents and command/focus services.               | It does not have to duplicate Singapore's editing algorithms.              |

Existing mutable caches and efficient local controllers may remain mutable. “Platform-agnostic” is not a mandate to rewrite every object as a pure reducer.

### 3.2 Package decision

**Keep `@singapore-editor/core` as the final platform-neutral package.** Keep the existing `packages/editor` location initially, so current sibling links and tooling are not churned before the behavioral boundary exists. Develop pure source islands inside it first. Then extract `@singapore-editor/dom` in one coordinated producer cutover after all first-party dependencies have been prepared.

The target dependency direction is:

```text
@singapore-editor/textbuffer
             ↑
@singapore-editor/core
       ↑               ↑
@singapore-editor/dom   @singapore-editor/strict-dom
       ↑
@singapore-editor/react
```

Feature packages depend on portable core contracts. Their DOM views and browser execution factories live in explicit host-specific entrypoints. Introduce additional packages only where an independently consumed/buildable artifact justifies them.

Do **not** make the new DOM package depend on `core` while `core` re-exports DOM through a permanent façade. That creates a package dependency cycle. During the source-island stages, existing exports can still point to local files. At the final package cutover, remove browser root exports and update the producer's packages and Fregat together against the candidate SHA.

| Existing surface                             | Migration rule                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/document`                              | Preserve the document contract and a DOM-free transitive closure.                                                                                                                   |
| `core` root                                  | End with portable state, commands and contracts only. Remove browser convenience exports at the coordinated breaking cutover.                                                       |
| `core/editor` and browser `Editor` types     | Move to `dom`; retain the DOM class's behavior and explicit host typing.                                                                                                            |
| `core/extensions`                            | Keep portable contributions here; move element-bearing contexts into a DOM-specific surface.                                                                                        |
| Browser rendering, snapshots and CSS exports | Move to DOM-owned entrypoints, without changing web paint semantics during relocation.                                                                                              |
| `core/shiki`                                 | Separate the supplied-highlighter tokenizer used by the TUI from browser worker construction. Preserve the headless use case; locate browser convenience factories with their host. |
| Tree-sitter and other feature packages       | Separate provider contracts/session logic from browser default factories. Native imports must not reach those defaults accidentally.                                                |
| `react`                                      | Continue to be the web adapter initially. `mount(HTMLElement)` and `getEditor(): DOMEditor` need not become unsafe unions.                                                          |
| `strict-dom`                                 | Expose an independent RSD host binding using shared state/behavior, with honest target-specific capability reporting.                                                               |

Record the final export map and breaking migration guide before cutover. Do not ship an undocumented forever-alias or a second implementation branded `engine` and `core`.

### 3.3 Source movement map

| Source area                                                         | Decision                                                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `documentSession.ts`, `history.ts`, selection/document edit helpers | Extract the existing domain implementation and its transitive dependencies into the portable island.                                   |
| `editor/Editor.ts`                                                  | Separate host-free orchestration from DOM construction; leave a small browser composition root.                                        |
| `editor/inputSelectionController.ts`                                | Split platform observation/normalization from shared editing and command policy.                                                       |
| `editor/inputState.ts`                                              | Reuse commit/composition invariants, while separating browser selection-owner decisions rather than merely renaming `dom` to `native`. |
| `virtualization/fixedRowVirtualizer.ts`                             | Extract numeric row/window/anchor logic; retain attachment, observation and wheel ownership in DOM.                                    |
| `virtualizedTextViewGeometry.ts` and mounted text/node types        | Keep the current measurement implementation in DOM. Export only new platform-neutral results/contracts to shared code.                 |
| Fold/inline/display mappings and row-height indexing                | Audit as portable candidates; preserve source mapping, invalidation and per-view ownership.                                            |
| `plugins.ts`                                                        | Separate portable declarations, host view contexts, snapshot data and runtime implementation. Keep one contribution ownership system.  |
| `viewContributions.ts`                                              | Retain DOM paint/lifecycle semantics; share only genuinely host-independent routing/lifetime primitives.                               |
| `preparedDocument.ts`                                               | Separate portable prepared data from owned execution-session handoff; preserve match/take/dispose semantics.                           |
| `paintSnapshot.ts`                                                  | Keep renderer-specific visual replay in DOM.                                                                                           |
| `workScheduler.ts` and worker clients                               | Isolate actual clock/timer/cancellation/worker operations behind runtime boundaries without changing their policies.                   |
| React adapter                                                       | Preserve lifecycle and subscriptions while consuming the new explicit interfaces.                                                      |

This is a classification of observed seams, not a completed transitive-dependency audit. P00 and P03 must establish and enforce that graph. [SG03]–[SG20]

## 4. Contracts to settle before moving implementation

### 4.1 Document and view identity

Use existing document sync points, buffer identity, runtime-session identity and view IDs wherever possible. Text equality alone is not identity. An undo branch, reopened document or logical-only transaction can invalidate work without yielding a conveniently different string. [SG03], [SG18]

Keep four concepts separate: canonical document revision, per-view projection/configuration revision, host layout generation, and attachment/input-session generation. Any measurement or asynchronous result must carry enough identity to establish that it still belongs to the current document and view. Reuse existing counters when they already express the same lifetime; do not create duplicate versions for branding purposes.

Snapshots and anchors remain live local domain values. A JSON representation or worker packet is a separate wire format. Never serialize provider functions, live sessions or object identity and pretend that it survived another heap.

### 4.2 Input: preserve user intent, not browser event shapes

The shared behavior layer accepts normalized edit operations, selection changes and semantic commands. The platform adapter owns browser/native event observation, text-window reconstruction and acknowledgement. Shared types must not expose `KeyboardEvent`, `InputEvent`, `ClipboardEvent`, `DataTransfer` or native TextInput instances.

A normalized input operation needs an input-session identity, a sequence/acknowledgement relationship, its base document sync point, replacement range and text, resulting selection, source/intent, and composition information when the platform supplies it. Reuse the existing `TextEdit`, selection and transaction types for those fields instead of inventing parallel position models.

Composition preedit is not canonical document text in the current browser implementation. Preserve the single-commit and undo-group semantics. Reuse the existing state machine and mirroring path: typing, deletion, cut, paste, drop and accepted suggestions must not bypass snippet/linked-edit bookkeeping. [SG07], [SG08], [SG23]

**User input is not stale-droppable derived work.** A stale syntax result may be discarded. An unacknowledged user replacement must instead be rebased or reconciled against its base state, or explicitly refused through a defined input-session recovery path. Never silently drop typed text because its version tag differs.

For native composition, the proof must cover disjoint external edits, overlapping external edits, view detachment, read-only transitions and mutation-lease acquisition. The native host must preserve any unacknowledged text while resolving the conflict. Capture the actual browser policy first; settle any new native-specific overlap behavior in the input ADR before allowing that capability to ship.

Logical editing stays synchronous in the local document owner. Native control preedit or an input shadow window is provisional host state, not a second document authority. Do not turn every keystroke into a backend RPC or force a full document through a controlled textarea value.

### 4.3 Geometry: versioned results from the actual text surface

The shared contract needs position-to-caret geometry, point-to-text hit testing, range-to-rectangles, visual navigation support where necessary, and reveal requests. Rectangles are plain values with an explicit coordinate space, not `DOMRect` under another name.

Distinguish content-local coordinates, viewport coordinates and screen/client coordinates. Normalize host scaling once. Bind results to the measured document, projection and layout generation. Affinity at BiDi boundaries and wrap seams is part of the result, not an optional cosmetic detail.

Do not require every implementation to synchronously measure unmounted text. The contract must distinguish **ready**, **pending**, and **unavailable**. A request may cause the host to mount/commit a window and publish a ready result later. The browser's current fast synchronous path can remain fast; the shared core must not fake it on another runtime.

Only use geometry after the host's corresponding layout is committed. Cancel obsolete reveal/measurement requests on document replacement and disposal. An old result must never reposition the new document's caret.

Do not manufacture a glyph engine with one component per character, a second offscreen text renderer with different shaping, or average widths for mixed-script correctness. Share numeric window planning; let the actual host text system shape the visible text. [SG09], [SG10], [SG23], [RSD02]

### 4.4 Render plans and invalidation

Expose immutable or stable-identity semantic row/chunk projections, source mappings, token ranges, selection data and decoration instructions. Subscribe the host only to changes it consumes. Do not rebuild an entire document-shaped React tree or serialize a full snapshot for each edit.

Keep invalidation categories explicit: document edits, syntax/style data, selection, projection/folds, viewport, font/layout metrics, and plugin configuration. Preserve row/chunk reuse and source-window bounds. A change before a mounted row may update its source offsets without requiring wholesale node replacement. [SG23]

The host owns its mounting strategy and actual measurements. Native wrapping may produce different line breaks from the browser. Correct source mapping and caret placement are required; pixel-identical layout across operating systems is not assumed.

### 4.5 Plugin power and portability

A plugin can have portable logic, a DOM view contribution, a native view contribution and an execution service. This does not require separate competing plugin runtimes. Composition, demand registration, ordering, cancellation and disposal should follow the existing direction of Plan 122. [FG12]

Keep full DOM access available to DOM-specific plugins. Keep native service access explicit on native. “Portable” must not mean reducing every plugin to the least common denominator. It also must not mean importing a browser library at module scope and guarding its use afterward with a platform check.

Resolve required capabilities before activation. A supported component may omit optional native features, but a required feature must fail visibly with a useful reason instead of quietly registering a no-op. A capability declaration is a routing/compatibility mechanism, not a security sandbox for trusted plugins.

Route updates to interested contributions **before constructing expensive payloads**. Preserve the existing viewport-specific fast path and lazy snapshot values. Test registration/reconfiguration, ordering, disposal, reentrancy, failure containment and providers imported after an editor already exists. [SG11], [SG12]

### 4.6 Execution and prepared ownership

Move browser Worker creation out of portable entrypoints. Preserve existing per-owner lifecycle and generation behavior. `TreeSitterBackend` is the starting point, not a blank sheet. The native adapter may use an appropriate native execution implementation after its own proof; there is no basis here to assume the browser's Worker/WASM bundle simply runs in Hermes. [SG16], [SG18]

Clocks, frame scheduling, timers, cancellation objects and any opportunistic shared-memory support require a runtime compatibility audit. Keep scheduling policy separate from the concrete driver. Do not make an otherwise portable package compile by declaring fake DOM globals.

Prepared documents contain both derived data and owned live parser/highlighter sessions. Preserve one-time `take()`, configuration/provider/snapshot matching and disposal of unclaimed stages. Sharing immutable data is different from transferring a live session to a new owner or heap. [SG13]

### 4.7 Paint replay and React lifecycle

Paint replay is visual-only, renderer-specific and bounded. It must never supply document text/revision truth. Preserve the current DOM format, appearance checks, payload validation, provisional state and initial-paint handoff during the extraction. Native replay, if added, gets an explicit renderer identity and compatible configuration envelope; do not replay browser rectangles onto a native text surface. [SG14], [FG02], [FG14]

Keep React controllers stable and preserve disposal deferral and incarnation/document-generation guards. A stale initial-paint callback must not publish state for a replaced document. Keep `storeSync: 'none'` effective for consumers that intentionally avoid normal editor-store publication. [SG15]

## 5. Fregat compatibility contracts

These become executable tests before the public package cutover.

| Consumer                      | Contract that must survive                                                                                             | Required regression scenario                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Main editor                   | The live buffer and view remain the same logical owners across unrelated React renders.                                | Change settings/sidebar state without reopening the document or replacing its history.                                  |
| Two views of one buffer       | Text/history are shared; selections, scroll and folds remain independently owned as today.                             | Edit in A, observe B, reveal a hidden C, undo from B, then return to A.                                                 |
| Prepared open                 | Prepared tags and provider identity control adoption; transfer/disposal happens once.                                  | Open, cancel, reopen, change syntax/theme configuration and deliver an obsolete preparation result.                     |
| Cached paint                  | Old paint is inert visual continuity, not authoritative text.                                                          | Restore incompatible appearance, malformed payload, Decode mode and a superseded document generation.                   |
| Hosted keymap                 | Fregat remains the keybinding and command/focus owner.                                                                 | A command/chord fires once, targets the right pane and does not accidentally invoke Singapore's standalone binding.     |
| Main plugin construction      | Plugin identity and language/configuration determine activation cost and first paint.                                  | Switch plain text, TypeScript, Markdown and Shiki mode; verify appropriate registrations and no unwanted parser demand. |
| Diff panes                    | `setText` preserves scroll; projection row identity remains exact; regular editor plugins do not alter the projection. | Expand a hunk, receive delayed tokens, copy selected text and place a line comment without source-row drift.            |
| Search results                | Excerpts are bounded and readonly; source mapping is not the same as local projected row index.                        | Navigate a match, resize/scroll the outer list, rebuild a line window and verify the correct source line opens.         |
| Readonly views                | User mutation is blocked while application-owned projection updates remain possible.                                   | Try typing/paste/drop/commands, then update a diff/search projection programmatically.                                  |
| WorkspaceEdit                 | Leases, sequence receipts, logical revisions, finalization, compensation and retained recovery state remain intact.    | Apply across two buffers, force finalization failure, reverse locally, verify history and retained locks.               |
| Environment identity          | A repeated file path in another environment is not the same document owner.                                            | Switch A → B → A while preparation/LSP work is pending; verify save destinations and accepted results.                  |
| TUI syntax                    | Supplied-highlighter tokenization does not acquire a DOM renderer or browser worker dependency.                        | Run the existing terminal tokenizer through the built package exports, not a workspace-source alias.                    |
| Shared diff utilities         | Full-file text and partial patch data remain distinguishable.                                                          | Test patch-only, full-text, missing-side and empty-file inputs.                                                         |
| Linked-package development/CI | New packages and export locations resolve to the intended source/build version.                                        | Build the candidate producer, link/install the consumer cleanly and verify the recorded producer SHA.                   |

These scenarios come from inspected consumers and documented ownership, not assumptions that every feature uses the main `<Editor>` component. [FG01]–[FG14]

## 6. Native feasibility: the gates that actually matter

### 6.1 What the RSD evidence says

The published HTML compatibility table is not a sufficient runtime verdict. It documents limited native layout and several missing/partial APIs. Meanwhile, the native source already forwards `onSelectionChange`, despite the corresponding table status. Treat that mismatch as a reason to test, not as proof that either the whole integration works or cannot work. [D02], [RSD03]

In the reviewed input adapter, input/change callbacks receive minimal objects containing the text value; keydown is built from filtered keypress/submit data; selection updates forward a native event. The strict-ref implementation may update cached selection fields even when an optional underlying `setSelection` call is absent. A passing typecheck or reading back cached values does not demonstrate that the actual native selection moved. [RSD02], [RSD03]

React Native documents separate native change counters, selection events and keyboard limitations. Its Text layout callback provides line measurements, not by itself the complete caret/range/hit-test service required here. [D09], [D10]

RSD's `compat.native` is explicitly experimental. Native APIs can also be added outside RSD through native modules. These provide possible implementation routes, not an already verified editor backend. [D04], [D06]

### 6.2 Four distinct outcomes

| Outcome                                      | What it means                                                                                | Release position                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Portable core + current DOM host             | Existing browser editor uses the extracted shared implementation.                            | This is the unconditional extraction target.                               |
| Pure RSD native editor                       | Public RSD APIs meet all required input, geometry, scroll and accessibility contracts.       | Ship only after the target-runtime proof passes; do not assume it.         |
| RSD host + narrow native text/input services | RSD composes the UI while a native implementation supplies missing text-system capabilities. | This is the preferred contingency if the pure API surface is insufficient. |
| Browser editor embedded in a WebView         | Existing DOM editor runs in a separate browser environment.                                  | This is an explicit product fallback, not native Strict DOM certification. |

A read-only RSD viewer may ship as a separately named limited capability. It must not be reported as completion of the editable native target. Expo's DOM-component route uses a WebView-based architecture and therefore has separate lifecycle, focus, messaging and memory costs to measure. [D16]

### 6.3 Proof matrix

| Gate                      | Experiment                                                                                                     | Passing evidence                                                                                           | Failure response                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| N0: package/runtime       | Render a styled component from the **built candidate package** on web, iOS and Android.                        | Correct target export, applied styles, no browser-only module evaluation, recorded runtime versions.       | Fix packaging before interpreting editor behavior.                                   |
| N1: native input          | Record insert, replace, delete, paste, autocorrect and selection changes.                                      | Each acknowledged operation appears once in the document, with exact selection and undo behavior.          | Provide a richer input adapter rather than guessing from key strings.                |
| N2: composition           | Use physical OS IMEs, including CJK, with commit/cancel, focus loss and external edits.                        | Preedit/commit distinction and no lost/doubled text, with traceable acknowledgements.                      | Add native composition support or keep editing unshipped.                            |
| N3: actual selection      | Programmatically move/collapse/extend selection and verify visible native selection plus subsequent insertion. | Real UI behavior agrees with engine offsets; cached getters alone are insufficient.                        | Reject the polyfill-only claim; use a supported underlying/native path.              |
| N4: glyph geometry        | Test caret/point/range mapping on Hebrew/English, Arabic, emoji, combining marks, tabs and ligatures.          | Geometry corresponds to the text actually drawn, including wrap/BiDi affinity and discontiguous selection. | Implement narrow native text geometry; do not fall back to width multiplication.     |
| N5: viewport              | Exercise long lines, large documents, two-axis scroll, reveal, keyboard resize and font scaling.               | Mounted work stays bounded and reveals settle at the correct committed layout.                             | Revise the host/window strategy before adding more features.                         |
| N6: input/worker races    | Delay derived work, replace documents, remount hosts, change language/theme and deliver old results.           | Old derived work is rejected; unacknowledged user edits are reconciled, not discarded.                     | Repair identity/ownership before feature rollout.                                    |
| N7: accessibility         | Use VoiceOver/TalkBack to focus, read, navigate, select and edit, with virtualized content and controls.       | The declared native scope is operable without sight and does not announce duplicate hidden/visible text.   | Fix the native text accessibility integration; a hidden textarea alone is not proof. |
| N8: sustained interaction | Type, paste, scroll and switch views during long sessions on physical devices.                                 | Recorded latency, memory, queue and lifecycle behavior meet predeclared device-specific limits.            | Optimize the host or narrow the certified scope; do not relax the browser gate.      |

For every gate, retain the exact candidate SHA, dependency lockfile, OS/device/keyboard versions, scenario input, event/commit trace, expected text/selection, observed result and known limitations. Mark **not run**, **passed**, or **failed** explicitly. A simulator/synthetic test and a physical-operator test are different evidence classes.

### 6.4 What a narrow native bridge should contain

Prefer an adapter to the text system that actually draws the text, not a new shared shaping engine. Apple's `UITextInput` describes marked text, selection, caret rectangles and hit testing. Android's `Layout` and `InputConnection` expose relevant geometry and composition responsibilities. These are plausible lower-level building blocks to investigate, not a claim that they are already exposed through the reviewed RSD version. [D11], [D12], [D13]

The bridge should expose versioned text-window application, input acknowledgements/composition state, selection control and measured position/range queries. Avoid a general DOM emulation layer. Keep native text layout and the drawn styles/fonts synchronized; do not measure one representation and paint another.

An IME may ask for text beyond a fixed hidden-input window. Windowing must support coherent surrounding-text requests and coordinate translation, not silently truncate input-method semantics to an arbitrary number of characters.

## 7. Execution sequence: small migrations, explicit gates

The units below are dependency-ordered changes, not time estimates. “Owner” names a responsibility, not an assigned person. Existing plan sequencing remains authoritative until this proposal is explicitly scheduled. A unit may contain several reviewable commits, but every merge must preserve a working DOM editor and a reproducible Fregat pairing.

### P00 · Capture the paired baseline and complete the census

**Owner:** Singapore architecture + Fregat integration. **Depends on:** nothing.

Record both actual checkout HEADs, complete dirty diffs, lockfiles, runtime versions and the linked producer build identity. Inventory all Singapore imports in Fregat and first-party packages, including dynamic imports, type-only imports, CSS, test/internal entrypoints and re-exports. Classify each as document, behavior, rendering, execution, application or tooling. Trace dependencies transitively, including declarations and module-level side effects; a grep for `document` alone is insufficient.

Extend the existing architecture-health inventory with portable-entrypoint dependency rules and a producer/consumer import ledger. Record the DOM classes/data attributes that consumers inspect. Audit every feature package, including find, gutters, scope lines, minimap, Markdown, Decode, diff, plugin UI, LSP and TypeScript integration. Mark uninspected or ambiguous dependencies explicitly. [SG22], [FG01], [FG06], [FG11]

**Exit:** checked-in baseline manifest, complete import/host-dependency inventory, surface regression matrix, frozen old built dependency closure and reproducible baseline results. No production behavior changes. **Rollback:** none required beyond removing research tooling; preserve collected evidence.

### P01 · Decide the minimum contracts and plan ownership

**Owner:** shared architecture review. **Depends on:** P00.

Write decision records for document/view/host ownership, normalized input acknowledgement, geometry availability and coordinate spaces, execution providers, host-specific contribution access and final export locations. Compare the proposed boundary against actual call sites rather than defining interfaces from imagined future hosts.

Use three reference examples: a pure document command, a selection-driven decoration and a DOM-specific view contribution. Add a bounded native input example. Review CodeMirror's state/view separation and Monaco's distinct event surfaces for useful concepts; neither API inventory establishes performance guarantees or solves native text input. Final plugin-authoring choices remain coordinated with Plan 122, including its comparison experiments. [D14], [D15], [FG12]

**Exit:** every public contract has a real caller, lifecycle, error behavior and test. Unproven native requirements remain conditional instead of being hidden behind `any`. Record how overlapping changes belong to Plans 099/122. **Rollback:** revise decisions before source relocation; no new production API needs to become permanent yet.

### P02 · Run the native feasibility lane early

**Owner:** native host/runtime. **Depends on:** P00; feeds P01, P05, P06 and P12.

Create a small RSD test application using the exact intended native dependency set. Start with N0–N4: built-package styling, input traces, physical composition, actual selection movement and glyph geometry. It may use existing document factories or a test-only buffer driver; do not duplicate production editing algorithms to make a demo pass.

Record where public RSD APIs suffice, where native integration is required and which capabilities are unavailable. Test programmatic selection by observing the native UI and inserting afterward, not by trusting polyfill getters. Preserve original native events in the proof harness where possible so normalization losses are visible. [RSD02], [RSD03]

**Exit:** a concrete choice between pure RSD and RSD plus native services for the initial certified scope. A failed native gate does not block the independent headless/DOM extraction, but it blocks claims about native editing. **Rollback:** remove or disable the experimental host; retain useful core work and all failed experiments.

### P03 · Establish portable source islands and compiler fences

**Owner:** Singapore core. **Depends on:** P00–P01.

Within the current package, isolate document types, offset/range/selection types, semantic token/style data and reusable calculations. Remove accidental imports of browser metric, element, rectangle and event types from the portable closure. Keep host-specific types explicit rather than giving them misleading neutral names.

Add a dedicated portable compiler target using an ECMAScript library set and no browser ambient types. Runtime services that are not part of ECMAScript must be explicit dependencies or narrow existing-compatible contracts; do not add fake DOM declarations to make the fence green. Test built declarations and runtime imports independently because type erasure can conceal an unsafe runtime import and a safe runtime can still export DOM-dependent declarations.

**Exit:** the first genuine portable entrypoints compile and import in a non-DOM fixture. Existing root imports remain intact while implementation is still local. **Rollback:** move the affected island back without changing document semantics.

### P04 · Extract the existing document and view-state owners

**Owner:** Singapore core + Fregat transaction integration. **Depends on:** P03.

Move the existing buffer/session/history/selection/edit-chain implementation into the portable boundary. Keep the public document contract and object ownership stable. Cover every mutation path: typing, batch edits, undo/redo, history checkout/clear, prepared commits, segmented sequences, compensation, clean-state changes and logical-only publication. Preserve mutation leases and external history barriers. [SG03], [SG04]

Replay identical operation traces through the baseline and candidate: compare resulting text, revision/sync-point semantics, anchor resolution, view selections, history reachability and listener order where it is contractual. Use the baseline as a regression oracle, not proof that every old behavior is desirable. Any intentional bug fix gets its own test and separate justification.

**Exit:** document operations run without DOM and the Fregat transaction tests retain their behavior. No new publication bus, worker authority or storage algorithm. **Rollback:** revert the relocation; do not migrate persisted document formats in this unit.

### P05 · Separate input observation from editing policy

**Owner:** input/commands. **Depends on:** P04 and P01; native-specific policy is informed by P02.

Split `InputSelectionController`: keep DOM listeners, hidden-input reads/writes, clipboard objects, drag/drop and browser selection reconciliation in the browser adapter. Move shared command/editing behavior through the existing transaction owner, including autoclose, snippets, linked edits, indentation and history grouping. Preserve the one path that updates mirrors for typed, pasted, cut, dropped and accepted text. [SG07], [SG08]

Introduce normalized input observations with explicit ownership and acknowledgement. Do not translate every keydown into inserted text or fabricate browser events on native. Test duplicate delivery, composition cancel/commit, selection changes during composition, readonly transitions, mutation leases, disposal and a delayed native observation after an external edit. Distinguish an obsolete attachment from unacknowledged text that must be reconciled.

**Exit:** baseline browser input behavior passes through the separated policy with no double commits or bypasses. Pure behavior tests require no element fixture. **Rollback:** reconnect the old DOM adapter to the same document owner, not to a second shadow editor.

### P06 · Separate projection and viewport calculations

**Owner:** display/virtualization. **Depends on:** P03–P04; geometry contracts informed by P02.

Extract numeric row-window, row-height, overscan, scroll-anchor and source-mapping calculations from platform observation. Classify fold/inline transforms and caches by document or view lifetime. Keep DOM text nodes, resize observers, wheel handlers, platform scroll caps and actual glyph measurement in the host. [SG09], [SG10]

Test hidden views, variable-height rows, wrapping, folded ranges, inline replacements, injected rows, horizontal chunk windows and invalidation after edits before the visible range. Geometry requests must reference a committed layout or explicitly report pending/unavailable. A missing measurement cannot silently become offset zero.

**Exit:** a host-free projection test can compute the desired window from document/view state and supplied metrics; browser row identities and bounded allocations remain unchanged. **Rollback:** restore the old attachment path around unchanged calculations.

### P07 · Make the existing DOM renderer an explicit host

**Owner:** DOM rendering/input/accessibility. **Depends on:** P05–P06.

Collect DOM creation, mounted rows, CSS Highlights, geometry, input placement, scrolling, browser metrics, announcements and paint capture behind the chosen host boundary. Keep the current DOM implementation rather than rebuilding it as React components. The existing `Editor` becomes a browser composition root around shared state and behavior.

Preserve source/peer callback ordering and the measured hidden-textarea write-before-caret-measurement sequence. A simplistic global “read everything, then write everything” rewrite can undo the current input-layout optimization. Optimize ordering only in a separate measured change. Retain DOM classes/attributes relied on by Fregat. [SG05], [SG23], [FG06]

**Exit:** the existing browser fixtures, input geometry, plugin paint and Fregat surface contracts pass against the host-separated implementation. **Rollback:** revert host extraction as a unit; preserve the portable document owner.

### P08 · Isolate execution contracts from browser factories

**Owner:** syntax/runtime. **Depends on:** P03–P04; coordinate with Plan 099.

Move `TreeSitterBackend` and portable provider/session contracts out of browser Worker implementation files. Separate the supplied-highlighter tokenizer from Shiki worker construction. Inventory minimap and language-service runtime imports, cancellation, source transport and build assets. Preserve each owner’s current restart, disposal, idle-fence and freshness semantics. [SG16], [SG18], [FG08]

Do not invent a fake Worker API for every runtime or make unsupported analysis appear as a successful empty result. A native execution path gets an explicit implementation and support state. Browser shared-memory optimizations and cancellation must remain optional where designed; this unit does not independently implement Plan 099's transport migration.

**Exit:** portable/native entrypoints do not evaluate browser factories; existing web worker behavior and TUI tokenizer usage are preserved. **Rollback:** restore a host-specific factory entrypoint, without reverting shared document state.

### P09 · Partition contribution types without creating another plugin framework

**Owner:** extension system + feature-package owners. **Depends on:** P05–P08; coordinated with Plan 122.

Separate portable commands/data/providers from DOM-specific view contexts and paint/capture interfaces. Keep trusted DOM extensions powerful. Add explicit target/capability matching only where needed, with predictable unsupported-feature reporting and cleanup. Preserve current provider precedence, cached language ordering, demand-triggered ambient activation and failure containment. [SG11], [SG12]

Migrate representative features before finalizing names: one command, one data decoration, one gutter or overlay, and one syntax-backed feature. Test late registration, duplicate ownership, configuration changes, reentrancy, provider failure and disposal during notification. A general catch-all update remains opt-in rather than the new default. Do not implement a second `createPlugin` universe or require the complete future Plan 122 runtime before moving the existing boundary.

**Exit:** a portable extension compiles without host types; a DOM extension still accesses real DOM through its explicit surface. No extra unrelated payload construction is introduced by the migration. **Rollback:** keep the old authoring route locally until the paired public cutover; never retain two active contribution owners for one feature.

### P10 · Preserve React, prepared-open and paint handoff behavior

**Owner:** React binding + Fregat presentation. **Depends on:** P07–P09.

Update the current React controller internally to consume the explicit browser composition root. Preserve stable controller identity, controlled option synchronization, full/none store modes, deferred disposal and incarnation/document guards. Keep DOM binding types concrete instead of widening `getEditor()` to a platform union that leaks unsafe assertions into consumers. [SG15]

Preserve prepared stage matching, one-time adoption and release of unclaimed live sessions. Keep the current bounded DOM paint codec and provisional/authoritative handoff. Separate native renderer caches rather than making browser paint appear universal. Test mount replay, unmount/remount, stale initial paint, rejected prepared tags, cancellation and a provider result arriving after disposal. [SG13], [SG14]

**Exit:** main editor, prepared-open and paint-cache regression scenarios pass; no unintended React-store materialization is added to `storeSync: 'none'` surfaces. **Rollback:** revert adapter wiring with the same document/view owners intact.

### P11 · Perform the paired package and consumer cutover

**Owner:** release/build + Fregat integration. **Depends on:** P03–P10, all browser gates.

Create the explicit DOM package and update Singapore's feature-package imports, exports, dependencies, CSS paths, declaration output, architecture inventories and build ordering together. At this point remove browser exports from the pure core root. Do not publish a `core -> dom -> core` compatibility cycle. [SG19]–[SG22]

Update Fregat's imports, type imports, linked-package overrides, required sibling links and linked-source verification. Use the existing CI `editor-ref` to test the exact candidate Singapore commit. Preserve diff/search-specific settings, hosted keymaps, WorkspaceEdit calls, TUI tokenization and shared diff helpers. The application must not acquire a second React or editor-runtime instance through packaging. [FG01], [FG06]–[FG11]

Test the actual built or packed packages from a clean consumer resolution environment, not only source aliases. Verify `.tsx` entries and nested platform conditions are handled intentionally. Keep worker self-containment assertions with the package that now owns those workers. Confirm the RSD styling transform and CSS extraction include packaged UI code when relevant; the official Vite guide has version-sensitive transform setup. [SG20], [D07], [D08]

**Exit:** recorded export migration map, no package cycles, portable built-import proof, producer checks, paired Fregat checks and unchanged web functionality. Merge through the repository's coordinated release policy, accepting that this is an explicit breaking cutover rather than disguising it as a compatible rename. **Rollback:** return both producer and consumer to the recorded compatible pair, including linked builds and lockfiles.

### P12 · Build the production Strict DOM host against the shared core

**Owner:** RSD/native host. **Depends on:** P02's explicit capability decision and shared boundaries from P04–P09; package wiring from P11 before release.

First consume the shared semantic projection to render a bounded readonly viewport, then add real input, selection, scrolling and composition against the same document owner. The intermediate readonly milestone does not close this unit. Use the native bridge selected by the proof where necessary. Do not measure one font/style representation and paint another or promote cached native input text to document authority.

Add supported gutters/decorations and required syntax through proven adapters. Keep unsupported DOM-only plugins out of the native dependency graph. Preserve feature/data contributions where possible, but certify visual features separately rather than claiming all Fregat plugins now render natively. Exercise all N0–N8 gates for the declared release scope.

**Exit:** editable native evidence on the named iOS/Android runtime combinations, documented exclusions and no duplicated editor behavior. **Rollback:** disable only the native host; the portable core and existing DOM host remain usable.

### P13 · Run integrated correctness, performance and lifetime certification

**Owner:** cross-project validation. **Depends on:** P11 for browser; P12 for native claims.

Run the full Fregat matrix and the benchmark/lifetime protocol below. Include real ordinary files, huge line counts, huge single lines, Unicode, multiple visible views and hidden retained views. Reproduce fresh controls where the harness/hardware requires them, preserving established limits rather than resetting them to fit the candidate. Freeze and hash the entire relocated dependency closure. [SG23]

Native measurements use separately recorded device-specific baselines and budgets. Test long sessions, foreground/background transitions, keyboard changes, memory pressure and delayed input/analysis. A web pass does not certify native behavior, and native device noise does not excuse a web regression.

**Exit:** independently reviewable results and an explicit status for every release gate. Failing mandatory cases keep the corresponding scope unshipped. **Rollback:** bisect by migration unit and use the recorded compatible pair or disable the experimental host.

### P14 · Close the migration and publish the support contract

**Owner:** maintainers/release. **Depends on:** P13 for the scope being released.

Remove superseded forwarding paths, duplicate ownership, temporary source-island bridges and unused exports after all consumers migrate. Keep a deliberate DOM-specific escape hatch rather than an undocumented internal escape route. Update package documentation, architecture diagrams, source inventories and the cross-project roadmap through its normal scheduling process. Keep deferred native features explicitly separate from completed headless/DOM work.

A host switch must occur at a defined attachment boundary, never by silently tearing down an active composition and dropping unacknowledged input. Rollback retains canonical documents and app-owned save/recovery state. Publish exact supported runtime combinations, limitations and validation links.

**Exit:** one canonical domain implementation, explicit host ownership, no permanent migration façade and a support statement that matches the evidence.

### Critical path and parallelism

```text
P00 → P01 → P03 → P04 → P05/P06 → P07 → P09/P10 → P11 → P13 → P14
                    └──────────── P08 ────────┘
P00 → P02 native proofs → contract feedback → P12 → native P13 → native P14
```

The diagram is a scheduling summary; the detailed prerequisites above govern. Native research can run early while the safe extraction proceeds. Core import-fence work need not wait for a native renderer. Public host contracts must absorb proof results before being declared stable.

## 8. Correctness and performance protocol

### 8.1 Three independent proof layers

**Domain proof:** run the same edit/selection/history/lease traces without a host. Validate offsets, UTF-16 boundaries, anchors, logical revisions and view ownership. Add randomized operation sequences with recorded seeds and shrinking/reproduction inputs. A reference comparison does not replace invariant tests.

**Host conformance:** feed equivalent semantic changes into each host and inspect visible text, source mappings, selections, committed geometry, reveal completion, input acknowledgements and cleanup. Allow legitimate platform shaping differences; reject source/position disagreement. Test geometry promises both before and after mounting/commit.

**Application proof:** exercise Fregat's actual main, diff, search, WorkspaceEdit, prepared-open, paint-replay, TUI and shared-utility paths. Library examples are necessary but not a substitute for the consumer contracts in section 5.

### 8.2 Preserve the calibrated browser gate

Singapore already documents an input benchmark with unchanged controls, a held-out unchanged run, a real delayed-event negative control and distinct timing/render-correctness measures. Reuse that methodology and its recorded limitations. Existing results are local historical measurements, not a newly verified universal latency promise. [SG23]

Measure the entire initiating handler, including peer-view updates and work after the source change callback. Keep input-to-applied, full dispatch, next-frame opportunity and screenshot-completion upper bound distinct. A fast `onChange` timestamp does not prove the handler stayed fast; a frame callback is not a pixel timestamp. Preserve screenshot timing's advisory status while keeping actual rendered text and visible changes mandatory. [SG23]

Do not invent an arbitrary “within 5% is fine” allowance or silently retune calibrated limits after observing the candidate. Preserve old failures, control identities and raw samples. Where a new environment requires calibration, define the protocol before candidate collection and require an independent unchanged holdout and a negative control.

The current frozen-reference mechanism is core-directory-oriented. Once DOM code moves into another package, extend the freeze, resolver and source hash to cover **all changed runtime dependencies**. Otherwise a supposed old reference can load the candidate DOM host and invalidate the comparison. Source and built exports must describe the same dependency set. [SG23]

### 8.3 Structural work bounds

Enforce viewport-bounded mounted rows/chunks and geometry buffers, stable reuse where unchanged, and bounded queues/caches. Do not materialize full document text or call snapshot `toJSON()` to feed an incremental render. Cold preparation or explicit export can still materialize text where the existing contract permits it; do not claim an unrealistic global ban. [SG11], [SG13], [SG23]

Instrument demand routing so an operation with no interested plugin consumers creates no new plugin payloads or callbacks attributable to the new path. Also count registration/index-maintenance overhead and affected dependency edges. “No callbacks” alone is not proof that a global selector scan is cheap. Preserve efficient existing paths without claiming the current complete plugin runtime is already selective. [SG11], [SG12], [FG12]

Keep input-critical local work independent of slow derived analysis. Preserve current debounce/max-wait policy unless a separately measured change is approved. Reject stale derived results, but retain/reconcile unacknowledged input. Record queue depth and oldest-work age rather than reporting only average task time.

### 8.4 Lifecycle and memory

After repeated document open/close, split/unsplit, mount replay, feature toggles and environment switches, verify no unexpected live listeners, workers, timers, registrations, retained input sessions or pending paint/geometry requests. Inspect bounded cache ownership separately from intentionally retained document/history state.

Use repeated warm/cold cycles and retained-object evidence. Do not infer a strong leak from a single non-collected WeakRef or promise a GC deadline. Diagnostics must not retain full documents merely to report timings. Native retention must include both JS and platform resources, not only the JavaScript heap. [SG16], [SG23]

### 8.5 Build and package verification

| Fixture                      | Required check                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Portable TypeScript consumer | Built core declarations compile without DOM ambient types or React types.                                                    |
| Headless runtime             | Import and use document operations without browser globals, renderer side effects or automatic worker creation.              |
| Built DOM consumer           | CSS, worker assets, declarations and public exports resolve; expected browser behavior remains.                              |
| Fregat linked consumer       | Candidate producer SHA is the one actually built and loaded; new packages and symlinks are complete.                         |
| Packaged RSD web consumer    | The styling transform includes the package and emitted CSS is applied, not just present in source.                           |
| Native consumer              | Metro/platform resolution selects native entries; browser Worker/CSS modules are absent from that entry's evaluated closure. |
| Singleton identity           | React, shared editor runtime and capability tokens do not duplicate across package boundaries.                               |

RSD's CSS subset is not a reason to erase existing web styling power. Preserve browser CSS/variables in the DOM host and define native-compatible semantic style data where sharing is real. Do not assume arbitrary selectors, CSS Highlight rules or raw CSS files are portable. [D03], [SG19]

### 8.6 Existing commands to retain

These commands are an execution checklist, **not commands run during this research**. Use each repository's pinned runtime and its documented dependency provisioning.

```sh
# Singapore: build and repository checks
bun run build
bun run health
bun run typecheck
bun run test
bun run lint
bun run format:check

# Singapore: compare frozen package sets through the paired input runner
bun run bench:input:paired --baseline <packages> --candidate <packages>

# Fregat: after building/linking the intended Singapore checkout
bun run verify
```

Historical input results remain as saved evidence. Fresh collection uses the paired runner and follows the stress-runner instructions, frozen-package protocol and actual argument schema. The new headless/native/package fixtures need explicit scripts added in their owning migration units rather than guessed command names. A skipped browser/physical-device case is not a pass. [SG21], [SG23], [SG24], [FG01], [FG11]

## 9. Existing plans: cooperate rather than fork ownership

### Plan 099: document publication and contribution synchronization

Preserve its ownership of canonical publication and demand-driven source synchronization. Source-island extraction can move the **current** implementation before the proposed contribution runtime is built. If publication code is changed as part of the work, reconcile that change into Plan 099 rather than creating a parallel journal, second buffer bus or native-only revision system. [FG13]

Keep separate execution queues and typed feature results. Do not independently switch text transport, consolidate workers or move document authority. Its public backend cutover must still follow the prerequisite contracts named in the cross-project roadmap. This proposal does not reorder them. [FG13], [FG14]

### Plan 122: composable full-power plugins

Preserve the direction toward one authoring entrypoint, extensible composition, trusted access and selective execution. Partitioning portable and host-specific contributions is compatible with that direction; introducing another plugin runtime for RSD is not. Do not require the whole proposed authoring/runtime redesign merely to extract existing document and host boundaries. [FG12]

Both plans should share the same document/view/lifetime definitions and compatibility decisions. Pair overlapping reviews and agree on the owner of each changed contract. Keep the historical proposed-plan status distinct from implemented code throughout.

### Roadmap and release discipline

Fregat's root roadmap identifies itself as the cross-project ordering authority. Promote this work there only through an explicit scheduling change. Keep architecture documentation as evidence/design, not an accidental authorization to implement unrelated native product scope. [FG14]

## 10. Decisions deliberately rejected

| Alternative                                                  | Why it is rejected for this plan                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Replace DOM tags with `html.*` and keep imperative internals | It leaves event, geometry, observer, worker and plugin dependence untouched.                                      |
| Copy the editor into a native package                        | It forks editing/history/selection behavior and makes future correctness fixes diverge.                           |
| Make the core depend on RSD                                  | It excludes existing headless consumers and couples domain logic to one UI abstraction.                           |
| Rebuild the working DOM renderer in React now                | It combines extraction with a different rendering/performance project without evidence that the change is needed. |
| Make all host operations promises                            | It would erase the current synchronous fast path and obscure which operations genuinely await layout.             |
| Require all geometry to be synchronous                       | It forces native/unmounted text to fabricate results or reach through unsupported internals.                      |
| Treat native input as latest-only derived state              | It can silently discard user text during asynchronous reconciliation.                                             |
| Create one universal worker/service queue                    | It changes ownership and allows unrelated slow work to delay editor features.                                     |
| Force every plugin into portable-only APIs                   | It removes intentionally powerful DOM/native features instead of making their targets explicit.                   |
| Keep a permanent browser façade inside pure `core`           | It either contaminates the portable closure or creates a dependency cycle with `dom`.                             |
| Use average glyph width as the correctness fallback          | It cannot establish exact source-to-glyph mapping for the required text cases.                                    |
| Declare a readonly viewer or WebView “native editor done”    | It certifies a different capability from the editable native target.                                              |

These are architectural judgments based on the inspected seams and required contracts, not benchmarked rankings of complete alternative implementations.

## 11. Open evidence register

All entries below are open at the end of this research. They are scoped experiments or inventory work, not hidden assumptions.

| Unknown                                         | Owner / gate                | Required evidence and decision                                                                                            |
| ----------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Full transitive source/type/runtime graph       | Architecture / P00–P03      | Complete import census and portable compiler/runtime fixtures; revise the movement map where indirect coupling appears.   |
| Local working-tree drift                        | Both repositories / P00     | Actual HEADs and complete dirty diffs; reconcile before using this plan as an execution baseline.                         |
| Exact initial native runtime and feature scope  | Native host / P02           | Pin target combinations and mandatory capabilities; do not assume native desktop or full Fregat parity.                   |
| Public RSD input sufficiency                    | Input / N1–N3               | Physical input/selection/composition traces; select public APIs or an explicit richer native adapter.                     |
| Precise native text geometry                    | Display / N4–N5             | Measured caret/range/hit-test conformance against the drawn text; select a concrete text-surface implementation.          |
| Native parser/highlighter execution             | Runtime / P08–P12           | Actual asset loading, cancellation, threading and lifecycle proof on the selected runtime; no assumed Worker/WASM parity. |
| Required native plugin subset                   | Feature owners / P09–P12    | Per-feature data, UI, geometry and service capability inventory with honest fallback/unsupported behavior.                |
| Input during conflicting external transactions  | Input + WorkspaceEdit / P05 | Explicit policy and race tests for disjoint/overlapping edits, leases and unacknowledged composition.                     |
| Native virtualization/accessibility interaction | Host accessibility / N5–N7  | Real assistive-technology navigation and editing across window boundaries without duplicate or missing text semantics.    |
| Performance and lifetime after extraction       | Validation / P13            | Fresh comparable built-artifact runs, controls, full dependency hashes and retained-resource evidence.                    |

Do not close an entry using a documentation table, type signature or screenshot when the required evidence is behavioral. A useful proof may discover that more native code is necessary; that is a resolved design question, not a reason to weaken the acceptance test.

## 12. Definition of done

**Headless/DOM extraction is complete** when the built core and declarations have a proven platform-neutral dependency closure; one canonical document/behavior implementation serves the explicit DOM host; existing Fregat surface and transaction contracts pass; browser correctness/performance gates are preserved; and the paired package cutover leaves no duplicate owners or permanent migration façade.

**Editable Strict DOM native support is complete only for its declared scope** when the same shared core drives the native host, all mandatory N0–N8 cases pass on the named runtime/device combinations, missing features are explicit, and actual input/geometry/accessibility behavior is certified rather than inferred. A successful headless extraction may be released independently while native work remains experimental.

**First implementation slice:** P00 baseline/census plus executable document and Fregat consumer contracts. Run the native feasibility spike alongside the early boundary work. No renderer surgery, package renaming or new plugin framework before those contracts are visible.

## 13. Pinned evidence ledger

The [companion JSON](e056-platform-agnostic-core-sources.json) retains the complete original
ledger: 41 repository files and 16 official reference pages, their review ranges, evidence
classes and limitations. Repository links are pinned to the recorded commits. Documentation
was recorded as retrieved on 2026-09-20; it is not runtime certification or a new verification
performed when this research was added to the repository.

[SG01]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/ARCHITECTURE.md
[SG02]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/textbuffer/README.md
[SG03]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/documentSession.ts
[SG04]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/public/document.ts
[SG05]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/editor/Editor.ts
[SG06]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/editor.ts
[SG07]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/editor/inputSelectionController.ts
[SG08]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/editor/inputState.ts
[SG09]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/virtualization/virtualizedTextViewGeometry.ts
[SG10]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/virtualization/fixedRowVirtualizer.ts
[SG11]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/plugins.ts
[SG12]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/editor/viewContributions.ts
[SG13]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/editor/preparedDocument.ts
[SG14]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/editor/paintSnapshot.ts
[SG15]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/react/src/index.ts
[SG16]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/docs/architecture/worker-topology.md
[SG17]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/src/editor/workScheduler.ts
[SG18]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/tree-sitter/src/treeSitter/workerClient.ts
[SG19]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/package.json
[SG20]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/scripts/build-package.ts
[SG21]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/package.json
[SG22]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/scripts/architecture-health.mjs
[SG23]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/docs/performance/input-latency.md
[SG24]: https://github.com/ShaulLavo/singapore/blob/45e22a495902c577243334586bc391f04201a827/packages/editor/test/imeComposition.browser.test.ts
[FG01]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/package.json
[FG02]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/apps/web/src/features/editor/components/editor.tsx
[FG03]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/apps/web/src/features/editor/utils/plugins.ts
[FG04]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/apps/web/src/features/editor/state/workspace-document-service.ts
[FG05]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/apps/web/src/features/editor/state/workspace-edit-service.ts
[FG06]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/apps/web/src/features/editor/components/diff-pane.tsx
[FG07]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/apps/web/src/features/search/components/result-file-editor.tsx
[FG08]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/apps/tui/src/viewer/state/syntax.ts
[FG09]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/packages/client-core/src/git/diff-files.ts
[FG10]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/apps/web/src/keymap/editor-keymap.ts
[FG11]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/.github/actions/setup/action.yml
[FG12]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/plans/122-composable-plugins.md
[FG13]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/plans/099-document-contributions.md
[FG14]: https://github.com/ShaulLavo/fregat/blob/43d3ac1762d4eb01f4521554967e666336858e33/PLAN.md
[RSD01]: https://github.com/react/react-strict-dom/blob/abd34bbf22bb468ffdc0baaf606f172c3a583487/packages/react-strict-dom/package.json
[RSD02]: https://github.com/react/react-strict-dom/blob/abd34bbf22bb468ffdc0baaf606f172c3a583487/packages/react-strict-dom/src/native/modules/useStrictDOMElement.js
[RSD03]: https://github.com/react/react-strict-dom/blob/abd34bbf22bb468ffdc0baaf606f172c3a583487/packages/react-strict-dom/src/native/modules/createStrictDOMTextInputComponent.js
[D01]: https://react.github.io/react-strict-dom/learn/
[D02]: https://react.github.io/react-strict-dom/api/html/
[D03]: https://react.github.io/react-strict-dom/api/css/
[D04]: https://react.github.io/react-strict-dom/api/other/common-min-api/
[D05]: https://react.github.io/react-strict-dom/api/other/document/
[D06]: https://react.github.io/react-strict-dom/api/other/compat/
[D07]: https://react.github.io/react-strict-dom/learn/setup-vite/
[D08]: https://react.github.io/react-strict-dom/learn/setup/
[D09]: https://reactnative.dev/docs/textinput
[D10]: https://reactnative.dev/docs/text
[D11]: https://developer.apple.com/documentation/uikit/uitextinput
[D12]: https://developer.android.com/reference/android/text/Layout
[D13]: https://developer.android.com/reference/android/view/inputmethod/InputConnection
[D14]: https://codemirror.net/docs/guide/
[D15]: https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ICodeEditor.html
[D16]: https://docs.expo.dev/guides/dom-components/
