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
