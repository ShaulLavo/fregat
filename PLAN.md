# Cross-Project Execution Roadmap

> **Status:** reconciled against Platform base `704d6ab6`, Editor base `b0919967`, and
> `ghostty-webgpu` closeout `06b070b` on 2026-08-29, including the verified paired working-tree paint
> contract below. Re-run each executable plan's drift check and capture its current HEAD plus full
> dirty diff before editing.

> **Active:** the [completion wave](docs/completion-wave.md) (2026-09-25) runs every executable
> plan in parallel lanes, each lane in its own worktree. Its lane order overrides the lane
> sections below until the wave ends.

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

Editor E006 is complete as of 2026-09-25.
[Automatic text reclamation](../Editor/docs/storage/e006-text-reclamation.md) releases deleted
text in live buffers, and [tombstone compaction](../Editor/docs/storage/e006-tombstone-compaction.md)
replaces runs of tombstones with stand-ins that resolve every deleted anchor exactly as before.
An insert now lands after the last visible piece ending at its offset. After 20,000 paragraph
replacements the current tree holds 4 pieces instead of 20,002, and about 22 bytes per insertion
remain in the index. Snapshot identity is unchanged, so Platform's leases and receipts need
nothing. This does not reorder the other lanes.

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

Plan 080 is done: Platform and VS Code keyboard modes across the app, whole-sidebar Cmd+B, shared
tab-or-chat navigation, numbered panels and held-modifier badges. [Keyboard modes](docs/keymap/modes.md)
records the per-host comparison and the owner checks still pending on the Mac.

## Document contribution refactor

[Plan 099](plans/099-document-contributions.md) is proposed; implementation has not started.
Decided 2026-09-25: owner — units 0–1 are approved to start; units 2–7 stay gated as the plan says.
It extends Editor's existing buffer owner with one committed-revision publication path and a
document contribution runtime. Tree-sitter, Shiki, minimap, and language-service adapters share
source synchronization while retaining typed APIs, independent queues, and domain-specific data.
Text delivery uses ordinary strings/chunks and incremental edits in the existing separate workers.
The syntax migration removes SAB text transport while preserving atomic cancellation and packed results.
Decided 2026-09-25: owner — the SAB transport is deleted ahead of 099 as Editor E057, a small task.

Its internal order is calibrated baseline and consumer inventory, canonical publication, shared
runtime with all syntax callers, minimap, local/external LSP, remaining ownership checks, a
string-delivery verification, and final correctness/performance gates. Baseline/publication work
can proceed independently. Public backend cutover follows completed Plan 098 then Plan 097 contracts;
it does not bypass their required order. Preserve WorkspaceEdit segment publication and
compensation, prepared adoption, and the existing input latency limits.

This proposal does not reorder other lanes. Editor E009 supplied transport measurement scope and
evidence for the strings decision; it is folded into 099 unit 6 (2026-09-25). E014 parallel search
must reuse this runtime if implemented. Shared text storage and worker consolidation are outside the
refactor; E010, E012 and E013 were closed as no-go on 2026-09-25.

## Instant workspace reload (completed 2026-09-21)

All Plan 085 slices are implemented. The [delivery record](docs/instant-reload-implementation.md)
covers synchronous bootstrap, tree and settings, Git and native diffs, both search views, chat,
logs, diagnostics, and native terminal output. Desktop and narrow held-response matrices each
pass all 15 scenarios; targeted checks cover failed revalidation, accepted local input, window
isolation, and owner/authority boundaries.

Editor and Ghostty source changes are implemented and verified in their linked repositories;
they must land with Platform or corresponding package releases. They are not yet published.
The executable plan is retired. This does not reorder the keybinding, TUI, or Ghostty lanes.

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
Decided 2026-09-25: owner — approve 087 milestone M0 only; M1+ is discussed with the owner before
anything else in 087 or 088 starts.
Decided 2026-09-26: recommendation (owner deferred) — 087 narrows to our own tool endpoint; managed
external MCP servers (former M2/M3) move to the unscheduled [Plan 174](plans/174-external-mcp-servers.md).

