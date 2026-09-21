# 134: Keep documents and diagnostics current after external edits

Status: proposed. Investigation first; the general fixes are not implemented.

## Outcome

A user opens an ordinary project, edits it in another tool, and returns to Platform. Clean documents show the new disk contents. Dirty documents retain unsaved work and offer conflict resolution. Diagnostics, navigation, and completion reflect the current project, including dependencies that were never opened in Platform.

This must work without clearing browser storage, restarting Platform, or routinely restarting the language server. An unavailable or refreshing result must not look like a successful empty result.

## Evidence and limits

Start with [the external-edit findings](../docs/external-edit-lsp-findings.md). The investigation on 2026-09-21 established:

| Case                                                                    | Observed result                                                                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary open TypeScript file edited on disk                            | Mesh app displayed new text and the corresponding TS2322 diagnostic.                                                                               |
| Unopened dependency edited, atomically replaced, deleted, and recreated | All four transitions updated diagnostics through Platform's proxy with TypeScript 6.0.3.                                                           |
| Unopened dependency edited with native TypeScript 7.0.2                 | No diagnostic-refresh notification within 20 seconds. This does not yet prove whether a manual diagnostic request would also return stale data.    |
| Open file reached through a symlink                                     | Editor retained the removed line beyond five seconds in both mesh and development. Later scenario steps did not run.                               |
| Declaration output deleted and rebuilt for a linked package             | TypeScript 6 retained TS7016 after declarations returned, under both Node and Bun. A project reload cleared it.                                    |
| New browser joins an already-open document                              | Proxy suppressed duplicate `didOpen` but did not replay diagnostics. A local fix and regression tests exist, but deployment has not been verified. |

The initial browser check showed zero Problems without receiving diagnostics. Do not repeat that mistake: distinguish an empty publication from no publication.

Production logs named server release `20260921T103639Z-2bdc8b52-main` even though the release symlink pointed elsewhere. Inspect the running server's release and the web build separately.

## Ownership and scope

| Responsibility                                      | Starting points                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filesystem observation and event classification     | `apps/server/src/fs/watch.ts`, `open-file-watches.ts`, `service.ts`                                                                                         |
| File events, reconciliation, dirty-buffer conflicts | `apps/web/src/features/workspace/hooks/use-events.ts`, `state/event-conflict-adapter.ts`; `features/editor/state/file-sync-service.ts`, `conflict-state.ts` |
| Shared language-server process and protocol         | `apps/server/src/lsp/proxy-session.ts`, `typescript/runtime.ts`, `registry.ts`                                                                              |
| Client capabilities and connection lifecycle        | `apps/web/src/lib/language-server-capabilities.ts`; `features/editor/state/language-server-connection-pool.ts`, `hooks/use-lsp-plugin.ts`                   |
| Diagnostic requests and presentation                | Editor `packages/lsp-plugin/src/pullDiagnostics.ts`; Platform `features/workbench/components/diagnostics-panel.tsx`, `state/diagnostics-reload.ts`          |

Platform owns host filesystem access, environment routing, and shared backend lifetimes. Editor owns protocol consumption and document-specific diagnostic state. Change Editor only if its current public API cannot express the required lifecycle.

This plan owns the external-change safety check raised by Plan 133 D1. Reconcile that audit with the existing conflict store and adapters; an overwrite-related function or TODO is not proof that every active path overwrites dirty content. Do not build a second conflict system.

Coordinate process recovery and runtime identity with Plan 132. AI diagnostic actions remain a separate plan and do not block this work.

## Phase 1: Reproduce and locate each failure

