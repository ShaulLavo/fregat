# Verification follow-ups

## 1. TUI typecheck

`bun run typecheck` failed with 29 TS2786 errors in 28 TUI files. All callers returned the shared `Dialog`, whose inferred return type was OpenTUI's reconciler portal.

The errors were introduced by the dependency change in `449e1ec1`, not its settings registry or client-core commands. Its bippy dependency installed `@types/react-reconciler`, making OpenTUI's previously unresolved portal return type concrete. A detached worktree at `c08c530e` passes with its frozen lockfile, but reproduces the errors with current dependencies.

`Dialog` now returns a JSX fragment containing the portal. This preserves the portal at runtime and gives the component a JSX element return without a cast or a false type augmentation.

Evidence directory: `/work/tmp/platform-evidence/typecheck-20260914/`.

- `before.txt`: root typecheck, 29 errors.
- `c08c530e-current-dependencies-tui.txt`: old source with current dependencies, same errors.
- `c08c530e-tui.txt`: old source with its frozen lockfile, passes.
- `after-root.txt`: root typecheck, passes.
- `dialog-test.txt`: existing TUI dialog prompt test, passes.

## 2. Closed workspace-edit dialogs

Every document revision invalidated workspace history and published a fresh service snapshot. Both dialogs subscribed to the full snapshot. Preview also subscribed to focus state to maintain a ref.

The hook now selects the existing snapshot only while its dialog is visible, and `null` while closed. Focus tracking updates the restoration ref through an effect subscription. History notifications remain available to command consumers.

The same `bun run agent:browser renders editor-type-burst` measured preview **278 → 0** and recovery **273 → 0** renders. The existing dialog tests pass all 12 cases, including preparing, cancellation, focus restoration and recovery.

- Before renders: `/work/tmp/platform-evidence/20260914T125141Z-renders-editor-type-burst/`.
- After renders: `/work/tmp/platform-evidence/20260914T125607Z-renders-editor-type-burst/`.
- Before screenshots, inspected: `/work/tmp/platform-evidence/20260914T125230Z-scenario-editor-type-burst/`.
- After screenshot, inspected: `/work/tmp/platform-evidence/20260914T125653Z-scenario-editor-type-burst/02-typed.png`.

## 3. Breadcrumb row

Cursor coordinates and pre-debounce document revisions both caused the breadcrumb row to rebuild every icon, picker and popover callback.

`EditorBreadcrumbs` now owns the symbol query. The cursor hook selects the enclosing symbol chain using symbol identity, and one memo boundary protects `BreadcrumbsBar`. The row receives the stable editor controller for focus. Refreshed symbols still update navigation targets and picker contents.

The same render command measured:

| Component      | Before | After |
| -------------- | -----: | ----: |
| BreadcrumbsBar |    291 |     1 |
| BreadcrumbItem |  4,074 |    14 |
| PopoverTrigger |  4,074 |    14 |
| FloatingTree   |  2,050 |    20 |

FloatingTree's reported render duration fell from 233.1ms to 2.9ms. The tool currently records React actualDuration, so this is subtree render duration, not exclusive self time.

- Before renders: `/work/tmp/platform-evidence/20260914T125607Z-renders-editor-type-burst/`.
- After renders: `/work/tmp/platform-evidence/20260914T125945Z-renders-editor-type-burst/`.
- Original baseline trace: `/work/tmp/platform-evidence/20260914T125712Z-trace-editor-type-burst/`.
- First after trace: `/work/tmp/platform-evidence/20260914T125959Z-trace-editor-type-burst/`. This was slower overall, with different language-server state. It is retained rather than treated as a speedup.
- Repeated baseline with the breadcrumb patch temporarily reversed: `/work/tmp/platform-evidence/20260914T130047Z-trace-editor-type-burst/`.
- Restored fix, `trace editor-type-burst --compare` against that baseline: `/work/tmp/platform-evidence/20260914T130133Z-trace-editor-type-burst/`. Scripting 5,404.4 → 3,452.2ms, tasks over 16ms 218 → 127, tasks over 50ms 13 → 7. This is one consecutive pair on the shared dev server, not an isolated benchmark.
- Focused checks: `item3-checks.txt` in the original baseline trace directory. Eight tests pass, including scope crossings and refreshed navigation targets, plus web typecheck and lint.
- Before screenshot: `/work/tmp/platform-evidence/20260914T125653Z-scenario-editor-type-burst/02-typed.png`. After screenshot: `/work/tmp/platform-evidence/20260914T130202Z-scenario-editor-type-burst/02-typed.png`. Both inspected.

## 4. Tree icons and truncation

Row updates recreated visual children even when their value props stayed equal. `Icon` and `MiddleTruncate` now use shallow memoization. `Truncate` and `Fruncate` also memoize because a changed filename can retain either segment. `OverflowText` relies on those parent boundaries and has no redundant memo. Whole rows retain their selection, focus and expansion updates.

The same render command removed all **1,102 parent-driven renders** among the five components:

| Component      | Before renders | After renders | Parent-driven before → after |
| -------------- | -------------: | ------------: | ---------------------------: |
| Icon           |            380 |           138 |                      242 → 0 |
| MiddleTruncate |            350 |           168 |                      182 → 0 |
| Truncate       |            283 |           137 |                      146 → 0 |
| Fruncate       |            322 |           129 |                      193 → 0 |
| OverflowText   |            605 |           266 |                      339 → 0 |

- Before: `/work/tmp/platform-evidence/20260914T125945Z-renders-editor-type-burst/`.
- After: `/work/tmp/platform-evidence/20260914T130416Z-renders-editor-type-burst/`.
- Before screenshot: `/work/tmp/platform-evidence/20260914T130202Z-scenario-editor-type-burst/02-typed.png`.
- After screenshot: `/work/tmp/platform-evidence/20260914T130451Z-scenario-editor-type-burst/02-typed.png`. Both inspected.
- Existing icon configuration update test and tree typecheck pass. Output: `item4-checks.txt` in the before directory.

## 5. Palettes route on the dev server

This is stale running code. `apps/server/src/themes/routes.ts` defines `GET /themes/palettes`, and `createApp` registers it. Port 3001 belongs to PID 1157399, started September 13 at 17:47:11 local time. The route landed in `1e456e82` on September 14 at 01:14:28 local time.

The user was told the dev server needs a restart. No restart or route change was made. The after check still returns 404, as expected until that restart.

- Before browser evidence: `/work/tmp/platform-evidence/20260914T125103Z-look-run/`.
- After browser evidence: `/work/tmp/platform-evidence/20260914T130606Z-look-run/`. Both screenshots inspected.
- Listener, process start, route source and commit evidence: `/work/tmp/platform-evidence/palettes-20260914/`.
