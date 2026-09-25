# Native Plan Prompts

One prompt per plan doc from `native-plan-of-plans.md`. Each is self-contained — run in a fresh session. Order matters loosely: 1 → 2 → 4 build on each other; 3 is independent; 5 is a gated skeleton; 6 is cleanup. Fold in any newer recon before firing.

## Plan 1 — bench harness (DONE — kept for reference; see Bench debt B1–B4 in native-plan-of-plans.md before touching bench numbers)

```text
Load the mac-app skill. Read docs/native-plan-of-plans.md and docs/native-editor-internals-research.md, then write docs/native-bench-harness.md and implement it in apps/mac/Sources/EditorBench.

Goal: the measurement instrument that gates all native editor work. Web-side facts (recon-verified 2026-08-28): the bench infra in ../Editor is standalone bun scripts, no framework, no CI, results printed not recorded — bench:piece-table/anchors/walker/transforms/fold-map/virtualization in packages/editor/bench/, bench:syntax in packages/tree-sitter/bench/, bench:semantic-classification in packages/typescript-lsp/bench/. The one checked-in table is ../Editor/docs/architecture/phase-0/performance-baseline.md (2026-05-24, Bun 1.3.10): 0.0048 ms per 1KiB append insertion (piece-table storage path ONLY), 45.3 ms scrolling a 100K-line doc under happy-dom (44 mounted rows), fold-map avg 0.088 ms round trip, minimap p95 2.0 ms, syntax edit totals 145 ms @10K → 1,733 ms @100K lines. CRITICAL: the oft-quoted "5.8 ms typing / p95 6 ms viewport highlights" figures are recorded NOWHERE in ../Editor, and the baseline doc's own Gaps section admits the end-to-end typing harness was never built.

So plan 1 has a web-side deliverable first: re-establish a real end-to-end typing baseline using the in-page diagnostics sink globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ (packages/editor/src/editor/performanceDiagnostics.ts) and the per-change timings array (names: input.beforeinput, editor.render, editor.change; viewport highlights: editor.tokenHighlights.ranges in virtualization/virtualizedTextViewHighlights.ts), driven by real Playwright input against the running platform dev server. Then define the native methodology: keystroke-to-photon via os_signpost + Instruments (seed from the xctrace scripts in .agents/skills/swiftui-expert-skill/scripts/), 120Hz ProMotion frame budget, and native mirrors of the web microbenches (same 2,000×1KiB insertion shape, anchors, walker, fold-map) so columns compare like-for-like. Known first lesson: never iterate String by Character in hot paths (142ms vs ~1ms for a 9MiB line scan) — bench utf8/utf16 views.

Exit: `swift run -c release EditorBench` prints the baseline table — web column filled from real measurements, native column empty. Update the plan-of-plans status row when done.
```

## Plan 2 — editor core design

```text
Load the mac-app skill. Read docs/native-plan-of-plans.md and docs/native-editor-internals-research.md (the design directives are binding), then write docs/native-editor-core-design.md.

Content: (1) Port map for the buffer and document model — recon-verified bottom-up order (all pure logic, zero DOM): tokens.ts (24 LOC, the shared vocabulary) → graphemes.ts (241) + pieceTable/lineEndings.ts → pieceTable/* in dependency order (pieceTableTypes → orders/priority → buffers → tree → walker → reads → reverseIndex → snapshot → positions → anchors → edits → diff → documentText; ~2,968 LOC; design docs at ../Editor/docs/storage/piece-table.md and docs/positions/anchors.md) → selections.ts (406, anchor-backed multi-cursor with affinity/goal columns) + documentTextSnapshot.ts + textRanges.ts → history.ts (148, generic persistent undo, MAX_UNDO_DEPTH 200) → documentSelectionEdits.ts (482) → documentSession.ts (2,618 — the document truth: transactions, typing-run undo coalescing, revisions, multi-view sessions) → displayTransforms.ts (977, tab expansion/wrap/display rows) → foldMap/inlineMap → syntax/session.ts + packedTokens.ts. Tests port first as the spec. Name every deliberate divergence (Swift value types, Sendable snapshots, ARC-aware nodes — final classes, maybe arena; UTF-16 offsets stay). The DOM-coupled surfaces to DESIGN fresh, not port: virtualization/virtualizedTextViewGeometry.ts (3,389 LOC, 51 DOM calls — caret rects/hit-testing delegate to the browser text engine; CoreText replaces this), the Rows/View/Highlights files, and editor/{Editor.ts,inputSelectionController.ts}. Portable *shapes* from those: reconcile-only-mounted-rows with per-row signatures, and the typing pipeline stages (documentSession.applyText → commitEdit → token/fold projection → view patch choosing same-line / multi-line / full-reset). (2) The line/layout layer above it: augmented tree with pixel-height + byte aggregates (study ~/Desktop/D/references/CodeEditTextView TextLineStorage and Runestone LineManager), estimated heights with scroll compensation, resumable partial typesetting for megalines. (3) CoreText spike spec: per-line CTTypesetter → CTLine fragments, style applied at typeset time from a run store (never stored in the character buffer), selection painted separately. (4) IME/accessibility: ~300-line NSTextInputClient plan stealing CodeEditTextView's multi-cursor marked text; ~170-line NSAccessibility single-element model.

Exit criterion of the plan itself: a spike hitting sub-2ms keystroke-to-paint on a 10MiB file, measured by the plan-1 harness. Running that spike is part of planning. Update the plan-of-plans status row.
```

## Plan 3 — type safety

