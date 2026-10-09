# Plan 342: Repair app reactivity and async ownership

## Status and scope

- Status: Approved repair work, recorded 2026-10-09. Audit complete; implementation has not started.
- Audited at: `847e696846ab85150f89ed1deeef49e5757f4d0b`.
- Scope: focused application audit following the React Compiler, Query/Router, composition, and state-boundary research. This is a bounded repair queue, not a framework migration.
- Owners: each unit below names its application domain and existing plan. This file owns the exact new defects, reproduction evidence, ordering, and acceptance. Broader programs retain their scope.

Read the cited source before execution. Run `git diff --stat 847e696846ab85150f89ed1deeef49e5757f4d0b..HEAD -- <unit paths>` and reconcile intervening fixes. Do not reproduce a resolved finding or overwrite another session's changes. Use repository React, Query, TypeScript, UI, and verification skills, plus the execution host's scheduling instructions.

## Execution order

| Unit | Problem                                                                      | Priority | Effort | Fix risk | Confidence                                                    | Dependency                                    | Status                 |
| ---- | ---------------------------------------------------------------------------- | -------- | ------ | -------- | ------------------------------------------------------------- | --------------------------------------------- | ---------------------- |
| 1    | MCP actions combine old data with a new provider or folder                   | P1       | M      | Medium   | High; Query observer proof and complete action-source trace   | None                                          | Approved               |
| 2    | Semantic-token cancellation removes other waiters and newer flight ownership | P1       | S      | Low      | High; actual public server API proof                          | None                                          | Approved               |
| 3    | App DOM tests silently omit React Compiler                                   | P1       | M      | Medium   | High; actual plugin transform and controlled test pass/fail   | None                                          | Approved               |
| 4    | Diff live text remains cached after the buffer changes                       | P1       | S      | Low      | High; exact compiled hook execution                           | 3, or an existing compiled browser regression | Approved               |
| 5    | Tree mutation availability ignores cache confirmation changes                | P1       | S      | Low      | High; actual compiled hook test failure                       | 3, or an existing compiled browser regression | Approved               |
| 6    | Recent-folder restoration keeps the initial navigation permission            | P2       | S      | Low      | High; exact compiled hook execution                           | 3, or an existing compiled browser regression | Approved               |
| 7    | Site player child timers overwrite a skipped or replayed story               | P2       | S      | Low      | High; actual player and replica runtime proof                 | None                                          | Approved               |
| 8    | TUI syntax resources retain the initial theme                                | P2       | S      | Medium   | High in source lifetime; native rerender still needs proof    | None                                          | Approved               |
| 9    | An old TUI dialog completion can close a newer dialog                        | P2       | S      | Low      | Medium; continuation proof, navigation integration unverified | Reproduce actual TUI navigation first         | Approved investigation |

Start 1 and 2 independently. Establish 3 before accepting compiler-sensitive DOM regressions for 4–6. Units 7 and 8 can run independently. Unit 9 starts with a real interaction proof. No public package API needs to change for these application repairs; add patch changesets if execution expands into shipped packages.

## Unit 1: Keep MCP data and actions with the same subject

Owner: [174](174-external-mcp-servers.md), with [192](192-no-swap-flash.md)'s held-subject contract.

Current source:

- `apps/web/src/features/settings/hooks/use-instance-mcp.ts:10` applies `placeholderData: keepPreviousData` across provider and folder changes.
- `utils/mcp-query.ts:18` fetches the selected provider and folder. `utils/query-keys.ts:15` correctly includes both in the key; key identity is not the defect.
- `components/mcp-section.tsx:57` retains `McpServerList` across subject changes.
- `components/mcp-server-list.tsx:76` renders old server records with the new `instance` and `folder`. Rows are keyed only by server name.
- `components/mcp-remove-dialog.tsx:64` invokes removal with the new folder and the displayed record's old name/scope. `hooks/use-remove-mcp-server.ts:13` targets the new provider. Copy and sign-in share the same mixed subject.

