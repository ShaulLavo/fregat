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

## Instant workspace reload

[Plan 085](plans/085-instant-workspace-reload.md) is proposed and implementation has not started.
It follows the existing environment, workspace-address, settings-admission, and Editor paint
foundations. Its internal order is calibrated browser proof and budgets, synchronous bootstrap,
tree/settings, Git/diff, search/chat, continuous native handoff, remaining visible tools, and
complete reload verification. The first complete slice is bootstrap plus tree and settings.

Editor/diff paint and Ghostty terminal viewport replay stay with their package owners. If a required
native contract is absent, record that package dependency before implementing its host integration.
The plan remains incomplete until the visible terminal and all other scoped panes pass. This
proposal does not reorder Plan 080 or the existing TUI and Ghostty lanes.

## Environments lane (foundation completed 2026-09-05)

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

The remaining order is:

1. **Plan 078 — federated environments.** Implemented; automated checks pass.
   Machines settings, the desktop SSH launcher, independent chat connections, scoped persistence,
   the cross-machine rail, machine selection, and per-machine failure states are in place.
   Live localhost SSH and browser gates remain open; retain the plan until they pass.
2. **Later, on demand only:** the direct `https://` origin check through the mesh proxy, then pairing,
   issued sessions, and revocation for a client that cannot SSH. The auth analysis in Git history
   (`docs/environments-and-remote-plan.md@1325b003`) remains the reference for that plan.

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

## Verification boundaries

- **Platform-only:** verify the narrow Platform tests/typechecks named by the active plan.
  Completed Plan 056 was verified within this boundary.
- **Platform + Editor lockstep:** plan 057 requires focused checks and diff review in both
  worktrees. Neither repository's half is complete alone.
- **`ghostty-webgpu`:** run its package gates in that repository.
- **Environments (068, 078, extending completed 077):** verify with two isolated in-process or
  loopback servers and distinct databases; the SSH gate uses the `localhost` target only. No test or demo binds
  non-loopback. Pairing, sessions, and TLS refusal are one later security boundary, not part of
  these three plans.
- Preserve pre-existing dirty work in every linked worktree. Use baseline deltas and the narrowest
  checks that can catch a plausible regression; never use a bare root test count as completion proof.

## Promotion, rewrite, defer, and deletion decisions

- **Deleted:** completed plans 038, 068, 069, and 077, and superseded plan 058.
- **Editor lane:** Plans 056 and 057 are complete. Standalone Editor chord execution was
  verified before Platform adopted the shared runtime.
- **Promoted:** environments foundations 077 and 068 are complete; Plan 078 is implemented with
  automated checks passing and live SSH/browser gates open.
- **Deferred:** the mesh https proxy check and pairing/sessions, until a client that cannot SSH
  exists; all compatibility work for the obsolete per-tab/active-editor/one-server architecture.
- **Dropped:** Ghostty config appearance plans 066 and 067; see the decision above.
- **Package-blocked:** `ghostty-webgpu` plan 009 needs public native extension surfaces. Plan 010 is
  additionally waiting on that dependency and physical operator gates; plans 011–015 remain downstream.
