# Workspace navigation

TanStack Router owns browser navigation. App commands use the navigation service to select
files, conversations, workspaces, and environments. The browser address describes the selected
destination and the current shareable view.

## Ownership

- [`state/router.ts`](../apps/web/src/state/router.ts) registers the local and remote route families.
  [`route-options.ts`](../apps/web/src/features/address/utils/route-options.ts) validates route
  fields and preserves document tokens and the deployment base path.
- [`state/navigation.ts`](../apps/web/src/state/navigation.ts) exposes app actions.
  [`navigation-coordinator.ts`](../apps/web/src/state/navigation-coordinator.ts) owns cancellation,
  accepted-route application, browser history completion, and reached-address persistence.
- [`apply-view.ts`](../apps/web/src/features/address/state/apply-view.ts) applies an accepted
  destination to the owning retained runtime. Environment switches preserve each machine's
  documents, query client, and pending operations.
- [`navigation-capture.ts`](../apps/web/src/state/navigation-capture.ts) reads the applied view.
  Copy-link commands use this current logical state, including changes not yet written to the URL.

## History and sharing

Completed destination selections create separate history entries. Search and log edits replace
the current entry. Back and Forward restore the addressed destination while preserving current
utility panels, filters, and unsaved documents. A late asynchronous open cannot override a
subsequent traversal or an environment switch.

Startup combines addressed tabs with retained tabs. Traversal preserves dirty and unaddressable
tabs, and an explicitly closed tab reopens only when it becomes the visited destination.
The reached address supplies bare-startup restoration after Back or Forward.

URLs have explicit size budgets. Copy reports omitted fields, strips development parameters,
and does not store a hidden full-view payload in browser history. Portable sharing services and
automatic repository cloning remain outside this implementation.

## Verification

[`verify-workspace-navigation.mjs`](../apps/web/scripts/verify-workspace-navigation.mjs) drives
the running app with Playwright. It checks the app and API environment identities, creates
disposable Git workspaces and metadata-only conversations, and removes its own fixtures.
It does not start a development server or invoke a provider.

The focused tests under [`features/address/tests`](../apps/web/src/features/address/tests)
cover route matching, URL budgets, startup, history, document ownership, and environment switching.
The live verifier covers browser history behavior, sustained input, clipboard commands, and
switching to a second machine through the existing SSH connection.
