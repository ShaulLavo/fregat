# Plan 248: Add transcript boundary commands and session MRU switching

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 206, Plan 220. Size: M. Triage: ZT-29.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Move by transcript line, page or message, jump to its start and switch or create grouped sessions.

## Zed behavior

- `agent::ScrollOutputLineUp` and `agent::ScrollOutputLineDown` move by three rendered line
  heights. `agent::ScrollOutputPageUp` and `agent::ScrollOutputPageDown` move by 90% of the
  viewport. `agent::ScrollOutputToTop` jumps to the beginning. See
  `crates/agent_ui/src/conversation_view/thread_view.rs:6995` through `:7044`.
- `agent::ScrollOutputToPreviousMessage` and `agent::ScrollOutputToNextMessage` visit preceding
  or following user-message boundaries, skipping assistant/tool entries. See the same file `:7055`.
- `agent::ToggleNewThreadMenu` toggles the new-thread menu for an open project.
  `agents_sidebar::NewThreadInGroup` creates in the selected group or active workspace.
  See `crates/agent_ui/src/agent_panel.rs:3602` and `crates/sidebar/src/sidebar.rs:6744`.
- `agents_sidebar::ToggleThreadSwitcher` opens/cycles the MRU switcher. Preserve the `select_last`
  payload and modifier-release confirmation. See `crates/sidebar/src/sidebar.rs:5960` and
  `crates/sidebar/src/thread_switcher.rs:312`.

## Existing implementation

[Chat command metadata](../packages/client-core/src/commands/chat.ts) has transcript page
commands, jump-to-latest, and rail navigation. [MessagesTimeline](../apps/web/src/features/chat/components/messages-timeline.tsx)
owns virtualization. [Timeline scroll reducer](../apps/web/src/features/chat/utils/timeline-scroll-anchoring.ts)
already has `user-navigated`, free-scrolling, and explicit end following.
[Timeline reveal](../apps/web/src/features/chat/hooks/use-timeline-reveal.ts) resolves stable row
IDs and opens folds. [Session rail store](../apps/web/src/features/chat-mode/state/session-rail-store.ts)
and [rail model](../packages/client-core/src/chat/rail/model.ts) supply grouped
sessions. `useChatTimelineActions` currently exposes review/retry actions, not scroll actions.
Editor-hosted composer focus joins this owner through Plan 204; the navigation policy is Fregat's.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- Reuse existing page commands and add missing line/boundary/menu/MRU commands to the catalog/table.
  Plan 206 preset data targets `Chat`, `Chat > Editor`, `ThreadsSidebar`, and `ThreadSwitcher`,
  retaining start/end-of-input predicates so composer editing keeps its intended keys.
- Put scroll actions beside the actual timeline/virtualizer owner and expose narrow actions through
  a context. Target the shown session, then release tail following before each navigation.
  Resolve user-message boundaries from timeline IDs, including earlier pages, not mounted DOM.
- Store MRU session identities by machine and project in zustand. Snapshot candidates when opening,
  cycle without rewriting recency, preview whole sessions through the held-subject owner, commit
  on modifier release/confirm, and restore on cancel. Handle archived/deleted/disconnected entries.
- Create grouped sessions through the existing session mutation owner, using the selected group or
  active project fallback. Use current rail groups. Plan 209's future independent columns require
  its separate implementation decision before extending scope to those layouts.
- Async reads/effects use TanStack and feature keys. Keep cross-feature orchestration in keymap or
  shared domain owners. Use shared listbox/menu/pending/error primitives and `Kbd` hints.

## Steps

- [ ] Add failing timeline tests for line/page geometry, user-message boundaries, and free-scrolling.
- [ ] Expose focused timeline navigation and earlier-page boundary resolution.
- [ ] Add MRU identity/state and switcher preview, cancellation, and modifier-release confirmation.
- [ ] Wire new-session menu/group actions, command contexts, payloads, and preset rows.
- [ ] Add `chat-navigation-mru` scenario and selectors with fixture conversations.

## Acceptance

Run focused timeline reducer/reveal tests and session-switcher component tests. Cover unloaded
older user messages, folded tools, session deletion, `select_last`, modifier release, and cancel.
`chat-navigation-mru` navigates a long fixture transcript while streaming fixture output, verifies
free-scrolling stays released, creates in the selected group, and switches across two sessions.
Pending session loads keep the previous header and body together; composer text is preserved.

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

Conversation search, prompt-history commands, Plan 209's unapproved implementation details,
and automated live-provider runs.
