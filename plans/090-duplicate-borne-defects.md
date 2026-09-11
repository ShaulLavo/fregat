# Fix the defects hiding inside the duplicates

Status: proposed, implementation not started. Requested 2026-09-11.

[Root PLAN.md](../PLAN.md) owns execution order. This plan is the prerequisite for every merge plan
in its lane: [Plan 091](091-error-and-timing-helpers.md), [Plan 092](092-path-and-uri-helpers.md),
[Plan 093](093-web-react-and-store-ceremony.md), [Plan 094](094-client-core-web-tui-parity.md),
[Plan 095](095-server-plumbing.md), and [Plan 096](096-web-layering-and-boundaries.md).

## Land every fix before its merge

Each item below is a live defect that a duplication census found by diffing near-identical helpers.
None is a refactor. Every one is repaired in place, in its own file, independent of every other.

Sequence matters for one reason. When a merge plan picks the correct variant of a pair and deletes
the wrong one, the defect disappears from the tree with no commit that names it, no test that pins
it, and no record that it ever shipped. Two file-URI builders open the wrong file today; folding
them into a shared helper fixes both silently and leaves nothing to regress against. So the fix
lands first, with a reproduction and a test, and the merge lands on top of a green test.

The same rule applies where the census tells the merge plan to _change_ behaviour: adopting the
canonical containment rule makes `..foo` readable at four sites and makes the parent directory
unwritable at one. Those are the fixes. They are recorded here so the merge is a no-op for
behaviour and can be reviewed as one.

## Reconcile the baseline

Platform base `75caae889d967fed0e0c8df85aa315670ef9fe49`. Capture HEAD and the working diff before
editing; recheck every anchor below, and re-run the drift check
[`plans/README.md`](README.md) requires.

