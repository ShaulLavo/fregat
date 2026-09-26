# Plan 181: Chat timeline on TanStack's end anchoring

## Status and authorization

- Status: IMPLEMENTED 2026-09-27 on wave 2 lane V (branch `w2/v-181`); two owner questions open
  (below). Requested 2026-09-26 (owner).
- Planned at: Platform `d5a901726`, 2026-09-26.
- Effort: M. Runs before [Plan 178](178-tree-in-the-app.md)'s
  [virtualization](178-tree-in-the-app/virtualization.md) sub-plan, which builds on the upgraded
  `VirtualList` this plan leaves behind.

## Owner direction

- 2026-09-26: the chat virtualizer fix is a prerequisite to the file tree plan. TanStack Virtual is
  the app's one virtualizer ("TanStack everywhere"). The full search view keeps its own windowing:
  it has its own problems, researched in [Plan 182](182-search-view-rendering.md). The sidebar
  search list is already on `VirtualList`.
- The chat's scrolling already has problems (owner). TanStack ships a chat mode we do not use.

## Outcome

`@tanstack/react-virtual` is current. The chat timeline follows streaming output, holds its place
when older history loads above it, and shows the jump button through TanStack's end anchoring
(`anchorTo: 'end'`, `followOnAppend`, `isAtEnd`), not our own geometry. The hand-written code those
options replace is deleted; what remains is what no library offers. Every chat scroll problem the
owner has reported has a scenario, and each one passes.

## Why