Plan 087 delivers an authenticated native tool endpoint. The
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
records the fixes, baseline corrections, and focused checks. Plan 096 is also complete. Commit `becdf722`
(2026-09-20) then merged the byte-identical halves of 091–095, created `packages/utils` (timing,
`isRecord`, subscriptions) and added the `dupes` / `dupes:functions` gates. What remains in those five
plans is the divergent helpers, where a decision picks which behaviour wins; the gates cannot see them.

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
Plan 101 recovers the values truncation hides,
[Plan 102](plans/102-scroll-and-keyboard-affordance.md) settles scrollbars, nested-scroll
containment and keyboard chips, and
Plan 103 finishes the loading, empty and error states
`CLAUDE.md` already decided (closed 2026-09-20, implemented and deployed). Each names the decisions that need confirmation before implementation.
They preserve the implemented design tokens and extend the existing census and browser verifier.

The [shared pattern layer](docs/pattern-layer.md) now supplies rows, list focus, virtualization
and pane shells from `packages/ui`. The boundary lint freezes feature imports, and the design
census gates icon sizes, text alpha, row hover and icon-only hints. File picker and command palette
follow the common feature layout, and query keys follow their consumers. Plans 101, 102 and 103
build on these patterns; 103's loading states mount inside the shared shell.

## Theme standardization

Requested 2026-09-12, split 2026-09-14. Plan 104 is retired and replaced by three plans that build
the pieces before the bundle. Plan 115 moves palettes out of CSS
into data: OKLCH canonical with hex at every boundary, sRGB only, paired or single-mode, a closed
token set that now includes the terminal colors, a server library for user palettes, and an editor
whose live preview writes variables to the root. Plan 116 gives
wallpaper a content-addressed library, a per-mode source setting, explicit rendering in the
compositor backdrop, and an importer seeded from `/usr/share/omarchy/themes`.
[Plan 117](docs/theme-bundles.md) binds separate light and dark variants under one name, each with
its own palette, syntax colors, wallpaper and material. Customization belongs to each bundle and
variant; switching applies the destination wallpaper. It adds a portable archive and the composed
Omarchy importer.

Plans 115 and 116 are implemented and deployed as of 2026-09-14, and
Plan 123 replaced 116's picker on 2026-09-17: a dialog with uploads,
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

Requested 2026-09-13. Six plans from one review, and a seventh added 2026-09-20 of the production web build. At the review the
deployed release sent 2421 KB gzip of JavaScript before the first frame, 2311 KB of it in a single chunk.
Plans 106, 107, 109 (Phases 2–3) and 129 (Phases 1–2) brought it to 1,610,904 B gz by 2026-09-21. The
cause is not bundler configuration — Rolldown is already in use and `apps/web/vite.config.ts` has no
chunking options because the application declares almost no loading boundaries. Chunk boundaries
come only from dynamic `import()` in source.

Execution order is strict:

1. Plan 106 builds the measurement instrument first, then defers Mermaid
   off the boot path and replaces the full Phosphor icon font — imported by one line of
   `packages/editor-find/src/style.css` for eleven glyphs — with inline path data. No dependencies.
2. Plan 107 replaces streamdown with `@workspace/markdown`,
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
   Phases 2 and 3 are implemented and deployed (2026-09-21): the report prints per-owner rows, and
   the terminal and settings load behind boundaries, first-load JS 1,722,976 → 1,610,904 gz. The
   written boot definition and the Phase 4 gate remain.

5. [Plan 129](plans/129-dependency-shape.md) owns the bytes 109 measured and handed off because no
   loading boundary reaches them: the Editor's three inline worker blobs, 579 KB gz and 25.5% of
   first-load JavaScript, and the `thin` and `light` Phosphor weights no call site draws. It does
   not depend on 108 or 109 and is the largest available cut, so it may run first; 109's gate
   re-pins downward when it lands.

