# Consolidate error construction, error formatting, and timing helpers

Status: proposed, implementation not started. Requested 2026-09-11.

[Root PLAN.md](../PLAN.md) owns execution order; this plan owns only the sequence inside itself.
It takes census items 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, the export half of 6.1, and the two
LEAVE-IT records 9.1 and 9.3. [Plan 090 regression record](../docs/duplicate-defect-regressions.md) owns the in-place credential
redaction fix and must land first. [Plan 092](092-path-and-uri-helpers.md) owns every path and URI
helper, [Plan 093](093-web-react-and-store-ceremony.md) the React and store ceremony,
[Plan 094](094-client-core-web-tui-parity.md) the web↔TUI clients, [Plan 095](095-server-plumbing.md)
the server-internal plumbing, and [Plan 096](096-web-layering-and-boundaries.md) the `lib/` layering
sweep.

The governing hazard is stated in [AGENTS.md](../AGENTS.md): six `basename` variants share the
signature `(string) => string` with three different empty-path fallbacks, so a wrong merge
typechecks. Every item below is the same shape one layer up — `(unknown) => string`,
`(unknown) => Record<string, unknown>`, `(number) => number`. No step in this plan may be executed
until its divergence table has been read and its winner chosen.

## Reconcile the baseline

The planning baseline is Platform `75caae889d967fed0e0c8df85aa315670ef9fe49`. Capture HEAD and the
full dirty diff before editing, and preserve pre-existing working changes. Every line reference below
was re-opened against this commit; the corrections are listed in "Correct the census before citing it".

