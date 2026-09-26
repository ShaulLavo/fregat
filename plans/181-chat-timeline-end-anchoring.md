# Plan 181: Chat timeline on TanStack's end anchoring

## Status and authorization

- Status: PROPOSED. Requested 2026-09-26 (owner). Nothing here authorizes implementation.
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

## Relation to Plan 158

[Plan 158](158-app-polish.md) item 1 (the "N new" pill and `VirtualList`'s `follow` prop) lands
after this plan and builds on its options: TanStack owns "at the edge" and following, 158 adds the
arrivals count and the pill, which replaces the chat's icon-only jump button.

## Verification

- Step 1 scenarios, plus `chat-follow-up`, `chat-queue`, `chat-turn-anatomy`,
  `chat-disclosure-settle`, `chat-timeline-pattern`, `stream-frames`, `stream-ambiguous-tail`.
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
