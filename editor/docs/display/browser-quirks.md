# Browser quirks

[Known limits](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/limitations.md)
records measurement ceilings, analysis budgets and bounded package behavior.
This page records browser bugs and their workarounds.

Browser-specific workarounds in the editor. Every workaround in the code gets an
entry here: the user-visible symptom, the root cause, the chosen fix and why, a
minimal repro, and the upstream bug. Keep entries dated with the engine versions
they were verified against, so they can be re-tested and removed when upstream
fixes ship.

Related inline workarounds already documented at their call sites:

- `packages/editor/src/style.css` — `will-change: transform` on virtualized rows
  (WebKit re-resolves registered CSS Highlight ranges when a painted row's
  transform changes).

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

The behavioral probe is `editor/site/tests/presentation.browser.ts`, run against a
production build with the membership-refresh loop removed. It checks native syntax
pixels after home/manual takeover, including light/dark themes, cold reloads,
desktop WebKit, phone-width WebKit and the iPhone descriptor. Screenshot animations
must remain enabled: disabling animations forces a WebKit repaint and hides the bug.
The unchanged control failed with zero native live syntax pixels; the workaround
passed all 32 production cases. See [the fix and verification](https://github.com/ShaulLavo/fregat/pull/1117).

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
