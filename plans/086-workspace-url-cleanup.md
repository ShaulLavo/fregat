# Plan 086: Clean up workspace URLs and preserve browser navigation

Status: proposed, implementation not started. Product decisions below are recommendations for review.
Planned against `99550068` on 2026-09-11. Priority P1, effort M–L, implementation risk medium.

The [Router evaluation](086-router-evaluation.md) recommends TanStack Router as the sole web navigation owner. This supersedes the initial native-controller recommendation. Implement the cleanup through that migration if selected; do not first repair a controller scheduled for deletion.

The user wants readable local workspace URLs with useful Back/Forward history, ordered tabs, and reusable view data for future sharing. Keep `~name.<persisted-id>` and keep tabs in the URL. No sharing backend, stored `viewId`, or tab payload in hidden history state is in scope.

This plan changes source only after implementation is requested. Use the current worktree. Do not create branches, commits, or PRs unless requested. Existing unrelated changes at audit time were `.oxlintrc.json` and chat checkpoint-dialog work; preserve them.

## Current behavior

| Situation                         | Current result                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch at `/`                     | Before React renders, install `platform.address.v2` with `replaceState`. Live query keys override matching saved keys.                                                                         |
| Open an explicit non-root URL     | The saved last-address URL cannot replace it. Workspace caches still supply fields that the link omits.                                                                                        |
| Boot into the cached workspace    | Explicit mode, panels, and selected file override the cache. Named tabs merge with existing tabs. Existing tab order stays; new tabs append.                                                   |
| Boot into another workspace       | Resolve its server-owned ID, open that workspace and its cache, then apply the URL. A root claim prevents recent-folder restoration from racing the link.                                      |
| Back/Forward                      | Apply the URL to stores and adopt it in the projection controller. Side/bottom defaults, empty search, and default logs are restored when omitted. Some chat fields lack equivalent resets.    |
| Tabs on Back/Forward              | A present list closes clean, representable tabs outside that list, retaining dirty/unrepresentable tabs. It does not reorder tabs already open. Absent/empty lists leave the collection alone. |
| File or full chat-mode navigation | Push when environment, workspace, mode, primary document, or editor document changes.                                                                                                          |
| Typing and view changes           | Search/log typing, filters, panel selection, tab reorder, settings category, rail and diff selection, and line focus replace. Composer text never enters the URL.                              |
| Navigation timing                 | Every projection waits for a trailing 250 ms quiet period, including distinct file/chat selections. Fast destinations can collapse into one entry.                                             |
| Sidebar chat selection            | Component-local state. `side=chat` names the panel, but its selected conversation is not addressed or persisted by this layer.                                                                 |
| Copy Workspace Address            | Copies the current address-bar URL, with origin and without development parameters. It can lag the live view during the debounce.                                                              |

Evidence anchors:

- `apps/web/src/main.tsx:60` and `features/address/state/storage.ts:80` own bare-launch restoration.
- `apps/web/src/features/address/utils/cache.ts:38` merges the address before store construction. `panelsForAddress` at line 90 opens/selects tabs without reordering.
- `apps/web/src/features/address/hooks/use-restore.ts:125` owns async boot/traversal; lines 439, 475, and 522 handle omitted sidebar/search/log values; `applyTabs` starts at line 539.
- `apps/web/src/features/address/state/projection.ts:38` defines navigation identity. The existing shape is:

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

- `apps/web/src/features/address/hooks/use-projection.ts:72` adapts to native `history.pushState` and `history.replaceState`. There is no TanStack Router or `@tanstack/history` dependency today.
- `packages/client-core/src/address/grammar.ts:69` resolves the selected editor from `editor` in chat mode and `document` in workbench mode.
- `apps/web/src/features/address/utils/snapshot.ts:85` emits the active file twice: once as the selected document and once in the full tab list.
- `apps/web/src/features/chat/hooks/use-active-chat-session-id.ts:9` owns sidebar chat selection; `address/utils/snapshot.ts:40` explicitly excludes it.
- `apps/web/src/keymap/workspace-commands.ts:731` copies the current location through `shareableAddress`.

