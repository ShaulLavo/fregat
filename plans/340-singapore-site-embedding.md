# Plan 340: Singapore pages painted by Singapore

## Status and ownership

- Status: Approved.
- Owner request: 2026-10-09. Static and live pages must look the same, wrap correctly, keep syntax colours, and scroll with the page.
- Parent: [Plan 336](336-packages-as-products.md).
- This PR contains the execution plan and baseline screenshots. Separate implementation agents own the editor changes, wrap fixes and site integration.
- Order: fix and prove editor embedding and snapshot support first, then replace the site's separate renderer. [Plan 338](338-singapore-docs-load-speed.md) owns broader startup and asset work. This plan owns snapshot restore qualification and supersedes its assumption that the separate Node prerenderer remains the first paint.
- [Plan 336 iOS scrolling](336-singapore-ios-scroll.md) remains the owner of its existing device probe. Share results with that lane. No work here requires the owner's Mac.

## Outcome

The first visible code sample and manual page are Singapore's own paint. A live editor takes over without changing line breaks, colours, gutters, content height or the reader's place. The document is the only reading scroll area on phone and desktop. The editor grows when its content grows and wraps within the available width.

Keep a "Go live" / "Go static" toggle. Going static freezes the current edited text using the same capture path. Going live restores that paint before parsing or worker startup finishes. Neither action reloads the page, discards edits, changes the URL or moves keyboard focus unexpectedly.

Generated API reference pages remain ordinary static reference pages. This work covers the home sample, hand-written Markdown manual and any live sample using the shared embedding helper. It makes no Monaco/CodeMirror performance, accessibility-parity or general mobile-support claim.

## Reproduction and evidence

Baseline source: `9a4f59425ea0a5fa88a296d053cc6b5a28b2d3c0`, including the manual shipped in PR #1063. On 2026-10-09, reproduce against both the owner's private preview and a fresh production build from main:

```sh
bun install --frozen-lockfile
bunx turbo run build --filter='./editor/packages/*'
bun run --cwd editor/site build
bun run --cwd editor/site preview --host 127.0.0.1 --port <free-port>
```

Open `/?editor=off`, `/docs/start-here/introduction/?editor=off` and `/docs/start-here/quick-start/?editor=off`. Wait for the bundled font, then press "Open in editor". Repeat at 390 × 900 and 1280 × 900 in Chromium and WebKit. Each case was exercised on both preview and local build, 24 switches in total. There were no page errors or failed required requests in these reproductions. A successful worker load does not mean the result is visually correct.

Raw screenshots, scripts and JSON are preserved in `/work/reports/plan-336/evidence/site-embed/`. These are host-specific investigation artifacts, not portable committed verification scripts. Selected screenshots below are copied into the repository so PR reviewers can see the problem.

### Phone wrapping and scroll ownership

Static introduction, Chromium, 390 px:

![Static introduction at 390 px](../docs/evidence/singapore-site-embedding/docs-static-390.png)

After pressing the live button on the same page:

![Live introduction at 390 px](../docs/evidence/singapore-site-embedding/docs-live-390.png)

The first paragraph drops from four display rows to three and text runs off the right edge. Later headings move up. The live scroller is 390 × 818 CSS pixels, with a 412 px scroll width in Chromium and 414 px in WebKit. At desktop width it is 752 × 818 with a 768 px scroll width in Chromium and 771 px in WebKit. Both axes belong to `.editor-virtualized`, although CSS hides its scrollbar.

The static phone manual uses document scrolling. Switching changes `.viewport` from natural height to `100dvh - header - path`. The editor host is absolutely positioned inside that fixed box. This changes the reading model even when the overall screenshot bounds appear stable. Static desktop already scrolls inside `.pane`; the requested result changes desktop to document scrolling too.

### The home sample loses its colours

Before the switch, WebKit, 390 px:

![Static home sample at 390 px](../docs/evidence/singapore-site-embedding/home-static-390.png)

After the switch:

![Uncoloured live home sample at 390 px](../docs/evidence/singapore-site-embedding/home-live-390.png)

This reproduces in both engines, on local and hosted builds, at both widths. The sample box keeps the static height, 638 px on phone and 484 px on desktop. Its live scroll height is 1254 px on phone and 946 px on desktop. Phone scroll widths are 396 px in a 382 px Chromium box and 406 px in a 382 px WebKit box. The static sample therefore remains the wrong height authority after takeover.

The home failure is paint invalidation. Eight syntax highlight groups exist, their ranges point to connected visible editor text nodes, and the computed `::highlight()` colour for `import` is the expected red. `home.ts` mounts under `visibility: hidden`, waits for `CSS.highlights.size`, then reveals the host. That readiness check accepts a registered but unpainted highlight. See `highlight-diagnosis.json` and `home-highlight-reinstall.png` in the raw evidence.

