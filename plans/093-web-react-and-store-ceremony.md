# Collapse repeated React and store ceremony in apps/web

Status: proposed, implementation not started. Requested 2026-09-11.

This plan owns duplication census items 5.1, 5.2, 5.3, 5.5, 5.6, 5.7 and 7.2 — the ceremony that
`apps/web` writes out per call site instead of once: the context guard, the zustand store context, the
settings module store, the deferred-commit field, the git mutation hook, the git test runner, and eight
mechanical web copies. [Root PLAN.md](../PLAN.md) owns execution order; nothing here reorders a lane.

Two sequencing constraints bind this plan to its siblings. [Plan 091](091-error-and-timing-helpers.md)
item 1.4 rewrites `apps/web/src/lib/structured-errors.ts`, which item 5.1 rewrites too — 1.4 lands
first. [Plan 090 regression record](../docs/duplicate-defect-regressions.md) item 7.1a rewrites
`apps/web/src/features/git/utils/api.ts`, which item 7.2c rewrites too — one pass, 090 first.
[Plan 094](094-client-core-web-tui-parity.md) owns census 5.4 (the twelve TUI state factories) and
4.11b, which touches the same git api file. [Plan 096](../docs/web-layering.md) owns 7.3
and 7.4. [Plan 092](092-path-and-uri-helpers.md) owns the `basename` trap zone and must not be
rebased onto by anything here.

## Reconcile the baseline

The planning baseline is Platform `75caae889d967fed0e0c8df85aa315670ef9fe49`. Capture HEAD and the
full dirty diff before editing and preserve unrelated working changes. Every line reference below was
re-read at this base; the corrections are recorded in the sections that carry them.

