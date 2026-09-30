# Disposal of busy syntax workers

Status: Approved. This is an ownership repair. Plan 099's frozen calibration and acceptance gates remain unchanged.

A syntax worker executing synchronous code cannot answer a queued disposal message. Shiki and
Tree-sitter owners previously awaited that answer before calling `terminate()`, so both the
owner's disposal promise and pending transport callers could remain unresolved indefinitely.
The highlighting service already aborts its public snippet caller, but then reached the same
blocked owner cleanup. Its normal disposal ordering needed no change after that mechanism was
reproduced and repaired.

Each owner now detaches and terminates its owned handle before completing disposal, clears
retained state and rejects pending RPCs with its existing disposal error. Repeated disposal
returns the same promise. Late messages and errors cannot revive the closed owner. A delivered
Tree-sitter registration reply can have a queued continuation when disposal begins; handle
identity checks prevent that continuation from repopulating the registration cache or sending
warm-up work after closure. Parse and edit readiness continuations also check the current
handle before creating source descriptors, so disposal cannot be followed by newly retained
document source.

Document-only disposal remains scoped to its runtime session. It leaves the shared worker
available to other views. Existing delayed registration and theme behavior is preserved: a
registration that resolves after owner closure cannot create a worker or retain a theme.
Highlighting-service callers waiting on grammar acquisition still settle with `disposed`.

## Reproduction and verification

Before source: main `4edb43b18`. Evidence is retained under
`/work/tmp/foundations-worker-cleanup/`.

| Check                                           | Before                                                                                           | After                                                         | Evidence                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Shiki owner transport/cache                     | 10 known-good cases pass; busy case fails because handle is not terminated                       | 11 pass                                                       | `known-good-shiki.log`, `red-shiki.log`, `green-shiki.log`        |
| Tree-sitter owner transport/registration        | Busy case fails; 12 existing cases pass                                                          | 19 pass including registration cases and delivered-reply race | `red-tree.log`, `red-delivered-reply.log`, `green-tree-final.log` |
| Actual Chromium worker and highlighting service | Cooperative control passes; owner and service busy-disposal cases fail                           | Included in 21 passing browser cases                          | `red-browser.log`, `green-browser.log`                            |
| Actual Shiki grammar/document worker            | Normal tokenization, edit/catch-up, disposed-session results and same-document session isolation | 13 pass                                                       | `green-native-shared.log`                                         |

The browser fixture posts an observable start message, then occupies its actual worker thread
with synchronous work. It cannot process a disposal reply. The test proves owner termination,
settlement of pending caller/idle fence, and highlighting-service disposal in this state. Only
the outside-world worker transport is controlled; editor owners, sessions and the service are
real. No source module is mocked. The real Shiki worker suite separately verifies ordinary
highlighting and document sharing. This is a teardown proof, not a tokenizer throughput claim.

Commands run from the isolated repository with the machine's heavy-command wrapper:

```sh
bunx vitest run --root editor/packages/editor --project dom test/shiki/workerClient-cache.test.ts
bunx vitest run --root editor/packages/tree-sitter test/treeSitter-workerClient.test.ts test/workerClient-registration.test.ts
bunx vitest run --root editor/packages/highlighting --project browser test/worker-disposal.browser.test.ts test/review.browser.test.ts test/disposed-admission.browser.test.ts test/service.browser.test.ts
bunx vitest run --root editor/packages/editor --project browser test/shiki/workerClient.browser.test.ts
```

Workspace exports were built before consumer tests. Required commit gates and repository
checks are recorded in `commit-repro.log` and `commit-fix.log`.

Calibration reported a 1 MB line remaining busy for 400 seconds. This repair lets an owner
release a busy worker without its cooperation. It does not make that fixture finish syntax
work, certify long-line support, alter its recorded exclusions, or complete Unit 0. The frozen
package sets, delayed-negative controls and calibration policy are untouched. No live provider
or account is involved.

## Independent review repair

The review at `https://github.com/ShaulLavo/fregat/pull/213#issuecomment-5917307032`
found that parse/edit readiness continuations could recreate retained source after synchronous
disposal. The two real-owner regressions reproduce this with the existing injected worker
transport: both fail on the reviewed head with one retained document, while 19 controls pass.
Both pass after current-handle checks run before descriptor creation. Closed callers resolve
with `undefined`, no parse/edit message is posted, and source retention, pending requests and
the owner idle fence are empty/settled.

`red-late-source.log` records the two failures; `green-late-source.log` records all 21
Tree-sitter transport/registration checks passing. The new checks use the real owner and
piece-table snapshot and control only the external Worker transport.