| Existing owner                                                         | Work to build on                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/observability/src/sanitize.ts:5`                             | The canonical 17-key redaction field set and head-truncation, already the server's       |
| `apps/web/src/lib/client-error-reporting.ts:17`                        | Browser report sanitizer with an 8-key field set and no truncation                       |
| `apps/server/src/observability/logging.ts:29`                          | `sensitiveErrorFields`, plus a separate tail-truncating, quote-stripping algorithm       |
| `apps/server/src/fs/path.ts:127`                                       | `isOutsideRoot` — the canonical containment rule, exported                               |
| `apps/server/src/fs/workspace-edit.ts:2635,2643`                       | Private `assertInside`/`isSameOrDescendant` behind the edit lease and mutation gate      |
| `apps/server/src/git/path-utils.ts:56`                                 | `relativeInsideRoot`, under a comment claiming parity with `WorkspacePaths.assertInside` |
| `apps/server/src/lsp/typescript/shared/boundary.ts:133`                | `isInsidePath`, the TypeScript session's read gate                                       |
| `apps/web/src/features/address/utils/definition-target.ts:3`           | Address-bar focus → editor definition target                                             |
| `apps/web/src/features/chat/hooks/use-open-file-reference.ts:37`       | Transcript file reference → editor definition target                                     |
| `apps/tui/src/storage/files.ts:110`                                    | SQLite-backed `FileStorage`, validating recents on write only                            |
| `apps/tui/src/agent/utils/location.ts:16-21`                           | The guarded read pattern the four unguarded reads must adopt                             |
| `apps/web/src/features/chat/state/session-detail-subscriptions.ts:418` | `shouldEvictEntry` → `isProtectedSession` → the LRU eviction path                        |
| `packages/contracts/src/settings/json-equal.ts:15`                     | `jsonEqual`, order-insensitive by design, not reachable through the package exports      |
| `packages/ui/src/components/resizable.tsx:142`                         | Persisted-layout validation; the package has no `@workspace/*` dependency to borrow from |
| `apps/web/test/server.ts:53`                                           | The web harness the TUI harness diverged from                                            |

Drift corrected against this base: `copySafeErrorFields` is at `logging.ts:277` and
`sanitizeErrorMessage` at `logging.ts:290`; the inverse URI decode is used at
`apps/web/src/lib/diagnostic.ts:34`, imported at `:1`. One census claim no longer holds and is
restated below: `apps/web/src/features/settings/utils/default-value.ts` has no importers at all.

## Close the two redaction holes

### Widen the browser sanitizer's field set in place

`apps/web/src/lib/client-error-reporting.ts:17` redacts eight keys. The identical server-side
sanitizer at `packages/observability/src/sanitize.ts:5` redacts seventeen. The nine the browser
misses are `body`, `content`, `cookie`, `password`, `patch`, `secret`, `set-cookie`, `text`,
`x-api-key`. A browser error report whose context carries any of them is written verbatim through
`sanitizeRecord` (`:78`) into the client log; the same report raised on the server is redacted.

Widen the set at `:17` to the seventeen keys now. Do not wait for the structural merge —
[Plan 091](091-error-and-timing-helpers.md) folds this file into the shared sanitizer, and that
fold would close the hole with nothing naming it. The fold then becomes a behaviour-preserving
deletion.

Two behavioural differences must survive the widening and are for 091 to carry as options, not to
lose here: this copy does not truncate strings, where `sanitize.ts:63` caps them at 2000 from the
head; and it lifts `code`/`fix`/`status`/`why` off the error at `:63-73`, which the canonical
sanitizer does not — that half is an improvement and stays.

**Reproduction** `reportClientError({ context: { password: 'p' }, … })` and read the emitted event.

**Regression test** extend the existing redaction case in
`apps/web/src/lib/tests/client-error-reporting.test.ts:51` — it already asserts
`absolutePath`/`authorization`/`token` become `[redacted]` and that the serialized event contains no
secret. Add each of the nine missing keys to the same `context` and the same `not.toContain` sweep.

### Add the credential keys to the server error-field list

`apps/server/src/observability/logging.ts:29` `sensitiveErrorFields` holds seven path-shaped keys
and nothing else: `absolutePath`, `cwd`, `dest`, `destination`, `fileName`, `filename`, `path`. A
structured error carrying `{ token }` or `{ authorization }` as an own property is copied straight
into the server log by `copySafeErrorFields` (`:277`) and by the cause walker at `:269`.

Add the eleven keys `sanitize.ts:5` carries and this set lacks — `authorization`, `body`, `content`,
`cookie`, `password`, `patch`, `secret`, `set-cookie`, `text`, `token`, `x-api-key` — at `:29`, and
keep `path`, which is this file's alone. Do **not** fold this file into
`packages/observability/src/sanitize.ts`. It is a different algorithm, and the fold would flip two
behaviours silently: `sanitizeErrorMessage` (`:290`) replaces every single-quoted substring with
`'[redacted]'`, which the shared sanitizer does not do at all; and `limitText` (`:161`) keeps the
**tail** at 500 characters where `sanitize.ts:63` keeps the **head** at 2000 — so a long message
would lose the opposite half. Record that constraint in the file so a later dedup pass does not
retry it. [Plan 091](091-error-and-timing-helpers.md) is bound by the same exclusion.

**Reproduction** raise a structured error with `Object.assign(error, { token: 'secret' })` through
any observed route and read the JSONL line in `logs/`.

**Regression test** `apps/server/src/observability/tests/routes.test.ts`, or a new focused case
beside it: assert an error property named `token` arrives as `[redacted]` while `requestId` survives.

## Fix the path predicates that open or admit the wrong file

### Encode the address bar's file URI

`apps/web/src/features/address/utils/definition-target.ts:13` builds
`` `file://${path.startsWith('/') ? path : `/${path}`}` `` — the leading slash is handled, the path
is not encoded. Every other builder in the tree percent-encodes each segment
(`apps/server/src/lsp/language.ts:10`, `apps/web/src/features/command-palette/command-palette-utils.ts:352`,
`apps/web/src/features/editor/utils/language-server-plugin.ts:320`).

The consumer is `new URL(uri).pathname` inside `documentUriToFileName`
(`@singapor/lsp-plugin/paths`), the inverse `apps/web/src/lib/diagnostic.ts:34` already uses. So:
`/repo/a#b.ts` yields pathname `/repo/a`, `/repo/a?q.ts` yields `/repo/a`, and `/repo/100%.ts`
makes `decodeURIComponent` throw, which that helper catches and reports as no file. Adopt segment
encoding; the target feeds `openDefinition` at `apps/web/src/features/address/state/apply-view-editors.ts:124`
and `apps/web/src/state/navigation.ts:175`.

### Give the chat reference URI its leading slash

`apps/web/src/features/chat/hooks/use-open-file-reference.ts:47` builds
`` `file://${reference.path.split('/').map(encodeURIComponent).join('/')}` `` — encoded, but with no
leading-slash normalisation. For an absolute path the first split segment is `''` and the result is
correct. For a workspace-relative path — which is what a transcript reference usually is —
`src/a.ts` becomes `file://src/a.ts`, where `src` parses as the URI **host** and `pathname` is
`/a.ts`. The editor opens the wrong file. Apply the same `replace(/^\/+/, '')` + `file:///` prefix
the six correct copies use.

Both targets feed `openDefinition` (`apps/web/src/features/editor/state/apply-actions.ts:211`), the
command the correct variants feed. [Plan 092](092-path-and-uri-helpers.md) then adopts one shared
builder in `packages/contracts`, and must resolve the backslash question there (the copies
percent-encode `\`, the editor package rewrites it to `/`) — that is not this plan's change.

**Reproduction** for the address bar, navigate to a focus address whose path contains `#`, `?` or
`%`: `definitionTargetFor('/repo/a#b.ts', focus).uri` is `file:///repo/a#b.ts`, whose pathname is
`/repo/a`. For the chat hook, click a transcript reference to a workspace-relative path:
`fileReferenceDefinitionTarget({ path: 'src/a.ts', … }).uri` is `file://src/a.ts`, whose host is
`src` and whose pathname is `/a.ts`.

**Regression test** a `.test.ts` beside each: assert
`new URL(uri).host === ''` and that `documentUriToFileName(uri)` round-trips the input path, for
`'src/a.ts'`, `'/repo/a#b.ts'`, `'/repo/a b.ts'` and `'/repo/100%.ts'`. The chat path already has a
render-level home at `apps/web/src/features/chat/components/tests/assistant-markdown.test.tsx:207`,
which reads the resulting `definitionTarget`.

### Reject the parent directory in the workspace-edit containment check

`apps/server/src/fs/workspace-edit.ts:2635` `assertInside` and `:2643` `isSameOrDescendant` test
only `` `..${path.sep}` `` and `path.isAbsolute`. They omit the bare `'..'` case that
`apps/server/src/fs/path.ts:127` `isOutsideRoot` handles explicitly. `path.relative('/a/b', '/a')`
is exactly `'..'`, so the parent directory of the root reads as a descendant: `assertInside` does
not throw `WORKSPACE_EDIT_INVALID` (call sites `:1058`, `:1066`, `:1085`, `:1724`, `:1730`), and
`pathsOverlap` (`:2649`) reports an overlap that the lease check at `:1857-1871` then treats as a
busy conflict.

Adopt the canonical rule: add `if (relative === '..') return` / `return false`.

**Reproduction** `path.relative('/a/b', '/a') === '..'`; today `isSameOrDescendant('/a/b', '/a')` is
`true` and the canonical answer is `false`.

**Regression test** `apps/server/src/fs/tests/mutation-containment.test.ts` — add the parent
directory of the workspace root to the escaping-mutation table. `pathsOverlap` feeds the edit
conflict check, so also assert a lease on `/a/b` does not conflict with a mutation at `/a`.

### Stop four `startsWith('..')` predicates from exiling `..foo`

Four sites test `relative.startsWith('..')`, which rejects any path whose first segment merely
begins with two dots. `path.relative('/repo', '/repo/..foo')` is `'..foo'` — an ordinary POSIX
filename, inside the root, that all four call outside:

| Site                                                    | Effect                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/server/src/git/path-utils.ts:59`                  | `relativeInsideRoot` returns `null`; the file leaves git status |
| `apps/server/src/git/service.ts:801`                    | `pathspecForRepository` throws `GIT_REPOSITORY_NOT_FOUND`       |
| `apps/server/src/lsp/registry.ts:990`                   | `isInsideOrEqual` false; root detection skips the path          |
| `apps/server/src/lsp/typescript/shared/boundary.ts:136` | `isInsidePath` false; `canReadFile` (`:140`) refuses the file   |

`apps/server/src/git/path-utils.ts:51-55` carries a comment stating the rule "is deliberately the
same one `WorkspacePaths.assertInside` enforces, so anything this maps is also a path the filesystem
layer accepts." It is not the same rule. `WorkspacePaths.assertInside`
(`apps/server/src/fs/path.ts:71` → `:134` → `:127`) accepts `..foo`; this one does not. Fix the
predicate and keep the comment honest, or delete the claim.

Adopt `isOutsideRoot`'s three-case rule at all four. The filesystem layer already proves the target
behaviour: `apps/server/src/fs/tests/containment.test.ts:20` reads a root-level file named `..foo`
through `/fs/read` and expects 200.

**Regression test** mirror that existing case per layer, narrowest first —
`apps/server/src/git/tests/service.test.ts` (a repository containing `..foo` reports it in status
and accepts it as a pathspec) and `apps/server/src/lsp/tests/registry.test.ts` (root detection
accepts `..foo`). [Plan 092](092-path-and-uri-helpers.md) then collapses all eight spellings onto
`isOutsideRoot` and merges `relativePathInside`/`relativeInsideRoot`; after this plan that collapse
changes no behaviour.

## Fix the state readers that crash or mis-classify

### Delete corrupt TUI storage instead of throwing

Four TUI reads call `v.parse(schema, JSON.parse(raw))` with no guard. A corrupt or schema-stale
value throws out of render and takes the app down:

- `apps/tui/src/agent-rail/state/rail.ts:57,58` — inside the initial state literal of
  `createAgentRailState`, which runs in `useState(() => …)` at
  `apps/tui/src/agent-rail/components/rail.tsx:87`
- `apps/tui/src/terminal/utils/tabs.ts:16` — `readTerminalTabs`, likewise under `useState` at
  `apps/tui/src/terminal/components/sessions.tsx:33`
- `apps/tui/src/agent-stage/state/inbox.ts:19,26`
- `apps/tui/src/storage/recents.ts:10` — `parseRecentCommands`, also used as the write validator at
  `apps/tui/src/storage/files.ts:111`, so it must keep throwing for writes

The guarded pattern already exists at `apps/tui/src/agent/utils/location.ts:16-21` and
`apps/tui/src/workbench/utils/location.ts:24-29,43-49`: `try` / `v.safeParse` / fall back. Per the
greenfield rule, the read also **deletes** the corrupt key (`KeyValueStorage.removeItem`,
`packages/client-core/src/storage.ts:4`) rather than healing it, and distinguishes absent (normal,
silent) from corrupt (one log line). `tabs.ts:12-15` mints a fresh id when the key is absent, so its
fallback is a thunk, not a value.

Fix each site in place. [Plan 094](094-client-core-web-tui-parity.md) extracts the one
`readJsonItem(storage, key, schema, fallback)`; it must do that before it moves
`apps/tui/src/storage/recents.ts`, or the crash is carried into the new location.

**Reproduction** write `'{'` to `agent:rail:collapsed`, or `'[]'` to `terminal-tabs:<root>`, and
start the TUI.

**Regression test** `apps/tui/src/agent-rail/tests/state.test.ts` already reopens a rail store
(`:29`); add a case that seeds a corrupt value, asserts the store constructs with the empty default,
and asserts the key is gone afterwards. Same shape in
`apps/tui/src/storage/tests/files.test.ts` for recents and a new case for terminal tabs.

### Narrow the web session-busy predicate to the runtime triad

`apps/web/src/features/chat/state/session-detail-subscriptions.ts:473` reads
`status !== 'idle' && status !== 'stopped'`. `sessionRuntimeStatusSchema`
(`packages/contracts/src/chat-model.ts:296`) has eight members, so `ready`, `interrupted` and
`error` all read as busy. The value reaches `isProtectedSession` (`:436`) → `shouldEvictEntry`
(`:418`), so a finished or failed session is permanently protected from idle eviction and from the
capacity sweep at `:404-416`, which filters on `shouldEvictEntry` at `:408`; the cache fills with
dead sessions and the only entries it can drop are the strictly idle ones.

The triad every other site means is `starting | running | waiting`: `isBusyChatSession`
(`packages/client-core/src/chat/session-busy.ts:12`), `isSessionAlive`
(`apps/server/src/orchestration/command-invariants.ts:151`), and `isActiveRuntime`
(`apps/server/src/orchestration/utils/session-attention.ts:60`). Narrow the web copy to it. If the
predicate is meant to be "a provider process may still be attached", rename it `holdsProviderRuntime`
and list the statuses explicitly — precedent at `canStopAgentSession`
(`apps/web/src/features/chat-mode/utils/session-menu.ts:31`, over a named
`STOPPABLE_SESSION_STATUSES`). Two deliberate supersets stay as they are and must not be folded in
later: `apps/server/src/orchestration/engine.ts:737-740` adds `latestTurn?.state === 'running'`, and
`decider.ts:672-673` `wakes` adds `'error'` on purpose, because an errored runtime also resets the
lifecycle.

**Reproduction** a released session whose runtime status is `error` keeps
`hasEvictionTimer === false` and survives a capacity sweep.

**Regression test** `apps/web/src/features/chat/state/tests/session-detail-subscriptions.test.ts` —
it already has "protects running and actionable sessions from idle eviction" (`:81`) and "evicts the
oldest idle entries when the cache exceeds capacity" (`:110`). Add the negative: a session in
`ready`/`error` with no pending approvals, no actionable plan and no running turn **is** evicted.

### Remove the two key-order-sensitive equality checks

`apps/server/src/provider/provider-service.ts:1088` and
`apps/server/src/provider/provider-adapter-registry.ts:676` both compare structures with
`JSON.stringify(a) === JSON.stringify(b)`. That is exactly the comparison
`packages/contracts/src/settings/json-equal.ts:3-14` documents as wrong, and for the same reason:
key order changes whenever a settings document is hand-edited or re-serialised. `{a:1,b:2}` and
`{b:2,a:1}` compare unequal, so `modelSelectionsEqual` (`provider-service.ts:1078`) reports a
changed binding and `configEqual` (`provider-adapter-registry.ts:393`) reports a changed config —
the latter gating an adapter replacement that disposes a live child process.

`jsonEqual` is not reachable: `packages/contracts/package.json` exposes only `"." : "./src/index.ts"`
and `src/index.ts` does not re-export it. Add that one line here, since both fixes need it;
[Plan 095](095-server-plumbing.md) then consolidates the four copies on top of a reachable export.

`apps/web/src/features/settings/utils/default-value.ts` is the census's third order-sensitivity site
and the finding has drifted: the module has **no importers anywhere in the tree**, so its `===`
(`:23`, where the canonical uses `Object.is`) reaches nothing and the `-0`-versus-`0` disagreement
the census predicted cannot be observed. Delete the file rather than repair it. Greenfield: no
alias, no deprecation.

**Reproduction** `JSON.stringify({a:1,b:2}) === JSON.stringify({b:2,a:1})` is `false`;
`jsonEqual` of the same pair is `true`.

**Regression test** `apps/server/src/provider/tests/driver-registry.test.ts` — reconciling the same
provider config with its keys in a different order returns no change and rebuilds no adapter.

### Reject a persisted array as a resizable layout

`packages/ui/src/components/resizable.tsx:164` `isRecord` returns `typeof value === 'object'` after
a falsy guard, with no `!Array.isArray`. `isResizableLayout` (`:151`) therefore accepts a persisted
`[50, 50]`: `Object.values([50,50]).every(isResizableLayoutSize)` is `true`. The payload passes
`isPersistedResizableLayoutPayload` (`:142`) and is handed to the panel primitive as
`defaultLayout` at `:49`, where a keyed record is expected.

`packages/ui/package.json` lists no `@workspace/*` dependency, so contracts' array-excluding
`isRecord` is not reachable and adding that edge to save four lines is the wrong trade. Fix in
place: add the array guard, or rename the helper
`isObjectLike` and add the guard at `isResizableLayout` instead. Either way the accepted shape
narrows — that is the fix, not a side effect.

**Reproduction** `localStorage.setItem(<layout key>, '{"version":1,"layout":[50,50]}')` and reload.

**Regression test** `packages/ui/src/components/tests/` — note the config includes only
`src/**/*.test.tsx` (`packages/ui/vitest.config.ts:13`), so the file must be `resizable.test.tsx`
or the include widened deliberately. Assert an array layout is rejected and a keyed record accepted.

## Fix the five web duplicates already shipping bugs

Each pair below diverged; one half is wrong. Fix the wrong half. The shared homes
(`lib/notify-client-error.ts`, `hooks/use-element-width.ts`, `lib/load-state.ts`, `lib/tool-tabs.ts`)
belong to [Plan 096](096-web-layering-and-boundaries.md).

**a. Every git mutation failure emits two wide events.**
`apps/web/src/features/git/utils/notify-mutation-error.ts:9` calls `reportClientError`
unconditionally. Its settings twin guards the same call with `if (!clientErrorMetadata(error))`
(`apps/web/src/features/settings/utils/notify-save-error.ts:22`) because the transport already
emitted the canonical event. Every function in `apps/web/src/features/git/utils/api.ts` runs through
`observeGitOperation` (`:383`) → `observeClientOperation` (`apps/web/src/lib/client-logging.ts:66`),
which logs the failure at `:95-100` and annotates the error at `:85`. Add the same guard.
_Test:_ `apps/web/src/lib/tests/client-error-reporting.test.ts` already asserts
`expect(emittedEvents).toHaveLength(1)` for the settings path (`:133`); add the git twin.

**b. The logs error banner renders twice.**
`apps/web/src/features/logs/components/panel.tsx:82` and
`apps/web/src/features/logs/components/event-list-container.tsx:27` hold byte-identical markup and
copy ("Could not read local logs."), gated on two independent queries — `summary.isError` and
`events.isError`. When the log directory is unreadable both fire and the sentence stacks. Render
once in `panel.tsx` from `summary.isError || events.isError` and delete it from the container;
`panel.tsx:87` is the container's only mount.
_Test:_ `apps/web/src/features/logs/tests/` — one case asserting a single banner when both queries error.

**c. The search preview never measures a late-mounted ref.**
`apps/web/src/features/search/components/results-view.tsx:334` declares a private
`useElementWidth` that does `const element = ref.current; if (!element) return` (`:338-339`). Its
twin at `apps/web/src/features/workspace/hooks/use-element-width.ts:3` retries on
`requestAnimationFrame` until the ref is populated (`:18-22`). A ref attached by a later-mounting
child reports `null` forever, so `searchPreviewMaxLength` (`:358`) returns `undefined` and the
preview never truncates. Adopt the retrying implementation. A third guard spelling sits at
`apps/web/src/features/file-picker/list.tsx:636` (`typeof ResizeObserver === 'undefined'` versus
`'ResizeObserver' in window`) — unify while here.
_Test:_ `apps/web/src/features/search/tests/` (dom project) — mount with the ref attached one render
late and assert a non-null width.

**d. The compare-saved pane shows an empty state while the file is still loading.**
`apps/web/src/features/workspace/hooks/use-selected-file.ts:59` `fileLoadState` maps `isPending`
(`:73`), stale data (`:72`) and the fall-through (`:75`) all to `idleState`. Its sibling
`treeLoadState` (`apps/web/src/features/workspace/hooks/use-tree.ts:258`) returns
`{ status: 'loading' }` for the same condition. The consequence is visible at
`apps/web/src/features/editor/components/compare-saved-view.tsx:63`, which renders "Open the file
to compare it with disk." — a verdict — while the fetch is in flight. This is the fall-through
AGENTS.md names: branch on pending **before** empty. Return a loading state for `isPending`.
Error-versus-stale precedence also flips inside one file:
`apps/web/src/features/file-picker/load-state.ts:14` tests `isError` before `data`, `:33` the
reverse — settle it in the same pass.
_Test:_ `apps/web/src/features/workspace/tests/use-selected-file.test.ts` already exercises
`fileLoadState` directly; add a pending case asserting `status === 'loading'`.

**e. One header calls the same tab two different words.**
`panelTabTitle('git')` returns `'Source Control'`
(`apps/web/src/features/workbench/components/tool-pane-header.tsx:154`);
`chatModeToolTabLabel('git')` returns `'Git'`
(`apps/web/src/features/chat-mode/utils/panels.ts:81`). In chat mode both are on screen at once —
`apps/web/src/features/chat-mode/components/tool-pane.tsx:110` renders `<ToolPaneHeader tab='git' />`
while `apps/web/src/features/chat-mode/components/tool-rail.tsx:45` titles its button from the other
table. Pick one word and make both tables agree. The union fork behind it —
`ToolPaneHeaderTab` (`tool-pane-header.tsx:23`) has `chat` and no `editor`, `ChatModeToolTab`
(`panels.ts:1`) the reverse, so `toolPaneHeaderIcon` (`:163`) has no arm for a tab the rail draws —
is structural and belongs to [Plan 096](096-web-layering-and-boundaries.md).
_Test:_ `apps/web/src/features/workbench/components/tests/` — assert the two label functions return
the same string for every shared tab id.

## Fix the two TUI test-harness defects

`apps/tui/test/server.ts:29-30` hard-codes `/work/tmp`: `mkdir('/work/tmp', { recursive: true })`
then `mkdtemp('/work/tmp/platform-tui-test-')`. `/work` does not exist on a developer Mac and `/`
is not writable by the running uid, so `makeTestServer` throws before any TUI test body runs. The
web harness uses `mkdtemp(path.join(tmpdir(), 'web-itest-'))`
(`apps/web/test/server.ts:64`). Adopt `os.tmpdir()`.

`apps/tui/test/server.ts:62-78` passes no `machines` option to `createApp`. The web harness stubs it
(`apps/web/test/server.ts:98`,
`machines: { tailnetStatusCommand: async () => '{"BackendState":"Stopped"}', … }`) because the
default `discoverTailnetHosts` (`apps/server/src/machines/tailnet-hosts.ts:58`) falls back to
`runTailnetStatus` (`:85`), which `execFile`s a real `tailscale status --json` on the developer's
machine. Add the same stub.

Both are fixes to the harness only. The ten-option merge of the two harnesses is explicitly not
worth doing — the census keeps them separate because `filesystemWatch` is `true` in one and hard
`false` in the other, and a merged default silently starts or stops a real `@parcel/watcher`.

**Regression test** the harness is its own proof: after the first fix
`bun --bun vitest run src/storage/tests/files.test.ts` in `apps/tui` runs at all. For the second,
add a case asserting a `/machines/tailnet-hosts` request under the harness returns the stubbed
`not-running` discovery rather than shelling out.

## Decide before writing code

- **Does the web session-busy predicate mean "busy" or "holds a provider runtime"?** Narrowing it to
  the triad is correct for eviction; if a second meaning is intended, it is a second, renamed
  predicate. Gates 4.10 and 094's contracts home.
- **Which word for the git tool tab — "Git" or "Source Control"?** Gates 7.1e and 096's
  `lib/tool-tabs.ts`.
- **Does a corrupt TUI storage key get a `warn` or an `info`?** It is not a user error and not
  normal. Gates the shape of the guarded read and 094's extraction.
- **Does this plan take the one-line `jsonEqual` re-export from `packages/contracts/src/index.ts`,
  or does 095?** It must land once and before either consumer. Recommended: here, because the two
  provider fixes cannot be written without it.
- **Rename `isRecord` to `isObjectLike` in `packages/ui`, or add the array guard under the existing
  name?** The rename is honest about the shape it tests and removes the merge hazard permanently;
  the guard is smaller. Gates 9.2.
- **Does `fileLoadState` grow a distinct `loading` state, or does the compare pane branch on the
  query itself?** Gates 7.1d and 096's `queryLoadState`.

## Verify plausible failures

Run each check from its own workspace directory. App Vitest is `bun --bun vitest`
(`apps/web`, `apps/server`, `apps/tui`); runtime-neutral packages use plain `vitest`. Running from
the repository root picks up the wrong config and drops the server's 30s `testTimeout`
(`apps/server/vitest.config.ts:15`). No repository-wide suite, no absolute test count.

| Failure to catch                                                                | Narrowest proof (run from the named directory)                                                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A browser report logs a credential                                              | `apps/web`: `bun --bun vitest run --project node src/lib/tests/client-error-reporting.test.ts`                              |
| A git mutation failure emits two wide events                                    | the same file's `toHaveLength(1)` assertion, extended to the git notifier                                                   |
| A server error property logs a credential                                       | `apps/server`: `bun --bun vitest run src/observability/tests/routes.test.ts`                                                |
| An encoded or relative path opens the wrong file                                | `apps/web`: the two new URI unit tests, plus `--project dom src/features/chat/components/tests/assistant-markdown.test.tsx` |
| The parent directory passes the workspace-edit gate                             | `apps/server`: `bun --bun vitest run src/fs/tests/mutation-containment.test.ts`                                             |
| A file named `..foo` disappears from git or the LSP                             | `apps/server`: `bun --bun vitest run src/git/tests/service.test.ts src/lsp/tests/registry.test.ts`                          |
| Corrupt storage takes down the TUI at startup                                   | `apps/tui`: `bun --bun vitest run src/agent-rail/tests/state.test.ts src/storage/tests/files.test.ts`                       |
| A finished session is never evicted                                             | `apps/web`: `bun --bun vitest run --project node src/features/chat/state/tests/session-detail-subscriptions.test.ts`        |
| Key order alone rebuilds a provider adapter                                     | `apps/server`: `bun --bun vitest run src/provider/tests/driver-registry.test.ts`                                            |
| A loading pane reads as an empty pane                                           | `apps/web`: `bun --bun vitest run --project node src/features/workspace/tests/use-selected-file.test.ts`                    |
| A persisted array is accepted as a panel layout                                 | `packages/ui`: `vitest run src/components/tests/resizable.test.tsx`                                                         |
| The TUI harness writes outside the temp directory, or shells out to `tailscale` | `apps/tui`: any harness-backed file runs at all; plus the new machines-route case                                           |

## Leave these to the sibling plans

This plan merges nothing and moves no module.

- Folding `client-error-reporting.ts` into `packages/observability/src/sanitize.ts`, and the shared
  `errorSummary`/`elapsedMs`/`errorMessage` homes — [Plan 091](091-error-and-timing-helpers.md).
- One `fileUriForPath` in `packages/contracts`, the backslash decision, `parentPath`, and collapsing
  all eight containment spellings onto `isOutsideRoot` — [Plan 092](092-path-and-uri-helpers.md).
- The `use(Context)`-or-throw sweep and the store/provider ceremony — [Plan 093](093-web-react-and-store-ceremony.md).
- `readJsonItem`, the busy predicate's contracts home, and the rest of the web↔TUI parity work —
  [Plan 094](094-client-core-web-tui-parity.md).
- Consolidating the four `jsonEqual` copies, the WebSocket adapters, and the fsync/atomic-write
  families — [Plan 095](095-server-plumbing.md).
- `lib/notify-client-error.ts`, `hooks/use-element-width.ts`, `lib/load-state.ts`,
  `lib/tool-tabs.ts`, and the `features/menus` move — [Plan 096](096-web-layering-and-boundaries.md).

## Completion checklist

- [ ] Both redaction field sets carry the credential keys, and `logging.ts` records why it is not
      folded into the shared sanitizer.
- [ ] Both file-URI builders encode segments and normalise the leading slash; both round-trip
      through `documentUriToFileName`.
- [ ] `workspace-edit.ts` rejects the bare `..` case; the four `startsWith('..')` predicates accept
      `..foo`; `git/path-utils.ts:51-55`'s parity claim is true or gone.
- [ ] The four unguarded TUI reads fall back, delete the corrupt key, and log once.
- [ ] The web busy predicate is the triad or is renamed; the eviction test covers `ready` and `error`.
- [ ] `jsonEqual` is reachable from the contracts index; neither provider site compares with
      `JSON.stringify`; `features/settings/utils/default-value.ts` is deleted.
- [ ] `isResizableLayout` rejects an array.
- [ ] The five web bug-bearing duplicates are fixed with the wrong half replaced, not deleted by a merge.
- [ ] The TUI harness uses `os.tmpdir()` and stubs `machines`.
- [ ] Every fix has a regression test that fails on the pre-fix tree, recorded before 091–096 begin.
