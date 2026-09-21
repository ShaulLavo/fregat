# Warm workspace reload

Warm reload restores saved presentation before live responses: workspace shell, tree, settings,
Git changes and diffs, compact and full search, chat, logs, diagnostics, and terminal output.
The records supply display inputs, never confirmed query data, writable document revisions,
stream sequence authority, approvals, or terminal input.

## Ownership and admission

`main.tsx` prepares the cached application before `createRoot`, including the selected theme and
visible deferred settings/terminal modules. Bootstrap activation and disposal survive Strict Mode.
Cached machine identity permits display; descriptor validation remains the write boundary.
Unknown connectivity starts as connecting. A failed refresh leaves usable saved content with a
local status; identity drift withdraws the incompatible application.

Tree/settings/Git/diff/log/diagnostic/terminal presentation and search/chat viewport records use
environment-scoped `sessionStorage`. Existing search results, chat projections and editor paint
retain their scoped storage owners. Explicit addresses win over saved navigation. Root, query,
object, appearance and generation checks reject incompatible records. Storage events never
replace a mounted owner's accepted edits. Malformed, oversized and obsolete records are dropped;
there are no migrations.

- **Tree:** loaded-directory coverage, rows, expansions, selection and scroll restore together.
  Unknown directories remain unknown. Filesystem actions require confirmed state and availability.
- **Settings:** scope, category, query, form/JSON mode and scroll restore. The registry renders the
  saved form with writes disabled. Raw JSON uses opaque native paint until its real document arrives.
- **Git:** saved status, sections, active row and scroll remain observations. Commit drafts retain
  their existing owner. Write admission bypasses both client freshness and the server status TTL,
  rechecks the repository and intended affected paths, and rejects changes requiring another review.
- **Diff:** historical data binds to exact object identities. Scroll, selections, expanded regions
  and split ratios restore. Huge diffs use bounded native viewport paint without loading both files
  synchronously. External diff syntax readiness participates in native takeover.
- **Search:** completed results preserve full query/options identity, coverage and truncation.
  Compact/full views have separate row anchors. Cached generation zero cannot authorize replacement.
- **Chat:** the visible session and message window take priority. Plans and checkpoints around that
  window are preserved; cached detail sequences reset to zero. Saved measurements restore an anchor
  away from the end. Unknown transcript detail renders pending, not an empty-conversation verdict.
- **Logs/diagnostics:** filters, observed rows and scroll restore without seeding queries or LSP state.
  Logs retain only the inspected detail. Diagnostics bind to the selected file and observed revision;
  dirty or changed documents reject them.
- **Terminal:** Ghostty paints its own saved cells synchronously. Input, focus, command inbox and
  menus wait for the server's replay-complete marker and a native painted frame. Scroll is restored
  before takeover. A disconnected live terminal keeps its existing paint read-only.

Settings write admission is enforced below the form. In `useSettingsActions.submit`, an owner
with saved presentation and no confirmed `settingsKeys.document()` returns `noop` before an intent
or mutation is created. The subsequent environment-writable check also applies to command callers.
Raw JSON saves require a live settings document and a non-null confirmed revision in
`SettingsSyncService.write`; server raw writes compare that revision before committing. The disabled
fieldset only communicates this state. Server settings routes remain behind `authGuard`, parse the
request schema, and enforce registered keys, layer scope and policy in `SettingsStore.assertWritable`.

`GET /git/status?fresh=true` is an authenticated read with explicit cache semantics. It re-probes
the requested directory, replaces that exact repository-root cache entry (including a missing-root
answer), and invalidates the resolved repository's status entries before reading status. Later ordinary
reads therefore reuse the new observation. A superseded in-flight load cannot overwrite the refreshed
entry. The client-settable flag requests a newer observation; authentication and per-call lexical/real
workspace containment remain the capability boundary for both fresh and ordinary reads.

Lifecycle flushes persist the outgoing owner's state without depending on idle callbacks. Capture
callbacks carry their owner generation. Size, DPR, font, theme and native geometry mismatches refuse
absolute paint and use normal loading. Native previews do not disappear on a timer or queue input.

## Paired native packages

These are uncommitted linked-source changes, not published package releases:

| Repository | Base revision                              | Required changes                                                                                                                                                                                                     |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor     | `678845e44a446d3b1b260503a84835b47b4b2c49` | Native snapshot format 3; overlay reservations; diff gutters, row backgrounds and inline paint; explicit external presentation readiness; provisional scroll preservation; capture only visible rows and selections. |
| Ghostty    | `0efdf5f4fe4c549992ece5f2f0d5a8a14eeb6384` | Bounded `captureViewport` and synchronous `paintTerminalViewport`; painted-frame notification; appearance/geometry admission and scrollbar metadata.                                                                 |

