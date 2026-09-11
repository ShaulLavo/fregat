# Plan 086: Migrate web navigation fully to TanStack Router

Status: implemented; focused checks and Chromium/Firefox browser gates pass. WebKit and the second live environment remain unverified. Priority P1, effort L, risk medium.
Planned at `eb926925` on 2026-09-11. The earlier [evaluation](086-router-evaluation.md) supplies rationale; this file owns the implementation decisions.

The outcome is one web navigation owner, typed destinations and search, useful browser Back/Forward, and reusable workspace-view data. Replace the custom URL projection and restoration wiring in the same cutover that migrates its callers. Keep the persisted `~platform.<id>` workspace address and ordered tabs in the URL.

Implementation was requested on 2026-09-11 and uses the existing worktree at `eb926925`. The pre-existing plan/evaluation/index edits are preserved. No branch, commit, push, or PR was created. The startup cutover preserves the existing bootstrap/cache behavior; Plan 085's first-paint work remains separate.

## Decisions used by this plan

| Question           | Decision                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router scope       | TanStack Router owns all web and HTTP-desktop destinations, search, and browser history. TUI keeps its own navigation, sharing the framework-neutral address contract.                                                |
| Route declarations | Code-based, registered concrete route families, with explicit local and remote-environment branches.                                                                                                                  |
| Validation         | Existing Valibot through Standard Schema. Validate route params, search, and hash at input boundaries; preserve branded domain IDs and live ownership checks.                                                         |
| History            | Immediate pushes for deliberate file/chat/workspace/mode destinations; immediate replacements for text, filters, focus, and panels. No URL debounce in this migration.                                                |
| Tabs               | Whole-token `@` marks the selected editor in its ordered position. `tabs=-` means explicitly empty; absence means unspecified. Keep singleton `tabs=@`.                                                               |
| Startup            | Preserve additive URL-over-cache restoration. Capture explicit input before removing defaults.                                                                                                                        |
| Traversal          | Restore addressed order and defaults, retaining dirty or unaddressable tabs. Never push in response to Back/Forward.                                                                                                  |
| Sidebar chats      | Include conversation selection in this migration, separate from full chat-mode selection. Use workbench search `chat=t/<sessionId>` or `chat=t/new`, emitted with `side=chat`.                                        |
| View data          | Selected file/chat, ordered addressable tabs, addressed panels, search/log filters, settings category, and line focus. Runtime content, drafts, jobs, terminals, and layout dimensions stay in their existing owners. |
| Sharing            | Fix current Copy Workspace Address to copy current state. File/chat/full-view copy menus, portable import, clone offers, and sharing transport are follow-ups.                                                        |

These choices give the executor a complete contract. Marker spelling and sidebar-chat addressing are concrete plan decisions, not claims about behavior already shipped. Panel-only history remains replacement; a later product review can decide whether panels deserve Back steps.

## Pre-migration implementation and defects

Paths below are relative to `apps/web/src/` unless they begin with another package.

| Owner                                                                                     | Current behavior                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx:60`, `features/address/state/storage.ts`                                        | Before React starts, `restoreAddressFromStorage()` replaces a bare `/` with `platform.address.v2`. Live query keys override matching saved keys. Explicit non-root URLs win over the saved address. |
| `state/bootstrap-runtime.ts`, `features/address/utils/cache.ts`                           | Parse the global location and seed the runtime from its workspace cache. Explicit URL fields override cached fields; omitted fields inherit. Boot tabs merge additively, retaining existing order.  |
| `features/address/hooks/use-restore.ts`                                                   | Boot and `popstate` restore environment, root, tabs, selected document/chat, panels, search, logs, and focus. Guards protect asynchronous ownership and dirty tabs.                                 |
| `features/address/hooks/use-projection.ts`                                                | Subscribe to stores, capture an address, write native history, save the last address, and separately listen to `popstate`.                                                                          |
| `features/address/state/projection.ts`                                                    | Classify a changed environment/workspace/mode/document/editor as push; other changes replace. Debounce everything for 250 ms.                                                                       |
| `features/address/utils/snapshot.ts`                                                      | Capture addressable state, duplicate the selected editor in tabs, and apply URL budgets. Live output already omits many defaults.                                                                   |
| `features/chat/hooks/use-active-chat-session-id.ts`                                       | Keep sidebar conversation selection in component-local state, absent from URL and workspace address persistence.                                                                                    |
| `features/chat-mode/hooks/use-reveal-opened-editors.ts`                                   | Observe selected-editor changes and reveal the editor tool, which can overwrite a restored tool selection.                                                                                          |
| `keymap/workspace-commands.ts`                                                            | Mutate navigation stores, call native Back/Forward, and copy the current address bar, which can lag store state.                                                                                    |
| `packages/client-core/src/address/grammar.ts`, `apps/tui/src/navigation/utils/address.ts` | Share URL parsing/formatting between clients. Router is not installed today.                                                                                                                        |

The current navigation identity in `features/address/state/projection.ts` is:

```ts
;[
  address.environmentId,
  address.rejectedEnvironment,
  address.workspace,
  address.mode,
  address.document,
  address.editor,
]
```

The current defects to remove through this migration are:

- A → B → Back A can leave the saved address at B. Only native writes persist it; adopting an already canonical traversal performs no write.
- `projection.adopt()` does not cancel a scheduled write. An actual-code probe reproduced a queued A query being pushed after adopting B. Successful restoration often masks this controller defect.
- The shared 250 ms timer can collapse rapid deliberate destinations.
- Applying tabs `[c,b,a]` over open `[a,b,c]` leaves the original order. A present traversal list closes clean representable extras, but does not reorder survivors.
- Omitted chat rail/tool/diff fields do not reset as consistently as side/bottom/search/log fields.
- The selected editor appears twice, and hand-edited empty/default fields can survive generic serialization.

The precedence rule is therefore reason-dependent, not simply "URL wins." Preserve the intentional startup merge while fixing traversal and persistence.

## Ownership and public interface

Use this direction of authority:

```text
user command or Link → typed Router destination → accepted-route application
                                                       ↓
                                              retained application runtime

text/filter/panel edit → typed Router replacement → apply addressed view fields