Two research plans feed the lane and are not executable as written:
[Plan 110](plans/110-workspace-indexing.md) asks what belongs in a workspace index beyond the file
index that already exists, with Shiki grammar prefetch, Plan 088's semantic retrieval, Plan 108's
document graph and search as its waiting consumers.
Its smallest consumer, the language census for grammar and theme prefetch, is split out as
[Plan 170](plans/170-language-census.md) (decided 2026-09-25: owner).
[Plan 111](plans/111-editor-decorations.md) compares `@singapore-editor`'s inline-replacement layer against
CodeMirror 6 decorations and Lexical's decorator nodes, and gates Plan 108 Phase 2, any later
Obsidian mode, and the question of whether the chat composer still needs Lexical.
Decided 2026-09-25: owner — 111's research is authorized with the composer as its first consumer,
and runs before the next wave.
[Plan 176](plans/176-markdown-parser.md) replaces Plan 108 D5 (decided 2026-09-26: owner): it
measures which parser drives live preview, with tree-sitter as the lead against `@lezer/markdown`, a
Rust parser and remark, and whether the winner can also replace remark in chat. Plan 108 Phase 2
waits on it.
[Plan 171](plans/171-composer-on-our-editor.md) is that composer migration: it inventories what
the composer uses Lexical for and orders the Editor gaps to close, with 111 first (decided
2026-09-25: owner — delete Lexical; the replacement is our own editor).

Coordinate shared editor and chat surfaces with Plans 101–103 and 115; do not interleave edits to the same
files. Plan 085 owns first paint and restoration, which this lane measures but does not change.
Replacing React with a smaller reimplementation was considered and rejected: React is 60 KB of the
first load, so it is revisited only once it is the largest remaining line item.

Plans 106 and 107 are done and deleted. What remains of the lane is 108 Phase 1, 109's gate
(Phase 4) and its Phase 1 doc, and 129 Phase 3 (Q2–Q4).

## React compiler and pane lifetime lane

Requested 2026-09-20. Plan 127 precedes
[Plan 128](plans/128-react-19-patterns.md). Plan 127 is done (`d5e7f213`, `e93ff779`) and deleted:
the compiler census runs in `gates`, and `lib/keep-alive` keeps terminals mounted across layout
changes. Plan 128 is not started and is partly obsolete. `2acc3b73` deleted the server's detach TTL,
so no shell is killed ten minutes after an unmount, and keep-alive covers its first two terminal
sites. The completion wave runs it rewritten small: A1.3, B2 and the `AGENTS.md` section.

Plan 127 is the repair pass. It turns the React Compiler's diagnostics on, pins them with a census
beside the design census, clears the `ref={focusTarget.ref}` bailouts, stops the bottom panel and its
collapse from unmounting every terminal, settles git stage,
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

## Workaround removal lane

Requested 2026-09-21, after the diff line-comment fix replaced a DOM read, a duplicated projection
and a runtime assumption guard with one Editor API (`diffRowAtEvent`). Five read-only audits the same
day swept both repositories for the same shape and for workarounds generally. Their findings are
grouped by owner into four Platform plans and five Editor backlog entries. Items marked verified in
each plan were confirmed in source; the rest are audit findings an implementer re-checks first.

Suggested order (steps 1–4 done by 2026-09-23; step 5 is in progress):

1. Plan 131 Phase 1 (all of Plan 131 done on lane L2, 2026-09-25) and
   [Plan 132](plans/132-process-and-dev-ownership.md) Phase 1. A tool permission's lifetime is
   decided by substring match, and the desktop app can kill a process it does not own. Both are
   small and both need a `--server` or desktop restart, so batch them.
2. [E047](../Editor/docs/display/e047-point-queries.md), then
   [Plan 130](plans/130-ask-the-editor.md) Phases 1 and 4. One point query in the Editor removes the
   search-result row arithmetic, the unicode hover's marker scan and the residue in `diffRowAtEvent`.
   Done: E047 landed in Editor `6656eb7`, and Plan 130 Phases 1, 2 and 4 are implemented and verified.