```text
Load the mac-app skill. Read docs/native-plan-of-plans.md (plan 3 row has recon findings), then write docs/native-type-safety.md.

Facts to build on (verify in code): the platform has zero TypeBox — all runtime schemas are Valibot; ~89 REST endpoints (apps/server/src/app.ts mounts them), 7 of which are SSE streams; auth is an exact Origin-header allowlist (no tokens) so the Swift client must set Origin manually on every request and WS upgrade; /orchestration/rpc WS is fully Valibot-schema'd with kind/method/type discriminators; /terminal and watch-events are small hand-parsed TS unions; /lsp WS is raw LSP JSON-RPC passthrough (no codegen needed — a Swift LSP client just speaks LSP).

Plan the pipeline: server exports OpenAPI via @elysia/openapi fromTypes() + mapJsonSchema {valibot: toJsonSchema}; Swift side consumes it with swift-openapi-generator run as a CLI with generated code checked into its own SPM target (not the build plugin — compile-time). WS: prototype Valibot → JSON Schema → quicktype → Codable on the orchestration contract (discriminated-union quality is make-or-break — prototype this FIRST); hand-write Codable for terminal's 7 message types. Design the SSE client (URLSession bytes streaming). Decide Origin strategy (spoof an allowlisted origin vs extend SERVER_ALLOWED_ORIGINS).

Exit: one typed REST call and one typed orchestration WS event flow server→Swift with no hand-written mirror types. Update the plan-of-plans status row.
```

## Plan 4 — tree-sitter + LSP

```text
Load the mac-app skill. Read docs/native-plan-of-plans.md and docs/native-editor-internals-research.md, then write docs/native-tree-sitter-lsp.md.

Port-first inputs, recon-verified from ../Editor/packages/tree-sitter (5,054 LOC): request/response envelope with per-document generation counters; cancellation via Atomics flags in SharedArrayBuffers, checked between worker phases (tree.edit → parse root → changed ranges → parse injections → query flatten, each phase timed); the session tracks snapshotVersion vs parsedSnapshotVersion, refuses viewport range queries while a parse is outstanding, drops stale results by version, and never replays failed requests; tokens return as three transferred Uint32Arrays + interned style palette (syntax/packedTokens.ts); source transfers piece-table-aware in 16KiB chunks with retention tracking. Editor-side scheduling (editor/syntaxController.ts): six latest-only request queues (full/visible/prefetch/warm/highlight/theme); SYNTAX_EDIT_DEBOUNCE_MS=75 with 400ms max; rapid-input secondary work deferred 150–400ms and versioned so superseded keystrokes drop; background warm tiles of 120K chars walking outward from the viewport; per-document caches capped at 6 snapshots / 8M source units. In Swift: Sendable piece-table snapshots delete the transfer/chunking layer entirely; port the versioning, cancellation, latest-only queues, debounce constants, and warm-tile walk as-is. Use SwiftTreeSitter + Neon (ChimeHQ, both maintained); study Chime's three-phase styler (~/Desktop/D/references/Chime/Modules/Highlighting/Highlighter.swift: instant fallback → tree-sitter → async LSP semantic tokens, visible-range-only revalidation) as the pipeline shape, and Runestone's byte-aggregate InputEdit mapping (no string scanning). Do NOT copy CodeEdit's TreeSitterExecutor polling lock. Grammar loading/distribution needs a decision (bundled dylibs vs SPM grammar packages).

LSP: the platform server already pools connections — WS /lsp?root=&path=&server= is raw JSON-RPC per message (no Content-Length framing), discovery via GET /lsp/match, proxy-injected notifications ($/serverExited, refresh notifications re-emitted as notifications). Plan a thin Swift LSP client over that socket mirroring apps/web's connection pool keyed (root, serverId).

Exit: viewport highlighting + live diagnostics in the spike editor. Update the plan-of-plans status row.
```

## Plan 5 — shell skeleton (gated)

```text
Load the mac-app skill. Read docs/native-plan-of-plans.md, then write docs/native-shell-platform.md as an explicitly GATED SKELETON — half a page, no detailed design (the editor gate hasn't passed; details would go stale).

Record only what's settled: the ghostty model (custom owner-drawn editor surface speaking NSTextInputClient/NSAccessibility; native everything else); AppKit skeleton for window/splits/responder chain with SwiftUI leaves for panels/settings/inspectors (CodeEdit tried SwiftUI at the window root and documentedly reverted — see references/CodeEdit CodeEditWindowController.swift); macOS 26 glass APIs on both frameworks (NSGlassEffectView / .glassEffect()) with the known 26.2 SwiftUI-hosting wart; resizable panels only — tiling was removed from the platform (commit 21d30b57), do not resurrect it; terminal pane embeds libghostty later; .app bundle via swift-bundler when needed. List the questions the real plan must answer post-gate (command routing, workspace/session model, settings stream consumption) without answering them. Update the plan-of-plans status row to "skeleton written, gated".
```

## Plan 6 — dev workflow

```text
Load the mac-app skill. Read docs/native-plan-of-plans.md, then write docs/native-dev-workflow.md (short — this plan is mostly done).

Record: toolchain requirements and traps (full Xcode 26.6+, the CLT-only failure mode, license acceptance, sudo xcode-select); the command set (swift build / swift test with swift-testing / swift run -c release EditorBench / swift run MacApp); apps/mac stays outside the bun/turbo workspace by design; decisions already made — EditorCore stays in-repo until it hurts (revisit when the app ships), no CI for now (zero users; revisit with plan 5), macOS 26 deployment floor. Decide and document: swift-format vs leaving formatting alone (pick one, wire it or explicitly decline); whether EditorBench results get checked in as dated JSON for regression tracking (recommend yes, tiny). Update the .agents/skills/mac-app/SKILL.md if any command or doctrine changed, and mark the plan-of-plans row done.
```
