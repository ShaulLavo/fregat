# Plan 340: Browsable Singapore documentation

## Status and ownership

- Status: Approved.
- Owner request: 2026-10-10.
- Parent: [Plan 336](336-packages-as-products.md).
- The whole-page editor approach was rejected. Making the entire manual editable made phone browsing difficult, could open the keyboard while reading, and introduced intimidating motion. PR #1233 remains the abandoned implementation and review record; this replacement starts from main.
- The owner's final direction keeps ordinary HTML pages, static Singapore code snapshots, and one explicit **Make live** button per example. The runtime prepares at idle; only that button enables editing. The home inline editor and separate `/demo/` remain.

## Outcome

Manual pages use semantic HTML paragraphs, headings, lists and tables. Phone and desktop use document scrolling. Code examples are Singapore's build-time document paint, including colours, gutters and wrapping. No page editor, page capture, navigation takeover, whole-page live/static toggle or compatibility shim remains.

Examples grow with their content and wrap inside their reading column. Container-selected build snapshots use the editor's own line-breaking and paint APIs. Light/dark and JavaScript-off stay readable. Captured colour spans paint directly from HTML before scripts and keep hidden theme variants independent of browser Highlight invalidation.

After loading, idle work loads the editor runtime and prepares nearby examples without focus. The small accessible button is the only activation path. Pressing it after preparation changes neither geometry nor colours; an early press keeps the static example and announces preparation. Focus and selection are intentionally scoped to the requested example, with document scroll retained. No load or activation animation is used, including under reduced motion.

## Execution checklist

- [x] Replace Markdown live-preview rows with ordinary Astro-rendered prose.
- [x] Delete whole-page takeover, raw page-source endpoints, and superseded browser tests.
- [x] Capture only fenced examples through `core/paint`; emit the captured colours directly in HTML for reliable first paint.
- [x] Add explicit, accessible per-example activation and idle preparation.
- [x] Preserve font preloads, add metric-matched fallbacks, retain the skip-link focus fix and keep `/demo/` separate.
- [x] Verify Chromium and WebKit at 320, 390, 768 and 1280 px: readable prose, no horizontal page overflow, no example inner scroll, Chromium CLS 0 and unchanged WebKit geometry, Chromium phone swipes and WebKit native wheel/touch taps never focusing an editor, and JavaScript-off readability.
- [x] Prove ready activation is immediate, early activation is announced, and focus/selection/scroll stay scoped to one example.
- [x] Read `look` screenshots and publish one private preview URL; send its first browsable version before polishing.
- [x] Commit and push by path, open the replacement PR. Leave #1233 open for the coordinator. Do not deploy to Cloudflare or watch CI.

## Review lessons retained

PR #1233 highlighted unexpected focus/selection changes, unnamed editor inputs and readiness tests that accepted a nonempty global highlight registry. Example preparation must check its own document-paint readiness; input labels identify the sample. Background hosts are inert. Activation starts selection at the beginning and focuses only after a deliberate button request. The skip link focuses the semantic main region even before editor preparation.

## Verification commands

Build editor workspaces, then `bun run --cwd editor/site build`. Run `bun run --cwd editor/site test` and `bun run --cwd editor/site test:browser`. Review `bun run agent:browser look --site --static-dir editor/site/dist --width 390 --height 844` and corresponding desktop/WebKit runs. Host-local heavy scheduling and private previews follow the owner's local skills; contributor commands stay portable.

No public editor package changes are needed. The format-6 document-paint API and content-height layout already shipped; their implementation remains in the editor packages.

## Qualified replacement

