# Test baseline

## After merging `origin/main` (`dd3565e3`) — the baseline is now green

`main` moved 70+ commits while this branch was in flight, landing Plan 098, Plan 096, and a knip
`unused:check` CI gate. It also repaired every failure this branch had been measuring against. On the
merged tree, every workspace passes:

| Workspace               | Result                                           |
| ----------------------- | ------------------------------------------------ |
| `apps/web` (node + dom) | 459 files / 3495 tests, 5 skipped — **all pass** |
| `apps/server`           | 1483 tests, 2 skipped — **all pass**             |
| `apps/tui`              | 99 files / 367 tests — **all pass**              |
| `packages/contracts`    | 23 files / 202 tests — **all pass**              |
| `packages/client-core`  | 4 files / 17 tests — **all pass**                |

`typecheck`, `lint`, `format:check`, `generated:check` and `unused:check` are all clean.

So completion for the remaining units is the ordinary bar — the suite stays green — not a delta. Two
caveats worth keeping:

- `apps/tui` has flaky tests. One file failed on the first full run of the merged tree and passed on
  the second with no change in between; `terminal/tests/host.test.ts` spawns real PTYs and
  `navigation/tests/files.test.tsx` has behaved the same way. Re-run before concluding a TUI failure
  is real.
- `apps/web` `src/state/tests/checkout-ownership.test.tsx` was load-flaky before the merge (passing
  alone, failing in a full project run) and now passes in both. Its history is recorded below in case
  it returns.

## What the pre-merge baseline was, and why it is kept here

Captured at `d0bbaa2b` before the first fix landed: **27 failing files, 49 failing tests**
(`packages/contracts` 2/2, `apps/tui` 6/7, `apps/web` 19/40, `apps/server` clean). Every commit on
this branch up to the merge was verified as a delta against that list, which is why their messages
say "no new failures" rather than "green".

Two of those failures were fixed here rather than worked around, and both are worth knowing about
because the diagnosis was the interesting part:

1. **`packages/contracts/src/tests/settings-mutations.test.ts`** — `SCALAR_SETTING_IDS` carried two
   **extra** entries, `editor.codeTheme.dark` and `.light`, not two missing ones. One audit pass
   reported the direction backwards. The test was stale, not the registry: those keys hold a plain
   theme-id string and `color-theme-provider.tsx` writes them through the scalar path, so excluding
   them would break the code-theme pickers. `main` reached the same fix independently.
2. **`apps/web/test/integration/server-in-process.test.ts`** — imported a deleted module
   (`@/lib/workspace-search-client`) and could not load at all. `main` repointed it independently and
   more cleanly, so its version was taken in the merge.

`session-vocabulary.test.ts` was deliberately left red here — it exists to make a human review
protocol-vocabulary additions, and the addition belonged to a dependency-sync commit. `main` has
since settled it.