Platform must land with those sources or corresponding package releases. A clean registry install
has not been verified. Native Editor's provisional suite passes 21 tests and the diff snapshot suite
covers old/new/stacked panes. Ghostty's viewport and existing renderer suites pass. The unrelated
existing diff-plugin lane-width expectation differs from both baseline and changed native output.

## Budgets

Startup has a **2 MiB aggregate parse/admission ceiling**, enforced by the shared cache reader until
first application handoff or committed bootstrap failure. Repeated identical records validated by
the same schema are reused only during that interval. Over-budget records remain on disk and fall
back to loading. This also covers existing workspace/chat/editor records using the shared reader.
Small appearance-mirror reads precede this phase and are not included.

| Record                               |                      Per-record ceiling |
| ------------------------------------ | --------------------------------------: |
| Tree                                 |                  256 KiB; 1,500 entries |
| Settings, including JSON paint       |                                 512 KiB |
| Git status and small exact diff data |                                 512 KiB |
| Git list selection and scroll        |      16 KiB, separate from status/diffs |
| Native diff paint, all visible panes |                                 320 KiB |
| Completed search results             |                                 768 KiB |
| Compact/full search view state       |                                  16 KiB |
| Chat projection                      |                                   1 MiB |
| Chat timeline geometry               |                                  64 KiB |
| Logs                                 | 320 KiB; 500 rows, one inspected detail |
| Diagnostics                          |                    128 KiB; 200 entries |
| Terminal                             |  264 KiB envelope; 256 KiB native paint |
| Existing editor visible paint        |                                 256 KiB |

Per-record ceilings do not add to an unrestricted startup allowance. Native paint, search, chat and
logs bound traversal before final serialization as well as checking the resulting string.

The 750-match search fixture used 522,488 bytes and took 1.1 ms to read/parse/validate. A complete
full-search reload parsed 879,924 unique bytes, reused 832,824 bytes, refused none, spent 2.9 ms in
cache reads and validation, and 4.0 ms constructing synchronous bootstrap state. Its first application
commit was 262 ms after preparation began; that wall time includes module scheduling and is not a
claimed speed improvement. Timings are local Chromium development-build observations, not a
production startup benchmark. Each proof retains its exact measurements.

One `app.reload` wide event records aggregate admission, reuse/refusal and timing without recording
source, chat or search text. `workspace.reload.*` performance entries provide per-record costs;
`workspace.reload.aggregate` separates cache work, bootstrap materialization and first-commit wall time.

## Verification

Use the existing server; none of these scripts starts or restarts it:

```bash
bun run --cwd apps/web proof:workspace-reload --scenario all --output /work/tmp/platform-instaload/final
bun run --cwd apps/web proof:workspace-reload --scenario all --width 900 --height 700 --output /work/tmp/platform-instaload/narrow
```

Individual scenarios include `tree`, `settings`, `settings-json`, `git`, `editor`, `search-compact`,
`search-full`, `chat`, `logs`, `diagnostics`, `diff-stacked`, `diff-split`, `diff-large-stacked`,
`diff-large-split`, and `terminal`. `--app-url` selects the target. Tree/settings support `--scroll`; tree also supports `--pending-scroll` for a second held reload;
`--hold-health` independently delays identity confirmation. Chat inspects an existing long session
without starting a provider. Diff and diagnostics create and remove their own fixtures. Terminal
uses a unique proof-owned PTY and verifies its cleanup.

The proofs establish a settled control, reload real persisted state with HTTP/stream responses held,
then release them. They record control/held/live screenshots, compositor filmstrips, first-content
observations, scroll, source fingerprints, native admission, errors and budgets. Diff proofs also verify visible selection
rectangles and real clipboard text after takeover; `--fail-revalidation` on the native diff proof
checks a real HTTP 503 followed by reconnect recovery. An overlaid failure alert preserves pane
geometry and saved native paint. Terminal compares
native canvas pixels against its control and a deliberately blank calibration. Its Playwright socket
bridge records and discards late mock deliveries to already closed sockets; it does not filter app
errors or modify application data.

Evidence for this run lives in `/work/tmp/platform-instaload/all-slices/`. The decision trail and
workflow are there too. The final `desktop-verified/matrix.json` and `narrow-verified/matrix.json` each pass all 15 scenarios
(1440×900 and 900×700); `verification.json` summarizes both. These are held-response/stream runs,
not production latency benchmarks. Both full commands exited successfully.