3. [E048](../Editor/docs/display/e048-minimap-document-space.md) and
   [E051](../Editor/docs/display/e051-fast-path-equivalence.md). The minimap repeats the display-row bug,
   and the row-layout fast path has no equivalence test. Done: Editor `2f801f7` and `7a37f10`.
4. [E049](../Editor/docs/architecture/e049-no-silent-misses.md), Plan 133. Done: E049 in Editor
   `f715d11`; Plan 133's four phases 2026-09-23, D1 moved to Plan 134 and closed there.
5. [E050](../Editor/docs/architecture/e050-host-obligations.md) row by row, each unlocking its Plan 130
   Phase 5 item. In progress: rows re-checked 2026-09-24; row 1 (`setText` with tokens), row 5 (press
   participants), row 6 (plugin keymap context keys) and typography options (2026-09-25) done.
   Rows 8 (`onDidScroll`) and 4 (theme keys) unlock Plan 130 Phase 5 items 8 and 10; the rest are
   Editor-only. Plan 130 Phase 3 (`getStackedRows`) is a separate small Editor change.

Left in the lane: Plan 132 Phases 2–4, the Plan 130 remainder and the E050 rows.

The owner decided Plan 132 D4 on 2026-09-21: the server's migrations are deleted and the schema
starts from scratch (Plan 132 Phase 4). External-change
and dirty-buffer safety from Plan 133 D1 were verified and closed by Plan 134. No lane is reordered
by this one.

## External edits and language-server freshness

Plan 134 is done (2026-09-25): external edits, linked packages, configuration, installs and branch
switches reach open documents and language servers; streams and language servers recover from gaps;
diagnostics say how fresh they are. What was found and decided is in
[the findings](docs/external-edit-lsp-findings.md).

## Agent workbench lane

Requested 2026-09-24. A survey of every reference clone (T3 Code, t1code, OpenCode, Crush, Codex,
Paseo, Orca, herdr, VS Code's agent host, NeuralInverse, Void, Anubis, pstack, Serena, streamdown)
asked which large agent features Platform lacks. The owner grouped the answers into the plans below.
Research plans do enough research to be correct, then their research phase rewrites their own
phases or splits them into executable plans; not all research happens up front.

| Plan                                          | Kind                   | Owns                                                                                                                        |
| --------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 138 (done)                                    | executable             | Claude models from the Claude CLI; chat runs the installed CLI                                                              |
| [139](plans/139-acting-on-agent-diffs.md)     | research               | Keep or undo agent edits per hunk, batched diff comments to the agent, review mode, second-model review, plan line feedback |
| [140](plans/140-editor-agent-advantage.md)    | research               | Editor context into chat, fix with AI, diagnostics fed back to the agent                                                    |
| [141](plans/141-usage-and-rate-limits.md)     | executable             | Rate-limit meter, usage page with cost, usage history                                                                       |
| 142 (done)                                    | executable             | Web Push from the mesh server                                                                                               |
| [143](plans/143-phone-layout.md)              | direction approved     | What the phone is for; web layout versus the later companion app                                                            |
| [144](plans/144-unattended-agent-work.md)     | research               | Scheduled, looping and multi-agent work: surface what the harnesses already do, build only the rest                         |
| [145](plans/145-harness-controls.md)          | small executable plans | Fork, approval rules, MCP status, background tasks, hooks, custom agents, compact, export                                   |
| [172](plans/172-shared-undo-stack.md)         | research               | One undo/redo stack behind Mod+Z, extracted from the existing undo implementations; Plan 126 LIFE-13 first                  |
| [173](plans/173-two-devices-one-workspace.md) | research               | Two clients opening a workspace on one server: per-client open generations, what the losing client sees                     |

[Plan 126](plans/126-t3code-alignment.md) also gained the T3 features shipped after its
2026-09-19 audit, and four reopened non-parity decisions.

Suggested order:

1. ~~Plan 138~~ — implemented 2026-09-24.
2. Quick wins: ~~Plan 141 Phases 1–3~~ (meter, per-turn recording, usage page; 2026-09-25), the
   small Plan 145 plans (~~approval-rules~~, merged in `89c58188`; ~~the rest~~, lane L3), and the small new Plan 126 rows.
3. ~~Plan 142~~ — implemented 2026-09-25 (completion wave, lane L5). The phone checks and the
   owner question are in the [delivery record](docs/web-push.md).
4. The research phases of Plans 139 and 140. Plan 140's diagnostics work waits on Plans 087 and
   088; its editor-to-chat work does not.
5. Plan 144's capability inventory. It decides how much of that lane is built rather than surfaced.
6. Plan 143: direction approved 2026-09-25 (two lazy shells behind one URL; Tailscale now, pairing URL, relay later). Research phase next.
7. Plan 172's research before Plan 126 LIFE-13 is rebuilt (decided 2026-09-25: owner — one shared
   undo/redo stack replaces the latest-undo slot).