1. Capture current commits and dirty diffs in Platform and Editor. Preserve the existing replay fix and unrelated work. Check which runtime the target workspace actually selects; do not assume every project uses the fallback TypeScript.
2. Run app doctor and record web/server release identity. Read the relevant log window before forming a theory.
3. Restore the retained integration reproduction into the existing TypeScript server tests. Its location is recorded in the findings document. Use disposable projects under `/work/tmp`; clean fixtures up afterward and retain evidence.
4. Establish a control for every probe: a known error must arrive, then a known fix must clear it. Verify exact URI, document version where available, error code, and message. A screenshot alone cannot prove the LSP result.
5. For TypeScript 7, record initialization capabilities and server registration requests. After the external write, check filesystem observation, refresh delivery, a direct diagnostic request, and a hover independently. Distinguish stale project data from a missing refresh request.
6. For the symlink failure, wait for the watch subscription to be ready before writing. Trace the disk revision through native watch, stream delivery, cache invalidation, reconciliation, document synchronization, and paint. A missed event during subscription setup and a permanently broken watcher require different fixes.
7. Enrich existing operation/session logs where a link is unobservable. Record watcher readiness, counts, stream generation, event classification, reconciliation outcome, runtime identity, and refresh outcome. Do not log file contents or diagnostic text.

Exit: each failure has a deterministic reproduction, the first incorrect boundary is identified, and the instrument detects the corresponding successful control. Preserve unresolved hypotheses explicitly.

## Phase 2: Repair external document synchronization

1. Fix the failing boundary from Phase 1. Exercise direct paths, symlink aliases, retargeted symlinks, replaced directories, and editor-style atomic saves. Keep watching after replacement; retaining a watch on an obsolete inode is insufficient.
2. Reuse the current filesystem hub and document owner. Preserve alias paths for the displayed document while following the current filesystem target. Share native watches where possible and release them when their owners close.
3. Reconcile clean buffers to the new disk revision and synchronize that text to the LSP. Guard async reads against navigation or a newer revision arriving while the read is pending.
4. Preserve dirty buffers. Store the new disk revision as a conflict and route resolution through existing document actions. Revert must load the selected current disk revision; an intentional overwrite must use the existing revision precondition so it cannot erase a third-party update made during resolution.
5. Handle external deletion and rename without losing unsaved text. Do not make a dirty buffer disappear merely because its path disappeared.

Exit: `editor-external-edit` completes every phase, including conflict protection and revert, rather than stopping after the first successful update. Ordinary-path controls still pass. Watch counts return to baseline after closing the fixture.

## Phase 3: Deliver filesystem changes to language servers

1. Confirm the installed servers' watcher requirements. The proxy currently acknowledges `client/registerCapability` without implementing watchers, while the client does not advertise dynamic watched-file registration. Do not enable a capability until its implementation exists.
2. Implement watched-file registration at the shared backend owner, not once per browser. Prefer extending the existing watcher infrastructure. Add a dedicated adapter only where its current filtering or path model cannot satisfy LSP registrations.
3. Support registration IDs, replacement, unregistration, glob and relative-pattern semantics, and create/change/delete masks. Derive bases from the registered workspace or explicit URI. Respect environment filesystem boundaries. Dispose watches on backend termination, failed initialization, or registration replacement.
4. Do not inherit UI-tree ignore rules blindly. Dependencies, declarations, configuration, and package metadata under `node_modules` or linked paths may be exactly what the language server asked to watch. Conversely, avoid unconditional recursive watches over an entire drive.
5. Coalesce bursts without losing final filesystem state. Test atomic replacement classification against the installed TypeScript versions: a rename-to-existing-path event must not leave the old file contents cached. Keep any runtime-specific adaptation narrow and backed by a reproduction.
6. Advertise only the watched-file capabilities now supported. Reply to registrations after watches are ready, and report unsupported or failed requests honestly instead of acknowledging an operation that did not happen.
7. Deliver `workspace/didChangeWatchedFiles` to the shared backend. Preserve the open-buffer contract: an external event for a dirty open file does not authorize replacing its LSP buffer with disk contents.
8. Verify both pull and push diagnostics. Forward server refresh requests through the proxy, make the active Editor request new pull diagnostics, and prove that push servers publish cleared results. Include a second non-TypeScript server with watcher registrations before claiming generic support.

Exit: the native TypeScript unopened-dependency test passes without injected document edits, manual diagnostic refresh, or process restart. TypeScript 6 controls remain green. Multiple browsers share watches and do not multiply notifications.

## Phase 4: Recover after gaps and make freshness visible