Across the 20 generic-pane budget reports, startup parsed 432,764–966,394 unique bytes with no
aggregate refusals. Cache read/validation cost was 1.7–5.6 ms; synchronous preparation was
2.5–5.6 ms. First application commit was 88.5–438.1 ms after preparation began. Native diff and
terminal scripts report their own paint and readiness measurements separately.

Additional checks passed:

- Large native diff retained visible paint during HTTP 503 and recovered on reconnect; selection
  rectangles and real clipboard text matched the control in all four diff variants.
- Holding machine identity confirmation preserved settings presentation (`identity-held/`).
- Two same-origin windows and a natively duplicated tab passed six isolation checks
  (`window-isolation/`). Accepted settings filter edits persist even before live revalidation.
- Tree scroll changed from 320 to 384 while responses were held, survived a second held reload,
  and remained 384 after live takeover (`tree-pending-scroll/`). Logs and diagnostics similarly
  preserve view-only edits over their original observation, with 14 focused regression tests
  across these four features. Their saved records never populate the live query cache.
- 448 focused web tests, followed by 66 search/listbox checks for the compact-scroll fix and 16
  Git checks after the failure-overlay repair; 42 focused server checks.
- Root type checking, scoped web/server lint, feature boundaries, design/compiler/error censuses,
  generated-file checks, unused-code checks, duplicate checks, and changed-file formatting.
- Native Editor and Ghostty checks described above. The broader pre-existing settings-page suite
  still has its baseline model-row/widget-label failures; the baseline native lane-width assertion
  also remains outside this change. The entire repository test suite is not claimed green.

The proof now verifies cleanup of its own terminals. Earlier fixture sessions were identified by
exact fixture path and worktree, removed through the terminal API, and their exits confirmed in
`proof-terminal-cleanup.json`. Temporary integration worktrees were removed after comparing their
changes with the original repositories. Source changes remain uncommitted and unpublished.

## Review corrections

Warm settings and terminal module preloads are best-effort: a rejected chunk no longer prevents
`createRoot`; the lazy view mounts a visible render boundary. Browser checks blocked both chunks and confirmed
that the shell still mounts. Releasing the block and reloading recovers; Retry alone did not recover
the failed settings ES module in the same document. Settings and Git
readers subscribe to owner replacement. Runtime creation and root changes share one preparation
function; tree preparation remains creation-only. Settings query events compare a precomputed hash.

Git keyboard navigation writes only `git.view.v1`, a separately bounded root-bound view record.
The regression retains a 240 KiB diff while 100 navigation writes each serialize fewer than 256
bytes; none rewrites the content record. An over-cap status discards the previous status observation.
Terminal replay completion is per connection, and saved native viewport disposal happens once.

### Lifecycle write measurements

`workspace.reload.flush` records callback count, attempted cache writes, serialized/written bytes,
cache writer time, and total registered-callback time. It keeps only the latest measurement and
contains no cached content. One failed callback does not prevent other owners from flushing.

Run the existing proof with `--scenario search-full --measure-writes` to collect 25 synthetic hidden-document
flush samples and a separate 13-record serialization/storage stress case. The proof restores the
real visibility state and deletes its temporary stress records. Evidence is in
`/work/tmp/platform-instaload/all-slices/write-measurement/result.json`.

On this machine, the settled 750-match search view had three active flush callbacks and two actual
cache writes totaling 19,220 bytes: median 1.1 ms, p95 3.0 ms, maximum 4.6 ms for all registered
callbacks. Its large search record was already settled by the existing debounce and was not dirty.
The separate 13-record case serialized and wrote 2,080,286 bytes: median 1.3 ms, p95 2.2 ms, maximum
2.8 ms. That case isolates stringify/storage with simple strings; it does not model worst-case
feature traversal. These are local development-browser measurements, not a cross-device latency
bound or a claim about total browser unload/BFCache time. Other lifecycle listeners are outside the
registered-callback measurement. Visibility change and page departure are separate events and can
both flush; the measurements describe one event at a time. The 2 MiB admission ceiling remains a **read** ceiling, not a write
ceiling; writes retain their per-record bounds and existing coalescing.

Review validation: 27 focused web regressions plus the viewport disposal test pass; 38 terminal
service and 14 Git/cache server tests pass. Root type checking, feature boundaries, unused-code,
compiler and design gates pass. Settings/Git/search browser reloads pass. Failed settings and
terminal warm-chunk evidence is in `all-slices/warm-chunk-failure/`; write measurements and
navigation-write isolation are separate from read-admission budgets.
