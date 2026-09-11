# TanStack Router evaluation for Plan 086

Evaluated on 2026-09-11 against Platform `99550068` and current official Router documentation.
Status: recommend Router as the web navigation owner. No application migration or dependency installation has been performed.

## Recommendation

Adopt TanStack Router for web destination selection and browser history. Migrate navigation callers to typed routes and validated search. Remove the current passive store-to-URL destination controller when those callers are migrated.

This recommendation changes Plan 086's earlier preference for retaining native history. That preference minimized the immediate patch. The user's desired outcome includes typed navigation, multiple kinds of copy link, and eventual portable workspace opening. Owning a custom navigation framework is a continuing cost in that context.

Do not install Router beneath the existing projection and continue passing preformatted `href` strings everywhere. That leaves two navigation owners and bypasses much of the useful typing.

## Alternatives compared

| Candidate              | Shape                                                                                           | Useful gains                                                                                                         | Cost and retained work                                                                                                              | Verdict                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Native owner           | Deepen the current controller around typed domain navigation actions. Keep native push/replace. | Smallest dependency change; domain IDs and discriminated destinations can still be typed.                            | We maintain route matching, caller/route relationships, notifications, history policy, and integrations.                            | Viable for the shortest repair; not the recommended longer-term design. |
| History adapter only   | Same controller over `@tanstack/history`.                                                       | Shared browser/memory-history abstraction.                                                                           | Replaces a few native calls/subscriptions. Does not infer route, path, or search types. Almost all restore/controller code remains. | Skip. Too little of the requested benefit.                              |
| Router owns navigation | Registered typed route tree and search schemas; domain runtimes apply the accepted route.       | Compiler-checked route callers, typed params/search, runtime search validation, supported navigation/lifecycle APIs. | Medium-to-large migration across navigation commands, boot, retained runtimes, and tests. App-specific restore policy remains.      | Recommended.                                                            |

Independent candidate reviews agreed on the central boundary: Router adds value only if it becomes the navigation owner. One reviewer preferred the native option for a narrowly bounded patch. This assessment selects Router because future link/navigation work is part of the stated scope, while retaining that reviewer's warning against a history-only halfway migration.

## What the type safety buys