The portable production-site scenario reproduces the failure with native screenshot animations. Disabling animations during capture repaints WebKit and conceals the failure. Registry-only re-registration leaves native paint unchanged. Removing and adding the same editor-owned StaticRanges at `setPresentationReady(true)` restores colours while preserving ranges, shared Highlight objects and other editors' memberships.

The quick-start manual's code fences do show colours in the reviewed screenshots. Do not generalize the home failure to every code fence. Add pixel checks for both paths, since a nonempty global highlight registry can also belong to another editor.

## Existing editor contracts

Read these before implementation:

- `editor/packages/editor/src/editor/Editor.ts`: `captureSnapshot`, `setSnapshot`, `paintAppearance` and admission checks.
- `editor/packages/editor/src/editor/paintSnapshot.ts`: format 5 codec and payload/geometry bounds.
- `editor/packages/editor/src/editor/viewSnapshot.ts`: visible paint classification and token runs.
- `editor/packages/editor/src/virtualization/virtualizedTextView.ts` and `scrollViewport.ts`: provisional paint and native scroll geometry.
- `editor/packages/editor/src/virtualization/virtualizedTextViewRows.ts`: `horizontalViewportColumns`, mounted paint facts and provisional row rendering.
- `editor/packages/editor/src/virtualization/fixedRowVirtualizer.ts`: existing `scrollMode: 'static'` renders all rows and fixes logical vertical scroll at zero.
- `editor/packages/editor/src/virtualization/wordWrap.ts`, `displayProjectionWrap.ts` and `virtualizedTextViewLayout.ts`: wrap rules, projection and font advances.
- `editor/packages/markdown/src/replacements.ts`, `linkRender.ts` and `headings.ts`: preview fragments, links and heading semantics.

Do not build another editor or a second line-breaking implementation. Existing static mode is close to the required all-row layout, but still permits horizontal scrolling and does not make the host auto-height. Reuse its row selection and geometry.

The current snapshot is a saved viewport, not a responsive document. `captureSnapshot()` filters rows to the visible window; format 5 admits at most 400 rows and 262,144 UTF-8 bytes. Saved paint records positioned segments, colours, gutter paint and rectangular layers. It does not preserve arbitrary plugin CSS, rich Markdown links or widget DOM. Rows with inline-kind classes or unreplayable widgets refuse capture. The settled quick-start preview returns `null` from capture in both engines at both investigated widths. Plain code is a required known-good control for this observation.

Restore also checks the appearance fingerprint, device pixel ratio and both outer box dimensions. Chromium and WebKit serialize the same font list differently. A Chromium build capture cannot simply be asserted compatible with WebKit, another width, another theme or another DPR. Keep rejection for actual appearance differences. Normalize equivalent serialization and add a document-paint contract where viewport geometry is deliberately recomputed.

## Editor API and implementation decisions

### Content-height layout

Extend the existing option, rather than adding independent height and scroll switches:

```ts
new Editor(element, {
  scrollMode: 'content',
  wordWrap: true,
  wordWrapBreak: 'word',
})
editor.setScrollMode('content')
```

`'virtualized'` and `'static'` retain their current meanings. `'content'` shares static mode's all-row rendering for docs-sized documents, uses the projection's total height as the editor's natural block height, and owns no horizontal or vertical scrolling. Do not add page-viewport virtualization in this plan. Rendering all rows is the simpler correct starting point and permits a complete accessible document.

- Normal document flow owns the host. No absolute fixed-height host, synthetic bottom reading space, wheel forwarding or hidden overflow masking an oversized row.
- Projection changes publish one content extent after edits, syntax-driven replacements, font load, folds and width changes. Avoid height/ResizeObserver feedback loops.
- Wrap width subtracts gutter, reservations and any caret safety space before choosing a break. Painted text and extent must fit the content box.
- Caret reveal, find results, heading links and keyboard navigation scroll the nearest outside scrolling ancestor, usually the document. Use element visibility and standard scroll APIs; do not copy the page's scroll offset into the editor's logical scroll position.
- Provisional content paint reserves the complete captured height while live syntax prepares. It must allow outside page scrolling and ordinary links.
- The simple `new Editor(element); setText(text)` path needs tests alongside document-backed use.
- Very large documents continue using virtualized mode. Document and test a bounded refusal for content mode beyond its supported paint size; never silently truncate a manual or substitute an inner scroll box.

### Responsive document paint

Keep the existing viewport capture for Fregat. Add an explicit document capture through the same API:

```ts
const saved = editor.captureSnapshot({ scope: 'document' })
// saved.paint is the serialized paint accepted by EditorOptions.snapshot.
new Editor(element, {
  scrollMode: 'content',
  snapshot: saved.paint,
  documentKey,
})
```

