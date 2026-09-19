# Page-owned subscriptions

`apps/web/src/lib/state/page-subscription.ts` connects existing subscription cleanup to the browser
page lifecycle. Settings streams, machine events and filesystem events all use it.

Ordinary `beforeunload` stops each subscription before Chromium tears down its connection. The
existing abort signals then classify shutdown as intentional and stop reconnect loops. Waiting
until `pagehide` alone was too late in the measured reloads.

The unsaved-work guard runs in capture phase. If it prevents the unload event to request a native
confirmation, subscriptions stay alive. Choosing Stay therefore needs no restart. A confirmed
departure stops them at `pagehide`. `pageshow` starts fresh subscriptions when a retained page
returns. Component cleanup removes all listeners and stops its subscription exactly once.

Real failures still use the existing error and reconnect paths. No network-error strings are
filtered. A watcher failure without an HTTP response now reports a connection failure rather than
“status undefined”.

The lifecycle tests cover duplicate events, disposal, unsaved-work confirmation and settings
catch-up after suspension. Existing stream tests still exercise unexpected disconnect/reconnect.
`bun run agent:browser scenario page-lifecycle` drives native reload confirmation (Stay and Leave),
three ordinary reloads, and simulated retained-page events. The latter tests restoration wiring,
not whether the browser will admit the whole app into its back/forward cache.

Verified 2026-09-19 on release `20260919T160144Z-e78c4c44-page-subscriptions`.
The seven-step production run is at
`/work/tmp/fregat-evidence/20260919T160213Z-scenario-page-lifecycle/`; its final screenshot was
inspected. Production logs for 16:02:13–16:02:20 UTC had no warning or error events. Ten focused
lifecycle/settings-stream tests and six environment-connection tests passed, with web/scripts
typechecks, changed-file lint/format and unused-code checks. The deploy reused the running server.
