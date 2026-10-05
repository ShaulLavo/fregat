# File-open first paint

Unprepared document opens publish text before scanning the whole document for indentation folds.
The scan uses the existing secondary-work queue: 150 ms after the latest update, with a 400 ms
maximum delay during sustained typing. It reads the current document when it runs and publishes
the resulting fold markers through a layout update.

Explicit fold commands flush pending work immediately, including commands that do not change a
collapse. A document replacement clears the outgoing markers. Detachment, disposal, and prepared
adoption cancel pending work. Ready prepared folds still arrive in the first atomic render.
Detached `setContent` retains its synchronous behavior.

## What the measurement found

The initial E001 diagnostic run measured a 36–37 ms fallback-fold scan inside attachment of the
500,000-line fixture. The scan ran even when no fold gutter was installed. Text had reached the DOM,
but the browser could not paint until the synchronous call returned.

Grammar resolution and parsing already complete asynchronously. First-party session creation did
not contain a synchronous parse, so E003 keeps the existing preparation and session APIs.
Required font metrics, line geometry, and indentation-width detection stay before text readiness.
The latter samples at most 10,000 lines and controls caret and editing behavior.

The [measured results](../../examples/stress/results/first-paint/README.md) compare cold and warm
opens, ordinary and huge files, direct and ready-prepared attachment, and Tree-sitter enabled or
disabled. The unchanged control records measurement variability. Diagnostic runs are separate
from the production measurements.

Deferral moves the fallback scan; it does not reduce its total CPU cost. An incremental indentation
index could remove repeated whole-document work. That is a separate algorithm change, especially
for nested regions and edits that change indentation. This change reuses the scheduler that already
keeps the scan out of rapid input handlers.

## Readiness and ownership

`onInitialPaint` retains its existing phases and generation fields. `text` reports current text
adoption with required geometry. It does not promise optional fallback folds. `highlight-settled`
reports the current terminal highlight outcome. These callbacks are readiness observations;
neither proves pixels reached the screen. Benchmark paint measurements include screenshot
completion and are labeled upper bounds.

Prepared revision and configuration matching remain exact. Late syntax results still pass the
document, content, configuration, and runtime-session checks. A cached image is never document
truth. A failed highlighter refresh retries once on the same session and once on a reloaded one,
then settles as `error` with one `editor.syntax.highlight_retries_exhausted` warning; a retry that
paints logs `editor.syntax.highlight_recovered`. Failure stays an observable terminal outcome. Before any document the status is `idle`, so every other value
except `loading` means settled.

Highlighter preparation includes the provider-base theme prerequisite. A cold highlighter
`startStage` acquires its token result and the actual ordered `themeProviders` loader result in the
same retained analysis entry. A singleton request defaults to its session provider. Multi-provider
callers pass every registered provider in order, including providers without a loader, and use the
highlighter configuration tag for the complete cohort. Borrow matching uses
`highlighterThemeProviders`, provider identities and captured loader-function identities.

The ordered search skips absent loaders, continues after `undefined`, and accepts the first theme
or explicit `null`. Rejection fails preparation. A ready retained highlighter read exposes its
`providerTheme` outcome alongside the session's token result. Provider base, session-result theme
and configured Editor theme retain that override order.

Compatible fully ready preparation attaches synchronously through the existing atomic render,
without a new constructor theme acquisition. Ordinary edits reuse the entry's certified theme
while current tokens advance. Explicit theme refresh retries a failed retained certificate once
through its existing owner; shared pending retries join that acquisition. Ordinary reads and
prepared borrowing stay passive. A failed preparation remains failed after another caller's
successful retry, and it supplies no ready transfer. Source,
configuration and generation checks reject obsolete replies, and disposing the entry releases its
theme outcome. An already invoked signal-less loader can still finish its side effect after
cancellation; its old result cannot publish. Unknown or unprepared cohorts keep ordinary async
readiness.

## Verification references

- [Browser contracts](../../packages/editor/test/firstPaint.browser.test.ts) hold the real grammar
  loader, capture plain-text pixels, type with trusted browser input, and verify the edited token's
  final highlight. They also cover terminal failure, disposal, two editors sharing a document ID,
  replacement, and a theme change while loading.
- [Fallback-fold contracts](../../packages/editor/test/foldRanges.test.ts) verify late markers,
  current edits, replacement, clear/disposal, and immediate public and keyboard commands.
- [Prepared-document contracts](../../packages/editor/test/preparedDocument.test.ts) retain stale
  revision/configuration rejection, transferred-session disposal, and ready first-render assertions.
- [Prepared theme browser contracts](../../packages/editor/test/preparedTheme.browser.test.ts) use
  real public Shiki and Tree workers for synchronous ready events, capture and constructor-work
  suppression. [Provider theme contracts](../../packages/editor/test/providerTheme.node.test.ts)
  cover loader order, edit reuse and source/owner cancellation.
- [Runner instructions](../../examples/stress/README.md#first-text-and-highlighted-paint) reproduce the built
  package measurements without starting a development server.

The paired Platform `editor-visible-snapshot.browser.tsx` suite passed all 11 checks against the
linked Editor build. Its test server blocked the cache-linked JetBrains Mono asset, so those
geometry comparisons used the same fallback font for both views. No Platform code changed.

The existing example built with `bun run build --filter=@singapore-editor/example-app`. A Playwright check
loaded that production output through request routing, opened a JSON file through the example's
GitHub boundary, observed real Tree-sitter highlights, and typed into the document. The only
substituted data was the external GitHub response. The page reported no runtime errors.

The fold-operation test fixture needed `createVisibleEditor` to supply happy-dom's missing
viewport measurement. Its six empty-layout failures reproduced against the unchanged baseline;
the corrected fixture passes all nine operations.