| Existing owner                                    | Work to build on                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/observability/src/sanitize.ts`          | Canonical recursive sanitizer, 17-key field set, head-2000 truncation                   |
| `packages/observability/src/scope.ts`             | Wide-event scope; already imports `./sanitize` at `:3`                                  |
| `packages/observability/package.json`             | Subpath exports (`.`, `./env`, `./env-file`, `./scope`, `./sanitize`); `evlog` only dep |
| `packages/contracts/src/error-fields.ts`          | `errorStringField`/`errorNumberField` with `maxLength` + `preserve: 'end' \| 'start'`   |
| `packages/contracts/src/index.ts`                 | The package's sole export surface (`.` → `src/index.ts`)                                |
| `packages/contracts/src/is-record.ts`             | Array-excluding `isRecord`, re-exported at `index.ts:100`                               |
| `packages/contracts/src/settings/json-equal.ts`   | `Object.is`-based structural equality, currently unreachable from outside contracts     |
| `packages/client-core/src/errors.ts`              | `createClientError`; the divergent cause rule of 9.3                                    |
| `packages/client-core/src/files/search-errors.ts` | `defineErrorCatalog('client', …)` holding `EDEN_STREAM_MISSING`                         |
| `packages/client-core/src/transport/rpc-error.ts` | `rpcErrorPayload`/`createRpcError`, the narrowest Eden envelope peel                    |
| `apps/server/src/observability/logging.ts`        | Exported `elapsedMs`/`errorSummary`/`limitText`; tail-500 truncation                    |
| `apps/server/src/observability/client-ingest.ts`  | The only bounded sanitizer; the only one that redacts `stack`                           |
| `apps/server/src/fs/errors.ts`                    | `FsError`, `nodeErrorCode`, and the quote-stripping `sanitizeCause` walker              |
| `apps/web/src/lib/client-error-reporting.ts`      | Web sanitizer clone; the structured-error field lifting worth keeping                   |
| `apps/web/src/lib/client-logging.ts`              | Web wide-event client; already imports `@workspace/observability/sanitize` at `:1`      |
| `apps/web/src/lib/client-error-taxonomy.ts`       | `toClientError`/`clientErrorMessage`, the widest Eden envelope peel                     |
| `apps/web/src/lib/structured-errors.ts`           | Web `defineErrorCatalog('client', …)`; also rewritten by Plan 093                       |
| `apps/web/src/lib/path-formatters.ts`             | The `basename` census comment at `:1-12` — the style 9.1 and 9.3 must copy              |

## Correct the census before citing it

The census was built at this HEAD, but nine references drifted or were mis-attributed. Use these.

| Census claim                                        | Corrected                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `client-ingest.ts:19-22` caps                       | `:20-23` — `maxArrayItems` 25, `maxObjectKeys` 50, `maxStringLength` 2000, `maxDepth` 5 |
| `client-ingest.ts:248-256` structured fields        | `sanitizeError` at `:244`; the lifted fields are `:247-254`                             |
| `logging.ts:148` status precedence                  | `:150`                                                                                  |
| `ws-rpc.ts:458` status precedence                   | `:457`                                                                                  |
| `provider-command-reactor.ts:845,849`               | `runtimeEventId` at `:841`, `providerErrorMessage` at `:845`                            |
| `streams.ts:558` `errorMessage`                     | the function is named `reactorErrorMessage`                                             |
| `terminal/service.ts:876` `errorMessage`            | the function is named `terminalSpawnErrorMessage`                                       |
| `client-error-reporting.ts:89` `isPlainObject`      | `:90`                                                                                   |
| `fs/errors.ts:136` "a fourth field set, same merge" | wrong — see "Keep `sanitizeCause` out of the merge" below                               |

Two additions the census missed: a sixth `isRecord` copy at
`apps/web/src/lib/tests/file-open-intent-service.test.ts:1449`, and a third truncation behaviour in
the `errorSummary` family (two of the four do not truncate at all).

## Land Pass 0 first — nothing else here compiles

Three enabling edits. They add no behaviour and must be one commit.

1. **Make `jsonEqual` reachable.** `packages/contracts/src/settings/json-equal.ts:15` is the canonical
   implementation and its doc comment at `:11-13` states why a `JSON.stringify` comparison is wrong.
   `packages/contracts/package.json:7-9` exposes exactly one export, `.` → `src/index.ts`, and
   `index.ts` does not re-export `jsonEqual`. That absence is why four consumers wrote their own.
   Add the re-export beside `index.ts:99-100`. This is the whole of this plan's share of item 6.1;
   [Plan 095](095-server-plumbing.md) owns converting the four consumers.

2. **Add the observability subpaths.** `packages/observability/package.json:7-13` declares `.`,
   `./env`, `./env-file`, `./scope`, `./sanitize`. Add `./timing` → `./src/timing.ts` and `./errors`
   → `./src/errors.ts`, and create both files. The package declares exactly one dependency, `evlog`
   (`package.json:22-24`); neither new module may add a second.

3. **Give `packages/client-core` the observability dependency.** Its dependency block
   (`packages/client-core/package.json:106-118`) lists `@workspace/contracts`, `evlog`, `server`,
   `valibot` and the rest, but not `@workspace/observability`. `apps/server`, `apps/web`,
   `apps/desktop` and `apps/tui` already depend on it. Without this edit,
   `packages/client-core/src/transport/orchestration-rpc-client.ts:774` keeps its private `elapsedMs`
   and item 1.5 lands fourteen of fifteen sites.

Then widen the sanitizer (below), because item 1.3's `errorSummary` and both server ingest paths
land on top of it.

## Widen the shared sanitizer and keep the web copy's improvement

Item 1.1. Four recursive walkers, four field sets, three truncation behaviours.

**Sites**

- `packages/observability/src/sanitize.ts:5-23` (17 keys), `:25` `sanitizeRecord`, `:41`
  `sanitizeDiagnosticValue` (private), `:51` `sanitizeError`, `:63` `limitDiagnosticString`.
  Exported today at `@workspace/observability/sanitize`.
- `apps/web/src/lib/client-error-reporting.ts:17-26` (8 keys), `:52`, `:62`, `:78`, `:90`.
- `apps/server/src/observability/client-ingest.ts:25-44` (18 keys), `:20-23` caps, `:221`, `:244`,
  `:259`, `:280`.

**Home** `packages/observability/src/sanitize.ts`, widened to
`sanitizeRecord(record, options?)` with `sensitiveFields`, `maxDepth`, `maxArrayItems`,
`maxObjectKeys`, `truncate`, and the error-field switch below. Today's 17 keys and no caps stay the
defaults, so every current caller keeps its behaviour by passing nothing. Export
`sanitizeDiagnosticValue`. `apps/web` already imports from this subpath at
`apps/web/src/lib/client-logging.ts:1`, so the web side needs no new dependency.

**Reconcile before merging — and the winner**

| Difference                  | `sanitize.ts`                         | `client-error-reporting.ts`             | `client-ingest.ts`                     | Winner                                                     |
| --------------------------- | ------------------------------------- | --------------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Field set                   | 17 keys                               | 8 keys                                  | 17 + `stack`                           | 17 as the default; `stack` stays an explicit ingest option |
| Depth / array / key caps    | none                                  | none                                    | 5 → `'[truncated]'`, 25 items, 50 keys | uncapped default; ingest passes its caps                   |
| String truncation           | head-2000 via `limitDiagnosticString` | **none**                                | head-2000 via `limitString` (`:280`)   | head-2000 default; `truncate: false` is not offered        |
| Structured-error fields     | none                                  | `code`/`fix`/`status`/`why` (`:65-74`)  | same four (`:247-254`)                 | **lift them — this half moves in, it is not dropped**      |
| Error `stack` in the result | kept (`:57`)                          | kept (`:72`)                            | **omitted from the shape entirely**    | kept by default; ingest opts out                           |
| Object guard                | array-excluding `isRecord` (`:69`)    | `isPlainObject` (`:90`), no array guard | array-excluding `isRecord` (`:221`)    | array-excluding                                            |

The field-set line is the security half. The web set omits `password`, `secret`, `cookie`,
`set-cookie`, `body`, `content`, `text`, `patch` and `x-api-key`, so a browser error report carrying
a credential is logged verbatim while the identical report from the server is redacted. The merge
closes that hole by deletion of the narrow set, not by adding an option that preserves it.

The structured-error line is the opposite direction and must not be lost in the noise. Both clones
lift `code`, `fix`, `status` and `why` off the error; the canonical one does not. Move that into
`sanitizeError` in `sanitize.ts` and reuse `errorStringField`/`errorNumberField` from
`@workspace/contracts` — except that observability may not take a workspace dependency, so either
re-implement the two readers privately inside observability or move them, with their
`ErrorStringFieldOptions`, to a place both can reach. Settle this in "Decide before writing code";
do not silently drop the lift because the import is inconvenient.

`client-error-reporting.ts:90`'s missing array guard is safe only because `:54` checks
`Array.isArray` one line earlier. It disappears with the file's copy; do not preserve it.

## Keep `sanitizeCause` out of the merge

`apps/server/src/fs/errors.ts:136` looks like a fourth clone of the same walker. It is not, and the
census's "same merge, lower priority" note is wrong. Its field set (`:29-37`) is the same seven
path-shaped keys as `apps/server/src/observability/logging.ts:29-37` and contains no credential key,
and its message rule (`:178`) is byte-identical to `logging.ts:290`: every single-quoted substring
becomes `'[redacted]'`. The shared walker has no analogue for that rule, so folding `sanitizeCause`
into it deletes a redaction.

`sanitizeCause` therefore stays where it is. Plan 090 widened the request logger's field set,
but left this constructor's list unchanged. Current responses omit causes, and request logging
redacts them again. This plan owns widening the constructor's list before any consolidation, with
a direct `FsError.cause` regression. Keep a short comment naming quote stripping as the reason
this sanitizer remains separate.

## Give `errorSummary` one implementation and name the losing rules

Item 1.3. Four functions, four different contracts, two of them across the server/client boundary of
one request.

**Sites** `apps/server/src/observability/logging.ts:143` (exported through
`observability/index.ts:15-17`, with `limitText` at `:161`) · `apps/web/src/lib/client-logging.ts:178`
· `apps/web/src/features/search/utils/providers.ts:217` `searchErrorSummary` ·
`apps/server/src/orchestration/ws-rpc.ts:451` `serializeOrchestrationRpcError`. The last two have
byte-identical bodies under different names, on opposite sides of the wire.

**Home** `packages/observability/src/errors.ts` behind the new `./errors` subpath from Pass 0. One
`errorSummary(error, options)` whose options name the truncation direction and the status precedence
rather than hiding them.

**Reconcile before merging**

| Difference               | `logging.ts:143`                                      | `client-logging.ts:178`                              | `providers.ts:217`               | `ws-rpc.ts:451`                  |
| ------------------------ | ----------------------------------------------------- | ---------------------------------------------------- | -------------------------------- | -------------------------------- |
| Status precedence        | `statusCode` → `status` (`:150`)                      | **`status` → `statusCode`** (`:180`)                 | `statusCode` → `status` (`:223`) | `statusCode` → `status` (`:457`) |
| Message truncation       | `limitText(…, 500)` — keeps the **tail** (`:161-165`) | `limitDiagnosticString` — keeps the **head** at 2000 | **none**                         | **none**                         |
| `fix` / `why`            | both, tail-500 via `preserve: 'end'`                  | neither                                              | neither                          | neither                          |
| `code` for non-`Error`   | no                                                    | **yes**                                              | no                               | no                               |
| `status` for non-`Error` | no                                                    | **yes**                                              | no                               | no                               |

The status precedence inversion is the reason this item exists: `client-logging.ts:180` reads
`status` first while the three server-side copies read `statusCode` first, so the two halves of one
request can log different numbers for the same error. Pick `statusCode` → `status` as the default —
three of four sites and every catalog error carries `status` under `statusCode` — and make the other
order an explicit option only if a web test proves a caller depends on it.

The truncation directions are opposite and both deliberate: a server operation message is most
informative at its tail, a client one at its head. Keep both as a named option and reuse the
vocabulary that already exists in `packages/contracts/src/error-fields.ts:1-4` — `maxLength` plus
`preserve: 'end' | 'start'` — instead of inventing a second spelling. Sites that truncate nothing
today must state `maxLength: undefined`, not inherit a cap by accident: `providers.ts` and `ws-rpc.ts`
currently emit full messages and a silent 500-char tail cut would be a behaviour change nobody asked
for.

This section and the next both rewrite `apps/server/src/observability/logging.ts` and
`apps/web/src/lib/client-logging.ts`. Land them in one pass or rebase the second onto the first.

## Fold fifteen `elapsedMs` and five `roundMs` onto one timing module

Item 1.5. Every one is `Math.round((performance.now() - startedAt) * 100) / 100`, directly or through
a local `roundMs`. Nothing to reconcile — and that is the point, because the two-decimal rounding is
the format every `durationMs` log field is written in. Do not "simplify" it away, do not add an
injectable clock, and do not add a negative-delta guard that no current site has.

**`elapsedMs`** `apps/server/src/observability/logging.ts:139` (exported) ·
`apps/server/src/settings/write-coordinator.ts:148` · `apps/server/src/provider/provider-service.ts:1145`
· `apps/server/src/orchestration/engine.ts:1133` · `apps/server/src/orchestration/ws-rpc.ts:486` ·
`apps/server/src/orchestration/checkpoint-reactor.ts:331` ·
`apps/server/src/fs/search-measurement.ts:178` · `apps/server/src/fs/workspace-index.ts:1352` ·
`apps/server/scripts/workspace-search-benchmark.ts:373` ·
`apps/web/src/features/chat/utils/elapsed-ms.ts:2` (exported) · `apps/web/src/lib/client-logging.ts:214`
· `apps/web/src/lib/file-server.ts:707` · `apps/web/src/features/search/utils/providers.ts:233` ·
`apps/web/src/components/use-pick-entry.tsx:184` ·
`packages/client-core/src/transport/orchestration-rpc-client.ts:774`.

**`roundMs`** `apps/server/src/observability/logging.ts:362` ·
`apps/server/src/observability/log-reader.ts:512` · `apps/server/src/fs/search-measurement.ts:182` ·
`apps/server/scripts/workspace-search-benchmark.ts:377` · `apps/web/src/lib/file-server.ts:711`.

**Home** `packages/observability/src/timing.ts` behind `./timing`, exporting both. Delete
`apps/web/src/features/chat/utils/elapsed-ms.ts` and repoint its importers; keep
`logging.ts:139`'s re-export through `observability/index.ts` so server callers do not all churn in
this pass.

`packages/client-core/src/transport/orchestration-rpc-client.ts:774` lands only if Pass 0's third
edit landed. If the dependency is rejected, take the other fourteen and leave that one with a comment
saying why.

## Give `errorMessage(unknown): string` one home

Item 2.1. Fourteen byte-identical copies of `error instanceof Error ? error.message : String(error)`,
plus two exported twins under a second name.

**Sites** `apps/server/src/app.ts:418` · `apps/server/src/index.ts:151` ·
`apps/server/src/lsp/proxy-session.ts:2189` · `apps/server/src/machines/launcher.ts:438` ·
`apps/server/src/orchestration/engine.ts:1125` · `apps/server/src/orchestration/command-receipts.ts:227`
· `apps/server/src/orchestration/session-deletion-reactor.ts:165` ·
`apps/server/src/orchestration/streams.ts:558` (named `reactorErrorMessage`) ·
`apps/server/src/fs/workspace-index.ts:1356` · `apps/server/scripts/workspace-search-benchmark.ts:381`
· `apps/desktop/src/bun/index.ts:510` · `scripts/dev.ts:76` · `scripts/prod.ts:203` ·
`scripts/run-with-env.ts:81`. Exported twins: `apps/server/src/provider/adapters/utils/adapters.ts:1`
`providerErrorMessage` and its re-declaration at
`apps/server/src/orchestration/provider-command-reactor.ts:845`.

**Home** `packages/contracts/src/error-fields.ts` plus the `index.ts:99` re-export. That module
already holds `errorStringField`/`errorNumberField`, contracts keeps its existing dependency set, and
`apps/server`, `apps/web` and `apps/desktop` all depend on it. `scripts/` reaches contracts by
relative source path today — `scripts/generate-settings-reference.ts:11` imports
`../packages/contracts/src/index` — so the three script sites need no package wiring.

**Reconcile** Nothing among the fourteen, including `null → 'null'` and `{} → '[object Object]'`.
`launcher.ts:438` and `session-deletion-reactor.ts:165` use the ternary spelling rather than the
guard-clause spelling; verified equivalent. `streams.ts:558`'s different name is the only thing that
kept it out of a `grep`.

**Six same-named neighbours must not join this merge.** See "Comment the deliberate non-copies".

**Same pass, same files** `provider-command-reactor.ts:841` re-declares `runtimeEventId`, exported at
`apps/server/src/provider/adapters/utils/runtime-ids.ts:1`; `apps/server/src/fonts/service.ts:253`
re-declares `nodeErrorCode`, exported at `apps/server/src/fs/errors.ts:128` (the exported one binds
`error.code` to a local before the `typeof` check; the copy re-reads the property — no behavioural
difference for a string code, and the exported one wins).

Item 2.4 lands in the same `packages/contracts` pass and touches overlapping files; do them together.

## Route the web's `errorMessage` spellings through the taxonomy

Item 2.2. Four web functions of the same name and four different contracts.

**Sites** `apps/web/src/lib/error-message.ts:1` — `(unknown, fallback: string)`, 27 importers ·
`apps/web/src/lib/file-server.ts:571-573` — a three-line alias of `clientErrorMessage`, 5 importers
(`features/workspace/hooks/use-tree.ts:4`, `features/workspace/hooks/use-selected-file.ts:2`,
`features/git/components/panel.tsx:7`, `features/editor/hooks/use-dirty-tab-close.tsx:26`,
`components/use-pick-entry.tsx:4`) · `apps/web/src/features/editor/state/language-server-connection-pool.ts:85`
· `apps/web/src/features/editor/state/workspace-edit-service.ts:2862`.

**Reconcile**

- `language-server-connection-pool.ts:85` falls through to `String(error)`. Its input is a rejected
  Eden envelope, so the literal string `[object Object]` reaches an `lsp.connection.*` wide event —
  exactly the failure AGENTS.md's logging rules exist to prevent. This site is the payload of the item.
- `workspace-edit-service.ts:2862` runs `toClientError` for non-`Error` values **and** for an `Error`
  with an empty message: `if (error instanceof Error && error.message) return error.message`. The
  extra empty-message branch is deliberate and survives the swap to `clientErrorMessage`, which
  applies the taxonomy in both cases.
- `lib/error-message.ts:1` never touches the taxonomy, returns a caller-supplied fallback, and also
  accepts a bare `string` input. Because its second parameter is required, a careless swap with any of
  the others does not typecheck. It stays.

**Actions** Delete `file-server.ts:571-573` and point its five importers at `clientErrorMessage` from
`@/lib/client-error-taxonomy`. Delete both editor copies and call `clientErrorMessage`;
`workspace-edit-service.ts` already imports `toClientError` from that module. Keep
`lib/error-message.ts` and consider renaming it `errorMessageOr` so the required fallback is visible
at the call site. The three deleted copies do **not** move to the contracts helper from item 2.1 —
they produce user-visible copy, which `String(error)` cannot.

## Layer the Eden envelope peels instead of merging them

Item 2.3. Three implementations of "reach into `{ value: { error: … } }`".

**Sites** `packages/client-core/src/transport/rpc-error.ts:4` `rpcErrorPayload` (exported; both apps
already import `createRpcError` from the same module — `apps/tui/src/viewer/state/lsp.ts:5`,
`apps/tui/src/tree/state/tree.ts:4`) · `apps/tui/src/connection/utils/failure.ts:15` `failureDetails`
· `apps/web/src/lib/client-error-taxonomy.ts:162` `extractFsErrorCode` and `:204`
`structuredErrorMessage`.

**Reconcile — the outer layers are supersets, not duplicates**

- For `{ value: 'oops' }`, `rpcErrorPayload` returns `'oops'` (`rpc-error.ts:6-7` tests
  `typeof container !== 'object'`), while `failureDetails` requires `isRecord(error.value)` and
  returns the whole object.
- `rpcErrorPayload`'s `typeof x === 'object'` admits arrays; `isRecord`
  (`packages/contracts/src/is-record.ts:1-2`) excludes them.
- `extractFsErrorCode:176-179` additionally tries a bare top-level `code` that neither other peel
  looks at.
- `structuredErrorMessage:212` requires a **string** `code` before accepting the payload; the others
  accept any shape and let the field readers return `undefined`.
- `failureFix` (`failure.ts:20-25`, mapping `UNAUTHORIZED`/`FORBIDDEN_ORIGIN` to a
  `SERVER_ALLOWED_ORIGINS` remedy) is genuinely TUI-only and stays.

**Action** Make `rpcErrorPayload` the one peel and keep both web layers on top of it as named
wrappers — the bare-`code` retry and the string-`code` gate are behaviour, not accident. The TUI's
`failureDetails` adopts `rpcErrorPayload`'s answers, which is a behaviour change for a string `value`
and for an array payload; state that in its commit message rather than letting it pass as a rename.
The `apps/tui` half overlaps [Plan 094](094-client-core-web-tui-parity.md); if that plan is already
moving `failure.ts`, land the peel there and keep only the two web wrappers here.

## Delete the `isRecord` re-declarations

Item 2.4. Five production copies plus one in a test, all byte-identical and all array-excluding.

**Sites** `packages/contracts/src/is-record.ts:1` (canonical, re-exported at
`packages/contracts/src/index.ts:100`) · `packages/client-core/src/files/search-client.ts:316` ·
`apps/web/src/lib/file-open-intent/state/service.ts:1912` · `packages/observability/src/scope.ts:136`
· `packages/observability/src/sanitize.ts:69` · `apps/web/src/lib/tests/file-open-intent-service.test.ts:1449`.

**Home — two homes, deliberately.** `search-client.ts` and `service.ts` import from
`@workspace/contracts`; `search-client.ts:1` already imports that package (type-only) so the edit is
a one-line widening. The two observability copies must **not** follow: that package declares only
`evlog` (`packages/observability/package.json:22-24`) and must keep it that way. Collapse them into
one private module inside observability — `scope.ts:3` already imports `./sanitize`, so the shortest
correct move is a private `src/internal/is-record.ts` that both import, rather than exporting
`isRecord` from the public `./sanitize` subpath.

**Reconcile** Nothing; all six bodies are identical. Do **not** pull in
`packages/ui/src/components/resizable.tsx:164`: it omits `!Array.isArray`, `packages/ui` has zero
workspace dependencies, and swapping in the contracts version changes what `isResizableLayout` accepts.
That one is census item 9.2 and belongs to [Plan 090 regression record](../docs/duplicate-defect-regressions.md).

## Collapse the duplicate `client` error catalog

Item 1.4. One wire code declared in two catalogs that share a namespace.

**Sites** `packages/client-core/src/files/search-errors.ts:3` and `apps/web/src/lib/structured-errors.ts:7`
both call `defineErrorCatalog('client', …)` and both export a symbol named `clientErrors`.
`EDEN_STREAM_MISSING` is declared at `search-errors.ts:4-9` and `structured-errors.ts:68-73` with
identical status 502, message factory, `why` and `fix`. Throw sites:
`packages/client-core/src/files/search-client.ts:75`,
`apps/web/src/features/workspace/hooks/use-events.ts:828`,
`apps/web/src/features/logs/utils/api.ts:57`.

**Home** Keep the single definition in client-core — `apps/web` imports client-core, not the reverse
(`apps/web/src/lib/structured-errors.ts:2-3` already imports from it). Delete
`structured-errors.ts:68-73` and alias the import at the two web throw sites so it does not shadow the
local `clientErrors`.

**Reconcile** The census asks whether `defineErrorCatalog` tolerates a repeated namespace. It does, and
the repo already relies on it: `'worktree'` is declared three times
(`apps/server/src/orchestration/worktree-runtime-errors.ts:3`, `worktree-errors.ts:3`,
`worktree-execution-gate.ts:4`), `'orchestration'` three times, `'git'` five times. So the collision
is not a runtime hazard — it is a readability one, and the better fix is the census's second
suggestion: rename client-core's catalog to the **search** catalog it actually is, since four of its
five entries are `SEARCH_*`. That also removes the two same-named `clientErrors` exports. Decide this
before the delete; the rename touches `search-client.ts`'s five throw sites.

**Sequencing** This item edits `apps/web/src/lib/structured-errors.ts`, which
[Plan 093](093-web-react-and-store-ceremony.md)'s context sweep rewrites wholesale. **1.4 lands
first**, 093 second, or 093 rebases.

## Comment the deliberate non-copies

Items 9.1 and 9.3 are LEAVE-IT. They are still work: the deliverable is a comment at each site naming
the fallback it deliberately does not share, in the style of the `basename` census at
`apps/web/src/lib/path-formatters.ts:1-12`, which already spells out the four divergent variants and
closes with "Every one of them is `(string) => string`, so a wrong swap typechecks and ships."

### 9.1 — the six `errorMessage` neighbours that must not merge

| Site                                                | The fallback it does not share                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/server/src/fs/watch.ts:656`                   | `'native filesystem watcher failed'`, never `String(error)`                      |
| `apps/server/src/lsp/typescript/shared/error.ts:16` | accepts a bare `string`; falls back to `'TypeScript LSP operation failed'`       |
| `apps/server/src/terminal/service.ts:876`           | branches on `FsError` first; falls back to `'failed to start terminal'`          |
| `apps/web/src/lib/error-message.ts:1`               | required caller fallback; accepts a bare `string`; never `String`                |
| `apps/web/src/lib/file-server.ts:571`               | routes through `clientErrorMessage` to produce **UI copy** — deleted by item 2.2 |
| `packages/observability/src/runtime.ts:276`         | takes `Error \| undefined`, not `unknown`; `'unknown drain failure'`             |

