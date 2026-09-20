# Cross-Project Execution Roadmap

> **Status:** reconciled against Platform base `704d6ab6`, Editor base `b0919967`, and
> `ghostty-webgpu` closeout `06b070b` on 2026-08-29, including the verified paired working-tree paint
> contract below. Re-run each executable plan's drift check and capture its current HEAD plus full
> dirty diff before editing.

This file is the sole source of cross-project execution order. [`plans/README.md`](plans/README.md)
is the Platform executable-plan inventory. Strategy documents under `docs/` describe product scope
but do not authorize implementation. A completed executable plan is deleted after its checks pass;
Git history is the archive.

The [Editor backlog](../Editor/plans/README.md) contains 30 stable entries from its 22-topic
wishlist. Its suggested order is advisory; promote selected work into this execution roadmap
when scheduled. Completed entries link to permanent references. The backlog also links the
existing Plan 071 syntax-retry proposal.

## Verified completed foundations

- Platform's one-document representation and deterministic file-sync cutover are live. Completed
  plan 038 has been deleted.
- Editor BiDi geometry Tiers A and B are complete; Editor has no standalone BiDi execution plan.
- Multi-server-per-document LSP and schema-aware settings JSON support are live. Do not rebuild a
  one-server compatibility layer.
- Conflict-proof settings persistence is live: normal writes use one semantic intent pipeline,
  confirmed and projected state are separate, raw JSON retains compare-and-swap conflicts, and the
  consolidated appearance provider owns transient preview plus commit handoff. Completed plan 059
  has been deleted.
- Editor-parity wave E0 is complete.
- The bounded last-visible-paint contract is live across Editor and Platform. Editor owns
  `EditorVisibleSnapshot`, `EditorInitialHighlightStatus`, and the generation-tagged
  `EditorInitialPaintEvent`; Platform owns the one-record, 256 KiB
  `editor-visible-snapshot-cache.ts`, inert overlay handoff, exact applied-theme guard, and
  `editor-open-benchmark.mjs` paint marks. This cache is unvalidated visual paint only: it never
  supplies text, tokens, revision truth, or a correctness decision to the live editor.
- The sole typed command/focus runtime is live. `platformCommands` is the command definition table,
  `CommandBus` owns synchronous claims plus non-rejecting async settlement, and `FocusService` owns
  deepest registered targets, actual DOM focus, and explicit origin restoration. The superseded
  draft and completed implementation plan have been deleted.
- Platform's two-stroke keymap is implemented at `0f5b0618`. One provider-owned chord session
  serves app commands and terminal input through the existing bus and focus targets. Focused tests
  and trusted browser input pass. Current behavior is recorded in
  [`docs/vscode-keymap-development.md`](docs/vscode-keymap-development.md).
- Lockstep WorkspaceEdit transactions are live in Editor and Platform. Editor owns typed LSP edit
  parsing, planning, inversion, and document application; Platform owns preview, filesystem commit,
  recovery, undo/redo, mutation coordination, and product integrations. Completed plan 063 has been
  deleted.
- Platform's terminal now uses the native `ghostty-webgpu` integration. Phase 3 DOM/input is
  complete in `ghostty-webgpu@0.1.1` commit `50788b2`; its headed macOS
  keyboard, IME, clipboard, idle-rendering, and VoiceOver gate is PASS in
  `ghostty-webgpu/docs/phase-3-acceptance.md`. Platform remains on registry `0.1.0` because both
  installed wasm artifacts are byte-identical to the verified package.
- App-owned Shiki resolution is live across Platform and Editor. Platform resolves every supported
  grammar and theme to registration data; Editor's inline worker uses the static Oniguruma engine,
  accepts only resolved registrations, and has a package-build assertion that rejects sibling JS
  chunks. The real-browser built-dist proof resolves the bounded 53-language preload set and emits
  `editor.syntax.highlight_applied` to the shared JSONL log.

## Shared runtime boundary