8. Plan 173's research before Plan 143's phone shell: the phone becomes a second client of the
   same server.

## Daily-driver lane

Requested 2026-09-25. The owner is moving to Platform as their main agentic coding tool; a review
of the plans, both logs and the service journal named what stands in the way. The unit file's
`SuccessExitStatus=143` was fixed on the spot.

| Plan                                           | Owns                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 146 (done)                                     | Dev and prod stop sharing `~/.platform`; each `agent:browser` run gets its own server and state                          |
| [147](plans/147-log-hygiene-and-noise-gate.md) | Producer fixes, level rules, the reaper give-up, ACK timeout vs overflow, a `logs:census` gate                           |
| [175](plans/175-large-folder-open.md)          | Opening a huge folder: watch limit, unreadable folders, switch not cancelled by clicks, bounded prefetch                 |
| [177](plans/177-prefetch-every-press.md)       | Prefetch on intent for every async press (diffs, chats, quick open, search), per-surface toggles                         |
| [148](plans/148-restart-when-idle.md)          | `deploy --server` stages; the server restarts when no turn is running                                                    |
| [149](plans/149-terminal-host.md)              | A PTY host that survives server restarts                                                                                 |
| 150 (done)                                     | Remote servers are checked for protocol; a stale one relaunches or reads "Server out of date"                            |
| 151 (done)                                     | Done: releases ship their runtime; Update server installs them over SSH ([record](docs/remote-server-releases.md))       |
| 152 (done)                                     | Done: a dev primary builds its tree and installs it in its own remote channel ([record](docs/remote-server-releases.md)) |

Suggested order:

1. ~~Plan 146~~ — implemented and deployed 2026-09-25. Prod keeps `~/.platform`, dev uses
   `/work/platform-dev/home`, and every `agent:browser` run has its own throwaway server.
2. Plan 147, after 146 removes the pollution it would otherwise re-level.
3. Plan 148, so Platform can deploy itself without killing the deploying turn.
4. Plan 149, so terminals and dev servers survive the same restart.
5. ~~Plan 150~~ — done 2026-09-25 (completion wave): protocol check at both ends of the SSH
   launch, stale relaunch, structured machine errors, "Server out of date". Plan 151 done 2026-09-25
   (completion wave; live Mac update is an owner check). Plan 152 done the same day.
6. Plan 175, reported 2026-09-26: opening `/work` froze the server for 10.8 s and took 92% of the
   machine's inotify watches. Phases 1–2 need no decision.
7. Plan 177's research (requested 2026-09-26). Its Phase 0 first-paint measurement is also the
   baseline for Plans 170 and 176.
8. Then Claude rewind and fork ([Plan 145 fork](plans/145-harness-controls.md), done, Plan 126
   RUNTIME-01) and the Plan 139 research phase.

## UI refresh lane

Requested 2026-09-25. A survey of 14 component libraries
([docs/ui-research](docs/ui-research/README.md)) listed what to take for the base components, chat
surfaces, the file picker and the site. The owner is taking it one topic at a time.