Installed QueryObserver proof changes from provider A/folder A to a pending provider B/folder B query. Observed result:

```json
{
  "dataOwner": "provider-a/fixture-a",
  "isPlaceholderData": true,
  "isPending": false,
  "isFetching": true
}
```

The row remains actionable under B's header. If B defines the same name/scope, the operation can affect B's configuration even though A's record supplied the visible details. No real deletion was performed during the audit.

Execution:

1. Extend `apps/web/src/features/settings/tests/mcp-section.test.tsx` using its real in-process server and external `McpConfigAdapter`. Give A and B distinct definitions with the same name and defer B's list response. Cover provider and folder changes, including an already-open remove/add dialog.
2. Keep displayed data, scopes, provider, folder, and action targets together until a complete subject switch. Alternatively exclude mismatched placeholder records from mutation-capable UI. Choose the smallest design consistent with the held-subject loading rules. Reset subject-specific dialog state when its owner changes.
3. Assert that delayed B data never causes A's row to dispatch removal, copying, or sign-in against B. Use isolated fixture records for mutation proofs.
4. Run `bun --bun vitest run --project dom src/features/settings/tests/mcp-section.test.tsx` from `apps/web`. Extend `scripts/agent/scenarios/mcp-settings.ts` for delayed subject switching and run `bun run agent:browser scenario mcp-settings` with fixture providers only.

Exit: delayed subject switches preserve action ownership and all fixture tests pass. Do not replace harness-owned configuration with a Platform MCP manager or contact a live provider.

## Unit 2: Cancel the requested semantic-token waiter

Owner: [088](088-native-code-intelligence.md)'s backend request ownership; preserve [333](333-async-terminal-and-server-adapters.md)'s existing LSP pool.

Current source in `apps/server/src/lsp/proxy-session.ts`:

- `:1187` identifies cancellation's client request ID, but `:1200` passes only its connection to waiter removal.
- `:792` coalesces several client request IDs onto one backend flight, including IDs from the same pooled connection.
- `:1713` removes every waiter on that connection. Two views can share a connection through `apps/web/src/features/editor/state/language-server-connection-pool.ts:26` and create independent semantic controllers through `utils/language-server-plugin.ts:354`.
- `:1723` deletes the URI's in-flight marker unconditionally after the final waiter leaves. An edit can already have installed a newer flight at `:826`.
- Response cleanup at `:862` already checks that the marker still equals its backend ID. Use the same ownership rule for cancellation.

An actual `LspSessionPool` proof uses fake external child stdio and socket objects, with no network sockets or provider calls. Known-good controls establish initial coalescing and separate requests across an edit. Observed failures:

```json
{"check":"one-connection-two-waiters","cancellationSent":true,"remainingRequestAnswered":false}
{"check":"older-cancellation-newer-marker","fullRequestsAfterSameVersionJoin":3,"expected":2}
```

Execution:

1. Extend `deltaFixture` in `apps/server/src/lsp/tests/proxy-session.test.ts:1883`. Send IDs 10 and 11 through `first`, cancel 10, and answer the single backend request. Require a reply for 11 and no premature backend cancellation.
2. Keep connection-wide removal for disconnect. Individual cancellation removes only the matching connection/client ID. Cancel backend work only when its final waiter leaves.
3. Start A, edit, start B, cancel A, and ask C without another edit. C must join B, with only two backend requests. Remove a URI marker only when it still names the retiring backend ID. Cover last-owner close after old cancellation.
4. Preserve the existing tests `cancels the shared request only when the last waiter gives up`, `starts a fresh request rather than coalescing across an edit`, and `refuses a delta computed against a baseline it no longer holds`.
5. Run `bun --bun vitest run src/lsp/tests/proxy-session.test.ts` from `apps/server`.

