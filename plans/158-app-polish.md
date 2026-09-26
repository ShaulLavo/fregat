# Plan 158: App polish from Neon — following, secrets, checkpoints, branch lanes, connection frames

## Status and authorization

- Status: PROPOSED — ready. The owner approved all five items and accepted D1–D2 as recommended on
  2026-09-25.
- Priority: P2 in the UI refresh lane, after [Plan 157](157-base-components.md). Items 1 and 3 use its
  `scroll-pinned` utility and its `StatusDot`.
- Effort: M. One shared `packages/ui` pattern, two small primitives, and four surface changes.
- Risk: LOW–MED. The chat timeline's follow logic is subtle (`timeline-scroll-anchoring.ts`, 380
  lines). Item 1 feeds it; it does not replace it.
- Planned at: Platform `9c1c45d1`, 2026-09-25. Research: [neon-ui.md](../docs/ui-research/neon-ui.md)
  items 5, 7, 9, 10 and 11. Sources are under `references/neon-ui/packages/registry/src/components/`.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Deploy with `bun run deploy` (web only).

## Outcome

- **Every live list says what arrived while you were away**, like "23 new lines" or "4 new
  messages". It says "Follow output" otherwise, and scrolling back to the live edge re-arms
  following.
- **Values that carry credentials show only what is safe.** Each value has its own copy action. An
  agent view names the environment variable instead of the value. A select trigger never reshapes
  its row when the choice changes.
- **Reverting a checkpoint reads as one calm event.** The revert action sits in space that is always
  reserved. The target turn breathes while it restores, and the turns being undone recede.
- **The branch picker shows where a branch came from**, but only when that is known, and never at
  the cost of motion, width jumps or a slower menu.
- **Connecting, failing and reconnecting happen in one fixed frame.** Only the words change; the
  layout never jumps.

## 1. Tail following and the "N new" count

**Today.**

- The chat has a full follow model: `TimelineFollowMode` (`'anchoring-new-turn' | 'following-end' |
'free-scrolling'`) in `features/chat/utils/timeline-scroll-anchoring.ts:43`. It is applied by
  `features/chat/state/timeline-scroll.ts`.
- Its jump button (`features/chat/components/timeline-viewport.tsx:280-300`) is an icon-only
  "Scroll to latest message" that appears in `free-scrolling`. It never says how much arrived.
- The logs list (`features/logs/components/event-list.tsx`, a `VirtualList`) has no follow at all.
  Live events arrive through `features/logs/hooks/use-live.ts` and are merged **newest first**
  (`features/logs/state/live-cache.ts:61`), so the live edge of the logs is the top, not the
  bottom.
- `VirtualList` (`packages/ui/src/patterns/virtual-list.tsx`) knows nothing about following.

**Build** a shared pattern in `packages/ui/src/patterns/`, from Neon's
`logs-viewer/logs-viewer.tsx:422-524`:

- `use-tail-follow.ts` is a small store: `edge: 'start' | 'end'`, `following`, `arrivals`. Rows
  appended at the live edge while not following add to `arrivals`. Reaching the edge (within one
  row) sets `following` and zeroes `arrivals`. It exposes `jumpToEdge()` through the `VirtualList`
  handle (`scrollToIndex`). Pure state lives in `tail-follow.ts`, which has node tests. The hook
  only wires scroll events.
- `tail-jump-button.tsx` is the pill: "Follow output" or "23 new lines", with the noun supplied by
  the caller. The count uses `TickerNumber` at `tabular-nums`. It is a real labelled button, not
  icon-only, so it needs no tooltip.
- While `following` is true, the scroll container gets `data-pinned`, so Plan 157's `scroll-pinned`
  hides the scrollbar.
- `VirtualList` gains an optional `follow` prop that mounts both pieces. A list that does not ask
  for it pays nothing.
- 2026-09-26: build on [Plan 181](181-chat-timeline-end-anchoring.md), which lands first. At an end
  edge, "at the edge" is TanStack's `isAtEnd` / `scrollEndThreshold` and following is
  `followOnAppend`; the store keeps only `arrivals` and the pill. Holding the reader across a
  prepend is `anchorTo: 'end'` with stable keys, which also answers the logs check below.

**Apply.**

- **Logs:** `edge: 'start'`, noun "line". The toolbar (`features/logs/components/toolbar.tsx`) gets
  no checkbox, because following is state, not a setting. Check first that a prepend while scrolled
  away holds the reader's position. If it does not, that is the first fix.