Our current `Address` already has TypeScript fields. Router adds a relationship between registered destinations and their callers. A changed route can break invalid `Link` or navigation calls at compile time. Registered route/search types also flow into reading hooks. [Type-safety documentation](https://tanstack.com/router/latest/docs/guide/type-safety)

Concrete targets for the implementation's compile checks:

- A nonexistent route name fails.
- Navigating to a session route without its required session parameter fails.
- `side: 'banana'` fails while `side: 'chat'` succeeds.
- Incorrect search value types fail.
- Route-bound hooks infer the fields owned by that route.

Valibot is already installed in Platform. Router accepts its Standard Schema interface directly for `validateSearch`, so we need no new schema library or Valibot adapter. `stripSearchParams` supports omission of declared defaults. Preserve sparse input where boot inheritance depends on distinguishing absent from explicitly supplied values. [Search validation and middleware](https://tanstack.com/router/latest/docs/guide/search-params)

These checks do not prove that a file exists, a workspace ID resolves on this server, or a session belongs to the addressed worktree. Keep the branded contract types and live ownership checks. A file-path splat remains a runtime path, even though the route accepting it is typed.

## Usage and ownership sketch

This is a design sketch, not code compiled during this evaluation. After registering the concrete routes, a file destination can use the supported parameter API:

```ts
router.navigate({
  to: '/~{$workspace}/workbench/f/$',
  params: { workspace: workspaceToken, _splat: relativePath },
  search: searchForView(nextView),
  replace: false,
  resetScroll: false,
})
```

Within a bound route, a query edit uses a typed functional search update and `replace: true`. Optional Pacer debouncing limits replacement frequency; it never chooses whether an edit is a destination. [Navigation API](https://tanstack.com/router/latest/docs/guide/navigation)

App commands that must resolve ownership, prepare tabs, or coordinate asynchronous workspace opening should keep a small domain interface such as `openFile`, `openChat`, and `copyView`. That interface calls Router with typed options internally. It must hide real domain work rather than forwarding arbitrary router options through extra wrappers. Simple links can use Router's `Link` directly.

The direction of authority is:

```text
file/chat intent → typed Router destination → accepted route application
                                                    ↓
                                       retained editor/chat runtime

view edit → typed Router search replacement → view application
```

Router owns the committed destination, search, and browser traversal. Existing runtime stores own document contents, dirty buffers, execution state, transport connections, and local preferences. Their active file/chat fields are the applied view of the route; arbitrary changes to those fields must no longer create competing navigation.

Keep URL presentation separate from a complete captured view. The `@` active-tab marker, explicit-empty representation, raw percent encoding, and URL size budgets are wire concerns. Domain tabs contain document references, never compression markers. Keep partial-address presence distinct from complete view state.

## Route shape and serialization

Preserve `~platform.<id>`. Router supports literal prefixes on params and file-path splats, so that format does not require a custom browser-history layer. [Path parameters](https://tanstack.com/router/latest/docs/guide/path-params)

Use concrete route families for workspace root, workbench, chat, settings/search documents, file/saved comparison, Git-ref diff, snapshot diff, and checkpoints. `t/new` is a static draft route; `t/$sessionId` names a session. A variable-length file path can use `_splat`. Do not hide the entire file/chat/document grammar in a generic catch-all string and claim equivalent route-level typing.

Keep explicit local and `@environment` branches where needed. Do not guess that an optional prefixed parameter removes the entire `@` segment. A shared typed route construction helper may remove declaration duplication; it must preserve concrete literal route types.

Prefer code-based route declarations for this small persistent workbench shell. They can reference existing components from separate files without manufacturing a page component for every document token. File-based routing remains supported, but generated page organization is not the main value here. Register the completed router type either way. [Code-based routing](https://tanstack.com/router/latest/docs/routing/code-based-routing)

Provide custom `parseSearch` and `stringifySearch` for the existing readable tabs/query representation. Router's default JSON search format is a different wire format. Split tab delimiters before decoding and prove filenames containing `~`, `@`, `%`, spaces, Unicode, and encoded slashes survive. Parsed Router parameters and already-encoded document tokens must not be mixed. [Custom serialization](https://tanstack.com/router/latest/docs/guide/custom-search-param-serialization)

`apps/tui/src/navigation/utils/address.ts` also imports `parseAddress` and `formatAddress`. Keep the shared client-core codec React-free and preserve cross-client URL compatibility. Router is the web routing owner, not a new dependency of the TUI. Shared schema/codec rules and round-trip tests prevent the web route tree and TUI parser from disagreeing.

## Lifecycle requirements

- Select the saved initial address for a bare `/` launch before initializing the final Router location and before boot seeds the editor stores. Route all URL mutations through the chosen history owner once it exists.
- Retain the additive boot versus authoritative traversal distinction from Plan 086. Installing Router is not permission to change omitted values or close remembered tabs on a pasted file link.
- Keep `ApplicationBootstrap`, `ApplicationRuntime`, retained environment runtimes, and editor document owners mounted across file/chat navigation. Do not key them by pathname. The existing provider remount at an environment boundary has separate ownership rules and should not be broadened.
- Use loaders/preload only for read-only preparation. Hovering a link must not switch workspaces, select a chat, open a terminal, or run commands. If useful read-only preload cannot be isolated initially, disable preload for these routes.
- Apply domain changes through one owner for accepted locations, with supersede checks. Router supplies loader abort signals, but that does not roll back store mutations or replace our operation-level ownership checks. Preserve existing protocols until a tested replacement owns the same invariant. [Loader lifecycle](https://tanstack.com/router/latest/docs/guide/data-loading)
- Restrict loader dependencies to actual data requirements. Changing a search field, panel, or cursor must not reopen the workspace or reload unrelated documents. Each committed view update must still apply even if loader data came from cache.
- Preserve one history step per completed file/chat destination. Before leaving a destination, settle its valid pending replacement. On browser traversal, discard pending edits from the abandoned destination.
- Persist accepted Back/Forward destinations independently of whether any URL rewrite was needed. Handle unavailable destinations explicitly; do not silently apply a remembered different workspace.
- Copy from current captured state using the same registered route builder and search codec, avoiding stale debounced location data.
- Keep panel-only changes as replacements, with the existing panel state attached to destination entries. The later panel-history product decision remains deferred.

T3 Code is a useful reference for typed route navigation, not a mandate to copy every configuration. Its Electron shell uses hash history. Platform's current desktop shell opens an HTTP `WEB_URL` in `apps/desktop/src/bun/index.ts:166`; retain browser history unless that serving model changes.

## Files that change and code that can disappear

| Area                                               | Change                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New web routing modules                            | Router creation/registration, code-based route tree, route/search validation, and one accepted-location application owner. Keep feature knowledge out of `lib/`; use app-level state or the address feature. |
| `features/address/state/projection.ts`             | Delete the passive destination classifier and global navigation debounce after callers migrate. Preserve its behavior requirements as navigation tests.                                                      |
| `features/address/hooks/use-projection.ts`         | Delete store subscriptions that infer destinations and its native writer/popstate listener. Move complete view capture to the current domain owner.                                                          |
| `features/address/hooks/use-restore.ts`            | Remove browser event wiring and rereads of global location. Extract and retain workspace/session resolution, tab protections, and view application under the route owner.                                    |
| `features/address/state/storage.ts`                | Keep read/write cache and dev-param policy; move native startup mutation to Router initialization and copy construction to current view capture.                                                             |
| `main.tsx`, bootstrap/runtime, `AppRuntimeContent` | Initialize Router once, retain runtime lifetime, replace the two address hooks with accepted-location integration.                                                                                           |
| Editor/session/workspace/keymap commands           | Send typed destinations through navigation completion boundaries; use Router's history for Back/Forward and current view building for copy.                                                                  |
| Shared client-core codec and TUI address consumer  | Keep framework-neutral parsing/serialization and validate interoperability; refine tab/default contracts with all consumers.                                                                                 |
| Package/test setup                                 | Add Router dependency and focused memory-history/type tests. Add plugin/generation only if file-based routes are selected.                                                                                   |

Current projection/controller files total 398 lines; these are deletion candidates, not a promised net code reduction. The 645-line restore module mostly contains domain rules that remain. A source scan found roughly 30 file/chat selection call sites behind concentrated command seams. Budget this as M–L, roughly 20–35 implementation files plus focused tests, depending on route organization and whether sidebar-chat addressing is included. These are estimates, not measured implementation totals. No bundle-size or performance claim is established by this evaluation.

## Migration sequence if selected

1. **Prove the boundary.** Build typed local/remote file and chat routes with the real custom codec, sparse search validation, and retained application shell. Check invalid navigation types fail. Verify raw URL round-trips and one actual file → chat → Back → Forward flow. This is the first implementation unit, not a second permanent navigation system.
2. **Expand to every current destination.** Cover draft, settings/search, comparisons, refs, snapshots, checkpoints, folderless state, and TUI interoperability before cutting over. Keep the branded IDs and runtime boundary checks.
3. **Migrate navigation producers and application together.** Wire command completion and one route application owner; preserve async supersede and dirty-tab rules. Delete the old projection/listeners in the same migration wave. Do not ship Router and native projection as competing writers.
4. **Finish the cleanup in Router-owned state.** Apply active-tab compression, ordered/empty tab restoration, sparse defaults, accepted-address persistence, and current-state copy. Do not first polish the old controller only to delete it.
5. **Verify real history and lifetime.** Reuse the running app for Plan 086's rapid navigation, paused typing, pending-edit traversal, bare relaunch, dirty-tab, copy, and environment retention cases. Add targeted memory-history/type checks; use plain Node for real-browser orchestration. No new dev server.

Retain Plan 086's open product decisions for marker spelling, full-view link scope, sidebar chats, and the exact meaning of whole workspace view. The sharing backend, clone execution, portable conversation transport, hidden tab history state, and stored view IDs remain out of scope.

## Evaluation limits

This was a source and architecture evaluation with two independent candidate reviews. Official support was checked for typed routes, Valibot search validation, search middleware, custom serialization, prefixed parameters, navigation, and loader behavior. No Router prototype was compiled, no dependency was installed, and no new runtime tests were needed for these plan-only edits. The first implementation unit must prove type inference and encoding against the version actually installed.