The typed command/focus foundation is landed in `apps/web/src/keymap/table.ts`,
`apps/web/src/keymap/state/command-bus.ts`, `apps/web/src/keymap/providers/command-provider.tsx`, and
`apps/web/src/lib/focus/`. Settings commands submit through the semantic intent API and await its
`settled` result; no command may add another settings mutation or error-reporting path.

No later Platform editor milestone may create an active-Editor pointer, a second settings mutation
path, a React-effect transaction coordinator, or a compatibility shim for the deleted architecture.

## Independent package lane

The `ghostty-webgpu` xterm-facade program is a separate package lane. Plan 008 is complete with its
accepted divergences transferred to the later certification gate. Plan 009 is blocked because the
required parser/Unicode, inactive-buffer, row-marker, and OSC 8 APIs are not public. Plan 010's CPU
gate has passed, but it remains blocked on Plan 009 and physical operator evidence. Plans 011–015
remain in package-defined dependency order and are not prerequisites for current Platform work.

## Ghostty appearance integration dropped

Plans 066 and 067 were dropped on 2026-09-09. Inheriting Ghostty appearance is not worth the
config-resolution and native-packaging complexity. `ghostty-webgpu` must never read disk.
If revisited, Platform would own file reads and pass data to the package. No replacement is planned.
The deleted plans remain in git history.

## Ordered Platform editor lane

Editor E002 is complete as of 2026-09-07. Correlated input diagnostics, bounded source-range
indexing, and stale secondary-work guards are live. Three fresh controls calibrated the
[local browser gate](../Editor/examples/stress/results/input-latency/README.md): the optimized candidate
and independent unchanged run pass all 108 blocking limits, and a real 20 ms delay fails all 36
synchronous input groups. Screenshot timing is advisory, with one excess retained. Mounted geometry
buffers and chunk reuse reduce long-line multiple-view p95 from 4.1 to 2.7 ms for typing and 9.8 to
6.9 ms for paste. The calibration uses observed control ranges and preserves previous failures.
The [measurement reference](../Editor/docs/performance/input-latency.md) records the contracts
and reference limits. The completed executable plan has been deleted.

Plans 056 and 057 are complete. Standalone Editor executes default and custom chords, and
Platform uses the shared runtime with its command-bus and terminal ownership policies intact.
Default and VS Code presets, conditional bindings, and Settings resolution diagnostics are wired.

See [shared keymap delivery](docs/keymap/delivery.md) for the paired revision, verification, and boundaries.

[Plan 080](plans/080-platform-keybinding-modes.md) is the proposed follow-up for Platform and VS Code
keyboard modes across the app. Platform defaults start from VS Code bindings and document intentional
differences. Whole-sidebar Cmd+B is the first milestone. Editor tabs and chats share navigation keys,
while numbered panel shortcuts use a separate combination. Held-modifier hints follow the matching
targets. Interaction rules are confirmed; the exact keys remain proposed. Implementation follows
the delivered shared runtime and has not started.

## Document contribution refactor

[Plan 099](plans/099-document-contributions.md) is proposed; implementation has not started.
It extends Editor's existing buffer owner with one committed-revision publication path and a
document contribution runtime. Tree-sitter, Shiki, minimap, and language-service adapters share
source synchronization while retaining typed APIs, independent queues, and domain-specific data.
Text delivery uses ordinary strings/chunks and incremental edits in the existing separate workers.
The syntax migration removes SAB text transport while preserving atomic cancellation and packed results.

Its internal order is calibrated baseline and consumer inventory, canonical publication, shared
runtime with all syntax callers, minimap, local/external LSP, remaining ownership checks, a
string-delivery verification, and final correctness/performance gates. Baseline/publication work
can proceed independently. Public backend cutover follows completed Plan 098 then Plan 097 contracts;
it does not bypass their required order. Preserve WorkspaceEdit segment publication and
compensation, prepared adoption, and the existing input latency limits.

This proposal does not reorder other lanes. Editor E009 supplies transport measurement scope and
evidence for the strings decision. E014 parallel search must reuse this runtime if implemented.
Shared text storage and worker consolidation are outside the refactor; E013 remains deferred research.

## Instant workspace reload