1. Define an explicit freshness state for each document/server result: awaiting first result, current, refreshing, or unavailable. Retained display data is not proof that the project remains current. Keep empty diagnostics distinct from missing diagnostics.
2. Reconcile after connection loss, watch errors, subscription replacement, or foreground return when continuity cannot be established. Re-read revisions for open documents, preserve dirty buffers, then synchronize and refresh diagnostics.
3. Use stream generations or continuity information supplied by the stream owner. Do not infer a lost event from a gap in a global sequence filtered for one subscriber, and do not infer continuity solely because the connection stayed open.
4. Review the local diagnostic replay fix. Replay only results applicable to the joining document. Test stale backend versions, changed dependencies with unchanged source text, late publications, empty publications, owner divergence, close/reopen, and joining during refresh.
5. Reuse TanStack queries and mutations for shared async state. Make reconciliation idempotent and serialize it by document or shared backend. Repeated focus events must not create parallel resync loops.
6. Add bounded recovery for proven watcher or backend failure. Prefer a supported project refresh; if recovery requires recreating a language server, resynchronize its owners and expose the temporary unavailable state. Never restart the application, terminals, or agent sessions to repair LSP state.
7. Revisit the linked-declaration reproduction after watcher support is correct. If the server still returns stale data, isolate an upstream issue and decide on a tested targeted recovery. Do not suppress TS7016, add ambient `any` declarations, or rewrite users' project configuration as a workaround.

Exit: an external edit while the page is disconnected or backgrounded becomes visible with correct diagnostics on return. Unsaved text survives. Saved diagnostic placeholders never masquerade as a fresh clean result.

## Phase 5: Verify the user journeys and release

Use an ordinary disposable project, not Platform or Editor as the only fixture. Run the applicable cases against both TypeScript 6 and 7:

| Operation                                                    | Required assertion                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Edit an open clean file externally                           | Disk text, visible text, LSP text, and diagnostics converge.                        |
| Edit an unopened dependency                                  | Open consumer's diagnostics, hover, and completion reflect the new export.          |
| Atomic save; delete/recreate; rename                         | Correct final state arrives, and the next edit is also observed.                    |
| Symlink target or parent directory replacement               | Alias shows the current target and continues receiving edits.                       |
| Configuration change; dependency installation; branch switch | Project resolution refreshes without editing the consumer to provoke it.            |
| Dirty buffer plus external edit, delete, or rename           | Local content survives and conflict actions are explicit and revision-safe.         |
| Second browser joins before or after a result                | Correct diagnostic state appears; no false clean state or duplicate native watches. |
| Offline/background edit, then return                         | Reconciliation and diagnostic refresh occur without manual cache clearing.          |
| Watcher/backend failure and recovery                         | Failure is observable, retry is bounded, and unrelated sessions remain alive.       |
| Repeated open/close and reconnect                            | Watchers, subscriptions, and pending work return to baseline.                       |

Starting checks, adjusted to the files actually changed:

```bash
TMPDIR=/work/tmp bun run --cwd apps/server test src/lsp/tests/typescript-server.test.ts src/lsp/tests/proxy-session.test.ts src/fs/tests/watch.test.ts src/fs/tests/watch-classification.test.ts
bun run --cwd apps/server typecheck
bun run agent:browser look --doctor
bun run agent:browser scenario editor-external-edit
```

Add focused tests in `features/workspace/tests/use-events.test.ts` and the existing conflict tests. Add a browser scenario for diagnostic freshness, since the current external-edit scenario uses text files and cannot prove LSP behavior. Follow `verify-fregat`; inspect screenshots, protocol evidence, and the matching log window. Run touched web/Editor checks and applicable compiler/design gates when those layers change. Compare against a recorded baseline, not a fixed global test count.

Before deployment, finish the reviewable changes and evidence using the existing release workflow. Verify the actual running server and web release afterward, then repeat the ordinary-project journeys against that deployment. A changed release symlink is not deployment proof. Do not restart shared services during investigation.

Done means every applicable case passes, known upstream limits have tested recovery, and production evidence names the running release. A manual project reload that clears one error is a recovery demonstration, not completion.
