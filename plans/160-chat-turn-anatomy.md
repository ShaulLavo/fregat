# Plan 160: What a turn looks like

## Status and authorization

- Status: PROPOSED — ready. The owner approved the shape on 2026-09-25 ("love it") and accepted
  D1–D3 as recommended.
- Priority: P1 in the UI refresh lane.
- Effort: L. Seven items, mostly web, plus one contract and server change (the model marker) and a
  richer script for `MockProviderAdapter`.
- Risk: MED. Most of it renders inside the virtualized timeline, where a row that changes height on
  its own can move the reader. Every item below says how it keeps measurements still.
- Planned at: Platform `ec78c45d`, 2026-09-25. Research:
  [neon-ui.md](../docs/ui-research/neon-ui.md) item 4 and the thinking-select sparkle,
  [ai-elements.md](../docs/ui-research/ai-elements.md) items 1, 3, 4 and 6,
  [agentui.md](../docs/ui-research/agentui.md) items 3, 5 and 6,
  [tinkerers-ui.md](../docs/ui-research/tinkerers-ui.md) item 3, and the `agent-plan` row in
  [scrimui.md](../docs/ui-research/scrimui.md).
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Web changes deploy with `bun run deploy`; the model marker needs `bun run deploy --server`.

## Outcome

A turn reads as a record of what happened, not as a stream of rows:

- **Reasoning** is its own fold. It says "Thinking" while it streams and settles to "Thought for 12s".
- **The work header** stays put for the whole live turn. It shows the last three calls in a fixed
  window, then settles to "Ran 3 commands · Changed 2 files · 1 failed · 1m 12s".
- **A quiet marker** says when a turn ran on a different model or effort than the one before it.
- **Tool details** read like code: highlighted JSON input, failed output tinted, stack frames that
  open the editor, and colour where the output carried it.
- **The plan** marks each step with a drawn status, keeps dropped steps visible as dropped, and
  folds itself away when everything is done.
- **Subagents** nest under the agent that spawned them, with a tally.
- **The highest effort levels sparkle**: xhigh, max, ultracode and ultrathink.

No `motion` dependency. Waiting states use the loader rule in `CLAUDE.md` (`Spinner`, `Shimmer`,
`LoadingState`). Nothing here animates height inside the timeline.

## Ground rules from the timeline

Read these before touching any row:

- **Rows are virtualized.** `messages-timeline.tsx` renders through `VirtualList`, and a row that
  scrolls out of overscan unmounts. Any open/closed state therefore lives in
  `state/chat-work-log-expansion-store.ts`, keyed by stable ids, never in component state.
- **User disclosures settle before the view moves.** `state/timeline-navigation.ts:55-60`
  (`handleClick`) calls `suspendForDisclosure` for a click on a disclosure. `timeline-viewport.tsx:65-176`
  then holds the row still until a ResizeObserver reports its new size, and only after that
  dispatches `scrolled`. That path exists only for clicks. An automatic open or close does not go
  through it.
- **So: no height transitions in the timeline.** A row that animates its height is measured a
  dozen times mid-animation, and the settle logic reads the first report as final. AgentUI's own
  note agrees: its reveal collides with this code. Height reveals stay off the timeline (the
  composer plan, approval details, settings).
- **Automatic changes happen only while following.** An open or close that nobody clicked may change
  a row's height only while the timeline follows the tail (`scrollState.followMode`). When the
  reader has scrolled away, the row keeps its current state until they come back, so nothing
  resizes under their eyes. `utils/timeline-scroll-anchoring.ts` stays the one owner of
  keeping position.
- **Estimates follow real heights.** `chatTimelineItemEstimate` (`utils/timeline-items.ts:421`) is
  updated with every row whose height changes, so first measurements don't jump.

## 1. Reasoning as its own fold

**Today.** Reasoning is a work-log entry with `tone: 'thinking'`. Its streamed deltas are
concatenated into `title` by `mergedTitle` (`utils/work-log.ts:444`). It renders as a plain
`ActivityRow` with a `BrainIcon`: the label is the reasoning text itself, truncated. Expanding it
shows a `Reasoning` `<pre>` (`utils/work-row.ts:4`, `components/activity-detail-section.tsx`). There
is no duration, and the merged entry keeps only its first `createdAt` (`work-log.ts:429`), so the
end time is lost.

**Build** `components/reasoning-row.tsx`, chosen in `timeline-row.tsx` / `activity-group-row.tsx`
for `tone === 'thinking'` entries:

- **Header:** a `Spinner size='xs'` in the icon slot and "Thinking" while it streams. At rest,
  `BrainIcon` and "Thought for 12s" (`tabular-nums`, `formatChatElapsed`).