[Plan 085](plans/085-instant-workspace-reload.md) is proposed and implementation has not started.
It follows the existing environment, [verified workspace navigation](docs/workspace-navigation.md),
settings-admission, and Editor paint foundations. Its internal order is calibrated browser proof and budgets, synchronous bootstrap,
tree/settings, Git/diff, search/chat, continuous native handoff, remaining visible tools, and
complete reload verification. The first complete slice is bootstrap plus tree and settings.

Editor/diff paint and Ghostty terminal viewport replay stay with their package owners. If a required
native contract is absent, record that package dependency before implementing its host integration.
The plan remains incomplete until the visible terminal and all other scoped panes pass. This
proposal does not reorder Plan 080 or the existing TUI and Ghostty lanes.

## Environments lane (completed 2026-09-12)

[`docs/environments-and-remote-plan.md`](docs/environments-and-remote-plan.md) is the reviewed
strategy: several machines connected at once, chat across all of them, and the workbench following
one. The same repository on two machines groups as one project; each checkout keeps independent
files, Git changes, and unsaved buffers.

**Plan 077 is complete.** Runtime origins are canonicalized, server identity survives restarts,
and authenticated health and WebSocket handshakes refuse identity or protocol mismatches. Each
origin owns its HTTP client, QueryClient, and retained editor runtime. Switching remounts query
consumers while preserving documents and save destinations; queued mutations keep their original
owner. One command bus captures the selected runtime before execution. Chat transports close
explicitly, and WebSocket auth refusal uses `1008`. The development-only loopback switch is
verified with two real in-process servers and an A → B → A browser workflow. Its executable plan
has been deleted.

Plan 068 is implemented. The [session domain](docs/session-domain.md) has deterministic repository
and checkout IDs, explicit Project → Worktree → Session ownership, raw Claude session UUIDs,
durable provider-start claims and crash recovery, and environment-scoped web projections and
navigation. One current-schema migration replaces obsolete orchestration history. Its executable
plan has been deleted; source and tests are linked from the domain reference.

[Federated environments](docs/federated-environments.md) is complete. Machines settings, backend
SSH launch, independent chat connections, scoped persistence, the cross-machine rail, machine
selection, and per-machine failure states pass automated and live Linux/macOS verification.
Browser reconnect and shared managed-server cleanup are verified; the executable plan is deleted.

On demand only, the remaining work is direct `https://` origin verification through the mesh proxy,
then pairing, issued sessions, and revocation for a client that cannot SSH. The auth analysis in Git
history (`docs/environments-and-remote-plan.md@1325b003`) remains the reference for that plan.

Plan 069 is complete (2026-09-06). The [worktree lifecycle reference](docs/worktree-lifecycle.md)
records explicit checkout choice, recoverable provisioning and cleanup, runtime ownership, and
the focused verification gate. Its executable plan has been deleted.
The combined Git overview across checkouts and machines is also unscheduled; strategy §5.6 records
its scope. Nothing in this lane binds a server off loopback.

## TUI lane

Plan 079 is complete (2026-09-05) and its executable plan is deleted. The TUI includes editable
settings, native shortcut recording, external JSON editing, command palette modes, file browsing,
address history, themes, and environment-scoped storage over the shared HTTP/RPC/settings core.
The [foundation record](docs/tui-foundation.md) preserves the design and verification; the
[binding audit](docs/tui-bindings.md) preserves command dispositions. The 2026-09-06 review fixes
pass all 152 TUI tests, including native dialog regressions, concurrent-process cache writes, and
shutdown cleanup. Real PTY tests cover the launcher, external editing, suspend/resume, signals,
and terminal restoration. The original completion also verified eight client-core tests and
affected web checks. TUI build and affected typechecks pass.
Plan 081 is complete (2026-09-07) and its executable plan is deleted. The
[workbench record](docs/tui-workbench.md) covers files, syntax and LSP, external editing with
durable conflict drafts, Git and diffs, search and replacement, logs, terminals, raw attach,
and persisted navigation. Review fixes cover all eight reproduced findings, including wrong-file
writes, rolled-back draft loss, and palette input reaching the shell during resize. The full
234-test TUI suite, build, lint, and client-core typecheck pass.
Native Neovim and host PTY checks prove resize, detach, and terminal restoration. The
[terminal](docs/tui-research/terminal-feasibility.md) and
[tokenizer](docs/tui-research/viewer-feasibility.md) records preserve the feasibility results.
Plan 082 is complete (2026-09-07) and its executable plan is deleted. The
[Agent view record](docs/tui-agent.md) covers the shared chat runtime, prompt and streamed timeline,
rail and provider management, approvals, questions, plans, terminal context, and Claude terminal
resume with safe history return. All 282 TUI tests pass, alongside 58 terminal/provider tests and
168 migrated web logic tests. TUI and server builds, affected typechecks, lint, and formatting pass.
The existing server was rebuilt and restarted; the desktop TUI connects live with a visible prompt.
Plan 083 is complete (2026-09-08). It adds current/new checkout selection, first-send worktree
creation, exact checkout navigation, shared lifecycle labels, and project cleanup controls. The
[worktree record](docs/tui-worktrees.md) links the native creation, recovery, navigation, and
cleanup checks. Distribution (084) follows [the TUI strategy](docs/tui-plan.md).
This lane preserves concurrent environment changes.