browser Back/Forward → Router subscription → the same application boundary
```

Router owns addressable destinations and URL view state. Existing stores own document contents, unsaved buffers, execution, transports, and the applied view needed by existing renderers. Addressable active-selection fields become projections of the accepted route, not independent navigation sources. Unaddressable documents retain the narrow transient-selection behavior specified below. Local input drafts may remain for responsive editing, but traversal resets them from the route. Search execution debouncing is separate from URL replacement.

Caller usage should stay small and domain-specific:

```ts
await navigation.openFile({ owner, path, focus })
await navigation.openChat({ owner, sessionId, surface: 'main' })
await navigation.openChat({ owner, sessionId, surface: 'sidebar' })
navigation.setSearchQuery(query) // replace
navigation.setSidePanel('chat') // replace
```

These are intended signatures, to compile in step 1. Keep meaningful domain actions that resolve ownership, dirty-tab decisions, or asynchronous work. Do not build a second generic router accepting arbitrary URL strings. Simple links may use typed `Link` directly; application subscribes to all accepted routes regardless of producer.

For a file destination, the domain action should produce supported typed Router options such as:

```ts
router.navigate({
  to: '/~{$workspace}/workbench/f/$',
  params: { workspace: workspaceToken, _splat: relativePath },
  search: searchForView(nextView),
  replace: false,
  resetScroll: false,
})
```

Register the completed router type. Do not erase it with `AnyRouter`, `any`, casts on navigation options, or an untyped `href` wrapper. `_splat` takes a decoded domain path; a raw encoded token needs the codec adapter first. Type tests must verify this example against the installed release, including the prefixed-param syntax. [Typed navigation](https://tanstack.com/router/latest/docs/guide/navigation), [registration](https://tanstack.com/router/latest/docs/guide/type-safety)

Use two distinct models:

- `AddressIntent`: sparse validated incoming address, including explicit presence. Absent tabs differ from an empty collection. Malformed optional fields are isolated without destroying a valid destination.
- `WorkspaceView`: complete reusable addressed view before wire compression and size limits. Use discriminated editor/chat references and readonly ordered collections, with no `@` markers, absolute root path, or environment transport object in the serialized view.

Resolve local workspace/environment ownership separately from the relative view. Retain existing `SessionId`, `EnvironmentId`, and document identities at domain boundaries. Resource existence and session ownership still require the server; compile-time navigation types cannot prove them. Main chat uses the session's owning worktree. Sidebar chat accepts sessions in the same environment/project while retaining the editor's addressed worktree, matching today's project-wide sidebar list.

### Module map

Create only modules that acquire real consumers. Names are relative to `apps/web/src/`:

| Module                                                                                  | Responsibility                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state/router.ts`                                                                       | Construct/register one Router and its history; accept an injectable history for focused tests.                                                                                                    |
| `state/routes/root.ts`, `workspace.ts`, `workbench.ts`, `chat.ts`                       | Concrete code-based route tree, parent relationships, typed params/search, read-only preparation. Preserve literal types through shared local/remote declarations.                                |
| `state/navigation.ts`                                                                   | Application-level domain commands and accepted-route coordinator. Own application generations, completion, and successful-address persistence. Feature knowledge belongs at this app layer.       |
| `providers/navigation-context.ts`, `navigation-provider.tsx`, `hooks/use-navigation.ts` | Narrow React access and lifecycle wiring. One provider and one hook per file.                                                                                                                     |
| `features/address/utils/intent.ts`, `view.ts`, `route-options.ts`                       | Pure validation/models/transforms for intent and view. The route adapter supplies typed options and custom query serialization; avoid runtime import cycles with router registration.             |
| `features/address/state/apply-view.ts`                                                  | Domain restore logic extracted from `use-restore.ts`, accepting validated input and explicit runtime ownership instead of reading global location. Split by substantive responsibility if needed. |
| `features/address/state/storage.ts`                                                     | Pure initial-address selection plus storage boundary; no native navigation.                                                                                                                       |
| `packages/client-core/src/address/*`                                                    | Shared wire rules and framework-neutral types actually consumed by web and TUI. Shared domain-independent models belong here when both need them.                                                 |

Keep capture that reads stores in the state owner. Pure `utils/snapshot.ts` transforms can remain or become `view.ts`; do not move mutable subscriptions into `utils/`. Do not put feature-importing navigation code in `lib/`. No new feature barrels. Runtime apply actions must be inaccessible through ordinary UI navigation exports; migrate callers and remove the old public bypass APIs together.

### Startup and accepted-route lifecycle