Exit: remaining waiters receive their answers, disconnect still clears its owned waiters, newer requests retain their discoverability, and all targeted tests pass. No new protocol, timeout, or version-negotiation path is needed.

## Unit 3: Prove that compiler-sensitive tests actually compile

Owner: this plan's verification prerequisite. Preserve existing socket-free app fixtures.

`apps/web/vitest.config.ts:11` requests `compiler: true`, but `test/env/happy-dom-ssr.ts:21` selects `viteEnvironment: 'ssr'`. Installed `@vitejs/plugin-react` 6.1.1 sets `reactCompiler: false` for a server consumer in `dist/index.js:225`. Direct plugin-transform controls show no compiler cache in server output and compiler cache in client output.

The existing `workspace/tests/use-fs-actions.test.tsx` test `saved rows cannot start mutations until the tree is confirmed` passes normally. A scratch configuration retains all standard fixtures and compiles only the actual `use-fs-actions.ts` through `scripts/lint/react-compiler.mjs`. That same test fails at line 419:

```text
AssertionError: expected true to be false
expect(harness.result.current.actions.mutationsEnabled).toBe(false)
```

Execution:

1. Establish a test path using the real build compiler for browser React modules while preserving in-process server/Bun resolution. The existing `apps/web/vitest.browser.config.ts:45` client transform is a working route for narrow regressions; changing every DOM environment is not a prerequisite for the first repair.
2. Add a meaningful compilation control that verifies the chosen path invokes the compiler and exercises stable-owner/changing-snapshot behavior. Inspect generated output rather than trusting a config flag.
3. Run the existing failing tree regression through that path before changing product code. It must fail for the audited reason. Then add compiled regressions for units 4–6.
4. If changing the general DOM transform, qualify the existing server/client fixtures, React effect cleanup, JSX helpers, and module resolution. Keep the browser configuration isolated from DOM environment `define` values.

Exit: the selected checks demonstrably execute compiled application code, and the relevant regression fails before its product repair and passes afterwards. Do not globally disable React Compiler or weaken the cache-presence assertion.

## Unit 4: Invalidate diff live text on its revision

Owner: [099](099-document-contributions.md)'s live document authority.

`apps/web/src/features/editor/hooks/use-diff-language-context.ts:25` subscribes to document revision, but the materialized-text expression at `:31` is compiled independently on `[analysisAllowed, buffer]`. The enclosing object includes `revision`, which does not force its text member to be recomputed.

Exact compiled-hook execution changes the same buffer from `const value = 1` to `const value = 2` and changes revision from r1 to r2. `ownedText` remains `const value = 1`; replacing buffer identity is the positive control and exposes the new text. The returned context is also unchanged after the same-buffer edit.

Callers are `features/git/components/diff-view.tsx:99` and `features/editor/components/compare-saved-view.tsx:31`. `features/editor/hooks/use-diff-language.ts:306` compares `ownedText` to the diff text to refuse real-URI queries after the source drifts. The stale read defeats that gate and risks answers at positions from the wrong text.

Execution:

1. Extend `features/editor/hooks/tests/use-diff-language-context.test.tsx`, or add its compiled-browser counterpart. Mutate a real editor buffer in place and publish the document revision. Assert current `ownedText` and the downstream drift refusal. Initial-publication tests already exist.
2. Make the text acquisition itself depend on the observed revision. A revision-tagged snapshot helper or owner-published immutable snapshot may express this. Merely placing `revision` beside a cached getter repeats the defect.
3. Run `bun run compiler:explain apps/web/src/features/editor/hooks/use-diff-language-context.ts --component useDiffLanguageContext`; verify that the acquisition cache includes the revision. Run the compiled regression and existing diff-language tests.
4. Exercise the working-tree diff while another editor makes an unsaved same-buffer edit, with browser evidence of the refusal behavior.

Exit: same-buffer edits update owned text, wrong-revision real-URI queries are refused, and large-file analysis limits remain respected.

