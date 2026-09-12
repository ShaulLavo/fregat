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
the current entry. Continuous edits apply immediately and publish the latest URL at a shared
250 ms cadence, keeping Safari within its native history quota. Back and Forward restore the
addressed destination while preserving current utility panels, filters, and unsaved documents. A late asynchronous open cannot override a
subsequent traversal or an environment switch.

Startup combines addressed tabs with retained tabs. Traversal preserves dirty and unaddressable
tabs, and an explicitly closed tab reopens only when it becomes the visited destination.
The reached address supplies bare-startup restoration after Back or Forward.

A reload during the publication interval resumes one pending canonical URL from session storage.
Restoration requires an actual reload, the same source URL, and the same native history entry.
Direct links and other entries discard that record; another tab's address cache cannot override it.
Settled publication and canceled navigation clear the pending record.

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

The verifier defaults to Chromium, Firefox, and WebKit. `--webkit-endpoint` accepts a matching
Playwright browser-server WebSocket endpoint, allowing WebKit to run on macOS while the script
uses the existing Linux app. `--second-machine` names a configured machine;
`--second-fixture-parent` gives an absolute directory on that machine for disposable files.

```sh
node apps/web/scripts/verify-workspace-navigation.mjs \
  --app-url <running-web-url> --server-url <running-api-url> \
  --second-machine <configured-machine-name> \
  --second-fixture-parent <remote-disposable-parent> \
  --output-dir /work/tmp/platform-router-verification
```

The 2026-09-12 WebKit failure control reproduced Safari's history quota after sustained log input.
The shared publication cadence preserves all 140 characters. A second control reloaded within the
250 ms interval and lost the latest filter; the per-tab pending record fixes that loss. The final
WebKit control reloaded 16.10 ms after accepted input and retained the latest filter in both the
UI and URL, with the pending record consumed. Evidence is in
`/work/tmp/platform-router-verification/2026-09-12-webkit-reload-fixed/results.json`.

The final replay passed all 72 cases: 24 each in Chromium, Firefox, and macOS WebKit, with no page
errors. Every browser completed the second-machine dirty-buffer, traversal, and late-read ownership
case. Quick reload preserved edits made 5.47 ms, 9.62 ms, and 25.54 ms earlier, respectively. The
verifier removed its own conversations, project registrations, and fixture directories. The report
records the running Mesh asset `index-M7axwCjS.js`, reached URLs, and cleanup receipts:
`/work/tmp/platform-router-verification/2026-09-12-all-browsers-verified/results.json`.

The verifier keeps its configured-machine lease alive by draining `/machines/events` through
cleanup. Startup waits account for observed slow workspace initialization; completed-selection and
reload timing checks retain their explicit 250 ms limits. Clipboard checks wait for this run's
actual copied address. The [Router evaluation](router-evaluation.md) preserves the architectural
comparison that preceded implementation.