The rule is not simply “URL beats localStorage.” Boot treats a link as a partial request over remembered state. Traversal treats it more like a snapshot, while protecting unsaved work.

## Findings to fix

| Priority | Finding                                                             | Impact                                                                                                                    | Effort / risk | Confidence and evidence                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | Traversal does not always save the reached address                  | A → B → Back to A can leave the saved last address at B. A later bare launch reopens B.                                   | S / low       | High. Cache writes exist only in push/replace; `adopt` plus the equality check can perform neither. `use-projection.ts:78`, `projection.ts:97,122`; `edges.test.tsx:189` asserts this zero-write path. |
| 1        | `adopt` leaves an old scheduled write alive                         | A pending edit can push an old destination after the browser moves. Successful restores often mask this by re-projecting. | S / low       | High at the controller boundary. Actual-code reproduction: project A, schedule A with a query, adopt B, flush → pushes A with the query. `projection.ts:122`.                                          |
| 2        | Blanket debounce merges deliberate destinations                     | Fast A → B → C navigation can make Back skip B.                                                                           | M / medium    | High. `projection.ts:144`; burst behavior is asserted in `projection.test.ts:88,114`.                                                                                                                  |
| 2        | Encoded tab order is not restored                                   | A URL list `[c,b,a]` over cached `[a,b,c]` remains `[a,b,c]`.                                                             | M / medium    | High, checked with the real `panelsForAddress` helper. `cache.ts:97`; `use-restore.ts:560`; `workbench/utils/panels.ts:58`.                                                                            |
| 2        | Missing chat defaults are not consistently applied during traversal | Back can retain a later archived rail, tool, or diff scope and rewrite the earlier entry.                                 | S–M / medium  | High. `use-restore.ts:408,412,430`, compared with reason-aware sidebar/search/log restoration.                                                                                                         |
| 3        | Active document duplication and incomplete normalization            | Longer URLs reach omission limits sooner. Hand-edited empty/default params can survive formatting.                        | M / medium    | High. `snapshot.ts:89`; `grammar.ts:212`; `grammar.test.ts:255` currently requires empty settings to round-trip.                                                                                       |

Normal live projection already omits `side=files`, `bottom=terminal`, the default chat tool `git`, and active rail. Search omits an empty query/default flags. Logs emit differences from their effective defaults. Preserve `side=chat` and other meaningful nondefaults. Do not describe the ordinary live writer as emitting all of these defaults today.

## Decisions before implementation

1. **Tab encoding.** Recommend a reserved whole-token `@` for the active editor's position. Keep `tabs=@` for one selected tab because absent currently means unspecified. Use `tabs=-` for an explicitly empty collection. An absent collection continues to mean unspecified or omitted by a size limit. This avoids empty query values without losing the distinction.
2. **Boot versus complete-view intent.** Recommend preserving today's additive boot behavior in this cleanup. Later, an explicit full-view link must mean exact addressed state, with omitted fields meaning defaults. Distinguish it from a partial file/chat link with an explicit URL scope, for example `view=1`, before implementing that sharing behavior. Do not infer scope from whether tabs happen to be present, and do not add an inert scope flag now.
3. **Sidebar chats.** Recommend including their selected conversation in navigation and future view data, while preserving its separate selection from full chat mode. Confirm whether that extension lands with this cleanup or as a follow-up. It requires a real state owner and URL consumer, not a new unused field. `side=chat` alone cannot supply it.
4. **History implementation.** Recommend TanStack Router owning web navigation, with typed destinations/search and one accepted-route application boundary. The [evaluation](086-router-evaluation.md) compares native, history-only, and full Router designs. Pacer may debounce replacements; it does not determine push versus replace. Router is not installed yet.
5. **What a workspace view includes.** Recommend selected editor/chat, ordered addressable tabs, addressed panel selections, search/log filters, and line focus. Layout dimensions, open/closed chrome, themes, local history, unsaved buffers, and drafts remain outside this view. “Entire workspace” including content/process state would be a larger export feature.

For preserved dirty or unaddressable tabs, recommend ordering the addressed tabs first, followed by protected extras in their existing relative order. Boot partial links continue to retain local order and append new tabs. Missing tabs due to a URL budget must never be mistaken for a request to close them.

