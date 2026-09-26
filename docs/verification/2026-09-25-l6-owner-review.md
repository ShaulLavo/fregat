# L6 owner review follow-up

The [owner review](https://github.com/ShaulLavo/fregat/pull/36#pullrequestreview-5320574475)
was read with all six inline comments and the top-level comment list. The latter was empty.
This follow-up preserves the rollback at `638137c66`, retained L2 semantics and the existing
migration chain. Plan 132 P4 stays held. No real database was opened, reset or deleted.

## Findings, fixes and regressions

All captures below are under `/work/tmp/l6-completion/`. Each accepted bug has a failing
regression capture and a passing capture.

| Finding                                                       | Change                                                                                                                                                                                           | Regression and evidence                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored worktree registration/revival events lack `retiredAt`  | The event schema defaults an omitted retirement timestamp to null.                                                                                                                               | Two engine replay cases remove the key from disposable stored rows, replay successfully, and verify that the raw rows remain unchanged. `review-event-replay-before.log` has two failures; `review-event-replay-after.log` passes all 28 engine tests.                                                                       |
| Failed Shiki grammars reload on every streamed chunk          | A grammar acquisition failure settles as a cached plain-text fallback for that highlighter's lifetime. Core initialization failures retain their separate retry behavior.                        | A real Shiki core with a rejected grammar acquisition calls the result callback, highlights later chunks as plain text, and attempts the grammar once. `review-resources-before.log` fails that case; `review-resources-after.log` passes all six Shiki tests.                                                               |
| Failed Mermaid import retries on diagram remount              | Disable retry on mount and keep errored imports disabled when the same hook changes from streaming to settled. Explicit imperative acquisition can still retry.                                  | A real QueryObserver remount fails before and passes after. Chromium also exposed the enabled-toggle retry after the first fix; `review-mermaid-browser-before.log` records two imports, and `review-mermaid-browser-after.log` passes all three browser cases with one import.                                              |
| External Git metadata disables upstream fetch                 | Missing local `.git` delegates location resolution to Git on each status read. Query still deduplicates concurrent lookups, while fetch throttling remains keyed by common directory and remote. | A real checkout with two external metadata directories fetches and recognizes a changed metadata location. `review-upstream-before.log` fails with zero fetches; `review-upstream-after.log` passes all 12 cases.                                                                                                            |
| Generic `.lock` selects JSON                                  | Use full-name mappings for Cargo.lock as TOML and bun.lock as JSONC. Yarn and unknown lock files have no selected grammar.                                                                       | Four filename assertions fail before and pass after. `review-policy-before.log`, `review-policy-after.log`; all nine language tests pass.                                                                                                                                                                                    |
| Unavailable browser storage loses command recents             | Web recording supplies its current in-memory history. TUI recording retains its atomic storage-derived merge.                                                                                    | Unavailable localStorage and failing writes reproduce two lost-history cases. Both pass afterward, including ordering/deduplication; all ten web tests and 26 TUI storage/corruption tests pass. `review-policy-before.log`, `review-policy-after.log`, `review-tui-storage-final.log`.                                      |
| Native POSIX backslashes become URI separators                | Server LSP callers use a native-path encoder. The editor retains its portable path convention.                                                                                                   | ESLint workspace configuration, proxy initialization/workspace-folder responses, TypeScript URI round-trips and native watch-source delivery each failed. `review-uri-before.log` and `review-watch-uri-before.log` retain the failures; `review-native-paths-after.log` passes all 161 LSP, mutation and containment cases. |
| ENOTDIR becomes FILE_CHANGED during a versioned save          | Direct mutation probes preserve ENOTDIR; journal probes retain their absent-path policy.                                                                                                         | Replace an already-resolved target's parent directory with a file, then save with a base version. The result returns to NOT_A_DIRECTORY. `review-enotdir-before.log` has two failures; `review-enotdir-after.log` passes all four cases.                                                                                     |
| Atomic staging removes an unowned temporary file after EEXIST | Already fixed in `3a4fc15ee`: cleanup follows successful exclusive creation.                                                                                                                     | Two collision cases failed before and passed after; partial-write cleanup also passes. `review-r1-before.log`, `review-r1-after.log`; see the [earlier review](2026-09-25-l6-review.md).                                                                                                                                     |
| Query API gate misses static template properties              | Inspect template literals with no expressions for member access and destructuring.                                                                                                               | Both template-name cases fail before and pass after; all nine gate tests pass. `review-query-gate-before.log`, `review-query-gate-after.log`.                                                                                                                                                                                |

The watched-file regression drives the native watch-source callback. An initial real-hub probe
received no event because the existing filesystem client-path boundary rejects backslashes.
That is separate from URI encoding. Ordinary real-hub notification tests still pass.

## Confirmed behavior

Mermaid 11.16.1 already serializes its public `render` calls in a global execution queue
(`dist/mermaid.core.mjs`, `executeQueue` and `render`). Removing the TanStack scope would leave
that queue in place and allow a later `initialize` call to change an earlier diagram's theme.
The scope stays. The controlled two-theme test proves that configuration remains owned until
each render settles. A hung Mermaid render can still block its library queue; this is an
existing library limitation, not a new timeout guarantee.

A null turn ID denotes an unattached message and survives revert. Empty and whitespace IDs are
rejected by `turnIdSchema` before event projection. The direct schema/helper check in
`review-revert-contract.log` confirms rejection of empty IDs, retention of null and known IDs,
and removal of unknown IDs. No valid event changes behavior from the explicit null check.

Regex replacement deliberately uses JavaScript capture expansion, plus the existing `$0`
whole-match form. Web and TUI caller tests cover unmatched captures, named groups, surrounding
text and numbered captures. The TUI table compares results to native `String.replace`.
The final focused runs pass 27 web cases and 15 TUI replacement cases in
`review-web-final.log` and `review-tui-final.log`.

## Validation

All workspace typechecks passed. The final checks cover lint, formatting, generated artifacts,
unused code, feature boundaries and repository gates. Package suites cover contracts,
client-core and Markdown. Chromium renders diagrams, math, HTML and highlighted code together,
keeps a streaming fence as code until settlement, and preserves code after an offline import
across remount/toggle behavior. The prior full application verification remains recorded in the
[earlier review](2026-09-25-l6-review.md). Current-head CI and mergeability are recorded in PR #36.

Logs: `owner-review-types.log`, `owner-review-static.log`, `owner-review-gates.log`,
`owner-review-packages.log`, `review-native-paths-after.log`, `review-mermaid-browser-after.log`.

The first owner-review CI run passed nine jobs and found a stale web language-detector
expectation for `other.lock`. The caller test now checks Cargo as TOML, Bun as JSONC, and Yarn
and unknown lock files as unclassified. The stale expectation failed locally as well; the
updated file passes in `review-web-language-after.log`. CI output is retained in
`owner-review-ci-web2.log`; application code required no further change.