- **Chat:** keep the follow reducer. `timeline-viewport.tsx` counts messages that arrive while
  `followMode === 'free-scrolling'` and renders `tail-jump-button` in place of the icon button, with
  noun "message". The dispatch stays `{ type: 'jump-to-end' }`. Only the counter and the pill are
  shared; the anchoring logic stays in chat.
- **Later:** terminal scrollback has its own renderer and is out of scope.

## 2. Secrets and connection strings

**Today.**

- Secrets never reach the client. The server sends `REDACTED_SETTINGS_VALUE` (`'••••••••'`,
  `packages/contracts/src/settings.ts:44`) where a provider environment secret exists
  (`apps/server/src/settings/secrets.ts:141`, `maskProviderSecrets`). Neon's "reveal" and "copy the
  real value" therefore cannot exist here, and must not (D1).
- Machine URLs cannot carry credentials. `originSchema` rejects them
  (`packages/contracts/src/machines.ts:21-26`). So there is no connection string to half-mask
  today.
- Values shown as one run-on line:
  - `features/settings/components/machine-row.tsx:61` joins name and URL or SSH target
  - `features/settings/components/provider-row.tsx:10` shows the binary path
  - `features/chat/components/provider-sign-in-dialog.tsx:153-156` shows a sign-in command, which
    already has a `CopyButton`
- Select triggers that reshape their row:
  - `features/chat/components/model-picker-trigger.tsx:43` (`max-w-44 … truncate`)
  - `features/chat/components/draft-machine-menu.tsx:52`
  - `features/chat/components/draft-workspace-menu.tsx:64`

**Build**, from Neon's `db-connection-card/db-connection-card.tsx` and `api-key-list`:

- `packages/ui/src/components/value-grid.tsx`: a `dl` of `dt` label and `dd` mono value. Each row
  has a copy button, and truncated values follow the `title` rule.
- A `secret` row renders "Set" or "Not set" beside the mask. It never has a copy action for the
  value.
- An **agent view** toggle on the grid swaps each secret for a paste-ready reference that names the
  environment variable (`$ANTHROPIC_API_KEY`), so the user can hand an agent the setup without the
  value.
- `widest-option`: a trigger reserves the width of its longest option by putting every label in one
  invisible grid cell (Neon's `widestOption`, `db-connection-card.tsx:120`). This only applies to
  closed, short option sets. Unbounded lists (models, branches) keep a cap and truncate.

**Apply.**

- `machine-row.tsx`: kind, target or URL, and port on separate `ValueGrid` rows.
- `provider-row.tsx`: binary path plus each environment variable's name, with set or unset. This
  gives the masked secrets a visible home, where today only the raw JSON view shows them.
- `widest-option` on the draft machine and workspace menus. The model picker trigger keeps its cap,
  because its options are unbounded.

## 3. Checkpoint restore

**Today.**

- The revert button already sits in reserved space: a fixed `size-5` slot in the user message's meta
  row. It fades in on hover or focus (`features/chat/components/message-bubble.tsx:147-178`).
- While a revert runs, `checkpointRevertPending` (from `useCheckpointRewind`, `chat-view.tsx:75-76`)
  disables every revert button. Nothing says which turn is being restored or what is about to go
  away.

**Build**, from Neon's `checkpoint-timeline/checkpoint-timeline.tsx` (lines 52-73):

- The action enters with a short `-translate-x-2 → 0` plus fade, inside the slot that already
  exists. The row never moves. Other rows' actions go fully absent while one restores.
- The target turn shows a live `StatusDot` (Plan 157) beside a `Shimmer` "Restoring…", in its
  meta row.
- The turns that the revert will remove recede to `opacity-50` until the timeline settles.
- To do this, the pending state carries the target message id, not a boolean. Take it from the
  mutation's variables through `useMutationState` on the rewind's `mutationKey`, not from a new
  local flag.

**Apply** in `message-bubble.tsx`, `timeline-row.tsx` and `messages-timeline.tsx` (which already
thread `checkpointRevertPending`). The editor's undo History tab (`history-view.tsx`) restores
differently and is not in scope.

## 4. Branch lanes in the branch picker

**Today.** `features/chat/components/draft-branch-list.tsx` is a flat radio list inside a dropdown.
`GitBranch` (`packages/contracts/src/git.ts:69-74`) has `name`, `current`, `upstream` and `commit`,
and no parent. Git does not record which branch a branch came from. The app only knows a parent for
worktrees it created (`baseBranch`, `packages/contracts/src/worktree-lifecycle.ts:22`).

**Build**, from Neon's `branch-tree/branch-tree.tsx` (geometry comment lines 35-50, `laneX`,
edge path). Rules that keep it from being annoying:

- **No lanes unless there is real depth.** If no branch in the list has a known parent (D2), the
  list renders exactly as today, with no gutter.
- **The gutter width is fixed per open menu.** It is computed once from the deepest lane, so rows
  never shift while data arrives or while you move through the list.
- **No motion.** Edges and dots are static SVG. Nothing animates on open, hover or selection.
- **It flattens while searching.** A search query hides the gutter and shows matches as a plain list.
- **Quiet colour.** Lanes use `historyLaneColor` (`apps/web/src/lib/history-lane-colors.ts`) at
  reduced opacity. The selected or current branch's dot gets the ring; nothing else is emphasized.
- **Cheap.** One SVG per row, sized to the row, with no layout reads. It stays correct when the list
  is virtualized.
- **Capped.** Past three lanes, deeper branches share the last lane. The picker is not a graph
  viewer.

**Apply** to `draft-branch-list.tsx` only. The git panel's branch actions have no list today.

## 5. Connection and boot frames

**Today.** Two full-screen gates each render three unrelated layouts:

- `features/environments/components/connection-gate.tsx:36-61`: `InlineError` plus a Retry
  `Button`, or a large `Spinner` plus "Connecting to server…", or the children
- `components/application-bootstrap.tsx:43-66`: an `EmptyState` error, or a large `Spinner` plus
  "Connecting to local machine…", or the app

Moving between pending and error swaps the whole layout.

**Build** `packages/ui/src/patterns/status-frame.tsx`, from Neon's
`provisioning-status/provisioning-status.tsx` and `preview-frame`:

- One frame of fixed size: a mark slot, a title line and a detail line. Only the voice changes. The
  mark slot shows `Spinner` while pending and an error mark on failure. The detail line crossfades in
  place, with the old line rolling out the top as the new one rises (300 ms on the motion tokens,
  zero shift).
- **Error keeps the frame.** The retry action appears where the loader was, with the catalog `fix` as
  the detail line.
- **Sleeping is a scrim, not a removal.** A surface whose connection drops after it has shown content
  (`reconnecting` or `offline` in `lib/environments/components/phase.tsx`) keeps its content under a
  `bg-background/70` scrim holding the same frame. Check first what an already-connected workspace
  shows today when its machine drops.
- Reduced motion: the detail line swaps without the roll.

**Apply** to `connection-gate.tsx` and `application-bootstrap.tsx`. `application-bootstrap.tsx` has
uncommitted changes from another session at the time of writing; merge onto whatever is there.

## Decisions

Decided 2026-09-25: the owner accepted every recommendation below ("whatever seems best"). The
alternatives stay only as a record of what was weighed.

- **D1 — no reveal, ever.** Neon reveals and copies secrets. We cannot, because the client never
  holds a secret value, and we should not add a path that sends one. Recommended: keep it that way;
  secret rows show set or unset plus the agent-view reference.
- **D2 — where a branch's parent comes from.** Recommended: only from what the app recorded
  (`baseBranch` on worktrees it created), so lanes appear only where they are true. The alternative
  is deriving a parent from merge-bases on every open, which costs one git call per branch and
  guesses.

## Order

1. Tail following (shared pattern, then logs, then chat).
2. Connection frames.
3. Checkpoint restore (needs `StatusDot` from Plan 157).
4. Secrets and value grids (after D1).
5. Branch lanes (after D2).

Each step lands green on its own.

## Verification

- Node tests:
  - `tail-follow.ts`: arrivals count only while away, reaching the edge re-arms, and both edges work
  - the `widest-option` label set
  - the lane layout: flat when no parents, the three-lane cap, flattening under a query
- `agent:browser look`, with the screenshots read back:
  - logs scrolled away with live events arriving (the pill shows the count)
  - the chat mid-stream while scrolled up
  - a checkpoint revert in flight
  - the machines and providers settings rows
  - the branch picker with and without app-created worktree branches
  - the connection gate pending, then failing, with no layout shift between them
- New scenarios, with selectors in `scripts/agent/selectors.ts` and feature-map lines:
  - `tail-follow`: drives logs and chat and asserts the counts
  - `connection-frame`: pending to error to retry, asserting the frame's box does not move
- Extend `checkpoint-rewind.ts` to assert the target turn's live dot and the receding rows.
- `countBlankFrames` on the connection-frame scenario: no blank frame between states.
- `caches` after a revert: the rewind mutation settles the timeline query.
- `bun run gates`.
- Deploy with `bun run deploy` and check `GET /platform/release`.
