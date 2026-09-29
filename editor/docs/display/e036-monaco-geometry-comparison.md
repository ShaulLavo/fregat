# E036: Monaco's view mechanisms against the calculated geometry path

Completed on 2026-09-24. Planned against `5f68ce6` (2026-09-14), measured on `10b0ac4` and later
in Chromium 148 through Playwright. Monaco's mechanisms were the control, not the spec.

Each of the six candidates ended in a measured decision. Three went in: monospace verification
with demotion, re-measuring whenever the rendered face changes, and an EditContext input route.
Hosts choose the route; Platform uses EditContext by default. Three were measured and rejected:
calculated geometry for tabbed rows, merging the forced layouts on the typing path, and a
measured-path cache. Replacing the CSS caret blink with a JavaScript interval was also rejected.

## Row mix

The calculated path does not cover real files. On disk, tab-indented codebases have a tab on 69%
(Go, crush) to 77% (VS Code `.ts`) of lines. Markdown has 8–10% non-ASCII lines before counting
inline replacements. Of the mounted rows, 71% (go-tabs), 33% (markdown) and 100% (unicode) take
measured geometry. The plan's 5% gate therefore did not settle candidates 1 and 4; their cost did.

The geometry module reports each row build's path (`view.rowGeometry`: `calculated`, `tab`,
`non-simple-text`, `inline-mapping`, `proportional-font`) and each sweep
(`view.rowGeometry.sweep`) through the performance diagnostics sink.

## Decisions

| Candidate                            | Measured                                                                                                                                                                                                                                                                                                                                                | Decision                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Tabbed rows calculated            | 3,000-line Go, identical text indented with tabs and with spaces, 5 runs. On short rows, click 0.83 vs 0.85 ms and ArrowDown 0.64 vs 0.61 ms (applied, mean). On 180-column rows, click 1.13 vs 0.77 ms and ArrowDown 0.86 vs 0.54 ms. A click on a tab row sweeps its geometry (47.6 vs 3.6 rect reads).                                               | No-go. The measured path costs about 3 µs per swept boundary, and +0.35 ms at 180 columns is the worst ordinary case.                               |
| 2. Monospace verification            | Hit test at every third column's DOM x. monospace, JetBrains Mono NF (ligatures on) and iA Writer Mono S: 0 of 339 wrong. Liberation Sans and Noto Sans: 339 of 339 wrong, up to 37 and 39 columns off.                                                                                                                                                 | Go, implemented. Hosts pass arbitrary fonts; Platform's `editor.fontFamily` is free text.                                                           |
| 3. Typing-path forced layout         | Every keystroke forces 2 layouts from script and none in the frame: `refreshHiddenInputContent` (`setSelectionRange` on the focused textarea) and `readRowClientRectScale`. Writing the input after the caret read still gives 2. Keeping the row scale across operations as well gives 1 layout, but layout time only goes 3.10 → 2.94 ms per 24 keys. | No-go. The second layout was the same dirty region laid out in two parts, so merging them saves about 0.007 ms per key.                             |
| 4. Measured-path cache, snap-to-grid | Bounded by candidate 1: the whole measured path is at most 0.35 ms per query on 180-column rows, and unicode rows cost +0.3 ms per click.                                                                                                                                                                                                               | No-go.                                                                                                                                              |
| 5. Caret blink                       | 20 s idle, 3 interleaved rounds, whole-browser CPU. Headed on Wayland with the GPU process on a hardware render node: CSS `steps()` 1.08%, JS interval 0.85%, no blink 0.38% of one core. Headless gave the same order.                                                                                                                                 | No-go. The interval saves 0.23 points of a core. The Chromium issue Monaco cites, frames at display rate for a 2 Hz blink, does not reproduce here. |
| 6. EditContext                       | Every text change arrives as `textupdate` with its replaced range, IME candidates included. Enter is `insertParagraph`. Preventing keydown or beforeinput withholds the update, and paste still fires `paste`. Per event, same fixtures, alternated: typing 0.31–0.35 vs 0.30–0.38 ms (textarea), composition commit 0.48–0.55 vs 0.47–0.65 ms.         | Go, implemented as `inputRoute: 'edit-context'`. Platform makes it the default.                                                                     |