Platform now uses `@workspace/pty` directly, with binary terminal input, output, and replay.
The Node bridge and its dependency are removed. The [terminal reference](docs/terminal.md)
records ownership, protocol, benchmarks, and verification on Linux and macOS. Service checks
cover three direct shell children, Ctrl-C/D, resize, exact 2 MiB binary echo, bounded replay,
Neovim editing, and awaited cleanup. Windows remains completely untested; the current package
platform guard permits Linux and macOS only.

## Native agent tools lane

Requested 2026-09-11. [Plan 087](plans/087-stateless-mcp.md) precedes
[Plan 088](plans/088-native-code-intelligence.md). Both are proposed; implementation has not started.

Plan 087 delivers managed external MCP servers and an authenticated native tool endpoint. The
required wire revision is stateless MCP `2026-07-28`, implemented with explicitly configured SDK v2.
Scoped machine-client authentication and real MCP calls from both providers are prerequisites,
not assumptions supplied by existing provider MCP event handling.

Plan 088 builds the full native capability on our document, language-server, search, and workspace
transaction services. Its order is comparative baseline, explicit document views/native backend
requests, retrieval/indexing, diagnostics, transactional edits, advanced refactors, memory/execution,
native DAP debugging, and final comparative certification. Read-only tools do not close the plan.
The [comparison](docs/serena-implementation-comparison.md) records what to adopt and what to improve.