## Unit 5: Observe tree confirmation before enabling actions

Owner: [192](192-no-swap-flash.md)'s restored tree, with workspace mutation ownership unchanged.

`apps/web/src/features/workspace/hooks/use-fs-actions.ts:85` derives `mutationsEnabled` from `queryClient.getQueryData(fileSystemKeys.tree(rootPath))`. That is a snapshot read, with no query subscription. Compiler output keys the gate on client, root, environment availability, mutation permission, and edit service identity; it contains no cache-presence dependency.

`hooks/use-tree.ts:202` can render a saved tree before confirmation arrives. `components/tree-pane.tsx:90` mounts `ReadyTreePane` for it. A compiled gate control observes `before:false`, `afterQueryArrives:false`, `cacheNowContainsTree:true`; toggling another gate input is a positive control and recomputes true. The actual compiled hook test in unit 3 proves the inverse stale-enabled direction after removal.

Execution:

1. Use the existing regression `workspace/tests/use-fs-actions.test.tsx:414` through the compiled path. Add missing-data to confirmed-data arrival alongside confirmed-data removal.
2. Expose confirmation through an observed query value or an explicit confirmation input from the tree owner. Keep saved rows usable for display while mutations follow actual confirmation.
3. Run `bun run compiler:explain apps/web/src/features/workspace/hooks/use-fs-actions.ts --component useFsActions`, then `bun --bun vitest run --project dom src/features/workspace/tests/use-fs-actions.test.tsx` from `apps/web`, plus the compiled regression.
4. Verify a restored tree with its confirmation read deliberately delayed: creation, renaming, deletion, and drag must enable only after confirmation. Removing confirmation disables them without requiring an unrelated state change.

Exit: both confirmation transitions update the action gate under production compilation. Preserve the journal, intent queue, and workspace edit service.

## Unit 6: Restore recent folders after navigation settles

Owner: [239](239-recent-projects-and-multiple-roots.md), with address ownership preserved.

`apps/web/src/features/workspace/hooks/use-restore-recent-root.ts:23` subscribes to the navigation snapshot, then `:24` separately reads `navigation.permitsRecentRoot()`. Compiler output caches that getter on `[navigation]` alone. The getter depends on mutable `status.status === 'applied'` at `apps/web/src/state/navigation-coordinator.ts:693`.

Bootstrap attaches navigation before mounting the app at `state/bootstrap.ts:57`; attachment starts asynchronous `router.load()` at `state/navigation-coordinator.ts:716`. A stable-owner pending-to-applied compiled control shows the getter read once: actual permission becomes true while recent-folder query `enabled` remains false. Replacing owner identity is the positive control.

Execution:

1. Extend `workspace/tests/use-restore-recent-root.test.tsx` through the compiled path. Start with empty workspace state and pending navigation, then publish applied status without replacing the coordinator. Require the recent read and restoration.
2. Derive permission from an observed snapshot or expose the permission in that snapshot. Keep initial explicit workspace and unavailable-address rules; they still claim their own destination.
3. Run `bun run compiler:explain apps/web/src/features/workspace/hooks/use-restore-recent-root.ts --component useRestoreRecentWorkspaceRoot` and the targeted compiled regression. Preserve existing no-recents and explicit-address controls.
4. Verify startup at the root address with an isolated persisted recent folder, plus an explicit workspace address that must win over recents.

Exit: settling the same navigation owner enables eligible restoration, and an explicit address is never displaced by a recent folder.

## Unit 7: Revoke old site playback timers

Owner: [155](155-site-demo-replica.md), with existing site accessibility and reduced-motion behavior.

`apps/site/src/scripts/player.ts:53` schedules untracked typing ticks; `:79` schedules untracked pointer press/release ticks. `end()` at `:147` and `replay()` at `:155` cancel only the main timeline timer. Actual replica callers include `src/replicas/agents.html:5`, `review.html:17`, and `fan-out.html:65`.