Replacement: [PR #1246](https://github.com/ShaulLavo/fregat/pull/1246).

The 2026-10-10 Mac production build generated 3,146 pages, captured 30 distinct
examples, and validated 203,781 internal links and anchors. The initial 28-test
Mac qualification missed the invalid no-match query, search ranking, normal dev
entry point and Starlight activation surface; independent review and CI exposed
those gaps. The review revision adds real-index title/full-heading search and
nine browser regressions for dev capture, Starlight paint, example-free pages
and repeated failed downloads. Static/live example screenshot bytes agree at
every qualified width.
Prepared click-to-activation in the final revision measured 2.4–3 ms in Chromium
and 5–7 ms in WebKit.
Early requests visibly retain static paint and announce preparation before focus
moves into the requested example.

Reload frame captures on home and Quick start keep captured colours in every
visible frame. System, stored and toggled theme labels agree with the displayed
theme. JavaScript-off pages remain readable at all eight engine/width pairs.
Chromium reports native CLS 0; WebKit lacks the LayoutShift API and is qualified
by unchanged document-relative geometry. Narrow WebKit uses a touch-capable
desktop context with wheel scrolling and taps because its automation lacks native
swipes. Four `look` runs reported healthy pages; their screenshots and the final
phone/desktop docs images were read.

The early private preview remains the same disposable app throughout revisions.
No public editor package source changed, so no changeset is required. No
Cloudflare deployment or CI watching is part of this replacement. PR #1233 stays
open for the coordinator; the replacement merges before the hosting PR rebases.

## Independent review revision

- [x] Start the shared capture path from the normal dev command and close its
      browser, HTTP servers and endpoint on shutdown. Vite middleware mode and
      caller-owned browser signals keep cleanup under the wrapper's control.
- [x] Exclude example figures from Starlight prose spacing; exact static/live
      pixels, gutter placement and height agree on its playground page.
- [x] Keep the runtime unloaded on authored and reference pages without examples.
- [x] Capture deliberate retry diagnostics and qualify the root-base CI build.
      Rejected promises are cleared and fresh module records recover after two
      aborted downloads. The intermittent investigation below remains open.
- [x] Use a verified zero-match Pagefind query, weight authored headings and wait
      for the current query to settle. Exact title and full-heading searches rank the
      authored Quick start page first.
- [x] Remove the obsolete direct-site runtime-pin assertion while retaining the
      editor host, Markdown, override, peer and release-fixture pin contracts.

Final Mac checks: 37 browser tests and 15 site unit tests pass; the targeted root
pin regression, repository typechecks, whole-tree gates, site lint and formatting
pass. The browser helper isolates dev output from the production search index and
clears Vitest's inherited process marker, which otherwise disables Astro's HTTP
route handler. Its DOM assertion waits through the initial development reload.
Four new Starlight `look` runs (390 and 1280 px, Chromium and WebKit) report healthy
pages; every screenshot was read. The same private preview serves the verified
revision. CI status is inspected once after pushing and reported in the handoff;
it is not watched or assumed green.

### WebKit retry failure — slow optional font identified

The [hosting integration run](https://github.com/ShaulLavo/fregat/actions/runs/38071251341/job/114269009967)
failed at `editor/site/tests/review.browser.ts:114`: after two announced download
failures, the third activation still had no `data-example-live` after 20 seconds.
Chromium passed. The old assertion recorded neither the final status nor the
request and click sequence, so this does not establish a module-cache cause.

- [x] Run a bounded Linux baseline from `c7e6e27b` with a root-base build:
      `bun run --cwd editor/site build` then
      `bun run --cwd editor/site test:browser -- tests/review.browser.ts -t "failed runtime download"`.
      All 41 repetitions passed in both engines; the complete 37-test browser
      suite also passed. A broken root-base runtime URL was not reproduced.
- [x] Record actual clicks, runtime URLs, failed requests, browser errors and the
      final example state. Capture the attempt number before asynchronous routing
      so a later request cannot change an earlier request's injected outcome.
- [x] Run ten bounded diagnostic cases per engine in Ubuntu CI. The explicit
      root-base build and all 55 browser tests passed in the
      [diagnostic run](https://github.com/ShaulLavo/fregat/actions/runs/38073480255/job/114275706422).
      Fresh root-base Mac verification also passed all 20 diagnostic cases. Keep
      two retry cases per engine in routine CI to bound its cost.
- [x] Investigate the [captured recurrence](https://github.com/ShaulLavo/fregat/actions/runs/38076005583/job/114283053679).
      The third entry request had no failed-request event. Instrumenting
      `FontFaceSet.prototype.load` identified the later font wait as the source of
      `NetworkError`, with the JetBrains Mono face in `error` state.
- [x] Reproduce the exact two-abort/third-allowed sequence on Mac Chromium and
      WebKit, first with immediate fonts, then with 1.5-second and 5-second font
      delays. Immediate responses passed in both engines. Delayed responses
      failed in WebKit at `document.fonts.load`; Chromium passed.
- [x] Repeat with a real delayed HTTP font response, without intercepting the
      font request. WebKit failed with `font-display: optional` and passed with
      `swap`; the third module response was HTTP 200 in both cases. This rules
      out a font-route race and a failed static-import dependency for the reproduction.
- [x] Preserve `font-display: optional`, both preloads and metric-matched
      fallbacks. Treat expiry of the optional font as nonfatal during live
      preparation. When the optional face has not loaded, pin the live editor
      and retained static paint roots to the same metric-matched fallback. WebKit
      otherwise blanks static text while the expired face downloads and paints
      it with Mono after the response. Pin both representations so measurements
      and paint stay on the rendered fallback. Do not introduce a late font
      swap, module-graph retry or timeout extension.
- [x] Replace the two identical routine retry cases with immediate-font and
      1.5-second-delayed-font cases. Record entry/font responses, font-load
      start/completion/failure and face states alongside the existing click and
      failure timeline. Assert retained-static/live pixel equality after font
      selection, unchanged height, and unchanged live pixels after the delayed
      response finishes. Await font route cleanup before closing the context.
- [x] Reduce WebKit's optional-font paint bug to plain HTML with a real delayed
      HTTP response and a fallback-only control. Document the workaround in
      `editor/docs/display/browser-quirks.md` and add the ready-to-file upstream
      entry to the owner's local queue. No upstream issue was posted.

The final 2026-10-10 Mac qualification preserves optional fonts: all four
immediate/delayed retry cases pass, including WebKit's recorded font-load failure.
The complete browser suite passes 43 tests and site unit tests pass 15. Site build,
types, samples, lint and formatting, plus repository gates pass. Existing wrap,
height, scroll, focus and normal ready-activation pixel checks remain green.
The delayed path compares the retained HTML after the browser's expired-font
selection has been pinned; an initial WebKit frame can be blank before that
selection, as the standalone upstream reproduction demonstrates.

The source fix is qualified locally; deployment still waits for its PR to merge.
Pending stylesheet loading was already ruled out: production HTML links editor
CSS before scripts.