Write a header comment at `apps/web/src/lib/error-message.ts:1` in the `path-formatters.ts` style
naming the other five and stating that five of the six return operator- or user-visible copy, then a
one- or two-line comment at each of the other four. Two of the six are named
`terminalSpawnErrorMessage` and (in item 2.1's set) `reactorErrorMessage`, so the name alone is not a
reliable index — say so in the header. `file-server.ts:571` needs no comment because item 2.2 deletes
it; if 2.2 is deferred, it gets one.

### 9.3 — the five `createError`-with-unknown-cause wrappers

`packages/tree/src/utils/structured-errors.ts:27` · `apps/desktop/src/bun/structured-errors.ts:27` ·
`packages/pty/src/utils/structured-errors.ts:30` · `apps/server/src/observability/structured-errors.ts:168`
· `packages/client-core/src/errors.ts:7`.

The first four route by `instanceof Error`: an `Error` cause becomes `cause`, anything else lands
under `internal`, evlog's documented backend-only context record
(`node_modules/evlog/dist/catalog-BkwN4C6z.d.mts:28-30`), where the sanitizer can reach it.
`packages/client-core/src/errors.ts:9` does the opposite — `Object.assign(error, { cause })` for any
defined cause — so a raw Eden envelope or a bare string ends up on the property evlog serialises as
the error chain. Every one typechecks as a swap for every other.

**Do not merge.** The only shared home is `packages/observability`, and giving `packages/tree` its
first workspace dependency to save nine lines is the wrong trade. The work items are:

1. Settle `packages/client-core/src/errors.ts:7`'s rule explicitly. Either adopt the four-site
   `instanceof Error` routing, or keep the assign and write the reason at the site. This is a
   decision, not a cleanup — see below.
2. Comment `packages/tree/src/utils/structured-errors.ts:27` and
   `apps/desktop/src/bun/structured-errors.ts:27` as deliberate copies of the server rule, each
   naming the dependency they are refusing.
3. Add the missing guard at `packages/pty/src/utils/structured-errors.ts:30`: it spreads
   `internal: { cause }` even when `cause` is `undefined`. All five callers
   (`packages/pty/src/process.ts:69,79,103,113,135`) pass one today, so this is prophylactic — one
   line, no behaviour change.

## Decide before writing code

Each decision gates the item beside it.

- **Does the shared sanitizer reach `errorStringField`/`errorNumberField`?** Observability may not
  depend on `@workspace/contracts`. Either re-implement the two readers privately inside
  observability, or move `packages/contracts/src/error-fields.ts` to observability and have contracts
  re-export it. The second unifies the readers but inverts today's package order; the first duplicates
  about 30 lines. Item 1.1's structured-error lift is blocked on this and must not be dropped to avoid
  choosing.
- **Which status precedence wins in the merged `errorSummary`?** `statusCode` → `status` (three sites)
  or `status` → `statusCode` (`client-logging.ts:180`). Item 1.3.
- **Do `providers.ts` and `ws-rpc.ts` start truncating?** They truncate nothing today. Adopting either
  direction is a behaviour change to two live log fields. Item 1.3.
- **Does client-core take the `@workspace/observability` dependency?** Yes unblocks
  `orchestration-rpc-client.ts:774`; no leaves one of fifteen `elapsedMs` copies standing. Items 1.5
  and Pass 0.
- **Is client-core's catalog renamed to `search` or kept as a second `client`?** The rename removes
  the duplicate `clientErrors` export name and touches five throw sites. Item 1.4.
- **Does `createClientError` adopt the `instanceof Error` cause routing?** Adopting it moves raw Eden
  envelopes off `cause` and under `internal` for every client structured error, which changes what
  appears in client wide events. Item 9.3.

## Verify plausible failures

App Vitest runs under `bun --bun vitest` in `apps/*`; runtime-neutral packages run plain `vitest`.
Run the named files, not a package or repo suite, and never a bare test count. No test may open a
socket to our own server. The dev server already running is the only one to use.

| Failure to catch                                                           | Narrowest check                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The widened sanitizer stops redacting a credential for one caller          | A new `packages/observability/src/tests/sanitize.test.ts` asserting all 17 default keys redact with no options passed, plus the ingest option set                                                                   |
| The web report loses `code`/`fix`/`status`/`why`                           | `apps/web/src/lib/tests/client-error-reporting.test.ts` — `bun --bun vitest run --project dom apps/web/src/lib/tests/client-error-reporting.test.ts`                                                                |
| Ingest silently drops its depth/array/key caps or starts emitting `stack`  | `apps/server/src/observability/tests/client-ingest.test.ts` — `bun --bun vitest run apps/server/src/observability/tests/client-ingest.test.ts`                                                                      |
| `errorSummary` flips truncation direction or status precedence on one side | `apps/web/src/lib/tests/client-logging.test.ts` plus a new case in `packages/observability/src/tests/` asserting head-2000, tail-500 and no-truncation against one long message with both `status` and `statusCode` |
| A merged `errorMessage` swallows a fallback message                        | `packages/contracts/src/tests/error-fields.test.ts` — `vitest run` in `packages/contracts`, plus a grep proving the six 9.1 sites still declare their own                                                           |
| `[object Object]` reaches an `lsp.connection.*` event again                | Assert `clientErrorMessage` on a rejected Eden envelope in `apps/web/src/lib/tests/client-error-taxonomy.test.ts`                                                                                                   |
| The Eden peel changes answers for a string or array payload                | `packages/client-core/src/transport/tests/` — a case table over `{value:'oops'}`, `[{error:…}]`, `{code:…}` and `{value:{error:{code:…}}}`                                                                          |
| The catalog collapse breaks a live throw site                              | `apps/web/src/features/logs/tests/api.test.ts` and `apps/web/src/features/workspace/tests/use-events.test.ts`                                                                                                       |
| `isRecord` removal changes array handling                                  | `packages/observability/src/tests/scope.test.ts`; contracts' behaviour is already covered by its own suite                                                                                                          |
| `jsonEqual` re-export breaks the contracts surface                         | `vitest run` in `packages/contracts` plus `tsgo --noEmit` in `packages/contracts` and `packages/client-core`                                                                                                        |
| A new observability subpath is unresolvable from a consumer                | `typecheck` in `packages/observability`, `apps/server`, `apps/web` and `packages/client-core` — the subpath error appears only at the consumer                                                                      |

Timing has no behavioural check worth writing: the merged `elapsedMs` is the same expression at every
site. Prove it with the diff and a typecheck, not a test.

## Do not do these here

- **The completed request-logger credential fixes** and the persisted resizable-layout guard
  belong to the [Plan 090 regression record](../docs/duplicate-defect-regressions.md).
  Preserve their tests. The separate `FsError.cause` hardening above remains this plan's work.
- **Converting `jsonEqual`'s four consumers** (`apps/server/src/settings/store.ts:1121`,
  `apps/web/src/features/settings/utils/default-value.ts:22`,
  `apps/server/src/provider/provider-service.ts:1087`,
  `apps/server/src/provider/provider-adapter-registry.ts:675`). This plan only makes the canonical one
  reachable; [Plan 095](095-server-plumbing.md) owns the conversions and the `-0` and key-order
  behaviour changes they carry.