## Monospace verification

`measureTextMetrics` also measures `i l | / - _ % W 0 1` and the space, in the same single layout,
and records whether every advance equals the `m` advance within 0.002 px. Only the regular face is
probed. Rows never draw bold or italic, because `::highlight()` cannot set font properties. A
differing bold advance (synthetic bold, iA Writer Mono S) would therefore only demote rows for
nothing. The view carries the verdict as `monospace`, and `rowGeometryPath` returns
`proportional-font` for rows it would otherwise calculate. With the check in place, all five fonts
hit-test 0 of 339 wrong. Measuring metrics costs 0.09 ms instead of 0.045 ms (mean of 400), once
per font and style.

Proportional fonts still misplace what is estimated from `characterWidth` outside row geometry:
soft-wrap column counts and the spacers of windowed long rows.
[E052](../../plans/e052-proportional-font-extents.md) plans the fix.

## Re-measuring when the face changes

A font change that loads nothing, such as a host swapping a CSS variable to a system face, used
to leave an open editor on the old font's columns. One `ResizeObserver` per window now watches a
sample of the probed glyphs in each editor. The sample sits in a shadow root, so it stays out of
the editor's text content. A delivery clears the metrics cache once and re-measures each editor it
reached. A first sighting also counts as a change, because a font can land between the reading
taken at construction and the first frame. The re-measure applies a reading only when it differs,
so an ordinary mount costs one probe pass and no re-render. A hidden editor reports no size and is
skipped; the view re-measures when it is shown. This replaced the `document.fonts` `loadingdone`
listener. The display-scale listener remains.

## EditContext input route

With `EditorOptions.inputRoute: 'edit-context'` on Chromium, the input element is a focusable
`div` holding an EditContext. Other engines keep the textarea whatever the option says, and the
option defaults to the textarea.

- **Text window:** the editor writes the caret window through `updateText` and `updateSelection`,
  giving a backward selection end first.
- **Edits:** a `textupdate` outside a composition becomes `textUpdateEdit`, which restates the
  written window around the caret, and goes through the existing multi-caret path. Typed
  characters still go through `beforeinput`, which keeps auto-close and snippets, because
  preventing that event withholds the update.
- **Composition:** the route tracks the candidate's span from the end of the range it replaced
  and draws it with the existing preedit. `characterboundsupdate` answers with the preedit's glyph
  rects, so the IME window opens beside the candidate.
- **Screen readers:** the `div` holds the window as text. While the `div` has focus, the caret is
  mirrored into the document selection, which is Monaco's approach. The accessibility tree reports
  the same value as it does for the textarea route.

Both routes commit a composition through one path. Text composed at the written selection is
inserted plainly and never auto-closes a bracket. A composition over a range behind the caret is
a correction. Its range comes from the textarea's selection at `compositionstart` or from the
EditContext update. It is rewritten around every caret. This fixed the textarea route, which used
to insert a correction beside the word it replaced. A composition abandoned without text
resynchronizes the window.

On Chromium the route retires the value diff (`deduceHiddenInputEdit` and its guards) and the
textarea composition commit. Nothing can be deleted while other engines still need them.

## Reproduce

From `examples/stress`, after `bun run build` at the repository root:

```sh
node geometry.mjs --output /work/tmp/editor-e036/run.json --repetitions 5
node geometry.mjs --output /work/tmp/editor-e036/fonts.json --font-check "monospace,Liberation Sans"
node blink.mjs --output /work/tmp/editor-e036/blink.json --headed
node edit-context-probe.mjs --output /work/tmp/editor-e036/edit-context-events.json
node profile-input-layout.mjs --mode trace --repetitions 1 --groups ordinary/single/typing \
  --output /work/tmp/editor-e036/layout-trace
```

Browser tests in `packages/editor`:

- `test/proportionalFont.browser.test.ts`: demotion, live font swaps, a face landing before the
  first frame, several editors sharing one change, and hide and show.
- `test/editContextInput.browser.test.ts`: every input case on both routes through CDP IME
  commands, plus what a screen reader reads and that selection is unaffected.

Platform exercises the app itself with the scenarios `editor-proportional-font` and
`editor-edit-context-input`.