| Existing owner                                                                  | Work to build on                                                                                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/structured-errors.ts:7`                                       | `clientErrors` catalog; `CLIENT_INVARIANT_ERROR:8` and `CONTEXT_MISSING:20` are the two codes             |
| `apps/web/src/lib/structured-errors.ts:101`                                     | `createClientInvariantError`, 119 references under `apps/web/src`                                         |
| `apps/web/src/hooks/`                                                           | Eight app-level hooks; the home for `useRequiredContext`                                                  |
| `packages/ui/src/lib/structured-errors.ts:3`                                    | `uiErrors.CONTEXT_MISSING`, zero importers repo-wide                                                      |
| `apps/web/src/features/editor/state/{ui,conflict,document,workspace}-state.tsx` | Four store contexts; two typed `StoreApi`, two typed `Mutate<StoreApi, subscribeWithSelector>`            |
| `apps/web/src/features/git/state/store.tsx:27`                                  | Git store context; aliases `StoreApi as ZustandStoreApi` at `:3`                                          |
| `apps/web/src/features/search/state/buffer-state.tsx:141`                       | Search buffer store context                                                                               |
| `apps/web/src/features/settings/state/`                                         | Four hand-rolled module stores, read from `features/settings`, `features/address`, `state/` and `keymap/` |
| `apps/web/src/features/settings/components/widgets/`                            | `number-widget.tsx`, `string-widget.tsx`, `font-widget.tsx` deferred-commit machine                       |
| `apps/web/src/features/settings/hooks/`                                         | 15 hooks; the home for `use-deferred-commit-field.ts`                                                     |
| `apps/web/src/features/git/hooks/`                                              | Ten single-shape mutation hooks, plus the app's only `index.ts` barrel                                    |
| `apps/web/src/features/git/utils/api.ts`                                        | 15 `unwrapEdenResponse` literals; `observeGitOperation:383`                                               |
| `apps/server/src/testing.ts`                                                    | The server's sole runtime test entry; `testSettingsOptions:20` is the precedent                           |
| `apps/web/test/factories/`                                                      | 40 web test factories; the home for the synchronous git runner                                            |
| `apps/web/src/lib/file-icon-style.ts:5`                                         | Canonical `fileIconStyle`, five importers                                                                 |
| `apps/web/src/lib/file-snapshot-query-cache.ts:42,94`                           | `setFileSnapshotQueryData`, `pruneFileSnapshotQueryCache`, 64-query cap at `:9`                           |
| `apps/web/src/lib/eden-events.ts:19`                                            | `unwrapEdenResponse`, the `requireData`/`emptyMessage` contract                                           |
| `apps/web/vitest.config.ts:22,33`                                               | `node` project takes `src/**/*.test.ts`, `dom` takes `src/**/*.test.tsx`                                  |

## Fix the five wrong error codes first

Five missing-provider guards throw `createClientInvariantError` instead of `clientErrors.CONTEXT_MISSING`:
`apps/web/src/hooks/use-application-runtime.ts:7`, `use-environment-connections.ts:8`,
`use-navigation.ts:7`, `use-machine-auth.ts:8`, and `apps/web/src/keymap/hooks/use-bus-binding.ts:8`.

Both codes are status 500 with a `({ message }) => message` factory, so nothing at the throw site
distinguishes them. `CLIENT_INVARIANT_ERROR` says _"A client-side invariant failed while handling
application state"_ (`structured-errors.ts:11`); `CONTEXT_MISSING` says _"A component hook was rendered
outside its required provider"_ and names the remedy (`:23-24`). `createClientInvariantError` has 119
references under `apps/web/src`, so a log filtered on `errorCode` buries these five among the genuine
invariant failures and reports the wrong `fix` to whoever reads them.

Convert the five and nothing else. This is a fix, lands on its own, and must not wait on the sweep.

## Sweep the context guard

Census 5.1. `clientErrors.CONTEXT_MISSING` is thrown at exactly 32 sites in 32 distinct files — one
throw per file, not repetitions within a file (the census's "12 in-file repetitions" phrasing is
imprecise; the correct split is 20 files whose entire content is the guard and 12 where the guard sits
inside a larger module). Plus the five above, 37 guards.

**Home** `apps/web/src/hooks/use-required-context.ts` —
`useRequiredContext<T>(context: Context<T | null>, providerName: string): T`. It calls React's `use`,
so `hooks/`, not `lib/`, and one hook per file. It cannot live in `packages/ui`: `clientErrors` is in
`apps/web/src/lib/structured-errors.ts` and `packages/ui` has zero workspace dependencies. For the
12 sites where the context value is already in hand inside a larger module, add a pure
`requireContext(value, message)` beside `clientErrors` — no React import, so it is a plain helper, not
a hook. No `useMemo`/`useCallback` anywhere in either: the helper returns the context value directly.

**Reconcile before merging**

- **Two guard spellings, verified equivalent.** Guard-then-throw (`if (!x) throw …; return x`) at 13
  sites; return-then-throw (`if (x) return x; throw …`) at 7, e.g.
  `apps/web/src/lib/focus/hooks/use-service.ts:8-12` and
  `apps/web/src/features/chat/hooks/use-chat-transport.ts:7-8`. No context in the set is typed over a
  falsy-but-valid value, so truthiness is safe for all 32.
- **One outlier.** `apps/web/src/features/editor/hooks/use-editor-color-theme.ts:9` tests
  `colorTheme === undefined`, not truthiness. Unobservable today because
  `EditorColorThemeContext` defaults to `undefined`, but a truthiness helper changes the answer if that
  default ever becomes `null`. Either keep this file's explicit test or pin the context default.
- **Message wording is the real change.** 17 sites say `'<hook> must be used within <Something>'`,
  three name the provider instead, and `use-chat-transport.ts:8` uses a different sentence entirely
  (`'Chat transport requires ChatTransportProvider.'`). Deriving the message from a passed-in provider
  name rewrites 18 strings. **One test asserts an exact sentence:**
  `apps/web/src/features/editor/hooks/tests/use-diff-language-context.test.tsx:15` expects
  `'useEditorDocumentStoreApi must be used within EditorStateProvider'`. That break is the desired
  failure mode, not a surprise — it is the only such assertion in `apps/web/src`.
- **The helper replaces the guard, not the file.** Most of these hooks do more than guard:
  `apps/web/src/hooks/use-environment-connections.ts:9` and `use-machine-auth.ts:11` also run
  `useSyncExternalStore` over the connection store. Leave the rest of each body alone.
- **Do not touch the optional accessors.** `apps/web/src/features/chat-mode/providers/session-context.ts`
  exports both a required accessor at `:41` and `useOptionalChatModeSession` at `:34`;
  `apps/web/src/features/editor/providers/workspace-edit-context.ts` does the same at `:50` and `:55`.
  The comment at `apps/web/src/features/chat-mode/hooks/use-save-project-script.ts:21-26` records why:
  the command palette mounts above `ChatModeSessionProvider`, and demanding the provider there took the
  whole palette down with a `CONTEXT_MISSING` error. A sweep that collapses the optional variant
  reintroduces that outage.

**Side item, same pass.** `packages/ui/src/lib/structured-errors.ts:3` defines `uiErrors.CONTEXT_MISSING`
with the same status/why/fix and zero importers repo-wide — the only match for `uiErrors` is its own
definition. Delete it or wire it; do not leave a second catalog owning the same concept.

Run this after Plan 091's 1.4 and after Plan 090's 7.1, so nothing rebases onto a 32-file edit.

## Give the zustand store contexts one factory

Census 5.2. Six modules write `createContext<StoreApi<T> | null>(null)`, a throwing `useXStoreApi`,
and a `useXState(selector)` that forwards to zustand's `useStore`:
`apps/web/src/features/editor/state/ui-state.tsx:37`, `conflict-state.tsx:41`, `document-state.tsx:159`,
`workspace-state.tsx:65`, `apps/web/src/features/git/state/store.tsx:27`, and
`apps/web/src/features/search/state/buffer-state.tsx:141`.

**Home** `apps/web/src/lib/store-context.tsx` — `createStoreContext<TStoreApi>(message)` returning
`{ Context, useStoreApi, useSelector }`. It qualifies for `lib/`: editor counts once, git and search are
two more outside consumers. It needs `react`, `zustand`, and `@/lib/structured-errors`, and imports no
`@/features/*`.

**Reconcile before merging**

- **The store-api type is not uniform, and the census missed it.** `ui-state.tsx:35` and
  `conflict-state.tsx:39` type the api as bare `StoreApi<T>`; `document-state.tsx:154`,
  `workspace-state.tsx:60` and `buffer-state.tsx:134` type it as
  `Mutate<StoreApi<T>, [['zustand/subscribeWithSelector', never]]>`, because their stores are created
  with the `subscribeWithSelector` middleware and callers use `.subscribe(selector, …)`. The factory
  must be generic over the whole api type, not over the state type with `StoreApi` hardcoded — a
  hardcoded `StoreApi` compiles and silently erases the middleware's `subscribe` overload at the three
  sites that use it.
- **`git/state/store.tsx` declares `useGitState:29` before `useGitStoreApi:35`** and aliases
  `StoreApi as ZustandStoreApi` at `:3`. Cosmetic; the alias goes away with the merge.
- All six create with `null` and test `!store`. The message stays a factory argument; the
  `createXStore()` factories stay in their own files.
- No memoization. `useSelector` calls zustand's `useStore`, which owns its own subscription identity.

## Decide the settings module stores on measurement

Census 5.3. Four modules in `apps/web/src/features/settings/state/` hand-roll the same
`let value` + `Set<listener>` + `useSyncExternalStore` shape: `scope-store.ts:13`, `view-store.ts:14`,
`category-store.ts:10`, `search-store.ts:3`. The comments admit the copy — `view-store.ts:8` says "for
the same reason as the scope selection next door".

**Take the measurement before writing the factory.** This is the only place in `apps/web` that
hand-rolls a store; 37 modules under `apps/web/src` already import `zustand`. Four zustand stores are
about the same size as four calls to a new factory and add no new abstraction. If the factory wins, its
home is `apps/web/src/features/settings/state/module-store.ts` — feature-local, because its only
importer would be `features/settings`, which fails the two-consumer bar for `lib/`. Stores are
stateful, so `state/`, never `utils/`.

**Reconcile before merging**

- **`category-store.ts` has two extra exported members that are not optional.** `:24`
  `readSettingsCategory` is a non-React reader and `:34` `subscribe` is exported, because the address
  projection observes the slot — the doc comment at `:28-33` records that dropping the subscription
  leaves `?settings=` in the URL until some unrelated store happens to move. The factory must return
  both as first-class members, not as an escape hatch.
- **`search-store.ts` has no named reader at all** — its snapshot is an inline `() => search` closure
  passed twice (`:15,:16`). Either the factory's reader export becomes optional or the search store
  gains an export it does not need.
- **All four pass the reader as `getServerSnapshot` too.** Keep it; omitting the third argument throws
  in SSR-style renders, and `apps/web/vitest.config.ts:34` runs the `dom` project under
  `./test/env/happy-dom-ssr.ts`.
- **Stable identity is required here and is an allowed reason.** `useSyncExternalStore` resubscribes
  whenever `subscribe` changes identity. Today each module's `subscribe` is a module-scope function, so
  identity is free. The factory must close over one `subscribe` and one `getSnapshot` per store **at
  factory-call time**, not construct them inside the returned hook body — building them per render
  would tear down and re-establish the subscription on every render. This is the "required stable
  identity" exception in AGENTS.md, not manual memoization: no `useMemo`, no `useCallback`.
- The stores themselves stay where they are. They are read from outside the feature —
  `apps/web/src/features/address/state/apply-view-fields.ts`,
  `apps/web/src/state/navigation-capture.ts`, and
  `apps/web/src/keymap/providers/command-provider.tsx` all import them — so moving the modules is a
  separate blast radius this plan does not take.

## Extract the deferred-commit field

Census 5.5. Three settings widgets carry the identical `draft`/`cancelled`/`commit` triple and all four
handlers: `apps/web/src/features/settings/components/widgets/number-widget.tsx:29-81`,
`string-widget.tsx:23-68`, `font-widget.tsx:37-84`. The contract is documented once at
`number-widget.tsx:4-17` (commit on blur and Enter, never per keystroke; ignore incoming values while
focused) and cross-referenced at `string-widget.tsx:5`.

**Home** `apps/web/src/features/settings/hooks/use-deferred-commit-field.ts`. Feature-local; that folder
holds 15 hooks already. One hook per file.

**Reconcile before merging**

- **`commit` differs on purpose and the difference is load-bearing.** `number-widget.tsx:39` maps a
  blank field to `Number.NaN` and then rejects non-finite, with the comment at `:36-38` recording why:
  `Number('')` is `0`, `0` is finite, and `type='number'` reports `''` for a half-typed `-` or `1e`, so
  a naive parse commits a zero the user never typed. `string-widget.tsx:28` and `font-widget.tsx:42`
  trim and reject empty. The hook takes a `parse` function; it does not pick one of the two.
- **Seeding differs.** Number seeds the draft through `String(value)` at `:30` and `:69`; string and
  font use the raw value at `:24,:56` and `:38,:72`. That is a `toDraft` option.
- **The commit prop is named differently.** `FontWidget` calls its prop `onChange` (`font-widget.tsx:33`),
  the other two `onCommit`. Rename to `onCommit` in the same pass.
- **Not in the census finding:** `font-widget.tsx:104`'s dropdown item calls `onChange(font)` directly,
  bypassing the draft entirely. It works only because clicking the menu blurs the input first, which
  commits whatever was typed. Decide explicitly whether the dropdown routes through the hook's commit.
- **Presentation stays at the call site.** Return the handler bag; do not render the `Input`. The three
  differ in `className`, `type`, `inputMode` and `aria-label`, and `font-widget.tsx` wraps its input in
  a flex row with a `DropdownMenu`. No memoization: the handlers go straight onto DOM props, where
  identity does not matter.
- **`string-widget.tsx` has no test.** `apps/web/src/features/settings/tests/` holds
  `number-widget.test.tsx` and `font-widget.test.tsx` and nothing for the string widget. Write one for
  the extracted hook covering the blank-field case before repointing all three.

## Collapse the git mutation hooks and delete the barrel

Census 5.6. Ten hooks in `apps/web/src/features/git/hooks/` are token-for-token identical apart from
the api function, the mutation key and the argument — `use-stage-path-mutation.ts`,
`use-stage-paths-mutation.ts`, `use-unstage-path-mutation.ts`, `use-unstage-paths-mutation.ts`,
`use-discard-path-mutation.ts`, `use-discard-paths-mutation.ts`, `use-fetch-remote-mutation.ts`,
`use-pull-remote-mutation.ts`, `use-push-remote-mutation.ts`, `use-sync-changes-mutation.ts`, each
declaring its hook at line 9 and its `useMutation` at `:12-17`.

**Home** `apps/web/src/features/git/hooks/use-workspace-mutation.ts` taking `{ mutationKey, run }`.
Stays in the feature; one hook per file.

**Reconcile before merging**

- **Keep `mutationKeys` per-operation.** `apps/web/src/features/git/hooks/use-commit-pending.ts:6`
  reads one through `useIsMutating`, and the action buttons read `isPending` per key. A single shared
  key collapses those into one busy state.
- **Two neighbours must not fold in.** `use-discard-staged-paths-mutation.ts:13-17` awaits
  `unstagePaths` before `discardPaths` inside one `mutationFn`.
  `use-create-pull-request-mutation.ts:19-20` invalidates only `gitKeys.pullRequestState(rootPath)`
  instead of calling `useWorkspaceInvalidation`, and its `mutationFn` takes a real `input` variable
  where the ten take `_variables` — the factory's variables type is `void` and must stay that way.
- **`notifyMutationError` is shared with Plan 090.** All ten pass
  `onError: notifyMutationError` from `@/features/git/utils/notify-mutation-error`, which Plan 090's
  7.1a folds into `apps/web/src/lib/notify-client-error.ts`. Land 090 first; the factory then takes
  one `onError` reference and the rebase is a single line.

**Bonus, same pass.** `apps/web/src/features/git/hooks/index.ts` is a 19-line re-export barrel and the
only `index.ts` under `apps/web/src` — AGENTS.md forbids feature barrels. Delete it and repoint its
nine importers at exact files: `apps/web/src/features/git/components/{file-actions.tsx:3,
group-actions.tsx:10, branch-actions.tsx:8, file-row.tsx:8, header.tsx:14, panel.tsx:8}`,
`apps/web/src/features/workspace/components/files-pane.tsx:2`,
`apps/web/src/features/workbench/components/editor-surface-layout-view.tsx:4`,
`apps/web/src/features/chat-mode/components/surface-view.tsx:10`.

## Give the git test fixtures one runner per runtime

Census 5.7. Twenty hand-rolled "run git and throw" helpers in three families that are not
interchangeable. Name the incompatibilities before proposing one helper.

**Family A — async `Bun.spawn` with `git -C <root>`, 12 sites.**
`apps/server/src/git/tests/{checkpoint-store.test.ts:255, commit-progress.test.ts:175,
push-and-pull-request.test.ts:137, ref-validation.test.ts:84, service.test.ts:518,
status-cache.test.ts:101}`, `apps/server/src/observability/tests/runtime.test.ts:611`,
`apps/server/src/orchestration/tests/{checkpoint-diff-query.test.ts:232, checkpoint-reactor.test.ts:476,
engine.test.ts:1242}`, `apps/server/src/tests/app.test.ts:1500`, and
`apps/server/test/factories/git-worktree.ts:43` — the last already exported and ignored by the other 11.

**Family B — `cwd` spawn option, variadic args, 2 sites.**
`apps/server/test/factories/orchestration.ts:95` `executeGit` and
`apps/web/test/factories/session-domain.ts:173` `executeDomainGit`.

**Family C — synchronous `execFileSync`, 6 sites.**
`apps/web/src/features/git/tests/{api.test.ts:16, panel-states.test.tsx:13}` and
`apps/web/src/features/git/components/tests/{branch-actions.test.tsx:71, diff-view.test.tsx:244,
diff-line-comment.test.tsx:193, commit-message-generation.test.tsx:318}`.

**The incompatibilities**

| Axis         | What differs                                                                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Return shape | Family A: `{ stderr, stdout }` ×7; bare trimmed `stdout` ×2; `{ exitCode, stderr, stdout }` with an `allowFailure` third parameter ×2 (`checkpoint-reactor.test.ts:476`, `engine.test.ts:1242`). Family B returns `stdout.trim()`. Family C returns whatever `execFileSync` returns |
| Trimming     | `git-worktree.ts:51` trims the tail only; family B trims both ends; `commit-message-generation.test.tsx:318` is the only family-C member that trims; the rest do not. **Trimming is not free** for a caller parsing `git status --porcelain` line by line                           |
| Encoding     | `api.test.ts:16` passes `{ cwd, stdio: 'pipe' }` with **no `encoding`**, so it returns a `Buffer`; the other five family-C sites pass `encoding: 'utf8'` and return a string. A merge onto one signature changes what four assertions compare against                               |
| Shape        | `api.test.ts:16` is an inline arrow closing over `repo`; the other five are named `git(cwd, ...args)` functions                                                                                                                                                                     |
| cwd mode     | Family A uses `git -C <root>`; family B uses the `cwd` spawn option. **Both modes matter**: `git init` in a not-yet-existing directory needs `cwd`, and `-C` resolves through a symlinked macOS temp root where `cwd` does not                                                      |
| Thrown type  | `Error` ×8, `TypeError` ×5, and `createTuiError` at `apps/tui/test/factories/git-workbench.ts:10` (a 4th family, TUI-only, returns raw untrimmed `stdout` at `:11`)                                                                                                                 |
| Message      | `` `git ${args.join(' ')} failed: ${stderr}${stdout}` `` at `checkpoint-store.test.ts:264`; `` `Git fixture failed: ${stderr}` `` in family B; bare `` `${stderr}${stdout}` `` elsewhere                                                                                            |
| Identity     | None of the Bun families sets `GIT_CONFIG_NOSYSTEM` or an author identity, which is why call sites re-run `git config` by hand — `apps/server/test/factories/git-worktree.ts:17-18` and `apps/tui/test/factories/git-workbench.ts:16-17`                                            |

**Homes.** One async `runGit(root, args, { allowFailure?, cwdMode?: 'flag' | 'option' })` returning
`{ exitCode, stdout, stderr }` in `apps/server/src/testing/git.ts`, re-exported from
`apps/server/src/testing.ts` — the package's exports map reaches only `./src/testing.ts`
(`apps/server/package.json:13-16`), and `testSettingsOptions` at `apps/server/src/testing.ts:20` is
the precedent. Trimming becomes a caller-side `.trim()`/`.trimEnd()`, never a default.

**Family C must stay synchronous, and must not reach through `server/testing`.** A thin `execFileSync`
wrapper in `apps/web/test/factories/git.ts` over the same argument shape — not a 21st copy and not an
async import. `apps/web/src/features/git/tests/api.test.ts` runs in the `node` project and the five
`.test.tsx` sites run in `dom` (`apps/web/vitest.config.ts:24,35`); importing `server/testing` from
them evaluates the whole Bun-native server module graph for a two-line helper.

## Take the mechanical web wins

Census 7.2. Eight collapses in `apps/web`, each with its divergences named.

**a. `fileIconStyle` ×6.** Canonical at `apps/web/src/lib/file-icon-style.ts:5` with five importers.
Copies at `apps/web/src/features/search/utils/result-editor.ts:397`,
`features/search/components/file-group.tsx:120`,
`features/chat/components/assistant-changed-files-tree.tsx:226`,
`features/editor/components/language-server-references-pane.tsx:296`,
`features/git/components/file-row.tsx:112`. **Reconcile: nothing** — all six are byte-identical,
including the shared `url(undefined)` behaviour when `icon.src` is missing. Four of the copies also
violate "keep pure helpers out of component files". Delete the exported copy at `result-editor.ts:397`
and repoint its one importer, `features/search/components/result-file-header.tsx:8`, at
`@/lib/file-icon-style`; `result-editor.ts` has ten other importers and keeps its remaining exports.
**Coordinate that import line with [Plan 092](092-path-and-uri-helpers.md):** the same statement also
pulls in `fileName` from `result-editor.ts:393`, the sixth `basename` variant, which 092 renames.

**b. `moveFileQueryData` ×4.** `apps/web/src/features/workspace/hooks/use-events.ts:795`,
`features/workspace/state/event-conflict-adapter.ts:279`,
`features/workspace/utils/conflict-editor-resolution.ts:128`, and inline at
`features/workspace/hooks/use-fs-actions.ts:201-205`. **Home**
`apps/web/src/lib/file-snapshot-query-cache.ts` as `moveFileSnapshotQueryData`; its header at `:18`
already claims single-source-of-truth for file-snapshot queries and it owns
`setFileSnapshotQueryData:42` and `pruneFileSnapshotQueryCache:94`. **Reconcile:** the three named
copies read, remove, then write; the inline fourth writes the new key at `:203` **before** removing the
old at `:205`. Observably equivalent — the keys never collide — except that
`pruneFileSnapshotQueryCache` sees one extra live entry, which can change which entry is evicted at the
64-query cap (`file-snapshot-query-cache.ts:9`). Adopt remove-first. The inline site also calls
`renameLiveEditorDocument` at `:204`, which is not part of the query-cache move: the shared helper
takes the cache half, the caller keeps the editor rename.

**c. The git `unwrapEdenResponse` literal ×16.** Fifteen in `apps/web/src/features/git/utils/api.ts`
and one at `features/git/utils/blob-diff-query.ts:48`, all with
`emptyMessage: 'git server returned an empty response'` and `requireData: true`. **Reconcile:** all 16
identical modulo key order. **Home** one local `unwrapGit<T>` in `api.ts`, exported for
`blob-diff-query.ts`. **Fold in a real fix:** `observeGitOperation` is spread with
`...clientLogContext(client)` at thirteen call sites but **not** at `api.ts:375` (`syncRemote`), so that
operation's wide event is missing the client and environment fields. The census says fourteen; the
current count is thirteen. Same pass as Plan 090's 7.1a and coordinated with Plan 094's 4.11b — all
three rewrite this file.

**d. Hand-rolled Eden unwrapping in settings import.**
`apps/web/src/features/settings/utils/session-import.ts:9` and `:16` both write
`if (error || !data) throw createRpcError(error)`. **Reconcile:** on a 200 with a null body that calls
`createRpcError(undefined)`, which matches no code and surfaces as a generic "Something unexpected went
wrong." with no code attached. `unwrapEdenResponse(response, { requireData: true })`
(`apps/web/src/lib/eden-events.ts:24-25`) throws a `CLIENT_INVARIANT_ERROR` naming the empty response.
Prefer it over client-core's `requireEdenData`, which bypasses `toClientError` for user-facing copy.
Nine other feature modules already call `unwrapEdenResponse`.

**e. `SidebarSelection` / `SessionSelection`.**
`apps/web/src/features/chat/state/sidebar-selection-store.ts:4` and
`features/chat-mode/utils/active-session.ts:3` are byte-identical arm for arm — same three arms, same
`EnvironmentId`/`ProjectId`/`SessionId` fields. **Home** `apps/web/src/lib/chat-selection.ts` as one
`ChatSelection`. Four feature consumers: `features/chat`, `features/chat-mode`, `features/address`
(`state/apply-view-chat.ts:13-14`), `features/workspace` (`state/cache.ts:24`), plus
`apps/web/src/state/navigation-capture.ts:108,117`. **Reconcile: none** — the codebase already relies
on the structural equality at `features/address/state/apply-view-chat.ts:116`, where a
`SidebarSelection` is passed into `useSessionSelectionStore`. **Not** client-core: the TUI models this
differently at `apps/tui/src/agent/utils/target.ts:3`.

**f. `assignRef` ×2.** `apps/web/src/features/workbench/components/editor-tab-button.tsx:107` and
`features/file-picker/list.tsx:745` (the census cited `:744`; corrected). **Reconcile: none** —
statement for statement identical modulo type-parameter name. **Home** `apps/web/src/lib/assign-ref.ts`,
which must be `lib/` and not `utils/`: it imports React's `Ref` type, and `utils/` takes nothing that
imports React. Both current homes are component files holding a pure helper.

**g. `clampIndex` ×2 and two preview-range pairs.** `apps/web/src/features/search/utils/result-items.ts:273`
and `features/search/utils/result-view-model.ts:453` are the same `clampIndex`;
`features/search/utils/match-display.ts:35,55` and `result-view-model.ts:370,383` are the same
`searchMatchPreviewRange`/`queryRange` pair under different names. `result-view-model.ts:6,12` already
imports from both modules, so export from `result-items.ts` and `match-display.ts`. **Reconcile:**
nothing in the bodies. Both `clampIndex` copies share a `length === 0` bug —
`Math.min(Math.max(0, 0), -1)` is `-1` — that both callers happen to guard
(`result-items.ts:200` returns early on an empty list). Fix it or keep it knowingly; do not merge
without deciding. **Dead branch to delete in the same pass:** `result-items.ts:206` recomputes
`activeIndex < 0` two lines after the `:204` early return already handled it.

**h. `StorageAccess` vs `KeyValueStorage`.** `apps/web/src/lib/environments/state/scoped-storage.ts:4-6`
declares `StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { keys }`;
`packages/client-core/src/storage.ts:1-6` declares the identical `KeyValueStorage`. Delete
`StorageAccess` and define `ScopedStorage = KeyValueStorage & { readonly environmentId: EnvironmentId }`
(`scoped-storage.ts:8-10`). **Reconcile:** mutually assignable today. The asymmetry is directional and
is the argument for the merge — web's derives from the DOM lib's `Storage`, so a TypeScript lib change
moves web's type and not client-core's. `ScopedStorage` is referenced in 31 non-test modules under
`apps/web/src`, concentrated in `features/chat`, `features/chat-mode` and `features/workspace`; the
type name stays, only its definition changes.

## Decide before writing code

Each decision gates its item. Settle them before the first edit.

- **5.1 — does the guard message become derived, or stay a literal per site?** Deriving it from a
  provider name rewrites 18 sentences and breaks
  `apps/web/src/features/editor/hooks/tests/use-diff-language-context.test.tsx:15`. Keeping literals
  makes the helper a two-argument call that saves fewer lines.
- **5.1 — delete `uiErrors` in `packages/ui/src/lib/structured-errors.ts`, or wire it?** It has zero
  importers today. Leaving it is a second catalog for one concept.
- **5.1 — does `EditorColorThemeContext` keep an `undefined` default?** If yes,
  `use-editor-color-theme.ts:9` can move to truthiness safely. If it may become `null`, the file keeps
  its explicit test and stays outside the sweep.
- **5.2 — is the factory generic over the store-api type or over the state type?** Three of six stores
  carry `subscribeWithSelector`; a state-generic factory erases their `subscribe` overload and still
  typechecks.
- **5.3 — factory or zustand?** 37 modules under `apps/web/src` already import zustand. Take the
  measurement first; a factory that saves 45 lines and adds an abstraction may lose to four
  `create()` calls.
- **5.5 — does `FontWidget`'s dropdown commit through the hook?** `font-widget.tsx:104` bypasses the
  draft today and works only because the menu blurs the input first.
- **5.7 — does the shared runner own `GIT_CONFIG_NOSYSTEM` and an author identity?** If yes, the
  hand-written `git config` calls at `apps/server/test/factories/git-worktree.ts:17-18` and
  `apps/tui/test/factories/git-workbench.ts:16-17` go away. If no, every new call site repeats them.
- **5.7 — one trim policy, or trimming at the call site?** Family A, B and C each answer differently,
  and a `git status --porcelain` parser cares.
- **7.2b — accept the eviction-order change?** Remove-first is correct, and it changes which entry
  `pruneFileSnapshotQueryCache` evicts at the 64-query cap.
- **7.2g — fix `clampIndex` on an empty list, or keep the `-1` and document it?**

## Verify plausible failures

App Vitest runs under `bun --bun vitest` from `apps/web` and `apps/server`. Use focused files in the
owning app and config — never a package or repository-wide suite, and never a bare test count. The
`node` project takes `src/**/*.test.ts`, the `dom` project takes `src/**/*.test.tsx`
(`apps/web/vitest.config.ts:24,35`). A dev server is already running; do not start another.

| Failure to catch                                                 | Narrowest proof                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The context sweep silently changes a thrown message              | `apps/web`: `bun --bun vitest run --project dom src/features/editor/hooks/tests/use-diff-language-context.test.tsx` — the only exact-sentence assertion in the app                                                                                                                                                                                                                                                 |
| The sweep collapses an optional accessor into a throwing one     | **No test covers this today** — `src/features/workspace/tests/use-fs-actions.test.tsx:252` always mounts `WorkspaceEditServiceContext`, and `features/command-palette/tests/script-groups.test.tsx` renders `ScriptGroups`, not the `content.tsx` that calls `useSaveProjectScript`. Write one focused `dom` test that renders a consumer of each optional accessor with no provider and asserts it does not throw |
| The five converted guards now report the wrong `fix`             | Assert `errorCode` and `fix` on the thrown error in a new focused test beside `apps/web/src/hooks/`; `createClientInvariantError`'s other 118 call sites must not move                                                                                                                                                                                                                                             |
| `createStoreContext` erases `subscribeWithSelector`              | `apps/web`: `tsgo --build` in `apps/web`, plus `bun --bun vitest run --project dom src/features/git/tests/store-provider.test.tsx` and `--project node src/features/search/tests/search-buffer-state.test.ts`                                                                                                                                                                                                      |
| The settings module-store factory resubscribes every render      | `apps/web`: `bun --bun vitest run --project dom src/features/settings/tests/page.test.tsx src/features/address/tests/edges.test.tsx` — the address projection reads `category-store`'s exported `subscribe`                                                                                                                                                                                                        |
| The deferred-commit hook commits a zero the user never typed     | `apps/web`: `bun --bun vitest run --project dom src/features/settings/tests/number-widget.test.tsx src/features/settings/tests/font-widget.test.tsx`, plus a new `string-widget` case for the blank field                                                                                                                                                                                                          |
| The mutation factory collapses per-key `isPending`               | `apps/web`: `bun --bun vitest run --project node src/features/git/tests/mutation-keys.test.ts` and `--project dom src/features/git/components/tests/branch-actions.test.tsx`                                                                                                                                                                                                                                       |
| Deleting the git hooks barrel breaks an importer                 | `apps/web`: `tsgo --build` (all nine importers are typed)                                                                                                                                                                                                                                                                                                                                                          |
| The shared `runGit` changes a parsed `git` result                | `apps/server`: `bun --bun vitest run src/git/tests/status-cache.test.ts src/git/tests/service.test.ts src/orchestration/tests/engine.test.ts` — `engine.test.ts:1242` is the `allowFailure` caller                                                                                                                                                                                                                 |
| Family C loses its synchronous shape or its Buffer/string return | `apps/web`: `bun --bun vitest run --project node src/features/git/tests/api.test.ts` and `--project dom src/features/git/tests/panel-states.test.tsx`                                                                                                                                                                                                                                                              |
| `moveFileSnapshotQueryData` evicts the wrong snapshot            | `apps/web`: `bun --bun vitest run --project node src/features/workspace/tests/use-events.test.ts` and `--project dom src/features/workspace/tests/use-fs-actions.test.tsx`                                                                                                                                                                                                                                         |
| `unwrapGit` loses the `syncRemote` log context                   | `apps/web`: `bun --bun vitest run --project node src/features/git/tests/api.test.ts`; assert the wide event carries the client/environment fields for `git.sync_remote`                                                                                                                                                                                                                                            |
| Settings import stops naming the empty response                  | `apps/web`: `bun --bun vitest run --project dom src/features/settings/tests/import.test.tsx`                                                                                                                                                                                                                                                                                                                       |
| `ChatSelection` breaks the structural hand-off                   | `apps/web`: `bun --bun vitest run --project dom src/features/address/tests/apply-view.test.tsx src/features/address/tests/diff-scope-navigation.test.tsx`                                                                                                                                                                                                                                                          |
| `clampIndex` or the preview-range merge reorders results         | `apps/web`: `bun --bun vitest run --project node src/features/search/tests/search-result-editor-utils.test.ts src/features/search/tests/search-result-view-model.test.ts`                                                                                                                                                                                                                                          |
| `ScopedStorage` narrowing breaks a persisted reader              | `apps/web`: `tsgo --build`, plus `bun --bun vitest run --project node src/features/workspace/state/tests/cache.test.ts`                                                                                                                                                                                                                                                                                            |

Run `oxlint .` in `apps/web` after the 32-file sweep and after the barrel deletion; the pre-commit gate
lints staged files only, so a repo-wide import change needs the explicit run.

## What this plan does not do

- It does not touch `apps/tui`. Census 5.4 — the twelve hand-rolled TUI state factories and their three
  guard families — belongs to [Plan 094](094-client-core-web-tui-parity.md), as does 4.11b's edit to
  `apps/web/src/features/git/utils/api.ts`.
- It does not rewrite `apps/web/src/lib/structured-errors.ts`'s catalog. The `EDEN_STREAM_MISSING`
  collision (census 1.4) and the `errorMessage`/`elapsedMs` foundations belong to
  [Plan 091](091-error-and-timing-helpers.md), which lands first.
- It does not fix `notify-mutation-error`'s double wide event, the doubled logs banner, the
  `use-element-width` ref bug, `fileLoadState`'s pending-as-empty fall-through, or the
  `panelTabTitle`/`chatModeToolTabLabel` fork. Census 7.1 belongs to
  [Plan 090 regression record](../docs/duplicate-defect-regressions.md).
- It does not move `features/menus`, refolder `features/environments`, relocate `lib/` modules below
  the two-consumer bar, or take any of the feature-local extractions in census 7.4 — including the
  chat storage modules (7.4a, 7.6), the two rankers (7.4b) and the document schemes (7.4e). Census 7.3,
  7.4, 7.5 and 7.6 belong to [Plan 096](../docs/web-layering.md).
- It does not merge any path, URI or `basename` helper. Census theme 3 belongs to
  [Plan 092](092-path-and-uri-helpers.md).
- It registers no settings key, so `bun run settings:reference` does not apply.

## Completion checklist

- [ ] The five wrong-catalog guards throw `CONTEXT_MISSING`, landed ahead of the sweep.
- [ ] 32 guards call one helper; the optional accessors and `use-editor-color-theme`'s explicit
      `undefined` test are handled per the recorded decisions.
- [ ] `uiErrors` is deleted or wired; no second catalog owns `CONTEXT_MISSING`.
- [ ] `createStoreContext` preserves `subscribeWithSelector` at the three stores that use it.
- [ ] The settings module-store decision is recorded with its measurement, factory or not.
- [ ] The deferred-commit hook carries `parse` and `toDraft`; `string-widget` gains a test.
- [ ] Ten git mutation hooks call one factory; the two non-folding neighbours are untouched; the
      barrel is deleted and all nine importers point at exact files.
- [ ] One async `runGit` with both cwd modes; one synchronous web wrapper; trimming is explicit at
      every call site.
- [ ] All eight 7.2 collapses landed, with `syncRemote`'s missing log context fixed in the same pass.
- [ ] No manual `memo`/`useMemo`/`useCallback` was added; the one stable-identity requirement
      (`useSyncExternalStore`'s `subscribe`) is satisfied by factory-scope closure, not by a hook.
- [ ] Focused checks above pass; no repo-wide suite was used as proof.