The document form stores captured logical display rows, styled runs, safe preview fragments, gutter values and the wrap inputs needed to lay them out again. Source Markdown remains separate for editing. The snapshot's display text and styles come from the real editor after syntax and preview settle. They must not come from a second parser or token renderer.

Expose the codec and a lightweight paint mounting entry under `@singapore-editor/core/paint`:

```ts
const paint = decodePaintSnapshot(serialized)
const mounted = paint && mountPaintSnapshot(element, paint, { width })
// mounted.dispose() releases the provisional rows.
```

`mountPaintSnapshot` and the editor's `restorePaint` share the same row painter and wrap code. The lightweight entry does not construct a document session, parse Markdown, start workers or load language grammars. Keep its import graph small and measure it separately. It is the browser bootstrap for responsive first paint, not a new Node renderer.

- Add a bounded versioned document form with explicit row/run/string limits. Keep existing viewport limits intact. Do not raise the 400-row bound globally to make complete manuals happen to fit.
- Capture supported Markdown font weight, font style, decorations, links, heading ids and roles as structured paint facts. Allow only known safe fragment kinds and link targets. Do not serialize arbitrary plugin HTML or execute snapshot content.
- Replay uses the editor's own wrap routine and measured bundled font advances. Width, theme and DPR changes may reflow the document form; a viewport snapshot still requires exact compatible geometry.
- Normalize equivalent font/colour serialization, without treating different fonts or colours as equal. A theme capture must match the selected palette, or use captured theme roles resolved through the shared palette.
- Add an explicit ready/unsupported outcome for captures. Build failure must name the refused construct and page without private source contents. No polling forever and no successful build with a missing page.
- Preserve paragraph/heading/link reading order in static output. Replayed links work before the live editor loads. The live all-row document has the same accessible names and heading ids.

## Build-time snapshot pipeline

1. Move the site's mounting options into one shared configuration used by the live site and a build-only browser capture page. Home TypeScript and manual Markdown use the same fonts, palette, gutters and preview plugins as their live counterparts.
2. Build capture assets, start an owned loopback server on a free port, and use headless Chromium to mount each real editor in content mode. Await fonts, syntax, preview and authoritative presentation readiness. Capture the full document through `Editor.captureSnapshot({ scope: 'document' })`.
3. Decode and restore each capture into a fresh editor before accepting it. Compare pixels and height. Capture the restored editor's HTML for the server-rendered default-width first paint. Extract heading/search metadata from editor-produced semantic facts. Node assembles the page and escapes the serialized payload; it does not parse Markdown or paint tokens.
4. Inline the serialized document paint and restored HTML into the Astro page. A small early browser bootstrap selects the current width and palette, then mounts or reflows that same captured paint through `core/paint` before the first visible editor frame. The bootstrap has no grammar or editor-session dependency. One responsive document capture avoids shipping a full snapshot for every possible phone width.
5. Keep a complete no-JavaScript article produced from the captured semantic rows. Its native wrapping remains a readable fallback; exact static/live parity is required when the shared paint bootstrap runs. For 320/390/1280, verify that bootstrap adjustment happens before first visible paint, not merely before the toggle.
6. On "Go live", mount the real editor with the inline paint already admitted. Open the original source, preserve the document anchor and settle syntax behind the paint. Commit the live rows only after layout and colour parity. On "Go static", capture the current revision, mount that paint and release the editable editor. Keep edited source in tab memory for the next toggle.
7. Remove `src/manual/render.ts` and its Node grammar loading, token HTML, hyphen/slash wrappers and CSS width approximations once capture owns the output. Update renderer tests to test editor-produced artifacts. Preserve links, search, theme, back/forward navigation and generated API pages.

Build captures are deterministic from the checkout, lockfile and bundled font. Cache by source, editor/plugin build, font and capture contract. Never cache solely by page URL. Capture servers and browsers stop on success and failure. Committed commands accept paths and ports; no machine-specific hosting dependency.

## Wrap and line-breaking work list

A separate editor implementation agent owns this section. First add a failing test or browser scenario, then fix the owning geometry or wrap code.

