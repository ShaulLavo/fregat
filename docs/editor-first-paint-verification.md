# Native provisional editor paint verification

This report covers the implementation of [the provisional display design](editor-first-paint-design.md) in `/work/projects/Editor` and `/work/projects/platform`. Browser recordings, benchmark scripts, raw results, and screenshots are retained in `/work/tmp/editor-provisional-paint/`.

## Implementation

The synchronous native `Editor` owns saved paint and authoritative paint in the same row pool. `setSnapshot` admits an opaque payload for a requested `documentKey`. `captureSnapshot` returns committed paint together with the mounted document ID, text version, buffer, and buffer revision. The payload never becomes a document, buffer, undo history, worker input, or line index.

The native presentation waits for real syntax and structural render data. It installs authoritative rows and required contributions synchronously, releases provisional resources, and then publishes actual text and highlight paint. Required contributions that throw or remain pending are disposed, logged, and omitted from the completed authoritative frame.

The React adapter preserves controller and session reuse, including an initial null document and A → B → A navigation. It applies current appearance configuration before snapshot admission and document controls after attachment. Requested target changes invalidate queued callbacks. Geometry remains unavailable while saved rows are displayed, and input cannot queue edits against those rows.

Platform stores a version 5 identity envelope containing opaque native paint. Capture checks the mounted key, document, buffer object, revision, clean state, and theme. The separate React snapshot renderer, copied token and fold painting, held-document hook, readiness aggregation, and timeout dismissal are removed.

The implementation is concentrated in these files:

| Owner                | Files and purpose                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native core          | `Editor/packages/editor/src/editor/Editor.ts`, `syntaxController.ts`, `viewContributions.ts`, and new `paintSnapshot.ts`: lifecycle, readiness, committed capture, and bounded codec.                                                                                      |
| Native row painter   | `Editor/packages/editor/src/virtualization/virtualizedTextView*.ts` and `fixedRowVirtualizer.ts`: pooled saved rows, frozen presented scroll geometry, highlight ownership, and cache reset at takeover.                                                                   |
| React adapter        | `Editor/packages/react/src/index.ts`: requested target and document synchronization, callback generations, and unavailable provisional geometry.                                                                                                                           |
| Native contributions | `Editor/packages/gutters`, `packages/scope-lines`, and `packages/minimap`: replay contracts, contribution visibility, current layout reservation, and full-document minimap input. Package CSS side-effect metadata keeps the minimap stylesheet in the production bundle. |
| Platform host        | `apps/web/src/features/editor/components/editor.tsx` and `features/workbench/components/file-editor-body.tsx`: mount while file data is pending and show truthful loading status.                                                                                          |
| Platform persistence | `apps/web/src/features/workbench/hooks/use-editor-visible-snapshot.ts`, new `state/snapshot-capture.ts`, and `apps/web/src/lib/editor-visible-snapshot-cache.ts`: eligibility, explicit capture, identity checks, and bounded storage.                                     |
| Platform plugins     | `apps/web/src/features/editor/utils/plugins.ts` and `decode-mode.ts`: current minimap configuration before admission, replayable SVG fold icons, and decode eligibility.                                                                                                   |
| Open benchmark       | `apps/web/scripts/editor-open-benchmark.mjs`: reseed opaque envelopes without rewriting native internals; accept prepared opens that reach live paint immediately.                                                                                                         |

## Verification method

The browser checks use the existing production preview at `https://omarchy.mesh.shaulavo.dev/platform/`. The linked Editor packages and Platform bundle were rebuilt for that running preview. No additional application server was started.

Baseline and result use the same 9,558-byte, 284-line fixture, with SHA-256 `c4427b922427b8709954202fb52d71c9cde55a89aaf60c956959d28c2116942e`. Artifact copies of the existing benchmark scripts seed the current environment-scoped workspace cache. Typing counters are collected outside the bounded diagnostic trace so all 40 edits remain observable.

Before implementation, material regression thresholds were recorded as the larger of 20% of baseline and the following absolute increase: startup 50 ms, file open 10 ms, typing p95 5 ms, mean `applyEdit` 0.5 ms, scrolling 2 ms, and capture 2 ms. A threshold breach requires a repeat under comparable CPU calibration. A calibration change above 10% requires repeating the affected comparison.

