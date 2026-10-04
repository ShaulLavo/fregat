# Plan 249: Add conversation text search

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 206, Plan 235, Plan 248. Size: L. Triage: ZT-30.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Search the current conversation, move between matches and dismiss the search widget.

## Zed behavior

`agent::ToggleSearch` opens/focuses or closes the thread search bar. `agent::SelectNextThreadMatch`
and `agent::SelectPreviousThreadMatch` cycle matches with wraparound. `agent::DismissThreadSearch`
clears highlights, cancels scanning, and returns focus to the composer. See
`crates/agent_ui/src/conversation_view/thread_view.rs:7103` and `:7124`, plus
`crates/agent_ui/src/conversation_view/thread_search_bar.rs:593` through `:653`.

Zed scans user-message editor snapshots and rendered markdown, including assistant answers,
expanded thoughts/tools, and compaction text. It excludes terminal/diff tool bodies and uses
stable active-match keys while refreshing. See `thread_search_bar.rs:310`, `:427`, and `:883`.
Fregat also searches unloaded/virtualized conversation text, as required by this triage.

## Existing implementation

[SessionSearchQuery](../apps/server/src/orchestration/session-search-query.ts) searches persisted
message text and returns the newest matching snippet per session. It cannot return all occurrences
within one conversation. [Timeline reveal](../apps/web/src/features/chat/hooks/use-timeline-reveal.ts)
releases following, expands folded rows, and reveals stable IDs.
[Earlier-page hook](../apps/web/src/features/chat/hooks/use-session-earlier-page.ts) loads transcript
history. [Buffer search state](../apps/web/src/features/search/state/buffer-state.tsx) owns editor
search options; share only domain-free helpers through shared modules. Editor's
`/work/projects/Editor/packages/find/` serves document find, while conversation indexing belongs
with orchestration and chat.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- Add the four chat-search commands to the catalog/table. Plan 206 presets publish `Chat`,
  `ChatSearch`, and `ChatSearch > Editor` contexts. Toggle from composer focus selects the
  conversation owner. Escape closes search and restores the originating composer focus.
- Add a session-scoped occurrence query using persisted message content, ordered by message
  sequence and text offset. Use machine/session/message/block identity plus content revision
  for matches. Page results and resolve a destination page without loading the whole transcript.
- Search user/assistant text and renderable thought/tool/compaction text available in the data
  model. Derive folded-content policy explicitly: hidden text may produce a result, and navigation
  reveals its fold. Keep terminal/diff bodies with their own search owners. Match display offsets
  through markdown/source mappings rather than searching only mounted DOM or raw serialized JSON.
- Merge live-stream content by revision into a query-owned local search result, avoiding duplicate
  persisted matches. Reconcile active-match identity on edits, retries, compaction, and eviction.
  Plan 235 supplies reusable search flags/history behavior; case/regex errors remain query state.
- Keep query and selected match tied to the shown session. TanStack keys include identity, revision,
  query, and options; cancellation prevents stale paint. Store persistent view state in zustand.
  Use Plan 248 reveal actions to load/expand/reveal and release tail following. Render highlights
  as safe text ranges using shared search-field/loading/error primitives.

## Steps

- [ ] Add a failing occurrence test with multiple matches in an unloaded early message.
- [ ] Add contracts, occurrence query, destination-page lookup, and bounded pagination.
- [ ] Add revision-aware live-text matching and stable active-match reconciliation.
- [ ] Implement search UI/highlights, wrap navigation, cancellation, and focus restoration.
- [ ] Register contexts/preset rows and add `conversation-text-search` scenario and selectors.

## Acceptance

Run focused orchestration occurrence-query tests and chat search/reveal tests. Cover duplicate
matches, Unicode and markdown offsets, folded content, compaction, streaming updates, query errors,
and session switch during a pending search. `conversation-text-search` finds an unloaded early
match, expands a folded match, wraps forward/backward, changes query, then dismisses. No-match
state differs from pending; the session's whole header/body remains consistent during loading,
and late results cannot highlight another conversation.

### Execution checks

Use fixture/mock providers only. Run heavy checks through
`bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Register the named scenario in `scripts/agent/scenarios/index.ts`. Run it with `bun run agent:browser scenario <name>` and capture
`bun run agent:browser look`; read screenshots back and report the evidence directory.
Any private dev server takes an explicit free `--port` and stops afterward. Run `bun run gates`
and typecheck changed packages. Commit by path, push, and ship through the mesh using
`bun run install-release` or `bun run install-release --server --restart` for server changes. Performance claims
require `trace --compare` and render counts before and after.

## Out of scope

Global session search redesign, replacing conversation text, terminal/diff-body search,
and indexing hidden provider metadata or secrets.