| Finding                                                               | Reproduction and evidence                                                                                                                                             | Work                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone prose exceeds the content box and changes row count on takeover | Introduction at 390 px, first paragraph is four static rows and three live rows; live right edge reaches 412/414 px in a 390 px box                                   | Trace projection width, actual font advance, inline replacements and extent. Fix width admission at the cause, then remove site approximations.                                                           |
| Content width admits columns beyond the physical edge                 | `horizontalViewportColumns` uses `Math.ceil(width / characterWidth)`; static CSS intentionally rounds differently on phone and desktop                                | Add fractional-width tests around one glyph boundary, with gutter and caret allowance. Never attribute the entire 22/24 px overflow to rounding alone. Validate extent and longest-row contributions too. |
| Home wrapped height differs from the static height                    | 390 px home box remains 638 px while live scroll extent is 1254 px; desktop 484 versus 946 px                                                                         | Compare actual projected rows and font metrics. Fix content height and breaks together; removing overflow alone would hide text.                                                                          |
| Two independent break policies                                        | Static `leavesHtml` wraps hyphen/slash words in `nowrap` spans and releases wide spans on phones; live `appendWordWrapText` owns its own spaces/CJK/unbreakable rules | Delete the static break policy after shared paint is in use. Add parity fixtures for URLs, package names, links and long inline code.                                                                     |

Additional required regression inputs are tabs at wrap boundaries, trailing spaces, nonbreaking spaces, CJK, combining sequences, emoji/surrogate pairs at a chunk boundary, long identifiers, link replacements, emphasis and a caret revealing Markdown marks. These are test targets, not confirmed bugs from this investigation. If one fails, record its exact text, width and row ends here and fix it under this plan. Do not open issues or leave a new wrap failure unowned.

### Wrap implementation evidence