Actual transpiled player and agents markup, with deterministic timers, produce:

```text
typing: c
skip-final: claude auth login, settled=true
late-old-tick after 30ms: cl, settled=true
```

Execution:

1. Give child typing and pointer work the playback run's ownership. Skip/replay cancels those timers or revokes their ability to mutate the DOM; pausing/off-screen behavior remains resumable.
2. Test mid-type skip, replay while old ticks remain, pause/resume, hidden-page behavior, and reduced motion with the actual player. Old callbacks cannot truncate final text or press elements in a new run.
3. Run `bun run --cwd apps/site typecheck`, the focused playback check, `bun run --cwd apps/site site:build`, and `bun run agent:browser look --site --static-dir apps/site/dist`. Read the desktop and phone screenshots using the verification skill.

Exit: final frames remain final and replay admits only the new run's callbacks. Do not replace the replica with the live web app.

## Unit 8: Replace TUI syntax resources with their theme

Owner: [202](202-tui-ui.md). This is terminal rendering correctness, independent of web parity work.

`apps/tui/src/agent-stage/components/composer.tsx:44` and `timeline.tsx:36` create `SyntaxStyle` through lazy state from the first theme. `components/application.tsx:44` reacts to theme changes; the stage keys Composer by draft and Timeline by conversation, so theme changes do not recreate them. Their styles are destroyed only on unmount.

Actual native style objects retain prompt color `[18,186,244,255]` where the light theme expects `[0,121,161,255]`, and Markdown foreground `[253,249,246,255]` where light expects `[12,10,8,255]`. This is a source-lifetime and native-color proof; a successful native rerender proof was not completed in the audit.

Execution:

1. Extend `apps/tui/src/agent-stage/tests/composer.test.tsx` and `timeline.test.tsx` to rerender the same mounted controls dark-to-light and palette-to-palette. Inspect their actual native syntax styles and rendered frame. Do not contact providers.
2. Define theme update/replacement for the native resources while keeping draft text, undo, selection, scroll, and command focus. `agent-stage/state/prompt-editor.ts` retains style IDs in extmarks, so replacing a style must update that owner too.
3. Run `bun --bun vitest run src/agent-stage/tests/composer.test.tsx src/agent-stage/tests/timeline.test.tsx src/components/tests/select-theme.test.tsx` from `apps/tui`.

Exit: all mounted content uses the new theme and old native resources are released without remounting the text editor merely to repaint it.

## Unit 9: Qualify late TUI dialog completion

Owner: [202](202-tui-ui.md)'s navigation and focus ownership. Status: Approved investigation; native navigation reproduction remains required.

`apps/tui/src/agent-stage/components/path-dialog.tsx:43` awaits submitted work then invokes captured `onClose`. The stage's `close()` at `stage.tsx:147` clears the shared modal slot unconditionally and requests composer focus. `agent/components/screen.tsx:159` retains the unkeyed stage, and Back/Forward handlers at `components/workspace.tsx:332` remain callable.

A current-source continuation control starts A's operation, installs B's modal, then resolves A. B's modal becomes null and composer focus is requested. The actual integrated navigation path was not exercised. Bare A-to-B-to-A dialog restoration is not yet a confirmed bug because its intended lifetime needs qualification.

Execution:

1. Reproduce attachment or transcript export on A with a deferred external operation. Navigate to B, open B's dialog, then resolve A. Capture actual TUI frames and focus ownership. Use existing `agent-stage/tests/stage.test.tsx` and command/navigation fixtures.
2. If confirmed, give a dialog occurrence its own completion authority. Original work can finish against its original draft/export, but can close only its originating dialog. Preserve pending operation settlement and current focus.
3. If navigation cannot occur while work is pending, document that tested invariant and close this investigation without adding a guard for an unreachable race.

Exit: the real path is either repaired with a regression or ruled out with direct evidence. Do not treat temporary focus retention as a defect by itself.

