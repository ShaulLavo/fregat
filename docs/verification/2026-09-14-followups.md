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