## Target URL encoding

The selected editor remains in the pathname in workbench mode:

```text
/~platform.<id>/workbench/f/b.ts?tabs=f/a.ts~@~f/c.ts
```

In chat mode the pathname names the conversation. The active editor still needs its independent query field:

```text
/~platform.<id>/chat/t/<session>?tabs=f/a.ts~@~f/c.ts&editor=f/b.ts
```

The marker refers to `editorDocumentToken(address)`, not unconditionally to the pathname. Internally use the complete ordered document list; expand/compress markers only at the URL boundary. A file named `@` remains an encoded `f/...` token.

Reject a tab collection with multiple markers or a marker without a usable selected editor, preserving the independently addressed destination. Validate limits after expansion. `tabs=-` denotes zero tabs and cannot coexist with tab tokens. If an explicit empty collection contradicts a selected editor, reject the collection and preserve the destination without closing other tabs. If a nonempty collection omits the independently selected editor, append that editor deterministically before applying limits and order. Test both cases. Keep existing split-before-decode handling for `~`, percent escapes, and path separators.

An explicit empty collection closes clean representable tabs only during traversal. Under the retained additive boot policy, opening or reloading `tabs=-` preserves remembered tabs. Exact full-view boot restoration is the separate scope decision above.

The alternative `tabs=f/a.ts~f/c.ts&at=1` is viable but adds a second field and an index invariant. The in-place marker is the recommended choice.

Normalize empty owned query fields to absence. Omit static defaults on output, while preserving explicit default intent through initial boot application before canonicalizing the URL. Keep dynamic defaults, such as log time range, resolved from the effective setting rather than hardcoding them in the generic codec. Audit all omission consumers before changing round-trip expectations.

## Implementation order

Use the Router-owned design recommended by the evaluation. Router is the sole web destination/history owner. Runtime stores retain document contents, unsaved work, execution state, and the applied view. Keep the client-core URL codec React-free because the TUI consumes it too.

### 1. Prove typed routes and retained runtime lifetime

Add registered local/remote file and chat routes, Valibot search validation, and custom query serialization. Keep named URL fields sparse through boot merging. Preserve `~name.id`, independent chat/editor selection, base paths, and raw tab token escaping. Use code-based route declarations referencing existing components; do not hide every document kind behind one opaque catch-all.

Keep `ApplicationBootstrap` and retained editor/environment runtimes alive across route changes. Read-only route preparation may fetch data; preload must not activate a workspace or mutate selection. Keep operation-level ownership and supersede checks when applying accepted routes. Reuse the current HTTP desktop history model.

Verification: add compile checks rejecting a nonexistent route, missing session param, and invalid sidebar value; prove valid file/chat calls infer their parameters. Round-trip encoded document/query tokens. Verify file → chat → Back → Forward in the running app before widening the migration.

### 2. Cover all destinations and migrate their producers

Add workspace/folderless roots, draft chat, settings, search, files, saved comparisons, Git refs, snapshots, and checkpoint destinations, with explicit known-environment variants. Validate IDs and domain membership at boundaries. Keep the shared codec/TUI reader compatible.

Wire file/chat/workspace/keymap actions to typed navigation completion. The async session action opens a workspace before selecting a session today; the new boundary must never push a new-root/old-session intermediate state. Keep one route application owner for user navigation, boot, and traversal. Delete passive projection destination inference, native URL writes, and duplicate popstate listeners in the same migration wave. Keep the substantive dirty-tab and ownership logic from `use-restore.ts`.

Verification: migrate projection tests into `tests/navigation.test.ts`, keep restore-edge expectations, and verify environment A → B → A retains dirty documents and routes pending work to its original owner.

### 3. Apply ordered tabs and default omissions

Implement the tab-marker and explicit-empty contracts above. Use one decoded representation in boot merging and route application. Apply exact addressable order on traversal while preserving protected extras; keep boot additive. Normalize empty owned parameters, retain `side=chat`, and complete reason-aware resets for tool/rail/diff. Preserve explicit default intent until initial application before canonicalization.

Verification: grammar, selection, document-token, URL-budget, search-params, and edges tests. Cover `[c,b,a]` over `[a,b,c]`, singleton/empty/unspecified collections, contradictory empty-plus-selected input, and nondefault chat fields traversed back to defaults.