## Rerunnable audit evidence

These are one-off execution-host artifacts, not committed portable tests. They contain synthetic data and no owner configuration. Paths are retained for reproducing the audited baseline; execution replaces them with repository-relative regression tests.

| Evidence directory                                       | Commands and observations                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/work/tmp/fregat-query-audit-20261009/`                 | `node mcp-placeholder.mjs` and `node tree-compiled-block.mjs`; observer/memo outputs, actual compiler explanation, `compiled-dom.vitest.config.ts`, and `compiled-dom-test.log`.                                                                                                     |
| `/work/tmp/fregat-react-audit-compiler-20261009-cJm760/` | `node diff-live-text.mjs <checkout>`, `node recent-root-permission.mjs <checkout>`, `node test-compiler-environments.mjs <checkout>`; exact source compilation, stable-cache controls, and installed-plugin client/server transform comparison. `environment.json` records versions. |
| `/work/tmp/fregat-react-audit-lsp-20261009-UKAn0C/`      | `bun proof.ts <checkout>`; actual `LspSessionPool` public APIs with in-memory external child stdio. `results.txt` records cancellation of another live waiter and three backend requests where two are expected.                                                                     |
| `/work/tmp/fregat-react-audit-other-20261009-XzPTsK/`    | `bun player-proof.mjs <checkout>`, `bun modal-continuation-proof.mjs <checkout>`, and, from `apps/tui`, `bun syntax-proof.mjs <checkout>`. Deterministic player runtime, controlled modal completion, and native color/lifetime observations.                                        |

The compiled-tree test was run from `apps/web` using `bun --bun vitest run --config <evidence>/compiled-dom.vitest.config.ts --project dom src/features/workspace/tests/use-fs-actions.test.tsx -t 'saved rows cannot start mutations until the tree is confirmed'`. Normal config: one passed, ten skipped. Forced actual-hook compilation: one failed, ten skipped, at line 419. Heavy executions use the host's runner; no live account was involved.

## Coverage and rejected leads

- Audited web React/compiler boundaries, query keys and preloading, cancellation/publication, transient ownership, TUI state/theme/dialogs, server LSP/filesystem/Git resource ownership, desktop TypeScript launch/bridge lifetimes, and site playback.
- No vetted desktop TypeScript defect survived. Native Swift/Zig hosts, full application interaction suites, a general security audit, and performance traces were not covered. The native Mac app is still an editor-gated scaffold; missing product features are not defects in this pass.
- Healthy examples include the settings route's shared module options, scoped directory preloads, Git intent leases, per-origin QueryClients, event-time cache admission reads, and server shared-owner cleanup across different connections.
- Many cheap context-consumer executions and manual memo exceptions do not establish a performance bug. Whole-store TUI subscriptions need measurements before changing ownership.
- The existing unchanged-tab paint failure stays with [327](327-virtualization-and-two-axis-tables.md). It is not explained by the new cancellation findings and was not counted again.
- Memoized mutable coordinators remain ownership leads, but theoretical cache eviction alone was not reported as an observed app failure.

## Delivery gates

- [ ] Units 1 and 2 have isolated regressions and their domain repair checks pass.
- [ ] Unit 3 proves compilation; units 4–6 pass compiled regressions and their real user paths.
- [ ] Unit 7 keeps final and replayed frames stable; site screenshots have been reviewed.
- [ ] Unit 8 passes native theme replacement without losing editing state.
- [ ] Unit 9 has a reproduced repair or a tested rejection.
- [ ] `bun run gates`, relevant typechecks, and required portable checks pass for each delivered unit.
- [ ] Commit each verified repair by its paths, push through the normal workflow, and record browser/TUI evidence. Install authorized application changes through the execution host's workflow and verify the served release.

Keep issue creation out of this queue. Stop a unit and report concrete evidence if drift removes the failing path or the repair requires an unrelated architecture change.