| Plan                                          | Owns                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [157](plans/157-base-components.md)           | Tabs, scroll fades, hold-to-confirm, status dots, typeahead refine; queued next                                           |
| [158](plans/158-app-polish.md)                | Tail following with "N new" in `VirtualList`, secrets display, checkpoint restore, branch lanes, boot frame               |
| [159](plans/159-file-picker.md)               | File and folder picker rewrite: columns, real previews, thumbnails, history keys                                          |
| 160 (done, lane L2)                           | Reasoning fold, turn receipts, live tail, model marker, tool details, plan steps, subagents, ultra sparkle                |
| 161 (done, lane L2)                           | Approval lifecycle, stopped turns, streaming holds, folding rules, hostile-state scenarios                                |
| ~~162~~                                       | Done 2026-09-25 (lane L3): context breakdown, usable window, session total, usage-page honesty                            |
| 163 (done, lane L2)                           | Screenshot attachment in the composer (export shipped with Plan 145)                                                      |
| [164](plans/164-what-feels-right-in-neon.md)  | First pass shipped (Inter, one mono, `section-label`, radius); a metadata font sweep is left                              |
| 165 (done)                                    | Nerd Fonts + Fontsource on demand; interface-font setting; curated autocomplete picker                                    |
| [166](plans/166-shortcuts-editor.md)          | Keyboard shortcuts page rebuilt from VS Code research: full-width list, save on Enter, several per command                |
| [154](plans/154-physical-mode.md)             | The seamui feel (springs, depth, motion in every primitive) and interface sounds                                          |
| [155](plans/155-site-demo-replica.md)         | Placeholder: the site hero becomes an animated replica of the app, like cursor.com                                        |
| [156](plans/156-documents-in-the-editor.md)   | Placeholder, far future: PDF, DOCX, XLSX, PPTX and CSV as editor documents agents can edit                                |
| [178](plans/178-tree-in-the-app.md)           | Plan of plans: the file tree rebuilt on app primitives (VirtualList, useListbox, dnd-kit, icons, Tailwind) at full parity |
| [179](plans/179-isolating-foreign-content.md) | Where a shadow root earns its place: mermaid, previews, an editor style-recalc experiment                                 |
| [180](plans/180-file-icon-variants.md)        | Quick research: more glyphs, variants and per-mode colours from the icon pack we already use                              |

Suggested order:

1. Plan 157, the base components. Queued next by the owner.
2. Plans 158–163 in any order once their decisions are answered. 158 builds on 157's status dot and
   scroll utilities; 160 and 161 touch the same timeline rows, so land them one after the other.
3. Plan 164's first pass shipped (`03f241fc`, `e8156148`); what is left is a metadata font sweep. The
   square status dots belong to Plan 157.
4. Plan 165, the font catalog, is done (`d9c6069e`, review `7ad4c866`, 2026-09-25).
5. Plan 154 near the end. Phases 1–3 may land earlier; Phases 4–6 wait for the base components so
   every new primitive is wired and audited once. D6 (settings semantics) comes first.
6. Plans 155 and 156 are placeholders; their research phases run when the site or documents matter.
7. Plan 166 any time; its research phase runs first, and it takes 102 P3, 157 and 080 from `main` as
   they land.
8. Plan 178: the parity harness first, then out-of-the-root and app-owned state; Q1–Q5 before the
   sub-plans they gate. Plan 179's Phase 0 instruments (style recalc split out of `trace`) any time;
   its editor experiment reuses Plan 178's scroll baseline.

## Parked plans

Not in the [completion wave](docs/completion-wave.md), each for the reason given there:

- [Plan 114](plans/114-polaron-shell.md), a desktop shell we own (tao, wry, Bun as a child). It
  needs an explicit go/no-go, and it collides with the desktop work in Plans 132 and 149.
- Plan 168, a flat file view under a chosen root (ex-Editor E030): dropped 2026-09-25 by owner:
  tree search covers it. Decided 2026-09-25: owner — drop it; the file tree's existing search
  already covers the need. Its plan file is deleted; git history keeps it.
- Plan 105 Phase 4, dropping the `/platform` route prefix. It needs service-level names in mesh,
  which no mesh task covers. The rest of Plan 105 is done and its file is deleted; the hashed-asset
  carry-forward between releases moved to Plan 109.

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