## Behavior evidence

The strengthened browser run passes 21 checks in `post-nonzero-checks.json`. It tests both a real document whose highlighter response is held independently and a never-opened file whose actual file response is held. Saved rows remain visible beyond 1,700 ms. The delayed-file case retains the captured 1,800 px offset and 7,355 px extent, including the underlying native scroll position.

The [delayed-file screenshot](/work/tmp/editor-provisional-paint/post-nonzero-delayed-file.png), [cached cold-start screenshot](/work/tmp/editor-provisional-paint/post-cold-cached-0.png), and [browser checks](/work/tmp/editor-provisional-paint/post-nonzero-checks.json) show the final build. Both top-of-file and nonzero-scroll runs pass all 21 checks and retain 176 compositor frames each.

There is one editor text tree throughout replacement. Frame observations show no empty visible-row frame during takeover, and authoritative text and highlight marks publish once after the held result is released. Screenshots and compositor frames show the provisional and authoritative presentations. The baseline used two text trees and removed its overlay after 1,500 ms while highlighting was still pending.

Wheel, touch, focus, pointer input, typing, programmatic scrolling, and scrollbar dragging retain the provisional viewport. Blocked typing is not replayed. The first live edit works and removes the clean-file snapshot. Known revision, path, and workspace mismatches reject saved paint.

Minimap worker messages contain the complete 9,558-byte authoritative document and all 284 line starts. Minimap click and slider drag move the real document after takeover. The existing worker attachment and version tests cover delayed results and replacements with changed newline positions.

Focused tests cover bootstrap emptiness versus an authoritative empty file, delayed highlights with the real buffer already attached, stale completions, same-file buffer replacement, current navigation taking priority over saved scroll, shared highlight ownership across editors, malformed payloads, required contribution failure, and pending appearance changes. Adapter tests cover controller reuse, explicit clear, initial waiting, and A → B → A callback generations. Ready prepared documents use the existing synchronous attachment and atomic render path without an added animation-frame wait.

The relevant test runs passed:

| Location    | Focused checks                                                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor core | `provisionalPaint.test.ts` (17), `fixedRowVirtualizer.test.ts` (43), and `viewSnapshot.test.ts` (29). The targeted `preparedDocument.test.ts`, `syntax.test.ts`, and `virtualizedTextView.test.ts` regression run passed 176 cases. |
| React       | `useEditor.test.ts`: 30 cases, including same-render theme and snapshot updates and incoming-document selection and scroll ordering.                                                                                                |
| Gutters     | `plugin.test.ts`: 7 cases, including restored fold buttons becoming live with the current callback.                                                                                                                                 |
| Minimap     | `plugin.test.ts` and `workerClient.test.ts`: 36 cases.                                                                                                                                                                              |
| Scope lines | `plugin.test.ts` (18) and `provisionalPaint.test.ts` (2), including real stylesheet visibility during late admission.                                                                                                               |
| Platform    | Snapshot envelope and workspace cache tests: 26 cases. File-editor ownership and performance-trace DOM checks: 2 cases.                                                                                                             |

App tests run with `bun --bun vitest`; Editor package tests run through their Vitest scripts. Core, React, gutters, minimap, scope-lines, and Platform typechecks pass. Focused formatting, lint, and diff checks pass. The production build verifies the `/platform/` asset base and emitted minimap and provisional contribution CSS.

Three browser failures were corrected before accepting the result: missing minimap CSS affected layout admission and slider drag, the empty bootstrap virtualizer clamped nonzero saved scroll, and the React adapter admitted snapshots before applying a newly supplied theme. Scroll checks now require visible row rectangles and matching geometry rather than merely counting mounted nodes. The theme regression is covered by a failing-before-fix adapter test and three cold browser contexts.

## Performance results

All 14 paired metrics stay within the thresholds recorded before implementation. Open timing uses 10 measured samples per mode after warmups; typing and scrolling use three trials, and cold startup uses five browser contexts with five completed capture measurements. The results do not establish zero overhead or a general speedup.