### 4. Implement the history/persistence contract through Router

| Incoming operation                       | Required behavior                                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Query/filter/focus/panel edit            | Typed search replacement. Optional trailing debounce. Pauses never create destinations.                           |
| Completed file/chat/workspace navigation | Settle the old destination's valid pending replacement, then push the complete new destination once.              |
| Boot/canonicalization                    | Replace.                                                                                                          |
| Back/Forward                             | Discard stale pending edits, apply the reached route, persist the accepted address, and never answer with a push. |
| Pagehide                                 | Cancel timer, flush valid pending replacement.                                                                    |
| Environment/runtime disposal             | Cancel pending work.                                                                                              |

Persist accepted traversal even when the reached URL needs no rewrite. Do not save superseded/unavailable destinations as successful last views. Keep panel-only changes as replacements, with panel selections attached to destination entries. Preserve Forward through the actual browser proof below.

Verification: navigation/storage/edges tests, especially pending A edit → Back B cannot later push A, and A → B → Back A → bare launch restores A.

### 5. Capture reusable views and copy current state

Refine `AddressSnapshot` into complete reusable view data before marker encoding and URL budgets. Keep store capture in its state owner and pure schemas/transforms in exact feature/client-core modules. Projection replacement and the copy command must both consume this data; do not register an unused sharing schema or introduce another state store.

Wire existing Copy Workspace Address to the current captured state and typed route builder, preserving origin/base path and dev-param removal. New file/chat/view copy menu choices, full-view scope, and portable import remain future work unless separately selected.

Verification: immediate copy after selection names that selection without waiting for a timer; affected web/client-core typechecks and TUI codec checks pass. Run Plan 086's real-browser sequence once the migration is complete.

## Sharing boundaries and follow-ups

The local workspace address maps an ID to a canonical directory on one server. Known-environment routes already exist, but an independent installation cannot resolve those IDs from the URL alone.

A repository identity already exists in `packages/contracts/src/chat-model.ts:162` as `RepositoryIdentity`. Registration in `apps/server/src/orchestration/registration.ts:70` uses a normalized Git remote, otherwise a root commit, otherwise a local path for non-Git directories. Reuse this model rather than inventing another project ID:

- Git-remote identity can support repository matching. Its normalized host/path is not a clone command or a complete clone URL.
- Root commit can help identify ancestry but supplies no download location.
- Path identity remains local.
- `WorktreeId` also depends on the canonical checkout path and is not a portable checkout locator.
- Chat sessions need accessible/imported conversation data. Cloning a repository cannot recreate a chat.

The eventual flow is portable project description → match local checkout or offer clone → resolve local workspace address → apply requested file/chat/view. Decide branch versus pinned revision, checkout/subdirectory selection, and missing chat behavior as part of that feature. No clone execution or backend is part of this plan.

Current URLs are deliberately lossy under pressure. `snapshot.ts` drops search, then logs, then tabs beyond the overall 4000-character budget; tabs also have a 1500-character and 64-item limit. Never partially trim a tab collection and then treat it as authoritative. Preserve the existing navigation fallback while separating the complete view from the budgeted URL.

Future **Copy workspace view** must report incompleteness or use a chosen export transport if the exact view cannot fit. It must not silently label a truncated address as the entire workspace. File/chat copy can stay small and partial. This decision does not require hidden history state or a stored `viewId` now.

Deferred product review: should Back navigate only file/chat destinations, or also panel changes? Current panel replacements are intentionally retained.

## Verification and scope

Audit verification: the focused `projection.test.ts`, `storage.test.ts`, and `edges.test.tsx` suites recorded passing results. Read-only actual-code probes confirmed stale pending data surviving `adopt` and tab order remaining unchanged. Recent available logs had no current address events to establish runtime behavior. No live browser stack was verified in this audit.

Run commands from the stated directory. Tests below each protect a named behavior; do not run a repository-wide suite.

