# Browser quirks

[Known limits](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/limitations.md)
records measurement ceilings, analysis budgets and bounded package behavior.
This page records browser bugs, platform limits, and their workarounds.

Browser-specific workarounds in the editor. Every workaround in the code gets an
entry here: the user-visible symptom, the root cause, the chosen fix and why, a
minimal repro, and the upstream bug. Keep entries dated with the engine versions
they were verified against, so they can be re-tested and removed when upstream
fixes ship.

Related inline workarounds already documented at their call sites:

- `packages/editor/src/style.css` — `will-change: transform` on virtualized rows
  (WebKit re-resolves registered CSS Highlight ranges when a painted row's
  transform changes).

## WebKit moves highlights from unselectable inline text onto following text

Verified 2026-10-10 on Linux with Playwright 1.63.0. WebKit 26.6 paints the wrong
text. Chromium 153.0.8010.12 and Firefox 155.0 paint the intended text.
The upstream report is written; no upstream issue has been opened.

### Symptom

In Markdown live preview, plain text after a link takes the link's syntax colour.
For example, the `to` after a link on a narrow manual page changes colour.
Document snapshot replay keeps the plain text in the foreground colour.

### Root cause

A CSS Highlight whose range covers text inside an element with `user-select: none`
paints the following selectable text in WebKit. The reduced reproduction uses one
highlight and one range, with no editor or overlapping priorities. Removing
`user-select: none` fixes the paint. Both `Range` and `StaticRange` reproduce it.

The editor also used equivalent DOM boundaries that ended at offset zero in the
following text node. Moving both endpoints into the covered text improves range
precision and lets document capture apply token styles inside inline widgets.
That boundary change alone does not fix WebKit's unselectable-text behaviour.

### Fix

Inline widgets use `user-select: text`. The editor's mouse handlers continue to
own editor selection. Snapshot replay uses the same widget selection style.
Native highlight ranges start in the first covered text node and end in the last
covered text node. Source spans that produce no displayed text create no highlight
range. Selection and caret geometry retain element-inclusive boundaries so atomic
widgets keep their full selection background, including padding and adornments.
Document capture reads those same registered ranges, so link token colours and
plain-text colours agree with live paint.

### Minimal reproduction

```html
<style>
  #row {
    font: 24px monospace;
    color: black;
    white-space: pre;
  }
  #row::highlight(link) {
    color: red;
  }
</style>
<div id="row">
  <span style="display:inline-block;user-select:none"><a>MMMM</a></span> MMMM
</div>
<script>
  const text = document.querySelector('a').firstChild
  const range = new StaticRange({
    startContainer: text,
    startOffset: 0,
    endContainer: text,
    endOffset: text.length,
  })
  CSS.highlights.set('link', new Highlight(range))
</script>
```

The link should be red and the following text black. WebKit paints the following
text red. Changing the span to `user-select: text` restores the intended paint.
Regression coverage lives in
[highlightPaint.browser.test.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/test/highlightPaint.browser.test.ts).
It checks light and dark Markdown preview at 390 px, exact live/snapshot pixels,
and the endpoints of both native range types in all three engines.

## WebKit keeps link underline colours under custom highlights

Verified 2026-10-10 on Linux with Playwright 1.63.0, Chromium 153.0.8010.12
and WebKit 26.6. Firefox was not checked for this case.

### Symptom and scope

When a Markdown link's syntax-token foreground differs from its theme link colour,
Chromium paints the live underline in the token colour, as the CSS highlight
painting rule requires. WebKit keeps the theme colour, which is a WebKit bug. Document snapshot replay uses the token colour, so WebKit's live and
replayed underlines differ. The isolated 14 px Snapshot Mono fixture reproduced
34 changed underline pixels in each of the light and dark themes; Chromium's
baseline comparisons passed. The docs site's link tokens use the link theme
colour and avoid this difference.

### Painting rule

