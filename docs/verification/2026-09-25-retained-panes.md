# Retained terminal hosts and Fragment observers

Plan 128 completed on L6, 2026-09-25, within the completion wave's A1.3, B2 and AGENTS.md scope. The obsolete Activity, tree lifetime, VirtualList and navigation phases were removed.

An unavailable machine shows a notice over the terminal host. The host stays mounted through disconnect and reconnect, with focus restored by ordinary terminal interaction. Ghostty keeps its existing runtime teardown/reconstruction behavior when the machine becomes unavailable. This change makes no runtime-instance or replay guarantee.

Tab strips and work-log groups observe rendered Fragment children through ResizeObserver. Their layout wrappers stay in place. Tab geometry still uses tab ids, with a scheduled read after order changes because moving equal-width children need not resize anything. The text inside a capped detail `pre` still uses MutationObserver: additional text can change scrollHeight without changing its box. Work-log anchor retention and following the text end remain intact.

The AGENTS.md section names these ownership rules and the existing React-state color-mode transition example. It does not prescribe transitions around external-store writes.

## Regression and browser evidence

- Tab marker mutation: failed before, passed after, proving unrelated child changes no longer force geometry reads.
- Equal-width reorder: failed with the scheduled read removed, passed with it restored. Cache answers resume after the next frame.
- Work-log text: row text changes no longer measure the group; capped text continues observing mutations. Both tests use the real React hook and Fragment implementation.
- Terminal notice: the isolated disconnect scenario timed out waiting for the notice on the prior panel. With the change it passed, retained the original host, reconnected and accepted focus.
- Focused tab-strip and work-log tests, server/web/scripts typechecks and repository gates passed. Compiler output retains the tab-strip callback memo because DOM/drag registration requires stable ref identity.

| Browser check         | Evidence directory                                                          | Result                                                                              |
| --------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| terminal-offline-host | `/work/tmp/fregat-evidence/20260925T154758Z-scenario-terminal-offline-host` | Same host online, unavailable and reconnected; focus accepted                       |
| chat-stream           | `/work/tmp/fregat-evidence/20260925T154838Z-scenario-chat-stream`           | Expanded group and capped reasoning stream completed; text followed its growing end |

The terminal scenario deliberately blocks network delivery, so console disconnect and log-ingest failures are expected. It uses a committed disposable Git fixture. Chat uses an isolated native-provider fixture, without a real model request. The chat trace captured one cancelled Git read and a checkpoint completion racing fixture cleanup; the screenshot run captured only the cancelled read. GPU/browser diagnostics are recorded in each evidence directory.

## Trace comparison

Each pair uses the same scenario and local Vite server. Values are milliseconds. These single runs establish behavior and record timing; they do not establish a speedup.

| Scenario           | Scripting before / after | Layout before / after | Paint before / after | Tasks over 50 ms before / after |
| ------------------ | ------------------------ | --------------------- | -------------------- | ------------------------------- |
| editor-split-order | 2750.4 / 2426.1          | 380.6 / 342.8         | 460.0 / 419.5        | 14 / 12                         |
| chat-stream        | 1691.5 / 1684.7          | 134.8 / 131.6         | 187.9 / 189.2        | 8 / 8                           |

Tab traces: `/work/tmp/fregat-evidence/20260925T152742Z-trace-editor-split-order` and `/work/tmp/fregat-evidence/20260925T154551Z-trace-editor-split-order`. Work-log traces: `/work/tmp/fregat-evidence/20260925T153638Z-trace-chat-stream` and `/work/tmp/fregat-evidence/20260925T154629Z-trace-chat-stream`. The deterministic regression tests establish the avoided measurements directly.

## Verification after the owner rollback

The retained L2 UI renders reasoning separately, so the original reasoning-in-work-log scenario
no longer targets the detail observer. The scenario now expands a running command and verifies
that its completed output grows beyond the cap and follows the end. The server publishes command
output on completion. The fixture also sends native output deltas, but this check makes no claim
about rendering those deltas. The selector names the Output section to avoid mistaking the
command text for its output.

The updated scenario passed at
`/work/tmp/fregat-evidence/20260925T171305Z-scenario-chat-stream`. Its capped-output screenshot was
read and shows lines 95–100 at the end of the output. No page errors, console errors or failed
responses were captured. The log has one Git pull-request lookup warning; browser diagnostics
record a socket closed during navigation and GPU warnings.
