# Test baseline at `d0bbaa2b`

Captured with `bun run test` in this worktree before any fix landed. Completion for every unit is
**no new failures against this list** — never "the suite is green", which it is not.

| Workspace                                                                                                                   | Files                  | Tests                               |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------- |
| `packages/contracts`                                                                                                        | 2 failed / 21 passed   | 2 failed / 209 passed               |
| `apps/tui`                                                                                                                  | 6 failed / 93 passed   | 7 failed / 360 passed               |
| `apps/web`                                                                                                                  | 19 failed / 429 passed | 40 failed / 2884 passed (5 skipped) |
| `apps/server`                                                                                                               | 0 failed / 154 passed  | 0 failed / 1438 passed (2 skipped)  |
| `packages/tree`, `packages/pty`, `packages/client-core`, `packages/ui`, `packages/observability`, `apps/desktop`, `scripts` | all passed             | all passed                          |

Totals: **27 failing files, 49 failing tests.**

## The two `packages/contracts` failures are stale expectations, not product bugs

Both track intentional upstream change from `afe4f727` ("sync editor and terminal revisions") and
both were confirmed by running them:

1. **`src/tests/settings-mutations.test.ts:46`** — `SCALAR_SETTING_IDS` has **two extra** entries
   (45 received vs 43 expected): `editor.codeTheme.dark` and `editor.codeTheme.light`. Direction
   matters and one audit pass reported it backwards. Cause: `SCALAR_SETTING_IDS` is `SETTING_IDS`
   minus eight explicitly non-scalar ids (`settings/mutations.ts:25-43`), while the test's `expected`
   filters by `widget ∈ {boolean, enum, font, multiline, number, string}` and those two keys carry
   `widget: 'code-theme'` (`keys.ts:81,91`).

   **The test is what is stale.** Those keys are written through the scalar path in production —
   `color-theme-provider.tsx:50-56` calls `setSetting('editor.codeTheme.' + resolvedTheme, themeId)`
   — so removing them from `SCALAR_SETTING_IDS` would break the code-theme pickers. The fix is to add
   `'code-theme'` to the test's `scalarWidgets` set. Owned here as unit 2's prerequisite, because
   unit 2 registers a key against the same assertion.

2. **`src/tests/session-vocabulary.test.ts`** — the codex protocol generator now emits `thread/list`,
   which the test's expected vocabulary does not list. **Left as baseline deliberately.** That test
   exists to force a human to review vocabulary additions, and the addition belongs to the sync
   commit, not to this work. Do not silently update it.

## A load-dependent failure the first capture missed

`apps/web` `src/state/tests/checkout-ownership.test.tsx > confirmed worktrees retain Git drafts
across A/B/A …` **passes in isolation** (run twice) but **fails in every full-project run**. It is
absent from the `bun run test` capture above because that run schedules `node` and `dom` together and
did not hit it.

Confirmed pre-existing rather than caused by this work: reverting
`packages/client-core/src/files/search-client.ts` to `d0bbaa2b` and re-running the whole `dom`
project reproduces it with byte-identical totals — 14 files / 26 tests failed either way. Treat it as
baseline, and prefer whole-project totals over per-test lists when checking for new failures, because
the per-test set shifts with scheduling.