[CSS Pseudo-Elements Level 4, text and text decorations](https://drafts.csswg.org/css-pseudo-4/#highlight-text)
says the topmost active highlight redraws text and originating-element decorations
using its own `color`, regardless of the decorations' original colour or fill.
Chromium's red originating underline follows that rule. Assigning grey
`text-decoration-color` to the DOM link and its highlight still left Chromium's
originating underline red, as the rule requires. An explicit highlight decoration
colour controls decorations introduced by the highlight itself.

Both engines initially reported the highlight's computed decoration colour as
red, despite their different originating-underline pixels. That computed value
therefore cannot identify WebKit's observed paint. No Chromium upstream report
was filed because this evidence matches the specified Chromium behavior.

### Minimal reproduction

```html
<style>
  .row {
    font: 14px/22px monospace;
    color: #222;
  }
  a {
    color: #222;
    text-decoration: underline;
  }
  #live::highlight(syntax) {
    color: red;
  }
  #saved a {
    color: red;
  }
</style>
<div class="row" id="live"><a href="https://example.com">MMMM</a></div>
<div class="row" id="saved"><a href="https://example.com">MMMM</a></div>
<script>
  const text = document.querySelector('#live a').firstChild
  const range = new Range()
  range.setStart(text, 0)
  range.setEnd(text, text.length)
  CSS.highlights.set('syntax', new Highlight(range))
</script>
```

The live underline is red in Chromium and grey in WebKit. The second row models
direct DOM replay and has a red underline in both engines. Setting the token
colour to `#222` makes the two rows agree.

### Bounded control and current decision

Separately capturing and replaying the originating decoration colour fixed the
WebKit control but changed Chromium's replay underline to grey while its live
underline remained red: 32 changed pixels, all on the underline row. Explicit DOM
and link-scoped highlight decoration colours did not remove that difference.

An experimental highlight-owned grey underline, with the DOM underline removed,
also failed through document capture and replay: 32 changed pixels in Chromium
and 34 in WebKit, for both themes. The underline added solely through the control
stylesheet was absent from the captured token style. Native token-generated
underlines retained equal mounted and emitted pixels in the separate controls.
This experiment does not qualify a replacement Markdown decoration pipeline.

The time-boxed investigation leaves snapshot code and Markdown rendering
unchanged. Matching link-token and theme colours is the qualified docs-site path;
changing decoration ownership requires separate capture and replay qualification.

## Native textarea caret leaks through transparent hidden input

**Verified 2026-06 against:** desktop app WebView, user-visible in the Platform
shell. Needs a standalone engine matrix before filing upstream.

### Symptom

When the editor is focused, a native insertion caret can blink at the top-left
of the editor viewport instead of only the custom editor caret being visible.

### Root cause

The editor keeps a 1px hidden `textarea` (`.editor-virtualized-input`) focused
to receive native text input, `beforeinput`, composition, paste, and keyboard
fallback events. The element is transparent, but some browser/native text field
paint paths can still expose the focused control's caret/chrome at its
position.

### Fix

The hidden textarea remains focusable and in the viewport, but every native
visual channel is explicitly neutralized in `packages/editor/src/style.css`:
transparent `caret-color`, transparent text fill, no background, border,
outline, shadow, native appearance, or padding. The visible caret continues to
be rendered by `.editor-virtualized-caret`.

## Safari renders every line number as "0"

**Verified 2026-06 against:** WebKit 26.4 (Playwright webkit-2272) — broken;
Chromium 147, Firefox 148 — correct. Upstream: [WebKit bug 308446
"Counters evaluation with style containment"](https://bugs.webkit.org/show_bug.cgi?id=308446),
open at time of writing.

### Symptom

In Safari the line-number gutter shows `0` for every row. Chromium and Firefox
show correct line numbers.

### How line numbers are rendered

The line gutter does not write digits into the DOM. Each gutter cell carries an
inline `counter-set: editor-line <n>` (`packages/gutters/src/lineGutter.ts`),
and the digits are painted by CSS:

```css
.editor-virtualized-line-number::before {
  content: counter(editor-line, var(--editor-line-gutter-counter-style, decimal));
}
```

This is deliberate: pseudo-element text stays out of text selection and the
clipboard, there is no per-scroll text-node churn when recycled rows are
renumbered, and the `counterStyle` plugin option lets consumers swap numbering
via any `@counter-style` name without JS formatting.

### Root cause

The virtualizer merges the `editor-virtualized-gutter-cell` class onto the very
element the gutter contribution returns from `createCell`
(`packages/editor/src/virtualization/virtualizedTextViewRows.ts`,
`createGutterCell`). That class used to apply `contain: layout paint style`.

WebKit mis-scopes CSS counters under style containment: when the **same
element** has `contain: style` and a `counter-set`, the counter is not visible
to that element's own `::before`, so `counter()` falls back to `0`. Per
[css-contain](https://drafts.csswg.org/css-contain/#containment-style), style
containment scopes counter properties to the element's subtree — which includes
its own pseudo-elements — and Chromium and Firefox render it that way.

The failure needs both halves on one element. Style containment on
_ancestors_ of the counter-carrying element works fine in WebKit, which is why
only the gutter cell (and not the row/root containment) ever broke.

### Repro matrix

Minimal repro, WebKit-only failure on the marked rows:

```html
<style>
  .num::before {
    content: counter(editor-line);
  }
  .lps {
    contain: layout paint style;
  }
  .lp {
    contain: layout paint;
  }
</style>
<span class="num lps" style="counter-set: editor-line 42"></span>
<!-- WebKit: 0 -->
<span class="num" style="counter-set: editor-line 42; contain: style"></span>
<!-- WebKit: 0 -->
<span class="num lp" style="counter-set: editor-line 42"></span>
<!-- 42 everywhere -->
<span class="lps"><span class="num" style="counter-set: editor-line 42"></span></span>
<!-- 42 everywhere -->
```

Also verified unaffected: dynamic CSSOM assignment (`el.style.counterSet`),
post-paint value mutation, `hidden` toggling, `var()` as the `counter()` style
argument, and the full root > row > cell containment chain — WebKit handles all
of those once the counter-carrying element itself has no style containment.

### Fix

`.editor-virtualized-gutter-cell` uses `contain: layout paint`, dropping
`style` (`packages/editor/src/style.css`). Layout and paint containment carry
the actual virtualization wins; style containment on a leaf cell only scoped
counters/quotes — and the only counters in play are exactly the ones it broke.
Rows and the editor root keep full `layout paint style` containment.

Rejected alternatives:

- **Wrap the counter in a child span** — an extra DOM node per mounted row per
  contribution, purely to dodge the bug.
- **Write digits via `textContent`** — puts line numbers back into
  selection/clipboard reach, adds text-node updates on every remount/renumber,
  and drops `@counter-style` support.

### Contract

Anything returned from a gutter contribution's `createCell` gets the cell class
merged onto it. Do not re-add `contain: style` (or `contain: strict`/
`content-visibility`, which imply it) to gutter cell elements that rely on CSS
counters.

## Firefox paints syntax highlights from a stale snapshot

**Verified 2026-06 against:** Firefox 148 — broken (intermittent, user-confirmed
persistent in long-lived sessions); Chromium 147, WebKit 26.4 — correct.
**Upstream:** no matching report existed when this was added (closest resolved
cousins: [Bug 2035083](https://bugzilla.mozilla.org/show_bug.cgi?id=2035083)
"CSS highlights not rendering on inserted text nodes",
[Bug 1984991](https://bugzilla.mozilla.org/show_bug.cgi?id=1984991) highlight
invalidation on style changes). File a new report once a standalone repro
exists; see "Reproduction status" below.

### Symptom

After scrolling (confirmed) and likely edits, Firefox renders token colors that
do not match the text: identifiers in the wrong color, later-registered
override buckets (function/builtin colors) losing to the base identifier
bucket, and single tokens split across two colors mid-word.

### Evidence chain

The decisive observation, captured live from a broken session:

- Dumping every range over the broken rows (`CSS.highlights` registry) showed
  **fully correct state** — clean token boundaries, correct style buckets,
  correct `::highlight()` rules, correct registration order.
- The screen disagreed with that registry — including a token covered by
  exactly one registered range that painted in **two different colors**, which
  no combination of the live ranges and rules can express.
- Re-registering every registry entry (order-preserving delete + set) from the
  console **instantly fixed the paint** without touching any range.

Conclusion: the registered ranges are right; Gecko paints `::highlight()` from
a stale internal snapshot after a burst of Highlight mutations over recycled
text nodes (virtualization rewrites `textNode.data` in place, then swaps that
row's `StaticRange`s — see `virtualizedTextViewRows.ts`).

### Workaround

`packages/editor/src/virtualization/geckoHighlightRepaint.ts`:
`scheduleHighlightRepaintNudge()` re-registers every registry entry,
order-preserving, coalesced per registry through a microtask so a mutation
burst costs one re-register and the rebuild lands before the next paint (no
broken frame, unlike rAF scheduling). Gecko is detected via
`CSS.supports('-moz-appearance', 'none')` with a `Gecko/<version>` UA-token
fallback — not via `'MozAppearance' in style`, which Firefox 148 no longer
exposes (that check shipped first, silently disabled the nudge, and cost a
debugging round). The nudge is a no-op elsewhere. It is scheduled from every highlight mutation primitive: token row
rebuilds, token range deletion on row release, token clears, and find/
diagnostic range highlight updates — so every trigger (scroll recycling,
typing, folds, tab switches) is covered by construction rather than by
enumerating triggers.

Order preservation matters: overlap winners between equal-priority highlights
follow registry order (base identifier bucket vs. function/builtin override
buckets), so the nudge must not reorder entries.

### Reproduction status

Not yet reproducible on demand: 23 scripted scroll-storm sessions against the
real app reproduced it at most once, and isolated repros (in-place `data`
mutation + StaticRange swap, hidden-during-recycle, transform moves,
containment wrappers) all paint correctly in Firefox. The trigger appears to
involve shared-bucket churn (token buckets being released and re-minted as
documents open/close) interleaved with row recycling. A standalone repro for
the upstream report should simulate two editors sharing highlights, one
churning acquire/release while the other recycles rows.

### Related

Eagerly mounted background tabs tokenize and register highlight ranges without
ever being activated. That multiplies shared-bucket churn (and wastes work);
reducing it shrinks this bug's trigger surface.

## WebKit omits decorations from negative-priority highlights

A plain-text spelling overlay at priority -1 has the correct DOM range and foreground color,
but WebKit draws no underline. Giving that same Highlight priority 0 makes it paint. Syntax
token twins already use priority 0, which hid the failure in the original spelling paint test.

Overlay bases now use priority 0 and register before syntax and semantic color producers.
The `draws spelling marks without a language or syntax tokens` regression in
`packages/spellcheck/test/paint.browser.test.ts` checks underline pixels in all three engines.
The core paint tests verify that syntax and semantic colors still win over the base. No upstream
issue has been filed yet.

## WebKit leaves hidden editor syntax highlights unpainted on reveal

Verified 2026-10-09 with Playwright 1.63.0 on Linux: WebKit 26.6 reproduces the
Singapore home/manual takeover failure. Chromium 153.0.8010.12 passes those
production controls. Firefox 155.0 passes the native Highlight and simple-editor
controls below. The iPhone descriptor uses Linux WebKit; real iOS Safari has not
been verified by this automated matrix.

### Trigger and workaround

During the site's asynchronous syntax takeover, a host remains `visibility: hidden`
while the editor registers syntax `StaticRange` objects. After the host is shown,
WebKit can draw plain text with no syntax pixels. The ranges remain connected,
registered and geometrically valid, with the correct computed highlight colours.
Deleting and adding the same ranges to their existing `Highlight` restores paint.
Re-registering the existing groups or reattaching their stylesheets did not restore it.

`Editor.setPresentationReady(true)` refreshes this editor's existing syntax memberships
on a hidden-to-visible presentation transition. It preserves range/group identity and
other editors' ranges. Already-ready and disposed editors do no membership work.
This is a browser workaround, not a new highlighting algorithm.

### Capability check and behavioral probe

`CSS.supports('-webkit-nbsp-mode', 'space')` selects WebKit's native text-layout
capability without reading a user-agent string. This check identifies the engine;
it does **not** detect stale Custom Highlight paint, and it can stay true after the
bug is fixed. Chromium and Firefox skip membership churn and still restore groups
and stylesheets. Refreshing 4,600 mounted ranges caused a 122–180 ms synchronous
Firefox pause in the reviewed implementation; the guarded path measured 0–1 ms.
These were bounded, non-quiet experiment samples, not throughput measurements.

The original behavioral probe used `editor/site/tests/presentation.browser.ts`
against a production build with the membership-refresh loop removed. It checked
native syntax pixels after home/manual takeover, including light/dark themes, cold
reloads, desktop WebKit, phone-width WebKit and the iPhone descriptor. The ordinary
HTML manual retired that takeover and probe. Its successor,
`editor/site/tests/manual.browser.ts`, checks captured colour spans on every
reload frame and static/live example pixels in Chromium and WebKit. Static
examples keep their captured colours in HTML; explicit live examples still use
native highlights. Screenshot animations must remain enabled: disabling them
forces a WebKit repaint and hides the bug.
The unchanged control failed with zero native live syntax pixels; the workaround
passed all 32 production cases. The fix and its verification are in the `@singapore-editor/core` changelog.

A plain native-API fixture and a one-line editor with manually assigned tokens both
paint correctly in Chromium 153, Firefox 155 and WebKit 26.6. Hidden registration
alone is therefore insufficient to reproduce the site's failure. The async site
fixture is the confirmed repro; a dependency-free failing reduction is still open.

### Removal check and upstream status

Remove the membership refresh and rerun the native production pixel probe on the
oldest supported and latest WebKit. Once the probe stops detecting missing syntax
paint, remove the capability gate and refresh loop, retain the production regression,
and rerun shared ownership, repeated reveal, disposal and all-engine paint tests.
Keep ordinary group/stylesheet restoration. Do not wait for the unrelated native
text-layout property to disappear. Real Safari verification is required before
claiming a Safari version fixed it.

An upstream WebKit report is drafted locally; nothing has been filed. The draft
records the confirmed site repro, the unsuccessful reductions and the removal check.

## WebKit retains a canvas fallback face after a web font loads

Verified 2026-10-09 with Playwright 1.63.0: WebKit 26.6 on Linux retains the
fallback face in both existing HTML canvas and OffscreenCanvas 2D contexts.
Chromium 153.0.8010.12 and Firefox 155.0 update the same retained contexts correctly.
Real Safari has not been verified.

A minimal repro sets a context's font to a currently unavailable custom face,
measures `W`, then loads and adds that face through `FontFace` and `document.fonts`.
After two frames, assign the same font string and measure again. At 14 px, WebKit's
retained contexts still report the serif fallback width of 13.2138671875 px;
fresh contexts and native text report 8.39996337890625 px. The problem survives
reassigning the same font string. No editor or highlighting code is needed.

Our glyph tables use a shared canvas context. Clearing only the tables therefore
kept wrapped rows measured with the fallback face after the font observer had
correctly detected the new face. `clearGlyphAdvancesCache()` now also releases
that context, so the next table is measured in a fresh one. This applies whenever
font metrics are invalidated, without an engine check or another observer.

`test/contentHeight.browser.test.ts` checks late-font content height and the cached
`W` advance against native text, including desktop and phone WebKit. The local
upstream queue contains the standalone HTML, bundled font and three-engine results;
nothing has been filed. Remove the context reset once retained contexts agree with
fresh contexts in the standalone repro on supported WebKit, then rerun the content,
wrap-layout and default browser projects. Keep glyph-table invalidation.

## WebKit blanks text after an optional font expires and later paints the downloaded face

Verified 2026-10-10 on macOS 26.4 with Playwright 1.63.0 and WebKit 26.6
(revision 2359). Chromium 153.0.8010.12 keeps fallback text visible. Real Safari
has not been verified.

### Symptom

On a slow first visit, Singapore documentation examples can stay blank while
JetBrains Mono downloads. Making an example editable can report a network error
after the editor module has downloaded successfully.

### Root cause

With a preloaded `font-display: optional` face and a delayed successful HTTP
response, WebKit marks the face `error` and `document.fonts.load()` rejects with
`NetworkError`. Existing text still stays blank. Once the response arrives,
WebKit paints that text using the downloaded face. The same sequence reproduces
with one native HTML text row, no editor, and no intercepted font request. A
second row using only the fallback remains visible throughout.

Optional-font expiry should keep fallback text visible and prevent a late font
swap. A font-load rejection must also be independent of editor-module readiness.

### Fix

Documentation preparation treats the font-load rejection as nonfatal. If Mono
was unavailable when preparation began, or its load rejects, both the retained
static paint roots and the live editor use the same fallback-only stack. This
also makes live measurements use the rendered fallback and prevents late Mono
arrival from repainting either view. The normal static/live stack includes the
existing metric-matched `Singapore Mono Fallback`. Font preloads and
`font-display: optional` stay unchanged.

### Minimal reproduction

Preload a WOFF2 font and declare it with `font-display: optional`. Render one
`pre` with that face followed by `monospace`, and a control `pre` with only
`monospace`. Delay the font's successful HTTP response by five seconds. After
400 ms, record its `FontFace.status` and call `document.fonts.load()` for it.
WebKit records `error` and rejects with `NetworkError`; the first row is blank
before the response and uses the downloaded face afterwards. Chromium retains
visible fallback text during the delay.

The upstream report material contains standalone HTML, the delayed-response server,
engine results and before/after screenshots. No upstream issue has been opened.
Regression coverage lives in `site/tests/review.browser.ts`: two aborted editor
entry requests, an allowed third request, successful activation with the optional
font expired, exact retained-static/live pixels and height, and unchanged live
pixels after the delayed font finishes. Remove the static-root pin once supported
WebKit keeps the fallback visible and stable in the standalone reproduction;
retain nonfatal font preparation and the matching fallback stack.

## iOS native long-press selection

Observed 2026-10-11 in Mobile Safari on the iPhone 17e simulator, iOS 26.5.
Intermittent native selection was also reported on a physical iPhone;
that report did not record the OS version. Desktop Playwright WebKit does not
reproduce UIKit's native long-press recognition through synthetic TouchEvents.

A long press on selectable rows can start Safari's native DOM selection while
Singapore selects a word through its document session. Native handles and the
system callout then compete with the custom selection and plugin menu. Native
long-press selection is expected browser behavior. The defect is allowing two
selection owners to handle the same editor contact.

[TouchSelectionController](../../packages/editor/src/editor/touchSelection.ts)
sets `data-editor-touch-selecting` in the capture-phase `touchstart` listener,
before recognition and host callbacks. [style.css](../../packages/editor/src/style.css)
makes visible rows unselectable for that contact and disables native touch
callouts on the virtualized editor. Touch-originated row `selectstart` and
`contextmenu` events are cancelled. Release and cancellation restore selectable
rows, retaining CSS Highlight paint and generic DOM-range behavior. Permanently
unselectable rows failed 15 WebKit paint assertions and four Chromium iframe
DOM-selection assertions in the reviewed control.

The portable reproduction is
[mobile-custom-selection.html](../../examples/app/test/fixtures/mobile-custom-selection.html).
Serve the example app with an explicit free port, then open
`/test/fixtures/mobile-custom-selection.html` in Mobile Safari. In a control build,
remove contact-scoped row suppression and the row `selectstart` cancellation.
Hold `bravo` for at least 550 ms, drag into the third row, and release. Record the
session selection and native visible-row selections separately. Repeat after a
fresh load, then repeat 20 holds. Synthetic events can check listener ordering;
trusted device gestures are required to reproduce Safari's competing selection.

The accepted guarded simulator run recorded zero native visible-row selections
across 20 holds, retained `[6, 41]` after cross-row release, and allowed replacement
typing. The local evidence set is `custom-touch-evidence/native-guard`, including
`production.log` and the per-attempt screenshots. The upstream CSS property is
[documented by Apple](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariCSSRef/Articles/StandardCSSProperties.html).
No upstream browser bug is claimed for normal native long-press selection.

Keep the ownership guard while custom touch selection is active. Remove it only
with a qualified replacement selection owner. A native-layout experiment
and optional handles remain open.
Retest native gestures, all-engine highlight paint, and generic DOM selection
before changing row selectability.

## iOS focus selection collapse

Observed 2026-10-11 in Mobile Safari on the iPhone 17e simulator, iOS 26.5.
A trusted cross-row drag selected `[6, 41]`; release and input focus then produced
a native selection update at `[0, 0]`. Reading that update into the document
session erased the custom range and prevented the plugin menu from opening.
Restoring the input during `focusin` alone did not protect every observed focus
write. A dependency-free failing reduction and the exact WebKit cause remain
unconfirmed, so this record does not classify native focus behavior as a browser bug.

[InputSelectionController](../../packages/editor/src/editor/inputSelectionController.ts)
uses `focusInputPreservingSelection()` to mark the focus operation as an input-window
write, then refreshes the hidden input from the document session. The `focusin`
listener also restores the current input window. Native selection synchronization
ignores editor-owned writes through the existing `writingInputWindow` guard.
Unrelated native input-selection changes continue to update the document session.

Use the same three-row touch fixture as the long-press reproduction. Blur the
textarea, hold `bravo`, extend into `third row`, and release. Record the session
range and textarea `selectionStart` and `selectionEnd` before focus, during
`focusin`, and after native `selectionchange`. With the workaround removed, the
observed failure collapses the session after release. The portable regression in
[mobile-custom-selection.spec.ts](../../examples/app/test/mobile-custom-selection.spec.ts)
forces a synchronous focus-time collapse and a `select` event. It verifies the
editor's ownership rule; it does not independently prove Safari's native trigger.

Remove the protected focus write only after the unguarded path preserves the
session and input range through repeated trusted holds, cross-row release,
replacement typing, and clipboard actions on supported iOS Safari versions.
Keep ordinary focus synchronization. No matching upstream report was verified.

## Touch release scroll ordering

Observed 2026-10-11 in Chromium touch-fixture tests after moving the menu into
`@singapore-editor/plugin-ui`. Three tests retained their selection but timed out
waiting for the menu. The release path focused the hidden input, and a subsequent
scroll notification cancelled the newly opened menu. This is an editor event-ordering
failure, with no reduced browser bug or engine-specific root cause established.

[TouchSelectionController.end](../../packages/editor/src/editor/touchSelection.ts)
settles the end notification on the next animation frame. Scroll notifications
while that frame is pending leave settlement intact. Later scrolling, a new
contact, cancellation, wheel input, and edits dismiss the menu through the normal
cancel notification. Core publishes touch events; the plugin owns menu creation.

Reproduce with the portable three-row fixture: hold `bravo`, release, focus the
hidden textarea, and deliver a scroll event before the next frame. The menu must
appear after settlement. Deliver another scroll event after settlement; the menu
must close. A double tap and a hold after removing and reinstalling the plugin
exercise the same ordering. The example app's mobile-selection browser tests
cover those paths.

Remove the deferral only when synchronous end notification survives release-time
focus and scroll notifications in the same checks and trusted mobile gestures.
Retain menu dismissal for later user scrolling. No upstream report is warranted
from the current evidence.

## Touch menu visual viewport

Implemented 2026-10-11 for mobile browsers exposing `window.visualViewport`.
This is normal viewport behavior, not a Safari bug. The on-screen keyboard can
reduce the visible viewport while layout-viewport dimensions remain unchanged.
Pinch zoom can also change the visible viewport's size and offsets. A fixed menu
clamped only to the layout viewport can sit behind the keyboard or outside the
visible area.

[TouchSelectionMenu.position](../../packages/plugin-ui/src/touchSelectionMenu.ts)
uses the visual viewport's width, height, and offsets, and repositions on its
`resize` and `scroll` events. It reads current selection geometry, leaves an 8 px
margin, and places the menu above or below the selection as space allows.
Browsers without that API use document viewport dimensions.

A portable reproduction needs one fixed-position toolbar and a focused textarea
on a page with `width=device-width`. Show the keyboard, then pinch zoom and pan.
Compare `document.documentElement.clientHeight` with `visualViewport.height`,
and record `offsetLeft` and `offsetTop`. Clamp the toolbar to each viewport in
turn. The layout-only control can leave the visible region. Use the three-row
editor fixture to repeat the same actions with the real selection menu.

The example app's 320 px light and dark checks verify layout bounds; they do not
prove keyboard or pinch behavior. Trusted simulator evidence verifies menu
availability with the keyboard, and physical-device pinch acceptance remains
open. The [VisualViewport API](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
defines these coordinates and events. Keep this geometry while the menu is fixed
in document coordinates. Remove it only if the menu's positioning model directly
tracks the visible viewport, with keyboard and pinch acceptance preserved.

## Touch clipboard user activation

Verified 2026-10-11 through trusted Copy, Cut, and Paste actions in Mobile Safari
on the iPhone 17e simulator, iOS 26.5. Clipboard access requires a secure context
and can require user activation or a paste permission prompt. These restrictions
are intended platform behavior. API presence alone does not establish permission.

[TouchSelectionMenu.run](../../packages/plugin-ui/src/touchSelectionMenu.ts)
invokes the action synchronously in its click handler. It awaits the result only
after the action has requested clipboard access. Moving invocation behind a timer
or other deferred work can lose the activation Safari requires. Rejections keep
the menu open and show the action's failure message. Paste uses the editor's
existing paste-provider pipeline.

For a dependency-free reproduction, serve a button over HTTPS or localhost.
Compare `navigator.clipboard.writeText('example')` directly inside its click handler
with a call after `setTimeout` outside that gesture. Repeat with `readText()` and
accept or reject the browser's paste prompt. The direct call can still reject
when permission or policy denies access; that result is independent of selection.
For the editor path, hold `bravo` in the touch fixture and use Copy, Cut, and Paste
through actual taps. Synthetic event dispatch and an injected clipboard verify
application logic, not Safari permission or trusted activation.

[WebKit's Async Clipboard API description](https://webkit.org/blog/10855/async-clipboard-api/)
records the secure-context and user-gesture requirements. Keep synchronous action
invocation while privileged commands require activation. Remove any browser-specific
handling only after supported Safari accepts the replacement invocation path;
retain clipboard rejection feedback and paste-range validation.

## Touch haptic availability

Implemented 2026-10-11 as an opt-in `haptics` option on
`createTouchSelectionPlugin`. Core emits no haptic feedback. On browsers exposing
`navigator.vibrate`, [createTouchHaptics](../../packages/plugin-ui/src/touchSelectionPlugin.ts)
requests an 8 ms pulse when selection starts, its range changes, and the menu opens.
The intended Android path depends on browser support, activation, device hardware,
and user policy. Physical Android tactile output has not been accepted.

Safari does not expose the Vibration API. Its native checkbox switch can request
platform haptics through a trusted activation. The plugin's
[TouchSelectionMenu](../../packages/plugin-ui/src/touchSelectionMenu.ts) uses a label
with a hidden `input type="checkbox" switch` when switch support exists and
Vibration API support is absent. The actual switch activation runs the menu action.
This is a candidate for feedback on a trusted menu tap; physical iPhone feedback
from the hidden switch has not been verified. It provides no tick for the hold timer
or range-extension callbacks. Scripted `click()` and `checked` writes do not create
trusted native activation, even inside an unrelated user gesture.

The reviewed upstream
[CheckboxInputType.cpp](https://github.com/WebKit/WebKit/blob/ce1fa925b83a6d324929839277036aaa2e30a652/Source/WebCore/html/CheckboxInputType.cpp)
requires trusted click state before `performSwitchVisuallyOnAnimation`, and requires
a processing user gesture for click-trigger haptic feedback. This source inspection
explains the limitation; it is not a trace of the installed Safari engine.
[WebKit bug 309082](https://bugs.webkit.org/show_bug.cgi?id=309082) is the cited
issue for scripted switch haptics. The report is access-restricted, so its
contents and status could not be verified. No additional issue has been filed.

A portable physical-device control contains a visible native checkbox switch,
a label activating that switch, and a button calling `switchInput.click()`.
Compare trusted direct taps, trusted label taps, and the scripted button path.
Then hide the switch as the plugin does and repeat the label tap. Record both
`click.isTrusted` and whether the device produces feedback. Check the plugin's
Copy action, keyboard focus, and accessibility separately. A passing DOM test or
simulator run cannot establish tactile output.

Keep the feature optional. Replace the switch candidate only after a supported
Safari haptic API or qualified native control provides physical-device feedback
without taking over editor contacts. Remove the trusted-activation limitation only
when the upstream behavior and supported Safari device checks both permit it.