- [x] Keep streamed graphemes intact across storage chunks. [PR #1098](https://github.com/ShaulLavo/fregat/pull/1098) fixes `aaa😀bb` at width 4, whose old row ends were `[4, 7]`, and `aaa ébc` at width 2, whose old ends were `[2, 4, 6, 8]`. Tests cover every chunk split, ZWJ emoji, flags and real 4,096/16,384-unit projection boundaries.
- [x] Admit wrapped text within the measured content width. [PR #1099](https://github.com/ShaulLavo/fregat/pull/1099) measures fallback glyphs, budgets the gutter and caret, floors the column fallback and separates hanging-space scroll width from caret geometry. Before the fix, the home sample had 9/17 px extra extent at 320/390 px in iPhone-descriptor WebKit. The portable phone extent project passes 122 tests across Chromium and WebKit, including a 60 px joined-family-emoji case whose old extent was 90 px, with exact `scrollWidth === clientWidth` before and after caret reveal.
- [x] Restart tabs on each displayed row. [PR #1104](https://github.com/ShaulLavo/fregat/pull/1104) fixes `\t a\ta aa` at width 4, whose old soft ends were `[2, 6]` and whose middle row painted five columns. [PR #1106](https://github.com/ShaulLavo/fregat/pull/1106) completes the column-only paths: `aaaaa\tb\tcdefgh\tij` at widths 5/6 had row ends `[5, 7, 10, 14, 17]`/`[5, 7, 11, 16, 17]`, painting `\tcd`/`\tcde` as six/seven columns. The projection tests include inline-map and block paths, measured and column wrapping, and deterministic edits/fold toggles.
- [x] Wrap long Markdown link labels through row-local rendered fragments. [PR #1114](https://github.com/ShaulLavo/fregat/pull/1114) fixes the real-parser input `read [the long label with words and averylongidentifier](https://example.com) now`, whose old display ends were `[5, 55, 58]` at width 10, leaving a 49-column label. The corrected node fixture fits every row and preserves all preview text. Browser fixtures cover link destinations, keyboard-node disposal, resize, source reveal, emphasis, long inline code and padded table labels, including 320/390 px in Chromium and iPhone-descriptor WebKit. Twelve phone-engine cases pass; the existing Markdown replacement/preview suites pass 55 tests.
- [x] Recheck an oversized word after moving it beyond a space. [PR #1123](https://github.com/ShaulLavo/fregat/pull/1123) fixes ` bbb` at measured width 4 with advances 1 for space and 1.5 for `b`. The old soft ends `[1]` left a 4.5-wide word; the corrected ends `[1, 3]` keep both word fragments within the width.
- [x] Trailing-space regression: `ab   cd  ` at a 72 px viewport with a 32 px gutter and 8 px fallback advance has character-wrap ends `[4, 8, 9]` after the caret allowance, and word-wrap ends `[5, 9]`. Preserve trailing markers at source offsets `[7, 8]` in both modes. Rewrapping an unchanged space-only row must refresh its source range from `[2, 3]` to `[8, 9]`.
- [x] Include patch changesets for core and Markdown behavior changes, with no package version edits.
- [x] Remove repeated grapheme-boundary searches and fragmented tab-prefix rescans found in review. The scanner segments each new storage chunk once and caches only its latest chunk. The tab fallback visits each measured source range once. Failing-first counters recorded 997 segmentation calls for a 1,050-unit line and 422,093 range-end reads for 1,024 source ranges. Their regression tests require at most two segmentations and four range-end reads per source range.

Local review experiments on 2026-10-09 used Bun 1.4.2 on Linux with an Intel Core i7-14700K. Paired medians at 1,075,200 UTF-16 units were 582.01 ms before and 8.54 ms after for the repeated mixed-Unicode fixture; the earlier scanner was 4.46 ms but split graphemes. A unique-chunk control was 689.86 ms before and 37.02 ms after, exposing the remaining cost of one segmentation per new chunk. At 1,048,576 units across 16,384 source fragments, tab wrapping fell from 276.94 ms to 2.06 ms. These are bounded scanner experiments, not browser interaction or product speed claims.

A separate large-Markdown experiment on the same host used 1,048,616 UTF-16 units with 12,788 links, a fresh parser for each of three runs and wrap width 40. It validated 12,788 textual link replacements within 38,364 mapped replacements and 25,577 projected rows. Median construction time was 7,768.62 ms; median stage times were 40.97 ms parsing, 7,612.24 ms replacement construction, 45.69 ms inline-map construction and 40.79 ms projection construction. Stage medians are independent and do not sum to the total median. This excludes browser layout and measures initial construction, not interactive wrapping.

- [x] Make large link-heavy replacement construction linear while preserving nested labels and markers. Completed in [PR #1135](https://github.com/ShaulLavo/fregat/pull/1135) with structural work counters and paired construction measurements. See [Follow-up: Markdown replacement construction](#follow-up-markdown-replacement-construction).

The width fixtures also cover fractional glyph boundaries, prose, long identifiers, CJK, URLs, package names, nonbreaking spaces, combining sequences, emoji and trailing spaces. Screenshots were read back. These checks prove live editor containment and source preservation, not static/live pixel parity.

The home height numbers alone do not prove duplicate wrapped rows. Their excesses exactly match the existing `scrollPastEnd` padding: `1254 - 638 = 638 - 22`, and `946 - 484 = 484 - 22`. Content-height ownership and hidden-to-visible highlights remain with their separate implementation lane. Deleting the site's independent break policy and proving static/live parity remain Phase 3 work.

### Follow-up: Scaled Markdown heading wrapping

Status: **Approved**. Blocks Phase 3 phone qualification; owned by the editor wrap lane.

- [ ] Wrap native headings and document-paint replay using each row's rendered typography. Keep the site on the shared editor policy and preserve heading size and weight.
- [ ] Add native and replay extent checks for the actual CodeMirror and Quick start manuals at 312/382 px content widths and 320/390 px touch viewports, including DPR 2.

On 2026-10-10, `bun --cwd editor/site scripts/capture.ts` rejected `start-here-codemirror.md-light: live overflows at 312px: [{"width":312,"scrollWidth":318},{"width":312,"scrollWidth":318}]` before snapshot replay. Quick start's `2. Give the editor a container` heading has a captured row font size of 16.8 px with a 14 px root font. The touch-enabled product-site audit expanded its 320 px layout viewport to 348 px in Chromium and 350 px in WebKit; WebKit's live editor had 38 px extra horizontal scroll extent.

`documentPaintRows.ts` creates glyph advances from the root once and reuses them across rows with different typography. Native heading wrapping also exceeds its content box. Original/live/emitted screenshot equality alone missed this because all three cropped the oversized heading. Build capture now checks horizontal extents before comparing pixels. The activation API is a separate dependency; run this reproduction after its build is available. Keep the failing phone audit and capture-refusal evidence with Phase 3 verification.

### Follow-up: WebKit link-boundary paint

Status: **Approved**. Blocks Phase 3 exact-pixel acceptance. The library/browser cause is unconfirmed; the site lane leaves core source unchanged.

- [ ] Reproduce Quick start's native versus replay colours at a 390 px touch viewport, both palettes, with `bun run --cwd editor/site test:browser tests/manual.browser.ts -t 'manual at 390'`. Use a qualified capture build after the heading fix. Chromium's two cases pass; WebKit's two cases fail on the current interim capture. Do not relax pixel equality or recolour the site to hide it.
- [ ] Inspect native highlight endpoints around source line 61's languages link and line 67's playground link. Native WebKit colours the literal `to` and `on` as links; replay uses foreground. At the languages link, `editor-shared-token-11` begins at an element boundary and ends on the following `to` text node at offset 0. Replay has no range on that literal. Inspect `editor/packages/editor/src/virtualization/virtualizedTextViewGeometry.ts` around `new StaticRangeConstructor` (line 1479 at the lane's merge base). Establish a minimal boundary-range control before attributing this to WebKit or changing endpoint construction.
- [ ] Preserve same-engine, same-font pixel comparisons after the fix and rerun the full site takeover matrix.

On 2026-10-10 the 390 px rerun passed two Chromium cases and failed both WebKit palettes after provisional/native readiness was corrected. RGB comparison places the light-palette difference at `(100, 2118, 333, 2329)` in a 382 × 2354 px document screenshot. Evidence is retained under `phase-340-site/runtime-settlement/` in the existing site-embed evidence directory: `phase340-manual390-current.log`, `phase340-webkit-range-boundaries.log`, and the static/live difference crops. The diagnostic converts native `StaticRange` endpoints to a DOM `Range` for inspection; directly calling `intersectsNode` on `StaticRange` was an invalid observation and is excluded. A standalone element-boundary to trailing-text-offset-0 control left `to` in foreground in both engines, so no upstream browser bug is established. Its script, log and before/after images are retained with the same evidence. No provider, remote Mac or core source was used.

## Snapshot speed budget

First paint is complete editor-produced HTML emitted at build time and remains visible without JavaScript replay. Responsive replay runs at takeover or a toggle, separately from worker/parser startup. These are qualification budgets, not achieved product claims. Speed qualification is a follow-up and does not gate merging the correctness implementation after independent re-review passes:

- Gate: decode, responsive layout, DOM insertion and forced layout at p95 within 50 ms after the bundled font is ready, with 30 independent repetitions per engine and width. This is the takeover response budget.
- Goal: the same work at p95 within 8 ms on the reference desktop. Preserve exact document pixels while pursuing this goal.
- Goal: within 16 ms at p95 in Chromium with 4× CPU slowdown. Gate: no individual restore long task over 50 ms. Chromium slowdown is an experiment, not an iPhone measurement. WebKit runs its own unthrottled qualification.
- A server-rendered captured article is visible before full editor code or grammars load. The captured DOM needs no decode or replay for its first paint; the responsive paint entry has no worker or wasm dependency.
- No visible blank frame, no toggle-induced layout shift, and zero changed document pixels between static and ready live states at the required widths. Mask only the caret and the toggle label, never text or gutters.
- Start with at most 32 KiB compressed document paint for the home sample, 96 KiB for a representative manual, and 16 KiB compressed for the paint-only entry. Record raw/decoded sizes and total HTML as well. An oversized page fails qualification and gets a measured compression or representation fix.

Measure parse/decode, font wait, document reflow, DOM insertion, forced layout, first painted frame and live settlement separately. Include the largest manual and a fixture above 400 rendered rows. Qualify 320, 390 and 1280 px, cold and warm entry caches, both palettes and DPR 1/2/3. Run a browser trace of the same restore scenario before and after any optimization, with `trace --compare`; report render/mounted-row counts. Do not call registry presence a paint timestamp.

The investigation first tried the settled Markdown capture and a plain-code control. Markdown capture refuses its rich preview paint, so its restore latency cannot be measured yet.

A feasibility experiment on 2026-10-09 used an Intel Core i7-14700K Linux host, Playwright 1.63.0, installed Chromium build 1243 and WebKit build 2359, DPR 1 and the bundled JetBrains Mono. It captured a viewport containing 38 rows from a 60-line TypeScript document and timed the synchronous `setSnapshot` call 20 times in a warm page. All 20 attempts per case admitted provisional paint. The capture was about 43.6 KiB of serialized text.

| Engine   | Width   | Restore p50 | Restore p95 | Maximum |
| -------- | ------- | ----------- | ----------- | ------- |
| Chromium | 390 px  | 5.3 ms      | 6.7 ms      | 7.1 ms  |
| Chromium | 1280 px | 5.6 ms      | 7.0 ms      | 8.5 ms  |
| WebKit   | 390 px  | 8 ms        | 10 ms       | 12 ms   |
| WebKit   | 1280 px | 8 ms        | 9 ms        | 12 ms   |

This is encouraging for a small captured viewport, but WebKit already misses the proposed 8 ms p95 budget. It excludes editor construction, entry download, font loading and the next painted frame. It does not measure complete responsive documents or rich Markdown, and is not a public performance claim. The script and raw samples are `snapshot-code-probe.cjs` and `snapshot-code-probe.json` in the evidence directory. Earlier zero-width probe attempts were invalid controls and are excluded. Phase 2 must publish admitted full-document restore measurements before site integration is accepted.

## Execution phases

### Phase 1: Editor embedding and wrap correctness

- [ ] Add portable failing scenarios for the phone and desktop overflow, content-height changes and hidden-to-visible highlight paint.
- [x] Implement `scrollMode: 'content'` by reusing static all-row rendering. Test outside scroll reveal, edits, resize, font load, syntax replacements and disposal.
- [ ] Fix reproduced wrap/line-breaking failures from the list above. Separate wrap PRs where the root causes differ.
- [x] Make hidden-to-visible presentation restore existing highlight paint at the owning editor lifecycle boundary. Reuse the existing highlight restoration path where appropriate; no site-wide registry manipulation or timer retry loop.
- [ ] Give each public editor behavior change a patch changeset for affected packages. Do not edit package version numbers.

### Phase 2: Complete and responsive snapshot paint

- [x] Add document capture, safe Markdown fragment capture, shared replay and the lightweight `core/paint` entry. Keep viewport captures and rejection gates covered.
- [x] Add capture/restore pixel tests, malformed/oversized payload tests, unsafe link tests, unsupported plugin tests and a complete document above 400 rows.
- [x] Prove responsive layout and semantic equivalence in Chromium and WebKit, including theme, DPR, fonts and cold startup. Add a patch changeset for core and Markdown API/behavior changes.
- [x] Measure admitted restore against the speed and payload budgets. Commit a portable benchmark/scenario and evidence before claiming it is landing-page ready.

Implementation and exact-pixel proof are in [PR #1217](https://github.com/ShaulLavo/fregat/pull/1217). The final library matrix passes 162 tests across Chromium and WebKit, DPR 1/2/3, both palettes, JetBrains Mono, Source Serif 4 and FreeSans, with one payload reflowed at 320/390/1280 px. It covers serialized HTML, fresh Markdown takeover, hidden-to-visible paint and an isolated cold paint-only entry. Expanded fold candidates remain capturable; collapsed folds are refused.

[Raw evidence](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/document-paint-2026-10-10/results.json) records the final non-quiet Linux experiment and earlier attempts, including failures. The paint entry is 15,620 bytes minified and 5,800 bytes gzip across nine modules, without editor/session/parser/worker imports. Captured payloads span 918–4,716 bytes gzip.

Speed qualification remains open as an explicit follow-up, not a merge gate. The correctness implementation can merge after independent re-review passes. Phase 3 site integration starts in a separate lane.

### Follow-up: Snapshot restore speed qualification

Status: **Approved**. Separate from the Phase 2 correctness merge. No qualified speed or landing-page readiness claim is made.

Baseline is the non-quiet Linux experiment in the raw evidence above. Warm p95 spans 0.5–53 ms, and the largest individual restore sample is 116 ms. The recorded exceptions are:

| Engine/DPR | Fixture and width       | p95   | Maximum sample |
| ---------- | ----------------------- | ----- | -------------- |
| WebKit/1   | 450 rows, 390 px        | 36 ms | 116 ms         |
| WebKit/2   | 450 rows, 320 px        | 53 ms | 55 ms          |
| WebKit/2   | Largest manual, 1280 px | 41 ms | 72 ms          |

Chromium observes page long tasks of 52–182 ms during benchmark windows. These have no per-restore attribution. The 4× Chromium slowdown p95 spans 27.8–41.4 ms and misses the 16 ms goal. Earlier over-budget experiments are also retained. Exact pixels and complete content height now pass; the remaining problem is performance attribution and qualification.

- [ ] Profile the 450-row restore on a quiet machine whose local policy permits quiet measurements. Follow that host's scheduler and resource rules. Record machine, power/load conditions, browser/runtime versions and source revision. Run `bun run --cwd editor/packages/editor bench:paint --project snapshot-webkit-dpr1 -t 'captures and mounts every row in a document above 400 rows'`, then repeat for Chromium/WebKit at DPR 1/2/3. Each run covers 320/390/1280 px with 30 independent samples.
- [ ] Attribute long tasks to individual restores before choosing a fix. Add per-iteration start/end marks around decode, mount, forced layout and disposal in `editor/packages/editor/test/documentPaint.browser.test.ts`'s `benchmark`. Correlate observer entries and browser traces with those intervals; separate replay work, disposal, garbage collection and other page work. WebKit needs trace-based attribution where its long-task observer is unavailable. Inspect `decodeDocumentPaint` in `src/editor/documentPaint.ts` and `mountDocumentPaint`/`appendGutter` in `src/virtualization/documentPaintRows.ts` under the editor package. Their relative cost is unconfirmed. Publish the raw `samples`, `decode`, `mount`, `layout`, intervals and trace evidence before/after any optimization.
- [ ] Based on the profile, consider replaying in bounded chunks over a few frames, or replaying the viewport plus a margin first and finishing the remainder afterward. Preserve the complete capture and reserved document height, reading order, links and anchors. Existing editor-produced HTML must remain visually identical through every intermediate frame and the final swap; no blank frame, clipped content, scroll-anchor shift or partial-paint flash. Compare these approaches with a simpler measured fix before adding scheduling complexity.
- [ ] Rerun the full exact-pixel and height matrix, cold entry, fresh takeover and hidden-to-visible proofs. Read screenshots and intermediate frames. Qualify the 50 ms p95/individual-task bounds and record progress against the 8 ms desktop and 16 ms slowdown goals. Real-site first-visible-frame, scroll-anchor and toggle acceptance remains Phase 3/4 work.

### Phase 3: Site capture and takeover

- [ ] Replace Node rendering with the build-time browser capture pipeline and inline payload.
- [ ] Move manual and home samples into normal flow with page scrolling. Delete fixed takeover height, hidden scrollbars, wheel forwarding and duplicated wrap CSS.
- [ ] Implement both toggle directions, edited-text preservation, theme, links, search and history on the shared snapshot path.
- [ ] Add a site-specific portable browser scenario and selectors for both home and manual. Extend the existing mobile check to exercise live mode, not only the static phone default.
- [ ] Site-only changes need no changeset. Keep one implementation PR focused on site integration after the editor PRs merge.

### Phase 4: Acceptance and closeout

- [ ] At 320/390/1280 px in Chromium and WebKit, pixel-compare home and representative manual before takeover, after live settlement and after returning static. Same engine, font, theme, DPR and scroll anchor for each comparison. Also capture intermediate frames to catch a switch flash.
- [ ] Match document height and every heading/line anchor. No inner scrollbars or scrollable editor extent, no horizontal document overflow, no clipped source, and no hidden overflow concealing a failure.
- [ ] Confirm syntax colours by screenshot pixels for keywords, strings, comments and numbers after both switches, theme changes and resizing. Check actual editor-owned ranges and connected nodes too.
- [ ] Scroll from page margins and code/prose on phone and desktop. Caret/find/heading reveal uses the page; keyboard focus and all text remain reachable.
- [ ] Block worker/grammar requests, disable JavaScript, and delay the editor entry. The captured article and links remain readable, and a failed live switch retains static paint and edited text.
- [ ] Pass site build, link/sample checks and `bun run --cwd editor/site test:browser`. Extend browser coverage to WebKit and mobile for the new paths.
- [ ] Keep all four `mobile-layout` CI shards green. Run `bun scripts/product-sites/test-mobile.mjs` and the portable `verify-mobile.mjs` flow against built product sites, including live phone takeover.
- [ ] Pass `bun run plans:check`, record final evidence and measured budgets here, and mark the implementing phases complete. No package-performance headline is published from experiment-only numbers.

### Follow-up: Markdown replacement construction

- [x] Profile and remove the repeated full-array scans and rebuilds during link replacement construction. Preserve replacement order, formatted labels, reveal ranges and per-line fragment boundaries. Add a bounded-work regression and a patch changeset.

The link-heavy reproduction has 1,048,616 UTF-16 units and 12,788 links. The original experiment measured a 7,768.62 ms median for complete construction, with replacement derivation taking 7,612.24 ms. Browser layout was excluded. CPU profiles confirm that each link scanned the complete link list, filtered all replacement specs twice and spliced the retained array back into place. Formatted labels also rebuilt their complete string for each hidden marker.

The fix orders unsigned parser offsets with stable radix passes, visits the markers once across source-ordered link labels, joins label chunks once and compacts retained specs once. It restores the original provider order after the sweep. Existing link mounting and wrapped-fragment rendering are unchanged.

Matched three-run experiments, using a fresh Bun process for each version and size, on 2026-10-09, Linux 7.2.8-arch1-2, Intel Core i7-14700K, Bun 1.4.2:

| UTF-16 units | Links  | Replacement median before | Replacement median after | Complete construction before | Complete construction after |
| ------------ | ------ | ------------------------- | ------------------------ | ---------------------------- | --------------------------- |
| 524,308      | 6,394  | 1,577.21 ms               | 17.80 ms                 | 1,651.09 ms                  | 82.10 ms                    |
| 1,048,616    | 12,788 | 9,007.32 ms               | 41.63 ms                 | 9,138.05 ms                  | 188.31 ms                   |

These are construction experiments on one shared host. They include a fresh parser, piece table, replacement specs, inline map and projection row count, and exclude browser layout, paint, fonts, workers and network. They support no general browser-startup or competitor claim. The full-size result still has 38,364 replacements and 25,577 projected rows.

The regression counts source-range visits at 128 and 1,024 links, including reversed input order. The old code fails at 128 links with 33,024 visits against a 5,120-visit bound. A saved snapshot covers formatted multiline labels and source boundaries. An additional 144-case experiment matched every replacement field except render-function identity. Chromium and WebKit each passed the six existing fragment, resize, reveal and table-link tests.

Portable reproduction after building the workspaces:

```sh
bun editor/packages/editor/bench/markdownConstruction.ts 524288
bun editor/packages/editor/bench/markdownConstruction.ts 1048576
```

Raw timing samples, method and machine details are in `editor/docs/performance/markdown-construction-2026-10-09/results.json`. The failing-test commit records the baseline algorithm. This follow-up makes no change to the other unchecked embedding and snapshot phases.