- **Body:** `AssistantMarkdown` at `text-xs text-muted-foreground` instead of `<pre>`.
- **Duration** needs an end time. Add `lastActivityAt` to `ChatWorkLogEntry`, carried through the
  merge in `work-log.ts:420-441` as the newest `createdAt` of the merged activities. The work-log
  equality check (`WORK_LOG_SCALAR_FIELDS`) gains it.
- **Open while streaming, fold after.** The default is open while the entry is live, and it folds 1 s
  after the stream ends (Neon's `reasoning.tsx` waits 1 s). Both automatic changes obey the
  following rule above.
- **The user's toggle always wins** (Neon's `userToggledRef`). The expansion store gains
  `userExpandedRowIds: Record<string, boolean>`. A recorded user choice overrides the automatic
  default, and nothing the automation does ever writes to it. A static entry loaded from history
  starts folded.
- Delete the `Reasoning` section from `workRowSections`, so reasoning never renders twice.

## 2. The work header and its live tail

**Today.** While a turn runs, `LiveActivityRow` (`components/live-activity-row.tsx`) shows one
label that changes with the latest entry: a tool label, "Thinking", "Responding", "Waiting for
approval" (`utils/live-activity.ts`). Expanding it opens the whole list in a scrolling region.
When the turn ends, the trailing entries become an `ActivityGroupRow` whose summary is
`activityGroupSummary` (`utils/activity-visibility.ts:62`): "Ran 3 commands · Changed 2 files". It
has no failure count and no duration.

**Change:**

- **One frame for the whole live turn.** While it runs, the header says "Working…" with a
  `Spinner size='xs'`, and the current step's label sits beside it, muted. It never folds between
  calls. Neon's `ToolGroup` reads "Working" for the whole turn for this reason: a header that
  collapses in the gaps reads as a glitch. Waiting states keep their `HandPalmIcon` and their own
  words.