| Directory              | Command                                                                                                                                                                                                                                                                        | Purpose                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/web`             | `bun --bun vitest run --project node src/features/address/tests/navigation.test.ts src/features/address/tests/storage.test.ts`                                                                                                                                                 | Create navigation tests during migration; verify push/replace, cancellation, persistence, and copy normalization.       |
| `apps/web`             | `bun --bun vitest run --project dom src/features/address/tests/edges.test.tsx`                                                                                                                                                                                                 | Real store restoration, cache precedence, protected tabs, and no feedback push.                                         |
| `apps/web`             | `bun --bun vitest run --project node src/features/address/tests/grammar.test.ts src/features/address/tests/selection.test.ts src/features/address/tests/document-token.test.ts src/features/address/tests/url-budget.test.ts src/features/address/tests/search-params.test.ts` | Marker expansion, ordered/empty/omitted tabs, escaping, defaults, and loss limits.                                      |
| `apps/web`             | `bun --bun vitest run --project dom src/features/address/tests/shared-link.test.tsx src/features/address/tests/environment-restore.test.tsx`                                                                                                                                   | Run if root/environment restore integration changes; catches ID resolution, wrong-owner writes, and superseded restore. |
| `apps/web`             | `bun run typecheck`                                                                                                                                                                                                                                                            | Contracts across stores/hooks/commands.                                                                                 |
| `packages/client-core` | `bun run typecheck`                                                                                                                                                                                                                                                            | Changed pure address types and package exports.                                                                         |
| Repository root        | `bun x oxlint apps/web/src/features/address packages/client-core/src/address`                                                                                                                                                                                                  | Focused source lint; include additional changed source files.                                                           |
| Repository root        | `git diff --check`                                                                                                                                                                                                                                                             | Patch hygiene.                                                                                                          |

Extend existing feature tests using `apps/web/test/fixtures.ts` and `test/address.tsx`. Use real stores and the in-process server; no mocks of our feature/server modules. Package-local runtime-neutral tests use plain Vitest. Keep nesting at most three, readonly contracts where consumers do not mutate, exact imports, short comments, and structured errors/logs.

The current happy-dom harness simulates Back by replacing the URL and dispatching `popstate`; it cannot prove the actual Forward stack. Reuse the already-running app for one browser proof:

1. Open file A, then B, then full chat C; Back reaches B then A; Forward reaches B then C.
2. Repeat A → B → C faster than 250 ms between completed selections; all destinations remain reachable.
3. Type `hello` into an addressed search field, with pauses between letters; Back does not visit five prefixes.
4. Start a pending query edit and immediately go Back; a delayed write cannot restore the abandoned destination or truncate Forward.
5. Reorder tabs, navigate, traverse history, and reload; ordered addressable tabs and selection restore, while dirty tabs remain safe.
6. After Back, launch at `/` and verify the reached destination is the restored one.
7. Switch `side=chat` and file tree; verify current replacement semantics remain unchanged. Test sidebar conversation steps only if that extension is selected.
8. Copy immediately after selecting a destination; the copied link opens that destination.

Do not start another dev server. Any automated real-browser orchestration runs under plain Node. Reconcile ownership with Plan 085 before changing bootstrap/cache admission; this plan does not implement its first-paint work.

In scope: address feature, new web routing modules and dependency, main/bootstrap/application runtime integration, client-core address modules/exports, the TUI address consumer if its contract changes, existing copy/Back/Forward commands, related editor/workbench/session actions needed for ordered restore and navigation completion, and focused tests. Sidebar-chat owner changes are conditional on decision 3. Server ID storage, repository registration, sharing backend, clone flow, layout redesign, and unrelated checkpoint work are out of scope.

Before implementation run `git diff --stat 99550068..HEAD -- apps/web/src/features/address packages/client-core/src/address apps/web/src/keymap/workspace-commands.ts` and compare the evidence against current code. Resolve changed assumptions before editing. If the plan requires closing dirty buffers, inventing machine-portable session IDs, or new runtime owners unrelated to routing, return to the product decision instead of widening scope.

Done means: focused checks pass; the browser sequence is verified; one address writer remains; active document duplication is removed; explicit tab order/emptiness works during traversal while boot remains additive; default omissions restore correctly; Back persists the reached address; copy uses current state; and no sharing backend or hidden tab-state store was introduced.