These plans absorb MCP and project-memory ownership from the unscheduled editor E7 strategy.
They reuse the completed environment/session foundations and
[verified federation transport](docs/federated-environments.md#verification). Remote MCP acceptance
must still prove its own authentication and tool calls over that transport. They do not depend on or reorder the
keymap, reload, TUI, or Ghostty lanes. Any new Editor public contract lands in lockstep with Platform.
General public hosting/pairing remains separate; the MCP prerequisite uses authenticated loopback
endpoints and existing SSH access, with explicit grants for native clients.

## Document and async operation ownership

Plan 098 is complete. Its [implementation reference](docs/document-and-tab-domain.md) records
verified document/tab APIs, cache version 21, correctness fixes, and baseline test limitations.

Plan 097 is complete. The [async operation ownership reference](docs/async-operation-ownership.md)
records captured transport owners, service-issued text sources, operation-bound previews,
conditional conflict reconciliation, TUI plans, and request-time LSP provenance. The focused
verification script passes across Platform and the linked Editor package. The required
**098 → 097** dependency is complete; Plan 099 consumes these settled contracts.

## Duplication census lane

Requested 2026-09-11. Plan 090 is implemented. Its [regression reference](docs/duplicate-defect-regressions.md)
records the fixes, baseline corrections, and focused checks. Plan 096 is also complete. The remaining five plans are proposed.

[Plan 091](plans/091-error-and-timing-helpers.md), [Plan 092](plans/092-path-and-uri-helpers.md),
[Plan 093](plans/093-web-react-and-store-ceremony.md), and
[Plan 094](plans/094-client-core-web-tui-parity.md) consolidate on top of those fixes.
[Plan 095](plans/095-server-plumbing.md) can proceed independently of the middle plans,
while preserving the same defect regressions. Plan 096 is complete; its
[web layering reference](docs/web-layering.md) records the implementation and review.

The middle plans consolidate onto the shared packages. Plan 091 widens the observability sanitizer,
`errorSummary`, and the timing helpers into shared modules and gives `errorMessage`, `isRecord`, and the
client error catalog one home each in `packages/contracts` and `packages/client-core`. Plan 092 collapses
the seven `file:` URI copies, the eight server containment spellings, and the walker/LSP path twins onto
one owner each, keeping the `parentPath` families deliberately split. Plan 093 collapses the 32-site
context guard, six store contexts, the deferred-commit widgets, and the Git mutation and test runners in
`apps/web`. Plan 094 moves the domain logic `apps/web` and `apps/tui` each wrote twice into
`packages/client-core` and `packages/contracts`. Plan 095 collapses the duplicated WebSocket adapters,
atomic writers, listener bridges, and Git common-directory resolutions in `apps/server`. Plan 096 has
implemented web layering, shared helper ownership, and unused API removal on `main`. Its
[implementation reference](docs/web-layering.md) records the isolated moves and passing focused,
typecheck, lint, build, and browser checks. The review fixed cache diagnostics, completed cache
helper adoption, and strengthened the import census and boundary guard. Knip is clean across
the repository and runs in CI. The completed executable plan is deleted.

Every unification step names the behavioural divergences it reconciles and states which behaviour wins;
these variants share signatures, so a wrong merge typechecks. Plan 096 settles the shared Git contract and
web Git API files before Plan 094's co-pass over them. This lane does not reorder or depend on the keymap,
reload, TUI, Ghostty, or MCP lanes.

## Web design language lane

Completed 2026-09-12. The [web design language](docs/web-design-language.md) supplies the
shared tokens and controls. The census gates its decisions in root `verify` and CI, and the
independent implementation audit and widened closeout review are recorded. The real Mesh app
passed 52 surface cases and 52 loading cases across both densities and color schemes. Closeout
fixed Search and Settings loading shifts, file-tree row corners, and remaining shared-bar gaps.
The completed plan file is deleted; the implementation reference owns the contracts and evidence.

Three independent follow-ups remain proposed:
[Plan 101](plans/101-truncation-recovery.md) recovers the values truncation hides,
[Plan 102](plans/102-scroll-and-keyboard-affordance.md) settles scrollbars, nested-scroll
containment and keyboard chips, and
[Plan 103](plans/103-loading-empty-error-states.md) finishes the loading, empty and error states
`CLAUDE.md` already decided. Each names the decisions that need confirmation before implementation.
They preserve the implemented design tokens and extend the existing census and browser verifier.

The [shared pattern layer](docs/pattern-layer.md) now supplies rows, list focus, virtualization
and pane shells from `packages/ui`. The boundary lint freezes feature imports, and the design
census gates icon sizes, text alpha, row hover and icon-only hints. File picker and command palette
follow the common feature layout, and query keys follow their consumers. Plans 101, 102 and 103
build on these patterns; 103's loading states mount inside the shared shell.

## Theme standardization

Requested 2026-09-12, split 2026-09-14. Plan 104 is retired and replaced by three plans that build
the pieces before the bundle. [Plan 115](plans/115-palettes-as-data.md) moves palettes out of CSS
into data: OKLCH canonical with hex at every boundary, sRGB only, paired or single-mode, a closed
token set that now includes the terminal colors, a server library for user palettes, and an editor
whose live preview writes variables to the root. [Plan 116](plans/116-wallpaper-library.md) gives
wallpaper a content-addressed library, a per-mode source setting, explicit rendering in the
compositor backdrop, and an importer seeded from `/usr/share/omarchy/themes`.
[Plan 117](docs/theme-bundles.md) binds separate light and dark variants under one name, each with
its own palette, syntax colors, wallpaper and material. Customization belongs to each bundle and
variant; switching applies the destination wallpaper. It adds a portable archive and the composed
Omarchy importer.

Plans 115 and 116 are implemented and deployed as of 2026-09-14, and
[Plan 123](plans/123-wallpaper-picker.md) replaced 116's picker on 2026-09-17: a dialog with uploads,
theme sections and a previewing palette scope, plus a display rendition. 117 is implemented and deployed as of 2026-09-19, including paired bundle editing, scoped
customization, portable archives, Omarchy import and shared web/TUI resolution. It reuses the picker
and the existing syntax registrations. CSS-in-JS was considered and rejected: custom properties are the
runtime, and Tailwind keeps resolving to tokens. [The research](docs/theme-standardization-reference.md)
records the Omarchy reuse strategy and the T3 Code and CodexThemes-App comparisons.

[Plan 124](plans/124-theme-studio.md), requested 2026-09-19, replaces 117's surface without touching
its data: the live workbench is the preview, a bottom dock over it holds one draft theme with
Themes, Colors, Code, Wallpaper and Surfaces tabs, colors can be derived from a wallpaper, and the
`theme ` palette scope switches whole themes. The settings row, creation dialog, variant editors and
the separate palette, code-theme and wallpaper widgets are deleted in the same pass.

The [design-token foundation](docs/web-design-language.md) is implemented. Coordinate `globals.css`
edits with Plans 101–103; do not interleave edits to the same files. Plan 085 and Plan 115 share the
boot mirror and first-paint path, so whichever lands second reuses the first's ownership. TUI
readers migrate with each shared-settings cutover. Native Swift theme UI is outside scope.

## First-load weight and markdown lane

Requested 2026-09-13. Six plans from one review, and a seventh added 2026-09-20 of the production web build. The deployed release
sends **2421 KB gzip of JavaScript before the first frame**, 2311 KB of it in a single chunk. The
cause is not bundler configuration — Rolldown is already in use and `apps/web/vite.config.ts` has no
chunking options because the application declares almost no loading boundaries. Chunk boundaries
come only from dynamic `import()` in source.

Execution order is strict:

1. [Plan 106](plans/106-boot-weight.md) builds the measurement instrument first, then defers Mermaid
   off the boot path and replaces the full Phosphor icon font — imported by one line of
   `packages/editor-find/src/style.css` for eleven glyphs — with inline path data. No dependencies.
2. [Plan 107](plans/107-workspace-markdown.md) replaces streamdown with `@workspace/markdown`,
   built on `unified` with termination healing and T3's incremental prefix parse. This is what
   removes the second complete `shiki@3.23.0` installation that `@streamdown/code` hard-depends on,
   and with it 123 duplicated grammar and theme chunks.
3. [Plan 108](plans/108-markdown-modes.md) gives markdown a split view on that package and finishes
   the existing live-preview experiment rather than deleting it. Phase 1 needs 107; Phase 2 is
   blocked on 111.
4. [Plan 109](plans/109-boot-boundaries.md) defines boot, decides where loading boundaries belong
   from 106's attribution data, and pins a first-load gate. It runs last because 107 and 108 both
   move the number. Revised 2026-09-20: the per-owner attribution now exists, which unblocks its
   Phases 2 and 3 and refuted two of the three boundaries anyone had proposed. Two survive, worth
   6.25% of the entry chunk. Phase 4 pins after Phase 3 and re-pins after 108 rather than waiting
   for a final number, and it owns correcting the stale first-load figure quoted below.

5. [Plan 129](plans/129-dependency-shape.md) owns the bytes 109 measured and handed off because no
   loading boundary reaches them: the Editor's three inline worker blobs, 579 KB gz and 25.5% of
   first-load JavaScript, and the `thin` and `light` Phosphor weights no call site draws. It does
   not depend on 108 or 109 and is the largest available cut, so it may run first; 109's gate
   re-pins downward when it lands.

Two research plans feed the lane and are not executable as written:
[Plan 110](plans/110-workspace-indexing.md) asks what belongs in a workspace index beyond the file
index that already exists, with Shiki grammar prefetch, Plan 088's semantic retrieval, Plan 108's
document graph and search as its waiting consumers.
[Plan 111](plans/111-editor-decorations.md) compares `@singapore-editor`'s inline-replacement layer against
CodeMirror 6 decorations and Lexical's decorator nodes, and gates Plan 108 Phase 2, any later
Obsidian mode, and the question of whether the chat composer still needs Lexical.

Coordinate shared editor and chat surfaces with Plans 101–103 and 115; do not interleave edits to the same
files. Plan 085 owns first paint and restoration, which this lane measures but does not change.
Replacing React with a smaller reimplementation was considered and rejected: React is 60 KB of a
2421 KB first load, so it is revisited only once it is the largest remaining line item.

## React compiler and pane lifetime lane

Requested 2026-09-20. [Plan 127](plans/127-compiler-and-lifetime-repairs.md) precedes
[Plan 128](plans/128-react-19-patterns.md). Both are proposed; implementation has not started, except
that Plan 127's Phase 3 terminal repair is applied in the working tree and unverified in a browser.

Plan 127 is the repair pass. It turns the React Compiler's diagnostics on, pins them with a census
beside the design census, clears the `ref={focusTarget.ref}` bailouts, stops the bottom panel and its
collapse from unmounting every terminal and arming the server's ten-minute kill, settles git stage,
unstage and discard from the response the server already computed, and takes one command-bus capture
per palette keystroke instead of one per row. Plan 128 follows with the written rules and the two
prerequisites the remaining pane work waits behind: `packages/tree` lifetime, and a `VirtualList`
contract for hiding and revealing a populated list. Its `AGENTS.md` sections are the deliverable,
because none of its three patterns can be gated by tooling.

Neither plan reorders another lane. The scoped error boundary and the `<Activity>` counter-example
are shared with [Plan 109](plans/109-boot-boundaries.md); whichever lands first owns the
implementation and the others consume it. Verification tooling reconciles with Plan 119 and mutation
shape with Plan 118. No measurement has been taken for either plan: the dev server is down, only the
mesh answers, and every `agent:browser` line in both is a prescription for the implementer.

## Verification boundaries

- **Platform-only:** verify the narrow Platform tests/typechecks named by the active plan.
  Completed Plan 056 was verified within this boundary.
- **Platform + Editor lockstep:** plan 057 requires focused checks and diff review in both
  worktrees. Neither repository's half is complete alone.
- **`ghostty-webgpu`:** run its package gates in that repository.
- **Environments:** verify with two isolated in-process or loopback servers and distinct databases.
  Live SSH checks use an authorized machine; the 2026-09-12 closeout used the operator's Mac.
  Server and forwarded listeners remain on loopback. Pairing, sessions, and TLS refusal are one later security boundary, not part of
  these three plans.
- **Duplication census (090–096):** Platform-only. Each plan names its own narrow checks — focused
  Vitest paths, the affected workspace typecheck, and diff review over the files it merges. Run those
  and compare against a captured baseline delta. A repository-wide suite or a bare test count proves
  nothing here, because the merged variants share signatures.
- Preserve pre-existing dirty work in every linked worktree. Use baseline deltas and the narrowest
  checks that can catch a plausible regression; never use a bare root test count as completion proof.

## Promotion, rewrite, defer, and deletion decisions

- **Deleted:** completed plans 038, 068, 069, and 077, and superseded plan 058.
- **Editor lane:** Plans 056 and 057 are complete. Standalone Editor chord execution was
  verified before Platform adopted the shared runtime.
- **Promoted:** environments foundations and federation are complete, with automated and live
  Linux/macOS browser and SSH checks recorded in the implementation reference.
- **Deferred:** the mesh https proxy check and pairing/sessions, until a client that cannot SSH
  exists; all compatibility work for the obsolete per-tab/active-editor/one-server architecture.
- **Dropped:** Ghostty config appearance plans 066 and 067; see the decision above.
- **Package-blocked:** `ghostty-webgpu` plan 009 needs public native extension surfaces. Plan 010 is
  additionally waiting on that dependency and physical operator gates; plans 011–015 remain downstream.