1. Capture the incoming raw URL. For bare `/`, choose the saved address with live query overrides using a pure helper. Explicit non-root input bypasses last-address restoration. Preserve raw explicit fields in the initial `AddressIntent`.
2. Create TanStack browser history once. If initial selection changes the href, replace through that supported history instance and call its supported `flush()` before Router creation and before bootstrap seeds stores. Browser history queues native writes, so logical history may otherwise precede `window.location`. Remove the native startup write. The desktop shell already serves an HTTP `WEB_URL`; retain browser history there.
3. Pass the selected initial intent into `createBootRuntime` instead of independently parsing `window.location`. Keep cached workspace seeding available before live responses. Observe Router location changes before initial loading; attach the retained `ApplicationRuntime` when available and consume the current resolved match if initial resolution preceded attachment.
4. Route preparation may validate or fetch without mutating current workspace/session state. Disable preload initially where preparation cannot be read-only. Do not activate environments, open tabs, or start work in loaders or `beforeLoad`. Restrict `loaderDeps` to actual resource requirements, not every search field. [Data loading](https://tanstack.com/router/latest/docs/guide/data-loading)
5. On navigation start, supersede the previous application operation. On a successfully resolved location, apply its typed match/search/hash through one generation-scoped owner. Guard every asynchronous continuation and use existing environment/root operation ownership; Router cancellation does not roll back store writes.
6. Apply each committed view edit even when resource data is cached. Replacing a filter must not reopen the workspace. Successful route application persists the reached canonical address, including Back/Forward with no URL rewrite. Default removal and normalized workspace spelling use Router replacement, never a feedback push.
7. Make application status explicit: pending, applied, or unavailable for the current location. A bad environment/root/session remains an unavailable addressed destination; it must not silently open a different recent workspace. Handle rejected required params, loaders, and not-found matches as well as successful matches: clear pending status and settle the request as unavailable while retaining runtime resources and the previous successful address. Recent-root fallback runs only for genuinely unspecified startup. Do not persist unavailable or superseded locations as successful last addresses.
8. Keep `ApplicationBootstrap` and `ApplicationRuntime` above changing route leaves. Preserve the existing environment-keyed QueryClient/provider boundary in `active-environment-application.tsx`; do not broaden remounts to file, chat, or search changes. Pending/error UI lives inside the stable shell.

Use supported Router events such as `onBeforeNavigate` and `onResolved`, with history identity and application generations to reject stale work. Account for browser location changing before a later lifecycle callback. Subscribers return `void`; Router does not await asynchronous application inside them. Therefore `await router.navigate()` is not proof that the editor runtime has applied the destination. Domain commands must register a request before calling Router and return their own `Promise<applied | unavailable | superseded>` associated with the requested location/operation. Catch errors from subscription-launched work and settle every request, including superseded or unavailable requests. Already-current destinations must complete without waiting for an event that may never fire. Do not add another destination store to implement this completion protocol. [Router events](https://tanstack.com/router/latest/docs/guide/router-events)

The same coordinator observes supported history action notifications to distinguish push/replace from Back/Forward, and records initial boot separately. No native `popstate` listener is needed. On application retry/replacement or unmount, unsubscribe, abort application, and settle outstanding requests as superseded. Guard with both application identity and navigation generation so old work cannot attach to a newly created runtime.

TanStack browser history also batches writes within a task. Flush a completed destination through the supported history API before reporting application completion, so multiple completed selections cannot collapse into one native entry. Prove this against the installed version in the browser; memory history alone does not cover it. [Official browser history implementation](https://github.com/TanStack/router/blob/main/packages/history/src/index.ts)

## Route and URL contract

Declare a `/` startup route plus workspace roots and mode roots. Use `/~{$workspace}` locally and `/@{$environmentId}/~{$workspace}` remotely. Folderless state uses the existing `~-` workspace token. Keep explicit local and remote branches; do not assume an optional prefixed parameter removes the entire `@` segment. [Path params](https://tanstack.com/router/latest/docs/guide/path-params), [code-based routes](https://tanstack.com/router/latest/docs/routing/code-based-routing)

Under each workspace branch, register these concrete families. `$name` denotes a typed param and `$` a file-path splat:

| Suffix                                                                  | Meaning and validation                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/workbench`                                                            | Workbench without a selected addressed editor.                                                                                                    |
| `/workbench/settings`                                                   | Settings document; allowed without a root.                                                                                                        |
| `/workbench/s`                                                          | Search document for this workspace.                                                                                                               |
| `/workbench/f/$`                                                        | Relative file path.                                                                                                                               |
| `/workbench/c/$`                                                        | Compare with saved file.                                                                                                                          |
| `/workbench/r/$ref/$`                                                   | Git ref and relative path; preserve encoded slashes within the ref.                                                                               |
| `/workbench/d/$source/$revision/$`                                      | Snapshot diff, revision extras and path. Validate supported sources and 40–64 hex object IDs; preserve explicit unavailable branch-diff behavior. |
| `/workbench/k/$sessionId/$turns` and `/workbench/k/$sessionId/$turns/$` | Session/turn/file checkpoint. Preserve range extras, `!turn`, rename metadata, and file-scope distinction.                                        |
| `/chat`                                                                 | Chat mode with inherited selection on partial boot or its defined empty state.                                                                    |
| `/chat/t/new`                                                           | Static draft destination, never parsed as a session ID.                                                                                           |
| `/chat/t/$sessionId`                                                    | Validated existing session identity, followed by live worktree-membership checks.                                                                 |

Workspace root alone remains a partial startup link. Unknown route families produce an unavailable/not-found state. Do not hide all these kinds behind an opaque document catch-all. Do not tighten existing valid domain values accidentally: diff scope is `wt` or an opaque `TurnId`, not a guessed `turn-` prefix.

Attach typed sparse search schemas for tabs, `editor`, sidebar conversation, side/bottom/tool/rail/diff, settings, `s.*`, `log.*`, and the existing bounded development passthrough. `editor` and conversation query tokens must decode into discriminated references, not unrestricted strings reaching stores. Parse line/column/range hash through the same view boundary. Invalid optional fields should be dropped independently and canonicalized; invalid destination/ownership gets unavailable UI.

Use Valibot directly through Standard Schema, without adding a schema adapter. Use supported search middleware for default omission where it preserves sparse startup intent. Supply custom `parseSearch`/`stringifySearch` for the readable existing grammar; Router's default JSON query representation would change it. Separate typed decoded search values from raw wire fields. [Search validation](https://tanstack.com/router/latest/docs/guide/search-params), [custom serialization](https://tanstack.com/router/latest/docs/guide/custom-search-param-serialization)

### Tabs, defaults, and boot precedence

```text
/~platform.<id>/workbench/f/b.ts?tabs=f/a.ts~@~f/c.ts
/~platform.<id>/chat/t/<session>?tabs=f/a.ts~@~f/c.ts&editor=f/b.ts
/~platform.<id>/workbench/f/b.ts?tabs=@&side=chat&chat=t/<session>
```

The selected editor supplies the marker target: the workbench path or chat `editor` field. Expand/compress only at the wire boundary. A file called `@` still uses an `f/...` token. Split raw `~` delimiters before decoding; prove percent signs, spaces, Unicode, `@`, `~`, and encoded `/` survive without double encoding. Keep raw document tokens distinct from decoded Router params.

| Input                                                                   | Boot from remembered state                                                                     | Back/Forward                                                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Absent tabs                                                             | Leave remembered tabs unspecified by link.                                                     | Leave collection unspecified; selection still applies.                                                                                      |
| Nonempty valid tabs                                                     | Keep cached order, append missing addressed tabs, apply explicit selection.                    | Addressed tabs in exact URL order, then dirty/unaddressable extras in their existing relative order. Close only clean representable extras. |
| `tabs=-` with no selected editor                                        | Retain remembered tabs under additive boot.                                                    | Close clean representable tabs; retain protected extras.                                                                                    |
| Empty list plus selected editor                                         | Reject the contradictory collection, preserve destination, close nothing because of that list. | Same.                                                                                                                                       |
| Nonempty list missing selected editor                                   | Append selected editor deterministically before validating limits.                             | Same, then use the resulting addressed order.                                                                                               |
| Duplicate/unresolvable `@`, mixed `-` and tokens, or invalid collection | Reject the collection, preserve independently valid destination.                               | Same; never interpret malformed input as a request to close tabs.                                                                           |

Normalize empty owned params to absence and omit static defaults, including file-tree side, terminal bottom, Git tool, and active rail. Retain `side=chat`. Resolve log defaults from the effective setting. During boot, explicit defaults such as `side=files` override a cached nondefault before canonical omission. During traversal, absent owned fields reset consistently, including tool/rail/diff, empty filters, and sidebar conversation. Define absent sidebar selection as automatic/default selection, without carrying a stale selected conversation from a later entry.

Sidebar selection remains independent of the remembered full chat-mode session. An incoming valid `chat=t/...` implies opening the sidebar chat panel; canonical output emits `side=chat` with it. If explicit `side` selects another panel, that explicit panel wins and the inactive `chat` query is removed. Opening the sidebar alone replaces; selecting a conversation pushes. Validate a sidebar session against the same environment/project, even when it belongs to another worktree, and keep the editor root fixed. Main-chat selection still opens the session's worktree. Keep composer text/draft generation outside this URL-owned selection.

Capture the complete view before budgets. Preserve current limits of 4000 URL characters, 1500 tab-field characters, and 64 tabs. The existing budget fallback drops search, then logs, then the entire tab collection. Never partially trim tabs and interpret the remainder as exact. Budget omission means unspecified, not empty. If the destination itself exceeds a limit, preserve its current fallback policy explicitly and report it in the focused budget tests. Budgeting must not mutate the complete in-memory view or feed omitted fields back as an instruction to erase the user's current filters/tabs during the same navigation. Restoration of a later lossy URL remains bounded by what that URL contains.

Implement that distinction with an operation-scoped command payload containing the complete view and the codec's omission result. Apply it only to its originating accepted destination, including when two different oversized edits serialize to the same href and Router emits no new event. Discard the payload on completion, traversal, supersession, or runtime disposal. Incoming links and browser traversal use decoded intent alone. This payload is neither a durable second view store nor hidden history data. Test successive over-budget queries with the same href, then revisit that URL and apply normal omission rules.

### Transient editor selection

Conflict documents and intentionally outside-root documents are unaddressable today. Keep them selectable through the navigation owner as local transient selections over the last addressable route. They add no URL/history entry and never serialize their contents or absolute path. The existing editor runtime owns the transient selection; do not invent a view ID or a parallel navigation stack. Capture its addressable editor from the accepted route instead of turning the transient tab into a new empty-document URL. A same-destination filter/panel edit preserves it, while a deliberate addressable destination or browser traversal resumes route-controlled selection. Even clicking the already-addressed file must clear the transient selection and apply that file before returning success. Transient requests use the same operation ownership so an older pending application cannot overwrite the user's selection.

This is the explicit exception to route-derived editor selection. Addressable files/chats still create history steps; transient tab selection is not promised to survive reload, copying, or history traversal. Copy captures only the addressable view and retains omission reporting. Where an ordinary external file has a resolvable workspace, normal open-file navigation may resolve that owner and use its typed route instead. Test selecting a retained conflict tab, editing a panel, then selecting the addressed file and traversing history without losing the conflict buffer.

## History contract and caller migration

| Operation                                                                   | History result                                                                                                                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select/open a different file, full chat, or sidebar conversation            | Push one complete destination immediately.                                                                                                                                    |
| Switch workspace, environment, or UI mode                                   | Push one complete destination. Resolve a main-chat session's owner before building the route, with no new-root/old-session entry. Sidebar selection retains the current root. |
| Close selected tab and choose its successor; reopen closed editor           | Preserve destination behavior: push the successor/reopened destination. Dirty-close confirmation remains owned by existing editor logic.                                      |
| Close inactive tab, reorder/move tabs, edit text/filter/settings/focus      | Replace. Same-file definition/line changes replace; different-file definitions push.                                                                                          |
| Switch side/bottom/tool/rail/diff panels                                    | Replace, preserving current panel history semantics.                                                                                                                          |
| Create a real session from its draft                                        | Replace the draft URL with the new session, preserving composer ownership and avoiding a dead draft Back step.                                                                |
| Archive/delete selected session; rename/delete selected resource externally | Replace with the domain-selected successor, renamed target, or explicit unavailable state. No passive store observer decides navigation.                                      |
| Startup/default normalization/Back/Forward                                  | Replace only if canonicalization is necessary. Traversal itself never pushes; persist successful reached view even without a write.                                           |
| Select already-current destination                                          | No duplicate history entry; still apply changed over-budget fields or clear a transient editor selection before returning completed status.                                   |

Removing URL debounce leaves no application timer to flush on pagehide. TanStack still owns its microtask write queue; use supported `history.flush()` at startup, completed-destination, and pagehide boundaries as needed by the installed version. Preserve existing search execution scheduling. If replacement frequency later proves expensive, add optional debounce only to replacements, with ownership guards and explicit flush-on-user-navigation/discard-on-traversal tests. Every pause must still replace. Do not retain the current timer as a shortcut.

Migrate these producer groups during the cutover. The list includes direct and indirect writers; trace importers of the named command seams again at implementation time.

| Group                  | Files and required action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap/runtime      | `main.tsx`, `state/{bootstrap-runtime,application-runtime}.ts`, `components/{application-bootstrap,active-environment-application,app-runtime-content}.tsx`, `features/editor/state/runtime.ts`, `features/workspace/hooks/use-cache-persistence.ts`, `features/address/utils/cache.ts`. One initial intent, retained runtime lifetime, one application owner.                                                                                                                                                                                                                                                                     |
| Workspace/environment  | `components/{app-workspace,workspace-project-menu,machine-picker-dialog}.tsx`, `state/{project-picker,environment-connections}.ts`, `features/workbench/hooks/use-titlebar-menu.ts`, `features/workspace/hooks/{use-open-root,use-restore-recent-root,use-validate-root-folder}.ts`, `features/workspace/state/{open-root,open-generation}.ts`. Preserve owner capture and supersede checks. Recent root uses coordinator status instead of a global claim.                                                                                                                                                                        |
| Editor command seam    | `features/editor/state/commands.ts`, `providers/tab-actions-provider.tsx`, `hooks/{use-editor-tab-actions,use-dirty-tab-close,use-diff-language}` under that feature. Split deliberate navigation from apply-only tab/document operations. Include `openFileSurface`, `selectFile`, `selectTab`, definitions, settings/search, previous/reopen, close/discard, rename, reorder, move/split.                                                                                                                                                                                                                                        |
| File-opening consumers | `features/workspace/components/{tree-pane,search-results,search-controls}.tsx`, hooks `{use-row-menu,use-fs-actions,use-events}.ts`, `state/event-conflict-adapter.ts`; `features/workbench/hooks/use-editor-tab-menu.ts`, components `{editor-tab-button,editor-tab-bar,editor-surface-tab-body,diagnostics-panel}.tsx`; Git hooks `{use-open-file-at-ref,use-open-diff-document,use-file-menu,use-commit-action}.ts`; chat hooks `{use-open-file-reference,use-open-checkpoint-diff-document}.ts`; `features/search/utils/open-match.ts`; file/editor rows and content in `features/command-palette/`. Prefetch stays read-only. |
| Main chat              | `features/chat-mode/state/session-commands.ts`, `providers/session-controller.tsx`, components `{chat-stage,session-row,session-rail,session-missing-state}.tsx`, hooks `{use-project-menu,use-session-menu,use-session-actions,use-project-actions}.ts`; session/project rows and `providers/actions-context.ts` in command palette. Include direct session creation, archive/delete successor, draft, previous/next/jump. Remove `setSessionProjectOpener` after the domain navigation owner resolves projects.                                                                                                                  |
| Sidebar chat           | `features/chat/hooks/use-active-chat-session-id.ts`, components `{side-panel-content,chat-panel-header}.tsx`; separate address-owned selection from composer/session execution.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Mode and panels        | `components/ui-mode-toggle.tsx`; workbench components `{sidebar-panel,bottom-panel,editor-surface-layout-view}.tsx` and `hooks/use-pane-header-menu.ts`; chat-mode components `{surface-view,layout,tool-rail,session-rail}.tsx`; chat `hooks/use-session-diff-scope.ts`. Fold editor-tool reveal into deliberate file navigation and delete `use-reveal-opened-editors.ts`. Keep unaddressed rail filters and geometry local.                                                                                                                                                                                                     |
| Filters and settings   | `features/search/hooks/use-buffer-inputs.ts` and its buffer-state owner, including query-history previous/next; `features/logs/components/panel.tsx` and filter store; `features/settings/components/page.tsx` and category store. User input calls typed replacement, applied-state writes do not project back.                                                                                                                                                                                                                                                                                                                   |
| Command bus and tools  | `keymap/workspace-commands.ts`, `providers/{command-provider.tsx,command-context.ts}`, `define-command.ts`, `state/runtime.ts` under keymap as needed. Back/Forward use Router history; Copy uses current view. Migrate editor-open benchmark selection or mark a genuine apply-only test boundary; production benchmark navigation must exercise the same route path.                                                                                                                                                                                                                                                             |

Keep existing runtime setters only as narrowly exposed apply actions for the coordinator, resource reconciliation, and real fixture construction. Do not leave a general UI escape hatch that mutates active route fields. Preserve operation context for commands that started in environment A and settle after B becomes active.

## Implementation steps and gates

Complete each verification gate before declaring its unit done. Preparatory modules may exist unmounted until the cutover; do not mount Router alongside the old native writer. Source scope is the modules above, their direct navigation callers and focused tests, `apps/web/package.json`, `bun.lock`, required package exports, and the TUI address adapter/tests. No server identity/storage redesign, sharing backend, clone execution, native Swift routing, or unrelated checkpoint/UI refactor.

### 1. Compile the route and view contracts

- First run `git status --short` and `git diff --stat eb926925..HEAD -- apps/web/src apps/web/package.json apps/web/test apps/web/scripts packages/client-core/src/address packages/client-core/package.json apps/tui/src/navigation bun.lock`. Reconcile changed navigation/bootstrap assumptions without overwriting unrelated work.
- In `apps/web`, run `bun add @tanstack/react-router`. Record the installed stable version in the verification notes. Use existing Valibot; do not add TanStack Start, a router plugin, SSR, or an extra history package unless the installed Router's supported exports require it.
- Build the complete code-based tree and the intent/view/route adapters with memory-history injection, before mounting them. Implement every route family and the shared tab/default codec now, so boot and navigation share one representation.
- Add `features/address/tests/router.test.ts` for real route matching and codec integration, and `navigation.types.ts` for positive inference plus `@ts-expect-error` negative calls. Reject nonexistent route, missing session parameter, invalid sidebar/search values, and invalid local/remote call shapes. Keep tests free of type-erasing casts.
- Update existing grammar/document/session/selection/budget tests and TUI address constructors. Remove obsolete empty/default round-trip expectations; no compatibility aliases or migration layer.

Verify from `apps/web`:

```sh
bun run typecheck
bun --bun vitest run --project node src/features/address/tests/router.test.ts src/features/address/tests/grammar.test.ts src/features/address/tests/document-token.test.ts src/features/address/tests/session-token.test.ts src/features/address/tests/selection.test.ts src/features/address/tests/url-budget.test.ts src/features/address/tests/search-params.test.ts
```

Verify from `packages/client-core`: `bun run typecheck`.
Verify from `apps/tui`: `bun run typecheck` and `bun --bun vitest run src/navigation/tests/address.test.ts`.
Expected: valid routes infer params/search, negative type checks are exercised, and all focused round-trip checks pass. Package-runtime tests, if added, use plain Vitest without `--bun`.

### 2. Cut over startup, application, and every producer together

- Wire the startup/lifecycle design above, with one Router/history instance and one accepted-route application owner.
- Extract substantive restore logic, preserving dirty-tab and retained-environment protections. Implement reason-aware additive boot, traversal order/defaults, successful-address persistence, and unavailable status.
- Migrate every producer group and its command completion. Route resource-reconciliation changes explicitly with replace. Include both chat surfaces and remove the editor-tool observer. Make Copy Workspace Address build a link from the current complete view and the typed route builder, including current edits, origin/base path, and development-param removal.
- Delete `features/address/state/projection.ts`, `hooks/use-projection.ts`, `hooks/use-restore.ts`, and `state/root-claim.ts` after their live responsibilities move. Remove their mounts, timers, native writes/listeners, `restoreAddressFromStorage`, and `setSessionProjectOpener`. Retain pure codec/domain helpers that still have consumers.
- Replace `projection.test.ts` with `navigation.test.tsx` covering real coordinator/store integration. Adapt `edges.test.tsx`, `environment-restore.test.tsx`, `shared-link.test.tsx`, and storage tests to the new owner. Update `apps/web/test/address.tsx` and `test/render.tsx` to mirror the actual provider stack with Router memory history. Do not preserve tests asserting the old bugs.

Verify from `apps/web`:

```sh
bun run typecheck
bun --bun vitest run --project node src/features/address/tests/storage.test.ts src/features/address/tests/router.test.ts
bun --bun vitest run --project dom src/features/address/tests/navigation.test.tsx src/features/address/tests/edges.test.tsx src/features/address/tests/environment-restore.test.tsx src/features/address/tests/shared-link.test.tsx
```

Expected: all focused checks pass, including the matrix below. Use `apps/web/test/fixtures.ts`, real stores, and the real in-process Elysia server. No mocks of our modules or socket to our own server from node/dom tests. Observe the completion protocol separately from `router.navigate()`.

| Required check                                                                                                            | Failure it catches                                                                         |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Boot bare/explicit links, same/different cached workspace, explicit defaults, no workspace, rejected environment          | Wrong precedence, early normalization, recent-root race.                                   |
| File/chat/local/remote route apply, stale owner continuation, A → B → A with dirty buffers                                | Wrong-workspace writes, lost retained runtime, application resolved too early.             |
| Read-only preload, cached loader with changed search, already-current command                                             | Navigation caused by preload, dropped view edit, hanging completion.                       |
| Rejected required param/loader, retry or unmount during application                                                       | Requests never settling, stale application attached to a replacement runtime.              |
| Exact traversal order, additive boot, absent/empty/malformed/oversized tabs, protected extras                             | Reordered or closed unsaved work, lossy links treated as exact.                            |
| Select retained conflict tab, edit a panel, return to addressed file                                                      | Protected tabs preserved but unusable; transient selection swallowing a no-op navigation.  |
| Main/sidebar chat steps, cross-worktree sidebar session with fixed editor root, draft promotion, archive/delete successor | Chat surfaces bypassing Router or applying main-chat ownership rules to sidebar selection. |
| Paused `hello`, rapid deliberate destinations, pending async apply followed by Back                                       | Extra typing entries, missing destinations, stale apply after traversal.                   |
| Different oversized filters serialize to the same href; later traversal to that href                                      | Lost input/search execution without a route event, budget-induced feedback loop.           |
| Nondefault panels/filters followed by omitted defaults                                                                    | Later state leaking backward, tool observer undoing restoration.                           |
| A → B → Back A, then bare startup; unavailable destination; copy immediately after selection                              | Stale persistence, invalid last-view cache, copied stale address.                          |

### 3. Prove the browser stack and remove bypasses

Add `apps/web/scripts/verify-workspace-navigation.mjs`, a standalone Playwright script that connects to the already-running app. Use plain Node, with explicit `--app-url`, `--server-url`, optional second configured environment, and `--output-dir` under `/work/tmp`. Follow existing script conventions without starting a server. Use an isolated browser context and a disposable workspace on `/work`, registered through real routes. Create metadata-only fixture sessions with the real `session.create` command targeting the registered current worktree and an available model selection; never send `session.turn.start`. `apps/server/src/orchestration/decider.ts` emits session metadata without invoking a provider. The normal server does not register the mock driver; keep `MockProviderAdapter` for in-process tests. Clean up only IDs created by the script. Do not mutate the user's project or stop running work.

Do not use `vitest.browser.config.ts` for this proof: its current `browser-file-server.ts` global setup spawns another server. Reuse the existing app and server, confirm their environment descriptor matches, and report missing prerequisites instead of silently testing a different instance.

Run from `apps/web`, substituting the discovered running endpoints:

```sh
node scripts/verify-workspace-navigation.mjs --app-url <running-web-url> --server-url <running-server-url> --output-dir /work/tmp/platform-router-verification
```

Expected: script exits 0 and writes the reached URLs, UI assertions, and failure screenshots for these real browser sequences:

1. File A → B → main chat C, Back twice, Forward twice. Verify the visible selected destination at each step.
2. Repeat with completed selections less than 250 ms apart. No deliberate destination disappears.
3. Type `hello` with pauses into addressed search and log fields. One Back reaches the previous destination, never a text prefix. Also exercise sustained input on supported browser targets to catch native history-rate limits or dropped final replacements.
4. Begin a delayed resource application and traverse Back. Late completion cannot reselect the abandoned destination or truncate Forward.
5. Reorder tabs, navigate, traverse, and reload. Verify traversal order and protected dirty tabs; verify additive boot separately.
6. Back to A, close the isolated page, open bare `/` in the same context. A is restored.
7. Switch panels without adding a history step; select sidebar conversations with steps. Verify main and sidebar selections stay independent.
8. Copy immediately after a selection/edit and open that URL. Verify the copied destination/view fields and dev-param stripping.
9. With two existing configured environments, A → B → A retains dirty documents and operation ownership. The focused in-process test is mandatory even if a second live environment is unavailable; record the live case as unverified, not passed.

From repository root, these scans must return no production matches:

```sh
rg -n 'history\.(pushState|replaceState)|addEventListener\(.popstate' apps/web/src --glob '!**/tests/**'
rg -n 'useAddressProjection|useAddressRestore|createAddressProjection|restoreAddressFromStorage|setSessionProjectOpener|useRevealOpenedEditors' apps/web/src
```

Also inspect imports and direct setters for every producer group above. Confirm ordinary UI callers cannot invoke apply-only active selection APIs. Test-only memory history and read-only diagnostic `window.location` inspection are allowed; native production address writes/listeners are not. Do not weaken the scans by renaming the old writer.

Run focused lint/format checks on changed files, `git diff --check`, and the affected web/client-core/TUI typechecks. From repository root use `bun x oxlint <changed-source-paths>` and `bun x oxfmt --check <changed-paths>`; do not run a repository-wide test suite. Re-run a focused test only after a relevant change or unresolved failure. Record pre-existing failures separately from new failures.

## Sharing design and deferred decisions

The URL's workspace ID resolves to a canonical directory on one server. An independent installation cannot resolve it merely from the URL. Preserve that local identity instead of presenting it as portable.

`packages/contracts/src/chat-model.ts` already defines `RepositoryIdentity`, used by server registration. Reuse it when portable opening is built. A normalized Git remote host/path can match repositories but is not a clone URL. A root commit supplies ancestry without a download source. A local path identity and the current path-dependent `WorktreeId` remain local.

Keep the view reusable for the future flow:

```text
portable project description + relative file/chat/view request
    → match local checkout or offer clone
    → resolve local environment/workspace identity
    → apply the same validated view through Router
```

Do not add unused sharing fields, inert settings, or a second portable-project identity now. Future work must choose clone source, branch versus pinned revision, worktree/subdirectory, and missing/imported chat behavior. Cloning a repo does not recreate conversations.

The later copy menu should offer file, chat, and whole workspace view. File/chat links are partial. A complete-view link needs explicit scope so omitted fields mean defaults even on boot; do not infer that scope from tabs. Preserve additive boot now and defer the exact scope spelling. A whole-view export must disclose budget omissions or use a chosen transport; it cannot silently call a truncated URL complete. No hidden history tab payload, stored `viewId`, sharing backend, or clone execution is part of this migration.

## Completion and limits

Done requires:

- [x] Registered concrete route families and compile-negative checks pass without type-erasing navigation casts.
- [x] All listed navigation producers use Router; the native controller/hooks/claim and obsolete APIs are deleted.
- [x] Boot precedence, default omission, ordered tabs, sidebar chat, command completion, retained environments, and reached-address persistence pass focused tests.
- [x] The real browser history/copy sequences pass against the running app. Any unavailable second-environment live proof is explicitly recorded as remaining verification.
- [x] Web/client-core/TUI interoperability checks, focused lint/format, and `git diff --check` pass or only documented pre-existing unrelated failures remain.
- [x] Only scoped files changed; no compatibility shims, sharing backend, hidden view store, or unrelated runtime redesign was introduced.
- [x] Verification evidence and remaining limits are recorded in this plan before updating its index status. Follow repository policy to retire completed executable plans when the work is accepted.

Resolve routine path/API drift autonomously and update this plan when the evidence supports the same contract. Stop the dependent portion and report if the installed Router cannot preserve raw token round-trips with typed routes, if safe traversal would require discarding dirty buffers, or if ownership cannot be maintained without changing server identity semantics. Keep making independent progress. If the running app is unavailable, finish type/unit/in-process verification and report the missing live gate; never launch another dev server to bypass it.

Audit limits: source tracing and actual-code probes established the current defects. Prior focused projection/storage/edge suites passed; they do not prove actual browser Forward history. No Router prototype has been compiled and no dependency installed during planning. Step 1 proves the supported APIs against the installed version. This document makes no measured bundle-size, startup-speed, or net-line-count claim.

## Implementation and verification record — 2026-09-11

The installed Router is `@tanstack/react-router@1.170.35`, with `@tanstack/router-core@1.171.29`
and `@tanstack/history@1.162.3`. The implementation uses its supported
history, route builders, events, and path rewrite API. No Router plugin, SSR, or extra history
package was added.

The live module boundaries are:

- `state/router.ts` and `state/routes/*` register concrete local and remote route families.
  `features/address/utils/route-options.ts` validates decoded params/search and preserves readable
  encoded tokens, including the `/platform/` deployment base path.
- `state/navigation.ts` exposes domain actions. `navigation-coordinator.ts` owns application
  completion, cancellation, accepted-route subscriptions, history flushes, and reached-address
  persistence. `navigation-capture.ts` reads the applied runtime; it has no store subscriptions.
  The complete `WorkspaceView` payload exists only for an in-flight command and can exceed URL budgets.
- `features/address/state/apply-view*.ts` applies the accepted view to retained runtimes. Boot
  merges tabs additively; traversal restores addressed order and defaults while retaining dirty
  and unaddressable tabs. Main chat selects its worktree; sidebar chat keeps the editor root.
- `features/editor/state/apply-actions.ts` contains the raw application actions. UI callers use
  `hooks/use-editor-commands.ts` and the navigation facade. File/diff openings, closes, modes,
  projects, chat surfaces, panels, filters, settings, and the keymap use that boundary.
- `NavigationProvider` mounts Router beside the stable application tree. `ApplicationBootstrap`
  attaches/detaches the accepted-route application owner. Startup captures explicit input before
  normalization. The old native writer, restore/projection hooks, root claim, editor reveal
  observer, session opener callback, and obsolete editor command constructor are deleted.

Focused automated evidence:

| Check                                                                                        | Result                     |
| -------------------------------------------------------------------------------------------- | -------------------------- |
| Concrete Router matching and raw-token/basepath round trips                                  | 32 tests passed            |
| Positive navigation inference and six compile-negative checks                                | Web typecheck passed       |
| Grammar, document/session tokens, selection, search, storage, URL budgets                    | 125 tests passed           |
| Navigation, edges, environment restore, shared links                                         | 33 tests passed            |
| Dirty close and command-palette execution                                                    | 10 tests passed together   |
| Settings command through the application/navigation runtime                                  | Passed                     |
| Chat/project actions, apply-view, ownership/cancellation audit; empty-root sidebar promotion | 30 tests passed            |
| Provider/disposal lifecycle, command UI, and empty-root removal                              | 35 focused tests passed    |
| Search effective filters, local drafts, navigation, boot, traversal, and budgets             | 34 focused tests passed    |
| Primary SSH-config picker after removing the connection navigation bypass                    | Passed                     |
| Shared client-core and TUI typechecks; TUI address interoperability                          | Passed; 8 TUI tests passed |

The environment test uses two real in-process Elysia servers and retained application runtimes.
It proves A → B → A preserves the dirty document object and text, isolates matching session IDs,
supersedes a stale owner, and preserves Forward. Lifecycle cases cover cleanup before first apply,
reattachment after Router advances, an older attachment's cleanup running after a new attach,
and commands issued after disposal. Test-provider ownership also passes with and without
StrictMode effect replay.

The standalone `apps/web/scripts/verify-workspace-navigation.mjs` reuses the running app at
`https://omarchy.mesh.shaulavo.dev/platform/` and server at
`https://omarchy.mesh.shaulavo.dev/platform-api/`. It checks their identity, creates disposable
Git workspaces and metadata-only sessions, and deletes only its own fixtures. It never starts a
server or a provider turn.

Chromium and Firefox pass the full app sequences: file/chat Back/Forward, rapid completed
selections, paused and sustained search/log replacements, delayed file apply followed by Back,
tab reordering/traversal/reload, additive boot, persistence after Back, panel replacements,
sidebar chat history, and immediate copy. Native same-task history pushes also pass with an
explicit flush after each completed application.

The strengthened dirty-tab probe records the native Back href before application canonicalizes
it. That reached entry omits the later dirty file; the file remains selectable with its unsaved
text. The sidebar probe selects main C, returns to Workbench B, selects sidebar S, and verifies
that returning to Chat still selects C.

Evidence is under `/work/tmp/platform-router-verification/`: `chromium-final/results.json`,
`firefox-app/results.json`, `history-control-current/results.json`,
`dirty-protection/results.json`, `sidebar-independence/results.json`, and
`final-focused/results.json`. The last report verifies folderless Settings deep links, category
replacement, close, Back/Forward, and keyboard open/focus in both browsers, plus file/chat history
and delayed application followed by Back. The initial Chromium
drag probe clicked inside dnd-kit's post-drag suppression window. Its replay waits 60 ms after
mouse release; the separate rapid-navigation probe still measures selections below 250 ms.

Replay against the same running services:

```sh
cd apps/web
node scripts/verify-workspace-navigation.mjs \
  --app-url https://omarchy.mesh.shaulavo.dev/platform/ \
  --server-url https://omarchy.mesh.shaulavo.dev/platform-api/ \
  --browsers chromium,firefox \
  --output-dir /work/tmp/platform-router-verification/replay
```

Remaining live limits: WebKit cannot launch because this host lacks `libicu74`, `libxml2`, and
`libflite1`; no system packages were installed. A second configured live environment is unavailable,
so its browser case is recorded as unverified. The mandatory two-server in-process case passed.
The script's default browser list includes WebKit and reports its missing prerequisite as a
failure; selecting Chromium and Firefox does not imply WebKit passed. Keep this plan while these
live checks remain open.

The final search probe is `final-search-globs/results.json`. A control on the previous build
reproduces empty filter controls closing immediately. The fixed build passes in Chromium and
Firefox: blank controls stay open, globs change actual results, hiding them removes effective
URL filters, and traversal preserves hidden drafts without reactivating them. Search options
also apply before a search buffer exists. URLs contain effective search data; disabled glob
drafts and replacement text remain local.

The final web build and typecheck pass (`final-search-build.log`, asset `index-UJWeHpzF.js`).
The existing preview serves those assets. The build uses the existing `/platform/` base and mesh
API endpoint; no dev server was started. Changed-source formatting and lint pass across 141 files,
and `git diff --check` passes. The two required native-history/obsolete-controller scans return
no production matches. A navigation import audit found no type-erasing Router casts or UI calls
to the raw editor application factory.

## Review corrections — 2026-09-11

The implementation review found twelve defects. Each now has a permanent regression covering
the reported trigger; the resource tests also cover parked workspaces and retained environments.

| Finding                                                          | Corrected behavior                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote startup parsed before environment bindings exist          | Resolve the captured intent against confirmed bindings when applying startup.                                                                      |
| A visible file click inherits a pending different workspace      | Reuse pending fields only when the visible workspace and environment match.                                                                        |
| Repeated rename/delete callbacks cancel earlier resource updates | Apply completed filesystem facts synchronously to current and parked resources; reconcile the current navigation without canceling its completion. |
| Drafts in another worktree keep the previous composer            | Include worktree identity when applying the draft selection.                                                                                       |
| A newly created session is absent from the local projection      | Fetch missing session ownership with cancellation before promoting the draft.                                                                      |
| Router default stripping changes additive boot into traversal    | Preserve the original startup intent through Router's initial normalization.                                                                       |
| Compressed tabs are expanded and budgeted twice                  | Expand the wire format once and consume the parsed collection directly.                                                                            |
| Reopen repeatedly selects the same closed file                   | Consume each successfully reopened entry from the closed-editor stack.                                                                             |
| Opening a file leaves the chat editor pane hidden                | Deliberate file, definition, and diff opens reveal the editor tool.                                                                                |
| Outside-root definitions lose their target range                 | Preserve the original definition target on transient opens.                                                                                        |
| A failed worktree prevents opening its conversation              | Keep the session selected while using an available project checkout for the editor.                                                                |
| Opening a session resets the archived rail                       | Preserve the rail filter for session selection; reset it for a new draft.                                                                          |

Resource reconciliation runs against the workspace resolved by the applier. A rename or delete
completed while Back is resolving a parked root updates that destination before its editors
apply. Changes made in a retained environment also survive a pending return without changing
the visible environment. The only queued transformations belong to the current operation;
there is no persistent resource or destination registry.

The original cancelled-resource test encoded the defect and was replaced. The shared test
client binding now updates both the RPC singleton and the retained query-client owner, clearing
data between temporary servers. This exposed and then verified dirty file/folder rename-save
through the real filesystem hooks. Two classification expectations now reflect the implemented
sidebar-chat field and explicit empty tab collection.

Verification artifacts:

- `/work/tmp/plan-086-fix-editor-before.log`, `plan-086-chat-fixes-before.log`, and
  `plan-086-resource-reconciliation-before.log` record failing controls.
- `/work/tmp/plan-086-fixes-final-tests.log` records 294 passing tests across 27 files covering
  address behavior, editor resources, filesystem hooks, environment connections, and providers.
- `/work/tmp/plan-086-fixes-final-typecheck.log` and `plan-086-fixes-final-build.log` record
  successful web typecheck and production build. The final asset is `index-Bkpol2jX.js`.
- Final lint and formatting pass across 155 changed source/configuration files. Both obsolete
  navigation scans have zero matches, and `git diff --check` passes; the corresponding
  `plan-086-fixes-final-{lint,format,audit}.log` files record these checks.
- `/work/tmp/platform-router-verification/review-fixes/results.json` records all 32 Chromium
  and Firefox browser cases passing, including the new reopen, pane-reveal, and archived-rail
  cases. After the final coordinator correction, `review-fixes-final/results.json` records
  14 relevant cases passing again on the final asset; all disposable fixtures were removed.

The WebKit host-library and second-live-environment limits recorded above remain. The final
resource-ownership regression uses two real in-process servers.

## Follow-up review corrections — 2026-09-11

Three further confirmed failures are fixed:

- Diff-scope actions resolve the session actually displayed by automatic selection, including
  project/environment ownership and archived-session exclusion. Choosing a scope pins that
  session and applies the scope through the address owner. Stale references cannot cancel a
  newer navigation. Stored-scope reconciliation waits for pending navigation and retries after
  it settles. Checkpoint opens use this same scope action.
- Cached-root validation restores the server's filesystem index scope. Confirmed invalid roots
  clear the active editor/search root and persist a folderless fallback while retaining parked
  tabs and dirty buffers. An in-flight different workspace keeps ownership. Validation waits
  for its workspace to own navigation before claiming a server-open generation, so mounting an
  old root cannot supersede a newer open. Validation responses use owner/path and abort checks,
  rather than comparing navigation-status object identity.
- Resource reconciliation preserves the distinction between incoming partial addresses and
  complete command views. A traversal with omitted or over-budget tabs keeps `tabs: null`
  through rename/delete reconciliation; unrelated clean tabs remain open. Four regressions
  exercise both operations and both omitted-tab inputs.

The root-validation and root-opening tests now drive their application's actual stores and
mutation service. Their original behavioral assertions remain. The owned fixture also exposed
and verified restoration of the root opener's `already-open` result for a canonical alias.

Independent failing controls for missing root clearing and status-object staleness are recorded
in `/work/tmp/plan-086-root-missing-clear-control.log` and
`/work/tmp/plan-086-root-status-guard-control.log`. The automatic-session control is in
`/work/tmp/plan-086-auto-diff-scope-before.log`. The updated combined gate and final live evidence
are recorded below.

The checkpoint route's `params.parse` rejection and `finish()` history flush ordering were
reviewed and remain unchanged. The empty local address-hooks directory was removed; it was not
a tracked artifact or a source defect.

Final live verification reused the running preview and API. Both browsers pass all twelve
selected checks on asset `index-B5cepflo.js`: automatic-session diff scope, invalid-root fallback
and bare relaunch, file/chat history, delayed application followed by Back, tab order/additive
startup, and dirty-tab retention. The report is
`/work/tmp/platform-router-verification/followup-final/results.json`; every disposable fixture
was removed. WebKit and the second configured live environment retain the limits above.

The generation race has its own failing control in
`/work/tmp/plan-086-root-mount-race-control.log` and passing regression in
`/work/tmp/plan-086-root-mount-race-after.log`. The final combined gate passes 316 tests across
33 files in `/work/tmp/plan-086-followup-final-tests.log`. The scope-bootstrap hook regression
fails without the pending-navigation retry and passes with it; the controls are recorded in
`/work/tmp/plan-086-diff-scope-bootstrap-before.log` and
`/work/tmp/plan-086-diff-scope-bootstrap-after.log`. The production build passes in
`/work/tmp/plan-086-followup-build.log`; the final web typecheck passes in
`/work/tmp/plan-086-diff-scope-bootstrap-typecheck.log`.