- We run `@tanstack/react-virtual` 3.14.2 (2026-06-02), which pins `virtual-core` 3.17.0. The chat
  API (`anchorTo`, `followOnAppend`, `scrollEndThreshold`, `scrollToEnd`, `isAtEnd`,
  `getDistanceFromEnd`) shipped in `virtual-core` 3.16.0 (#1173), so it is already installed. We
  call only `scrollToEnd`. Docs: `references/tanstack-virtual/docs/chat.md`; example:
  `examples/react/chat/src/main.tsx`.
- 3.14.13 (2026-09-14, `virtual-core` 3.17.11) carries about 20 fixes to the end-anchored path,
  several of them the failures a streaming chat hits: the pinned write clamped by the browser so the
  view drifts off the end (#1209, #1260, including `paddingEnd`), a message spanning the fold
  dragging the scroll token by token (#1236), a gap after a prepend (#1237), a stuck `isScrolling`
  (#1256), and the size-change compensation rules (#1199, #1212).
- The chat carries about 1,100 lines of its own scroll geometry on top of TanStack
  (`utils/timeline-scroll-anchoring.ts` 380, `state/timeline-scroll.ts` 136,
  `components/timeline-viewport.tsx` 303, `state/timeline-reload.ts` 195). The follow modes are
  ported from t3code, which later moved to LegendList and carries a 1,936-line patch against it; we
  do not follow them there.

## Today, mapped to the library

| Our code                                                                                | What it does                                       | Becomes                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `applyTimelineScroll` → `scrollToEnd` while `following-end`                             | pin to the live edge as content grows              | `followOnAppend` plus end-anchored growth                                    |
| `absorbTimelinePrepend`, `timelinePrependedScrollTop`, `prependedAboveItemId`           | hold the reader when an earlier page lands above   | `anchorTo: 'end'` with the stable `getItemKey`                               |
| `observeTimelineMeasurements` → `shouldAdjustScrollPositionOnItemSizeChange`            | decide which re-measures move the scroll           | the library default after #1199, #1212, #1236; keep only the disclosure hold |
| `isTimelineAtContentEnd`, `TIMELINE_AT_END_EPSILON_PX`, `TIMELINE_FOLLOW_REARM_BAND_PX` | at-end detection and the re-arm band               | `isAtEnd(threshold)` / `getDistanceFromEnd()`, `scrollEndThreshold`          |
| `pendingInitialScroll`                                                                  | start at the latest message                        | `scrollToEnd()` once, as the docs show (already the call we make)            |
| "Scroll to latest message" button                                                       | shown in `free-scrolling`                          | stays ours, driven by `isAtEnd`                                              |
| `anchoring-new-turn`, `anchoredEndSpace`, `applyAnchoredTurnScroll`                     | park the sent message near the top, answer unrolls | stays ours; no library equivalent. Follow is off while it is active          |
| disclosure settle (`disclosureSettle`, the ResizeObserver hand-off)                     | hold a toggled row still until its new size lands  | stays unless end anchoring already holds it (a harness case decides)         |
| `timeline-reload.ts` (`initialOffset`, `initialRect`, `initialMeasurementsCache`)       | reopen at the exact reading position               | stays; the options are TanStack's                                            |
| minimap                                                                                 | marks and viewport band over the measurements      | stays                                                                        |

The reducer (`timelineScrollReducer`) keeps the modes the product needs and loses the geometry the
library now owns.

## Work

1. **Reproduce first.** Collect the owner's list of chat scroll problems. Each gets a scenario under
   `scripts/agent/scenarios/` that fails today, before anything changes (AGENTS.md, Verification).
   Add the four behaviours the docs promise as scenarios too: streaming stays pinned, a scrolled-up
   reader is not pulled down, "Load earlier" holds the reading position, the jump button appears and
   works.
2. **Upgrade.** `@tanstack/react-virtual` 3.14.2 → 3.14.13 in `packages/ui/package.json`. Run the
   step 1 scenarios, the chat unit tests and every `VirtualList` consumer's scenario before and
   after. Record which owner problems the upgrade alone fixes.
3. **Stable key in `VirtualList`.** `VirtualList` passes a new `getItemKey` on every render, which
   makes `virtual-core` rebuild every position each render (0.9 ms at 100k rows, measured
   2026-09-26; 0.08 ms at 10k). Hold the caller's `getKey` in a stable wrapper. `anchorTo: 'end'`
   depends on stable keys. This is also the first half of Plan 178's count mode.
4. **Expose the chat options.** `VirtualList` passes `anchorTo`, `followOnAppend` and
   `scrollEndThreshold` through, and its handle adds `isAtEnd` and `getDistanceFromEnd`.
5. **Chat adopts them** and deletes the rows marked "becomes" above. `anchoring-new-turn` turns
   `followOnAppend` off while it parks the sent message, and back on when it releases.
6. **`directDomUpdates`.** Try it on the chat (flow layout) and on one fixed-height list (git
   changes). It is upstream's answer to the React Compiler issue (#736): positions go straight to the
   DOM and React re-renders only when the range or `isScrolling` changes. Keep it where `renders`
   and `trace` show a win and nothing breaks; record why where it does not. `'use no memo'` stays in
   `VirtualList` either way: the compiler hard-codes `useVirtualizer` as incompatible
   (facebook/react#34493); #1241 and #1259 are the upstream fixes, both open.
7. **Known race.** #1267 (open): `scrollToEnd` during an in-flight prepend strands the view one
   page above the end. The jump button and "Load earlier" must not overlap; a scenario covers it.

## Results (2026-09-27, lane V)

**The owner's list.** No list was written down: not in this plan, the wave-2 inventory, the owner
questions log or the session where the plan was made ("we have problems with it already"). The
scenarios below cover the documented behaviours and every failure found while writing them; the
owner's own list is Owner question 1.

**Scenarios** (`scripts/agent/scenarios/chat-scroll.ts`, native Codex fixture, no real model):

| Scenario                        | What it checks                                                       | `main`                        | After |
| ------------------------------- | -------------------------------------------------------------------- | ----------------------------- | ----- |
| `chat-scroll-pinned`            | the growing end stays visible in every frame while following         | pass                          | pass  |
| `chat-scroll-reader-held`       | a reader scrolled into history does not move while an answer streams | pass                          | pass  |
| `chat-scroll-fold-held`         | an answer spanning the fold grows without dragging the view (#1236)  | pass                          | pass  |
| `chat-scroll-jump`              | the jump button shows, returns to the end and keeps following        | pass                          | pass  |
| `chat-scroll-load-earlier`      | "Load earlier" keeps the row under the reader where it was           | **fail**: 80–264 px jump      | pass  |
| `chat-scroll-load-earlier-jump` | jump pressed while a page loads ends at the latest message (#1267)   | pass                          | pass  |
| `chat-scroll-home`              | Ctrl+Home in a reloaded long session reaches the first row           | **fail**: stops 114–1876 px   | pass  |
| `chat-scroll-disclosure`        | a disclosure opened at the live edge and in history stays put        | pass                          | pass  |
| `chat-scroll-reload`            | a reload of a long session reopens on the latest answer, twice       | pass (4 of 5; one blank page) | pass  |

- **Upgrade.** 3.14.13 / `virtual-core` 3.17.11 was already on `main` (70f57fa83, "Dependencies to
  latest"). The scenarios gave the same results on 3.14.2 and 3.14.13: the upgrade alone fixed none
  of the failures.
- **Load earlier.** The hand-written absorption read the shift off the previously first row, whose
  position still held estimates; `anchorTo: 'end'` with keys that follow the rows holds it exactly.
- **Ctrl+Home.** The browser animates Home; the first measurement of each estimated row above the
  reader moves `scrollTop` to compensate, and that write cancels the animation partway. Home, End,
  Cmd+Up and Cmd+Down are now instant jumps the virtualizer lands (`timelineEdgeKey`).
- **Found while adopting end anchoring.** Its pin to a growing last row fired between a wheel-up and
  that wheel's first scroll, re-armed following and swallowed the gesture (1 of 5 runs of
  `chat-scroll-reader-held`). Outside following the virtualizer's `scrollEndThreshold` is -1, so
  only the reducer decides when a reader is back at the end.
- **Kept, with the reason.** The park (`anchoring-new-turn`) and a settling disclosure anchor to the
  start: end anchoring would pin a disclosure opened at the live edge, and pull the growing answer
  under a parked prompt. The follow effect keeps one `scrollToEnd` for what is not an append or a
  last-row growth: a jump, a released park, a shorter viewport, a replaced last row. The scroll
  handler still reads "at the end" from the element, with the virtualizer's 2 px threshold: the
  virtualizer's tracked offset can lag the event it is handling. Reload restore and the minimap are
  unchanged.
- **Deleted.** `absorbTimelinePrepend`, `timelinePrependedScrollTop`, `timelineRemeasureScrollDelta`,
  `prependedAboveItemId` / `firstItemId` / `prepend-absorbed`; the remeasure predicate is now only
  the disclosure hold (`holdTimelineMeasurements`).
- **`directDomUpdates`: not adopted.** It writes `transform` or `top` on absolutely positioned rows.
  The chat and git changes are both flow layout (git changes moved to measured flow rows after this
  plan was written), so neither can take it; the remaining absolute lists (history, search results,
  picker columns) are for Plan 178's virtualization sub-plan to weigh.
- **Plan 158's tail-follow.** Its only consumer, the log, follows the start edge; end anchoring does
  not apply there, so `tail-follow.ts` is unchanged.
- **Cost.** `trace chat-scroll-pinned --compare`: scripting 5401 → 5135 ms, tasks over 16 ms 56 →
  37, over 50 ms 10 → 9. `renders chat-scroll-pinned`: `MessagesTimeline` 386 on `main`, 398 and
  443 on two runs after; the spread between runs covers the difference.
- **Not a scroll change: a turn's end moves an answer being read by one row.** A turn with no tool
  steps shows "Working for Ns" between the prompt and the answer; when it settles that row goes and
  "Worked for Ns" appears under the answer, so a reader mid-answer sees the text rise 34 px (on
  `main` too). Owner question 2.

### Owner questions

1. Which chat scroll problems have you seen? None were written down; the scenarios above cover the
   documented behaviours plus the two failures found (Load earlier, Ctrl+Home). Each problem you name
   gets a scenario.
2. When a turn with no tool steps settles, should "Worked for Ns" take the Working row's place under
   the prompt, as it already does for turns with steps? Recommendation: yes; it removes the 34 px
   rise at turn end. It changes Plan 160's turn anatomy, so it waits for you.

## Relation to Plan 158

Plan 158 item 1 (the "N new" pill and `VirtualList`'s `follow` prop, `patterns/tail-follow.ts`)
shipped first, in lane L1 (PR #30), and Plan 158 is closed. This plan moves "at the edge" and
following onto TanStack's `isAtEnd` / `scrollEndThreshold` and `followOnAppend`; the tail-follow
store keeps only the arrivals count and the pill. Holding the reader across a prepend is
`anchorTo: 'end'` with stable keys.

## Verification

- Step 1 scenarios, plus `chat-queue`, `chat-turn-anatomy`, `chat-history-pages`, `chat-stream`,
  `stream-ambiguous-tail`. `chat-follow-up` runs a real Codex or Claude turn: never from a lane.
  `chat-disclosure-settle` and `chat-timeline` need sessions the throwaway server lacks;
  `chat-scroll-disclosure` covers the first.
- Unit tests: `timeline-scroll-anchoring.test.ts`, `timeline-navigation.test.tsx`,
  `timeline-reload-discard.test.tsx`, `messages-timeline.test.tsx`, `timeline-minimap.test.ts`,
  rewritten where the geometry moved to the library.
- `trace stream-frames --compare` and `renders stream-frames` before and after.
- Every other `VirtualList` consumer after the upgrade: `git-changes-scroll`, logs, history, the
  file picker (`look` and their scenarios).

## Out of scope

- The full search view's windowing (`features/search/state/result-virtual-window-store.ts`): owner
  decision, [Plan 182](182-search-view-rendering.md).
- The editor's line virtualizer.
- Plan 178's `VirtualList` extensions (count mode, sticky chains, kept rows, scroll padding,
  settlement): [virtualization](178-tree-in-the-app/virtualization.md) builds them on this plan's
  result.