- **Live tail** (AgentUI's AgentActivity). Under the header, the last three work-log rows render in
  a **fixed-height** window of `3 × --density-row-height`, clipped, newest at the bottom, with the
  top row faded by a static mask. The height is reserved from the first tool call to the end of
  the turn, so the row is measured once when the tail appears and never again while calls stream.
  `chatTimelineItemEstimate` returns the header plus the tail for a `live-activity` item that has
  calls. Clicking the header still opens the full scrolling list, as today.
- **At rest:** the summary gains failures and duration: "Ran 3 commands · Changed 2 files · 1
  failed · 1m 12s". The duration runs from the group's first `createdAt` to its newest
  `lastActivityAt` (item 1). The `N steps` fallback stays.
- The switch from the live row to the group row happens at the same timeline position, and the tail
  height disappears when it does. That is one measured change at the end of a turn, while following.

## 3. The model and effort marker

**Today.** Nothing shows when a turn ran on a different model or effort. A user message
(`orchestrationMessageSchema`, `packages/contracts/src/chat-model.ts:261`) carries no model.
`sessionTurnStartRequestedPayloadSchema` (`orchestration-events.ts`) has an optional
`modelSelection`, but no read model keeps it per turn. The session keeps only its current one.

**Change:**

- The server projection records the `modelSelection` each turn started with on the turn's user
  message, as a new optional `modelSelection` field on `orchestrationMessageSchema`. It follows the
  existing snapshot and delta path, and the change deploys with `--server`.
- `timeline-items.ts` emits a `model-switch` item above a user turn whose model or effort differs
  from the previous turn's: "Switched to GPT-5.2 · high". The words come from the same catalog
  labels the model picker uses. The item is one line of `text-2xs text-muted-foreground` with a
  fixed height and its own estimate.
- Codex's `model.rerouted` activity is in `QUIET_ACTIVITY_KINDS`
  (`activity-visibility.ts:13`). A reroute the provider chose renders as the same marker with "Rerouted to".

## 4. Tool details that read like code

**Today.** Every section in `ActivityDetailSection` is a muted `<pre>`: Details, Input, Command,
Result, Output and Changed files. A failed row tints only its label (`activity-row.tsx`, `severeFailure`).

**Change**, in `components/activity-detail-section.tsx` and a `utils/` helper per rule:

- **Input as JSON.** When `input` parses as JSON, render it pretty-printed through `HighlightedCode`
  (`packages/markdown/src/components/highlighted-code.tsx`, `language='json'`). Otherwise keep the
  `<pre>`.
- **Failed output tint.** When `isWorkLogFailure(entry)`, the Output and Result sections take
  `bg-destructive/10` with `text-destructive` (a status tint, not a line).
- **Stack frames open the editor.** A pure `utils/stack-frames.ts` finds `path:line[:col]` frames in
  output text. It covers the traces we actually get: Bun, Node, Vitest, TypeScript `tsc`, and
  Python. Frames become links through `useOpenFileReference` (`hooks/use-open-file-reference.ts`),
  which already resolves workspace paths and opens a line. `node_modules`, `node:` and `bun:` frames
  render muted and stay plain text. There is one test per trace format with a real captured trace,
  because a wrong regex typechecks.
- **ANSI colour, only if it exists.** First check the stored tool output for ESC sequences. If
  providers already strip them, drop this item. If they do not, `features/git/utils/ansi-spans.ts`
  gains its second feature consumer and moves to `apps/web/src/lib/ansi-spans.ts` in the same pass
  (the two-consumer rule), with both call sites updated.

## 5. Plan steps

**Today.** `components/composer-active-plan.tsx` lists the latest `turn.plan.updated` steps: a
check for completed, a `bg-info` dot for in progress, a muted dot for pending. Steps are keyed by
`${index}:${step.step}`. Each update replaces the whole list, so a step the agent drops simply
vanishes. The trigger shows `completed/total`.

**Change:**

- **Status marks.** A small SVG `components/plan-step-mark.tsx`:
  - pending: a dashed circle
  - in progress: `Spinner size='xs'` (a loader in a slot, per the loader rule; no hand-drawn
    spinning arc)
  - completed: a check whose stroke draws in once through `stroke-dashoffset` on the motion
    tokens, instantly under reduced motion
  - dropped: a short dash
- **Dropped, not deleted.** `ChatWorkLogPlan` keeps steps that an update removed, with a new status
  `dropped`, matched by text and occurrence rather than by index (Scrim's `agent-plan` rule). Dropped
  steps render muted with a strike and never count toward progress.
- **No percentage.** The trigger keeps `completed/total` over the steps that are not dropped. There
  is no bar and no percentage, because the list's length changes.
- **Folds when done.** When every live step is completed, an open plan folds to its trigger
  ("Plan complete"). It reopens if a step goes back to pending. This is outside the timeline, so it
  may animate height through `Collapsible`.
- Plan 157 lists this dot among its `StatusDot` migrations. This plan replaces it with the step mark
  instead, so whichever lands second drops that line.

## 6. Subagents as a tree

**Today.** `AgentsRow` opens `AgentsPanel`, a side dialog listing each agent flat. Every
`AgentRow` already shows its state word (`chatAgentStatus`), elapsed time, tool count and tokens.
`chatAgentGroupLabel` says "2 of 5 agents working" or "5 agents · 1 failed". The contract already
carries `parentThreadId` (`packages/contracts/src/chat-agent.ts:7`), but nothing reads it for layout.

**Change:**

- **Nest by `parentThreadId`** in `AgentsPanel`, as nested lists and not a tree widget, because
  nothing is navigated (Mischief's `subagent-tree`). The indent comes from padding on the nested
  list, not a line.
- **Tally** in both `AgentsRow` and the panel header: "2 running · 5 done · 1 failed", omitting zero
  parts. `chatAgentGroupLabel` becomes that.
- A running agent's row gets a live `StatusDot` (Plan 157) in place of the extra `Spinner` beside
  its state word. The `Spinner` stays in `AgentsRow`'s icon slot.

## 7. Effort sparkle

**Source.** Neon's `thinking-select` (`references/neon-ui/packages/registry/src/components/thinking-select/thinking-select.tsx`)
and `thinking-model-select`. `GrainFill` lights 3 px pixel cells inside the slider's fill. Each cell
twinkles on its own sine phase and shows only near the peak, at ≤ .45 alpha in the primary colour.
Density and speed rise with effort: low .04 / 8, medium .07 / 14, high .10 / 24, xhigh .14 / 34,
max .20 / 48. It skips under reduced motion and stops drawing while hidden. Theirs rides a
`motion` `ElasticSlider` and paints a canvas every frame. We want the look, not that machinery.

**Where it shows:**

- The model-options trigger (`components/model-options-menu.tsx`, whose label comes from
  `descriptorSummary` in `utils/model-options.ts`) while the effective effort is xhigh, max or
  ultracode, or while ultrathink is controlling the effort (`promptEffortState(...).controlled`,
  shown as "Ultrathink").
- The effort rows for those levels in `components/model-options-group.tsx`
  (`DropdownMenuRadioItem`), always, so the menu previews what each level looks like.
- The word "ultrathink" in the composer, like Claude Code's rainbow treatment. This is a Lexical
  text decoration on the matched word in `chat-input.tsx`'s editor, using the same `/\bultrathink\b/i`
  that `promptEffortState` uses. D3 decides whether it ships.
- **Never** inside virtualized rows: not in timeline items, and not in the model picker's list rows.

**Build**, CSS first, in `components/effort-sparkle.tsx` (chat-only, so it stays in the feature
until a second feature wants it):

- A fixed set of cells, positioned by a deterministic hash (no `Math.random`, nothing at module
  scope that varies), rendered once as absolutely placed 3 px spans, `aria-hidden`.
- **Density** is how many cells are on: the level sets `data-level`, and CSS shows the first N
  cells for that level. **Speed** is the keyframe duration, from per-level tokens in
  `globals.css`. Each cell's `animation-delay` comes from the same hash, so the phases differ.
- The keyframe is opacity only, 0 for most of the cycle and a peak of `.45` in `bg-primary`, the
  same shape as Neon's `(twinkle − .75) / .25`. It runs on the compositor, with no React renders
  per frame.
- Reduced motion shows a static sprinkle at low opacity, not nothing. A hidden trigger does not
  animate, because its cells are not rendered.
- A canvas only if CSS cannot hold the density on the largest surface. If one is needed, it pauses
  off-screen (`IntersectionObserver`) and while the document is hidden.

**Against the loader rule.** The sparkle is a state decoration: it shows a setting that is on. It
is not a waiting state, and it must never appear to mean "working". It shows the same whether a
turn is running or not, and it never replaces a `Spinner`, `Shimmer` or `LoadingState`. Plan 154's
physical mode may later give it its personality's timing.

## Order

1. `lastActivityAt` and the reasoning fold (1), which the header's duration then reuses.
2. The work header and live tail (2).
3. Tool details (4). The ANSI check comes first and may delete its step.
4. Plan steps (5).
5. Subagent tree (6), after Plan 157's `StatusDot` if that has landed; otherwise keep the `Spinner`
   and switch later.
6. The effort sparkle (7).
7. The model marker (3), last, because it is the one contract and server change.

Each step lands green on its own.

## Decisions

Decided 2026-09-25: the owner accepted every recommendation below ("whatever seems best"). The
alternatives stay only as a record of what was weighed.

- **D1 — marker scope.** Recommended: show the marker whenever a turn's model or effort differs
  from the previous turn's, never on the first turn. Alternative: only when the change happened
  in the middle of a session with earlier turns on screen.
- **D2 — reasoning for summary-only providers.** The work log already distinguishes
  `reasoning_text` from `reasoning_summary_text` (`chatActivityReasoningDelta`), and some providers
  send only summaries. Recommended: one fold for both, labelled the same. Alternative:
  "Thought for 12s (summary)" when the provider sent only a summary.
- **D3 — the composer word.** Recommended: yes, sparkle "ultrathink" in the composer where it
  already switches the effort. Alternative: only the trigger and the menu rows.

Decided by the owner: reasoning folds when the turn moves on unless the reader toggled it; the live
tail ships; the sparkle is adopted for the ultra modes.

## Verification

- Unit tests (`node`):
  - `work-log.ts` merge: `lastActivityAt` advances and `createdAt` holds
  - `activityGroupSummary`: failures and duration
  - plan merge: a dropped step stays and is marked, keys follow text, not index
  - `stack-frames.ts`: one real trace per format
  - the agent tally: zero parts omitted
- Timeline items (`node`): the `model-switch` item appears only when the selection differs, and a
  `live-activity` item's estimate includes the reserved tail.
- **Scenario data.** `MockProviderAdapter` (`apps/server/src/provider/adapters/mock.ts`) today emits
  only assistant deltas. It gains a scripted turn with reasoning deltas, four tool calls (one
  failing, one with a Bun stack trace), two plan updates (the second drops a step) and one
  subagent with a child. It is a production adapter, so this is a real feature of it, not a test
  stub.
- **Scenario `chat-turn-anatomy`** in `scripts/agent/scenarios/`, selectors in
  `scripts/agent/selectors.ts`, plus a feature-map line. It checks, in order:
  - "Thinking" with the fold open while the turn streams
  - the tail holds three rows, and the live row's height does not change while calls arrive
    (read `data-index` row heights on every step)
  - "Thought for Ns" folded one second after the stream ends, but still open when the reader had
    toggled it or had scrolled away
  - the settled summary with "1 failed" and a duration
  - a stack frame opens the editor at the line
  - the dropped plan step is struck
  - the agent tree and its tally
  - the sparkle on the trigger at max, and a still sprinkle under `reducedMotion: 'reduce'`
- **The existing `chat-disclosure-settle` scenario** still passes: user toggles keep their row under
  the pointer.
- `renders` on a streaming turn before and after: the live tail must not re-render rows that did not
  change. `trace` on the model-options menu open with the sparkle on, before and after, with
  `--compare`: no long tasks.
- `look` on the chat in both densities and both colour modes, with the screenshots read back.
- `bun run gates` and `bun run compiler:memos` on every touched file.
- Deploy with `bun run deploy --server` (the marker's contract), then check `GET /platform/release`.
