# E062: Spellcheck hardening: bounded tokenization, settled worker failures, cheaper underline masks

Completed 2026-09-27 (Editor `dab87329`, Platform `c1391065a`), from GitHub issue 58. Builds on
[E058](https://github.com/ShaulLavo/fregat/blob/main/plans/e058-spellcheck.md).

Scope: retain cspell and the worker/plugin architecture. Fix bounded tokenization and worker
failure settlement; measure rendering before deciding on changes. Keep file defaults unchanged.

- [x] Reproduce tokenizer growth and worker failures.
- [x] Bound structured classification and oversized visible lines; cover browser input.
- [x] Settle setup/post/crash failures and verify editor recovery behavior.
- [x] Measure controller, highlight updates and overall typing; fix supported rendering waste.
- [x] Verify paint in Chromium, Firefox and WebKit.
- [x] Document English policy, language design and benchmark denominators.
- [x] Run checks, commit and push Editor changes, integrate and deploy Platform.

## Baseline

2026-09-26, local Bun: a single token of 5k/10k/20k letters took 26.94/106.08/410.39 ms.
The structured regular expressions run before any limit and retry from successive offsets.

Worker probes against the unmodified HEAD also reproduced a synchronous factory throw and one
retained pending request after a throwing post. The new service tests exercise both APIs, initial
accepted words, a failed later post, accepted-list synchronization, crash, restart and disposal.

## Implementation

Structured classification now runs only within whitespace chunks of at most 256 UTF-16 units.
Oversized chunks are skipped as a whole, preserving surrounding words and original offsets.
The controller skips prose lines and code regions over 16,384 units before reading/caching them.
New browser tests paste into a 20k visible line, type through it, return to normal prose, and type
after worker construction fails. The latter verifies that the controller stops retrying.

Service setup is inside the request promise. Any setup/post failure terminates the worker and
settles all outstanding requests. Accepted words survive restart. Null-id dictionary failures and
message decoding errors terminate the worker too; disposal detaches old handlers.

The CPU profile isolated repeated `mergeTextDecorations`/`textDecorationWords` work while building
the underline mask. The mask now normalizes each shared overlay style once and reuses it whenever
only one overlay covers a span. This removes repeated CSS parsing without changing range/paint
ownership. Full incremental repainting remains a follow-up; defaults remain unchanged.

The README describes the ASCII/English policy and a scoped explicit-language design. The engine
benchmark now separates target coverage, missed typos and eligible suggestion-ranking pairs.
A full local run found 670 evaluation pairs, 661 covered targets, 27 accepted typos among those,
and 634 eligible pairs; conditional top-1/top-5 were 71.6%/89.0%.

## Measurements

Local Bun, median of nine: 5k/10k/20k letter chunks now take 0.0035/0.0071/0.0124 ms and are skipped.
The baseline was a single call per size, so use these to verify scaling and bounded policy, not
as a portable speedup ratio.

Chromium, 2,000 lines, 300 edits. The corrected sparse case has exactly one marked line in four;
the previous benchmark accidentally retained about 70% of marks. Values below are median/p95 ms.
Highlight time is included in controller time; token adoption measures the earlier overlay refresh.

| Case     | Before total | After total | Before controller | After controller | Before highlight | After highlight | Before adoption | After adoption |
| -------- | ------------ | ----------- | ----------------- | ---------------- | ---------------- | --------------- | --------------- | -------------- |
| Off      | 18.4/39.0    | 16.9/23.3   | 0/0               | 0/0              | 0/0              | 0/0             | 0.1/0.2         | 0.1/0.2        |
| No marks | 19.7/40.4    | 18.5/28.3   | 1.2/2.8           | 1.2/2.2          | 0/0              | 0/0             | 0.1/0.2         | 0.1/0.2        |
| Dense    | 32.9/63.3    | 25.5/46.6   | 6.2/11.1          | 3.8/8.2          | 4.7/8.4          | 2.4/5.1         | 4.4/8.1         | 2.3/4.6        |
| Sparse   | 24.4/44.6    | 21.7/31.1   | 2.9/5.4           | 2.3/4.0          | 1.5/2.8          | 1.0/2.0         | 1.5/2.6         | 1.0/1.7        |

These are local single runs with background test activity, not a controlled latency guarantee.
The off baseline also varies. The improvement in both overlay paths supports removing repeated
CSS parsing, but the remaining total edit cost does not justify enabling file spellcheck by default.
The benchmark now includes an isolated tokenizer measurement and a CDP CPU profile for reruns.

## Validation

- Spellcheck: 67 tests pass, including real worker and paint tests in Chromium/Firefox/WebKit.
- Core: 13 overlay integration tests and 6 mask unit tests pass.
- Core and spellcheck typechecks pass; spellcheck lint and workspace formatting checks pass.
- First Platform scenario failed before load: a stale Vite process lacked the spellcheck source
  entry. Current `readDevSources` resolves it correctly; stopped the mesh dev route to reload it.

A repeat run during unrelated shared-checkout merges was noisier: off 18.4/38.9, no marks
32.5/57.2, dense 28.6/59.8, sparse 31.5/60.7 ms total. Dense highlight work remained 2.5/5.2 ms
and token adoption 2.5/5.6 ms. The CSS parsing functions dropped out of the top 20 sampled
functions. Browser tokenizer medians were below its 0.1 ms clock resolution; p95 was at most
0.1 ms across the 99-character prose and 5k/10k/20k oversized cases.

Platform doctor passed after the dev restart, with screenshot inspected at
`/work/tmp/fregat-evidence/20260926T210903Z-look-1440x1000/page.png`.
Subsequent spelling scenarios were interrupted by unrelated merges hot-reloading the app.
A further run found newly added server dependencies missing; installing the current lockfile.

The complete Platform `editor-spellcheck` scenario passed after dependencies were synchronized.
Inspected the menu and accepted-after-reload screenshots in
`/work/tmp/fregat-evidence/20260926T211027Z-scenario-editor-spellcheck/`.
It verified replacement on disk, caret suggestions, accepted-word settings and reload persistence.
The log contains connection-abort warnings during fixture navigation; no spellcheck error.

A repeated browser run exposed a test readiness race: the failure test sometimes typed before
first layout had requested a check. It now waits for the injected worker factory to run before
asserting that further typing causes no retry. All 67 tests pass with that wait.

## Shipped

Editor runtime commit `dab873292fb9b0cd38c7c9fc4cd4c84951734e2b` is pushed to main.
Platform pins it in `c1391065a`, whose pre-commit gates and repository typechecks passed.
The web release `20260926T211241Z-c1391065-spellcheck-hardening` is live on the mesh and passed
its live browser check. The existing server bundle was reused. Live-check output reported three
known orchestration/provider log groups; no new spellcheck failure.

Multilingual implementation and fully incremental overlay repaint remain scoped follow-ups.
No file-spellcheck default was changed. The full Editor suite and comparative engine suite were
not rerun; validation used the spellcheck suite, overlay tests, local benchmarks and real app path.