| Metric                                        |  Baseline |    Result |
| --------------------------------------------- | --------: | --------: |
| Cold startup: first text frame, median        | 473.17 ms | 472.04 ms |
| Cold startup: first highlighted frame, median | 662.02 ms | 653.45 ms |
| Uncached open: text, median                   |  29.28 ms |  22.59 ms |
| Uncached open: highlights, median             |  63.37 ms |  51.59 ms |
| Query cache only: text, median                |  16.35 ms |   7.90 ms |
| Query cache only: highlights, median          |  52.94 ms |  35.83 ms |
| Prepared 300 ms: text, median                 |  10.99 ms |   6.45 ms |
| Prepared 300 ms: highlights, median           |  11.00 ms |  11.42 ms |
| Steady typing: mean trial p95                 |  16.27 ms |  17.20 ms |
| Burst typing: mean trial p95                  |   8.02 ms |   6.06 ms |
| Steady typing: mean `applyEdit`               |   0.85 ms |   0.79 ms |
| Burst typing: mean `applyEdit`                |   0.59 ms |   0.59 ms |
| Scrolling: median trial mean frame            |   3.92 ms |   4.03 ms |
| Explicit capture, median                      |   2.18 ms |   2.41 ms |

CPU calibration changed from 47.91 to 49.04 ms for typing and from 49.38 to 48.85 ms for scrolling, both below the 10% repeat threshold. Open timing was repeated during verification with no threshold breach.

For saved paint in an already loaded app, the first observed frame after file activation was 22.39 ms before and 23.04 ms after. This is a matched frame observation, not a cold reload distribution. The result also has compositor screenshots; the baseline cached transition has frame observations and screenshots without a matching compositor trace.

Cold startup measurements include code loading, evaluation, synchronous editor construction, and browser rendering. CDP recorded 160.99 ms of module evaluation before and 162.36 ms after. Script transfer bodies totaled 2,843,978 and 2,843,971 bytes, respectively. Constructor cost is included in navigation-to-frame timing but is not separately isolated.

A supplementary cached cold-start check admits saved paint in all three fresh browser contexts. The first actual saved-row frames occur at 435.20, 424.19, and 430.13 ms from navigation, with a 430.13 ms median. Theme responses are allowed through while highlight responses are held independently. Saved rows remain visible beyond 1,800 ms, and authoritative paint publishes only after release. This measures the current implementation alone; there is no paired baseline for cached cold startup.

Raw distributions and thresholds are in `baseline-summary.json`, `post-open.log`, `post-typing.log`, `post-scroll.log`, `post-startup.json`, and `performance-comparison.json` under the artifact directory.

Navigation failures that occurred before the app mounted were retained as diagnostics and retried. The timing tables use completed runs. Earlier result builds and their measurements are retained separately; the startup and open figures above use the final adapter ordering.

## Supported scope

Saved paint includes native text, resolved syntax styles, built-in line and fold gutters, and replayable scope guides and decorations. The minimap lane is reserved from current configuration; minimap imagery appears from the complete authoritative document after takeover.

Fold icons support declarative SVG path data. Platform passes its chevron path to the gutter plugin, which renders the same SVG during live paint and snapshot restore. The snapshot key includes the icon description, so changing the path or view box invalidates incompatible paint. Restored fold buttons stay disabled until the authoritative row binds its current fold action.

Custom gutter DOM requires an explicit native replay renderer. Custom visible contributions require a stable `snapshotKey` and synchronous capture and replacement support. Mounted custom widgets, unsupported row or gutter CSS decorations, and incomplete declared contributions decline capture. Arbitrary third-party DOM without a capture declaration is outside the supported scope. Platform also declines snapshots while a decode animation is enabled because that plugin has no replay contract.

Admission requires compatible effective font metrics, theme, typography, tab and wrap configuration, contributions, viewport, and zoom-sensitive geometry. The decoder refuses oversized or inconsistent payloads and absolute extents that require native coordinate remapping. There is no cache migration decoder.

Saved paint still waits for native bundle evaluation and the synchronous constructor. This implementation does not split construction into stages.