- **Any path, URI, or containment helper** — `fileUriForPath`, `parentPath`, `isOutsideRoot`,
  `basename`. [Plan 092](092-path-and-uri-helpers.md) owns them, including the `path-formatters.ts`
  header this plan's 9.1 comment sits beside. If both plans are in flight, 092 owns that file and 091
  hands it the `errorMessage` header text.
- **The `use(Context)`-or-throw sweep and the five wrong-catalog throw sites.**
  [Plan 093](093-web-react-and-store-ceremony.md) owns them and rewrites
  `apps/web/src/lib/structured-errors.ts`; item 1.4 must land before it.
- **The TUI half of the Eden peel and every other web↔TUI parallel.**
  [Plan 094](094-client-core-web-tui-parity.md).
- **The `apps/web/src/lib/` two-consumer audit.** [Plan 096](096-web-layering-and-boundaries.md).

## Completion checklist

- [ ] Pass 0's three edits are one commit and change no behaviour.
- [ ] The widened sanitizer keeps the 17-key default, the head-2000 default, and the lifted
      `code`/`fix`/`status`/`why`; the 8-key set exists nowhere.
- [ ] `sanitizeCause` still strips single-quoted substrings and carries a comment saying why it is not
      the shared walker.
- [ ] One `errorSummary` with named truncation direction and status precedence; the four call sites
      state their choice explicitly.
- [ ] Fifteen `elapsedMs` and five `roundMs` declarations are one module; the two-decimal rounding is
      unchanged.
- [ ] One `errorMessage` in contracts; the six 9.1 neighbours are untouched and commented.
- [ ] `apps/web` has one `errorMessage` export, and no web log field can receive `[object Object]`.
- [ ] One Eden peel with the two web layers preserved on top.
- [ ] `isRecord` is declared twice repo-wide: contracts, and one private observability module.
- [ ] One `client` catalog owns `EDEN_STREAM_MISSING`, and the duplicate `clientErrors` export name
      is resolved.
- [ ] `packages/client-core/src/errors.ts`'s cause rule is decided and written down; `pty`'s
      `undefined` guard is added.
- [ ] Every check in the verification table ran on its named file and passed.
