# Shared helpers verification

`nowMs`, `elapsedMs`, `durationBetweenMs`, and `roundMs` live in
`@workspace/utils/timing`. Duration clocks retain the performance clock and the
Date fallback. Epoch timestamps still use `Date.now()`.

Matching helpers now share implementations across the apps, packages, and scripts.
The consolidation includes error formatting, object predicates, URI encoding,
path filtering, search matching, keyboard events, subscriptions, resize observation,
benchmark helpers, and the workbench toggle button. Domain constructors and functions
reading different registries retain their distinct contracts and state.

`bun run dupes:functions` is part of `lint`, which CI runs. The final scan checked
2,211 source files and reported zero duplicate function groups, zero inline clock
fallbacks, and zero parser errors. The former jscpd configuration used the unsupported
`ts` format; it now uses `typescript`.

The function check compares top-level declarations and assigned function expressions.
It ignores formatting, comments, declaration names, and type annotations, preserves
branded assertions, and distinguishes captured module state. Constant callbacks and
plain identity/getter functions carry no shared algorithm and are excluded. Tests,
generated protocol directories, nested callbacks, and class methods are outside this
check. Equivalent logic written with different expressions or parameter names still
requires review; `bun run dupes` remains available for repeated code blocks.

Validation passed:

- Typechecks for server, web, TUI, desktop, client-core, contracts, tree, UI,
  observability, utils, and scripts.
- Changed-source lint and whitespace checks.
- 207 focused tests covering web and server helpers, resize hooks, command recents,
  optimistic queues, contracts, tree keyboard behavior, resizable layouts, clocks,
  subscription isolation, and the duplicate checker.
- Settings schema and Codex protocol generation checks.
- The search-input-undo and settings-defaults browser scenarios. Screenshots were
  opened and inspected.

Browser evidence:

- `/work/tmp/fregat-evidence/20260919T202423Z-look-1440x1000/`
- `/work/tmp/fregat-evidence/20260919T202448Z-scenario-search-input-undo/`
- `/work/tmp/fregat-evidence/20260919T203255Z-scenario-settings-defaults/`

The settings scenario completed, but its network log reports 404 responses for
`/themes/bundles` and `/themes/wallpapers`. Those endpoints are outside this refactor.
The exports scan also reports six unused values and three unused types outside the
new helpers; those findings remain in the checkout.

The web and server release `20260919T203350Z-e4ee5f1d-shared-helpers` is deployed to
`https://omarchy.mesh.shaulavo.dev/platform/`. The deployment's live browser check
reported no failures, and `/platform/release` confirmed both bundles use this release.
The release includes the checkout's existing work, with 414 dirty files recorded at
build time. Check logs are retained in `/work/tmp/platform-duplicate-functions/`.
