# Plan 340: Browsable Singapore documentation

## Status and ownership

- Status: Approved.
- Owner request: 2026-10-10.
- Parent: [Plan 336](336-packages-as-products.md).
- The whole-page editor approach was rejected. Making the entire manual editable made phone browsing difficult, could open the keyboard while reading, and introduced intimidating motion. PR #1233 remains the abandoned implementation and review record; this replacement starts from main.
- The owner's final direction keeps ordinary HTML pages, static Singapore code snapshots, and one explicit **Make live** button per example. The runtime prepares at idle; only that button enables editing. The home inline editor and separate `/demo/` remain.

## Outcome

Manual pages use semantic HTML paragraphs, headings, lists and tables. Phone and desktop use document scrolling. Code examples are Singapore's build-time document paint, including colours, gutters and wrapping. No page editor, page capture, navigation takeover, whole-page live/static toggle or compatibility shim remains.

Examples grow with their content and wrap inside their reading column. Container-selected build snapshots use the editor's own line-breaking and paint APIs. Light/dark and JavaScript-off stay readable. A head paint gate and per-root activation establish highlights before the first visible frame.

After loading, idle work loads the editor runtime and prepares nearby examples without focus. The small accessible button is the only activation path. Pressing it after preparation changes neither geometry nor colours; an early press keeps the static example and announces preparation. Focus and selection are intentionally scoped to the requested example, with document scroll retained. No load or activation animation is used, including under reduced motion.

## Execution checklist

- [x] Replace Markdown live-preview rows with ordinary Astro-rendered prose.
- [x] Delete whole-page takeover, raw page-source endpoints, and superseded browser tests.
- [x] Capture only fenced examples through `core/paint`; use `preparePaintSnapshotHighlights` and `activatePaintSnapshotHighlights` for first paint.
- [x] Add explicit, accessible per-example activation and idle preparation.
- [x] Preserve font preloads, add metric-matched fallbacks, retain the skip-link focus fix and keep `/demo/` separate.
- [ ] Verify Chromium and WebKit at 320, 390, 768 and 1280 px: readable prose, no horizontal page overflow, no example inner scroll, CLS 0, phone swipes never focusing an editor, and JavaScript-off readability.
- [ ] Prove ready activation is immediate, early activation is announced, and focus/selection/scroll stay scoped to one example.
- [ ] Read `look` screenshots and publish one private preview URL; send its first browsable version before polishing.
- [ ] Commit and push by path, open the replacement PR. Leave #1233 open for the coordinator. Do not deploy to Cloudflare or watch CI.

## Review lessons retained

PR #1233 highlighted unexpected focus/selection changes, unnamed editor inputs and readiness tests that accepted a nonempty global highlight registry. Example preparation must check its own syntax records; input labels identify the sample. Background hosts are inert. Activation starts selection at the beginning and focuses only after a deliberate button request. The skip link focuses the semantic main region even before editor preparation.

## Verification commands

Build editor workspaces, then `bun run --cwd editor/site build`. Run `bun run --cwd editor/site test` and `bun run --cwd editor/site test:browser`. Review `bun run agent:browser look --site --static-dir editor/site/dist --width 390 --height 844` and corresponding desktop/WebKit runs. Host-local heavy scheduling and private previews follow the owner's local skills; contributor commands stay portable.

No public editor package changes are needed. The format-6 document-paint API and content-height layout already shipped; their implementation remains in the editor packages.
