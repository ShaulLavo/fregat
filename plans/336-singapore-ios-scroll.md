# Plan 336: steady Singapore scrolling on iPhone Safari

Status: Approved
Kind: Editor investigation, followed by a measured fix
Owner: Singapore scroll lane
Priority: High
Effort: xhigh
Dependencies: [Plan 336](336-packages-as-products.md); inspect [PR #1027](https://github.com/ShaulLavo/fregat/pull/1027) again after it lands
Inspected baseline: `59ea26764`, 2026-10-08

## Outcome

The owner sees shaky scrolling on iPhone Safari in the docs-in-editor prototype and earlier
Singapore views. Mac and desktop browsers look steady. Reproduce a slow drag and a fling on
an actual iPhone, identify the write or paint dependency responsible, then make the smallest
change that improves that recording. Editor package code stays unchanged until iPhone data
supports a fix. Simulator controls validate the probe and narrow hypotheses.

## Current code

- `editor/packages/editor/src/virtualization/fixedRowVirtualizer.ts` attaches a passive native
  scroll listener. The listener schedules one animation frame. That frame reads scroll metrics,
  updates the visible range, delivers a snapshot when the virtual window changes, and calls
  the scroll-paint callback. Overscan defaults to 12 rows and a stable-window deadband already
  reduces recycling. Some scroll-only snapshots have a trailing delivery after a quiet period.
- `virtualizedTextView.ts` calls `synchronizeScrollPaint` on each changed scroll position and
  again while rendering a snapshot. `ScrollViewport.setScrollPosition` writes text and gutter
  content transforms, respectively `translate(-left, -top)` and `translateY(-top)`.
- `scrollViewport.ts` hosts both layers inside a viewport that is sticky at the scrollport's
  top. Native scrolling therefore pins this viewport while JavaScript moves the painted rows.
  Late events or animation-frame scheduling could leave painted text temporarily stationary,
  then jump it. More overscan alone cannot remove that dependency.
- A window change also reaches `renderRows`, recycles row nodes, sets row indices and text,
  positions rows through `top` or `translateY`, updates gutter cells and counters, and rebuilds
  relevant token, range and selection highlights. Row positions have equality guards.
- `style.css` contains layout and paint on the scroller and layout, paint, style and size on
  rows. Rows and scroll content use `will-change: transform`; the gutter is horizontally sticky.
  Gutter cells deliberately omit style containment because Safari counters otherwise show zero.
- PR #1027 is open at inspection, head `318359b6549c8dd7893a254b7714140f7de3278c`.
  It rebases very tall document paint at native-height boundaries, moves spacer transforms and
  positions rows, carets and composition relative to that origin. It retains the sticky viewport
  and per-scroll content transforms. The probe's 10,000 rows never reach that large-height boundary.

These are verified mechanisms. Compositor delay, row recycling and scroll adjustments remain
competing explanations for the owner's report.

## Reference techniques

Reference clones were pulled before inspection on 2026-10-08. These are mechanisms to compare,
not evidence that any library solves every iOS scrolling problem.

| Reference                                                                                                                                                                                                       | Checked behavior                                                                                                                                                                                           | What it suggests                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CodeMirror view `fbff59b`, viewstate.ts](https://github.com/codemirror/view/blob/fbff59ba004d80d8c914f64c42586387b08706ac/src/viewstate.ts)                                                                    | 1,000 px viewport margin, direction-biased coverage, visible blocks in document flow with height-bearing gap widgets. Scroll observation requests measurement.                                             | Native flow and generous coverage are useful controls. There is no inspected iOS-only overscan increase.                                                                                                   |
| [CodeMirror #1601](https://github.com/codemirror/dev/issues/1601)                                                                                                                                               | Maintainer traced twitchy wrapped-line scrolling to Safari overwriting the library's height-correction scroll position during a drag.                                                                      | Record scrollTop writes and height changes separately. This issue concerns variable-height estimation, which the probe deliberately excludes.                                                              |
| [Monaco's VS Code gesture source `4c8b9b7`](https://github.com/microsoft/vscode/blob/4c8b9b7acaf8989a2b2f342c4f0c8dd18e9568f2/src/vs/base/browser/touch.ts)                                                     | Its gesture implementation prevents default touch behavior and synthesizes inertia. View lines use scroll coordinates and a big-number offset.                                                             | It takes control of scrolling in that path. It is not a proof of native Safari momentum compatibility, and adopting a custom scroller would be a much larger change.                                       |
| [xterm viewport `c58ea36`](https://github.com/xtermjs/xterm.js/blob/c58ea3637f3968e0e6e79cd92cf9aace7ef89ee2/src/browser/Viewport.ts) and [mobile issue #5377](https://github.com/xtermjs/xterm.js/issues/5377) | The viewport uses its own Scrollable and SmoothScrollableElement. Touch support has reported limitations.                                                                                                  | A terminal's buffer-row scroll model is a different control, with no inspected native-momentum fix to transplant.                                                                                          |
| [TanStack core `78371e8`](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/packages/virtual-core/src/index.ts) and [#884](https://github.com/TanStack/virtual/issues/884)      | Passive scroll and scrollend listeners, touch tracking, deferred iOS scroll-position adjustments during touch and momentum.                                                                                | Avoid scrollTop correction writes during a real gesture if measurements show them. Its dynamic-size example uses flow rows in a translated window. That pattern still has reports of interrupted momentum. |
| [TanStack #1250](https://github.com/TanStack/virtual/issues/1250) and [PR #1280](https://github.com/TanStack/virtual/pull/1280)                                                                                 | Broad iOS deferral also caused sagged programmatic landings; the follow-up distinguishes touch provenance.                                                                                                 | A quiet timer alone is insufficient. Keep programmatic control runs separate from finger gestures.                                                                                                         |
| [react-window 1.8.10 source](https://github.com/bvaughn/react-window/blob/7e4a312e5900a61b19fcd863943ff0cebae8328d/src/createListComponent.js) and [#816](https://github.com/bvaughn/react-window/issues/816)   | Native overflow, WebkitOverflowScrolling touch, absolute-positioned rows, directional overscan and bounded offsets to stop Safari elastic overscroll shaking. Synced grids still have iOS inertia reports. | Absolute document-space rows can leave movement to the browser. Bounds handling and avoiding two-way scroll synchronization deserve separate checks. This citation is the pinned v1 implementation.        |

Check `overflow-anchor: none` as its own experiment. Browser support varies, and changing it
cannot prove scroll smoothing improved. Likewise, `-webkit-overflow-scrolling: touch` is a legacy
hint, not a universal modern-iOS cure. Passive listeners are already present. Test containment
changes only after a trace implicates layout or paint. Preserve the gutter counter exception.
A scroll-linked animation frame does not provide compositor position or make late events early.

## Scope and design

The portable probe lives in `editor/bench/ios-scroll/`. Its data model is one run with settings,
source commit, browser and viewport metadata, scroll events, touch phase markers, frame samples,
optional long tasks and a summary. It uses generated short lines and a real Singapore Editor.
It collects no user document, account state or provider data. Manual recording stops after
60 seconds. A programmatic control runs for eight seconds and records its kind as `scripted`.

Controls cover 12, 48 and 120 overscan rows; top and transform row positioning; the existing
sticky viewport and a CSS-only native document experiment; sticky and absolute gutters;
browser anchoring and disabled anchoring; and geometry reads on or off. Overscan uses an explicit
probe-only build transform because the Editor constructor has no public overscan option.
The native experiment removes the sticky vertical viewport and cancels content transforms in
CSS. It still incurs the underlying JS writes. It changes horizontal behavior, so it cannot ship
as a production fix. Normal-flow rows with an idle-updated window origin remain a follow-up
candidate if native movement helps and window recycling becomes the measured bottleneck.

For an unwrapped row, derive apparent scroll position as `rowIndex * rowHeight - rowViewportY`.
Subtract the sampled native scrollTop to obtain a signed DOM lag proxy. Singapore installs an
own logical scrollTop property, so read the browser getter on Element.prototype and record the
logical getter separately. A direct `scroller.scrollTop` read would hide pending-frame lag. Compare first and last
mounted row bounds with the scrollport to record uncovered pixels, and sample gutter alignment.
This reads main-thread geometry, not the compositor's displayed frame. Pair it with screen video.
Geometry reads can force layout; report their cost and repeat with reads off. Unsupported long
task APIs produce null, not a claimed zero. Copy and download work on static hosting; the optional
Bun collector accepts completed JSON runs inside the private disposable app.

## Steps

1. Publish one private probe URL, then verify formulas on known aligned and deliberately stale
   rows. Exercise each toggle and collection without touching production state.
2. Run short iPhone simulator controls while the shared Mac has no active benchmark. Preserve raw
   JSON and a screenshot, then shut the simulator down. Mark synthetic scrolls explicitly.
3. On the owner's physical iPhone, record Safari/iOS version, phone model and refresh mode.
   Run baseline, one candidate, baseline again. Make three repeats per setting, each with a slow
   drag, a fast fling in both directions, and an edge bounce. Let momentum settle before stopping.
4. Compare event gaps and deltas, frame intervals, DOM lag, missing coverage, gutter error and
   measurement overhead. Read the video before selecting a fix. Change one setting at a time.
5. Reproduce on the docs-in-editor page with its real plugins and wrapping. If height adjustments
   appear, instrument their provenance before considering deferral. If lag survives with constant
   rows and no adjustments, compare native document movement with the sticky viewport.
6. Implement only the measured cause. Add a browser regression for its geometry or scheduling
   failure, then rerun the physical-device protocol and desktop checks. Recheck PR #1027's origin
   boundary, caret, selection, IME and hit testing if any paint coordinates change.

## Verification and acceptance

From a fresh clone, run `bun install --frozen-lockfile` at the repository root, then:

```sh
node --test editor/bench/ios-scroll/metrics.test.mjs
node editor/bench/ios-scroll/build.mjs /path/to/output
bun /path/to/output/server.mjs --port 4837
```

Choose an unused loopback port. The portable browser control starts and stops its own collector:

```sh
node editor/bench/ios-scroll/verify.mjs /path/to/output 4839
```

Use the editor site's installed Playwright Chromium. The three metric tests catch incorrect
fractional coordinates, missed stale paint or blank coverage, and false supported-long-task reports. Browser verification
must inject a known row translation to prove nonzero lag detection, check native and sticky
coordinates at rest, test settings across reloads and confirm collector JSON contains raw samples.
Acceptance for the investigation is the hosted probe, an approved measurement protocol and
simulator or real-device artifacts. Acceptance for a fix requires repeated real finger-scroll
improvement, no missing content, aligned gutters, correct editing geometry and no desktop regression.
No universal smoothness, superiority over other editors, or compositor latency claim follows
from this investigation alone.

## Initial simulator controls

On 2026-10-08, Mobile Safari in the iPhone 17 Pro simulator, iOS runtime 26.5, ran
three eight-second scrollBy controls on the owner's Apple M1 Mac. These are experiments
without trusted finger gestures. The baseline used 12 overscan rows and transform positioning.
It recorded 479 scroll events, 18 ms p95 frame intervals, zero measured DOM lag and zero
missing-coverage frames. The native CSS experiment recorded 481 events, 18 ms p95 intervals,
29 px p95 DOM lag and 39 px maximum lag, with zero missing-coverage frames. The combined
48-row, top-positioned, absolute-gutter control recorded 480 events, 17 ms p95 intervals,
zero DOM lag and zero missing-coverage frames. This combined control is a probe check,
not an attribution experiment. Per-frame geometry measurement cost was 1 ms at p95.
Long-task entries are unsupported in this Safari and are null. These initial controls used
Singapore's shadowed logical scrollTop getter, so their lag numbers compare against the
virtualizer snapshot. They are probe checks, not native-scroll latency measurements. The
finished probe bypasses that getter through Element.prototype and records logicalScrollTop
separately. Repeat the simulator protocol with that corrected native observation.

These controls do not reproduce the owner's shaky fling. In particular, the native CSS
experiment's bounds can disagree with sampled scrollTop during script-driven movement.
A DOM lag number alone cannot tell which composited frame the owner saw. No production
fix follows from these controls. A geometry-off control and raw JSON are retained locally
with the probe evidence; the physical-device protocol remains the next decision gate.

## Risks and decisions

The simulator's scripted scrollBy does not reproduce trusted touch momentum. A zero DOM lag can
coexist with compositor jitter. Estimated wrap heights, overscroll bounce, outer-page movement
and the measuring code can each confound results. The first probe isolates fixed-height vertical
scrolling; later tests must add those factors individually. Keep raw evidence outside the public
product pages and keep temporary hosting private. Stop short of production changes until the
physical-device record supports the decision.
