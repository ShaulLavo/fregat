# Log Audit — Implementation Prompts

Source: audit of `/Users/shaul/Desktop/D/platform/logs/*.jsonl`, 14 files,
174,840 lines, 2026-08-11 → 2026-08-22. 4,441 errors, 5,851 warnings.

Each prompt below is self-contained: hand one to an agent without any other
context. Repo paths are absolute because two prompts target a sibling repo.

**Counts are a snapshot.** The dev server appends to these files continuously,
so re-running any command below will return slightly higher numbers than the
figures quoted. Ratios and rankings are what matter, not exact totals.

Priority order: P1–P5 first. P3 and P4 are the cheapest wins (two level
changes remove ~5,100 lines of false signal). P5 is what makes the remaining
errors debuggable at all.

| #   | Title                                          | Repo            | Severity | Size |
| --- | ---------------------------------------------- | --------------- | -------- | ---- |
| P1  | Fold projections throw on every reparse        | Editor          | high     | M    |
| P2  | WebAssembly OOM after ~217 editor instances    | Editor          | high     | M    |
| P3  | Server stamps `error` on 404s and on HTTP 200  | platform        | high     | S    |
| P4  | `address.tabs_omitted` warns 161×/minute       | platform        | high     | XS   |
| P5  | 1,864 context-free client errors               | platform        | high     | M    |
| P6  | `AbortError` reported as an error              | platform        | medium   | XS   |
| P7  | `path` redacted on client, plaintext on server | platform        | medium   | S    |
| P8  | Theme re-resolves 303×/minute                  | platform        | medium   | M    |
| P9  | Wallpaper endpoints: 10,700 requests           | platform        | medium   | S    |
| P10 | Wallpaper reads never retry EINTR              | platform        | medium   | S    |
| P11 | Diff `row-count-mismatch` × 179                | platform+Editor | medium   | M    |
| P12 | Structural syntax failures log twice           | Editor          | low      | XS   |
| P13 | `fs.read` on literal path `settings:`          | platform        | low      | S    |
| P14 | HMR artifacts pollute the error log            | platform        | low      | S    |

House rules that apply to every prompt: `CLAUDE.md` at the repo root is
binding — wide-event logging (enrich one event, never add narrow lines),
never `new Error` (use `createError`/`createStructuredError`), guard clauses
over nesting, comments 1–2 lines, greenfield so no back-compat shims, and
run the narrowest test that could catch the change rather than a suite.

---

## P1 — Fold projections throw on every reparse

**Repo:** `/Users/shaul/Desktop/D/Editor` · **Severity:** high · **Size:** M

### Evidence

997 error pairs across 2026-08-17..22, still firing on the most recent day.
Every one is `changeKind: "refresh"`, `documentMode: "session"`, languages
typescript (980) and markdown (18).

```bash
cat /Users/shaul/Desktop/D/platform/logs/*.jsonl \
  | jq -rc 'select(.action=="editor.syntax.structural_request_failed")
            | [.syntax.changeKind, .syntax.languageId, (.error.message|.[0:70])] | @tsv' \
  | sort | uniq -c | sort -rn
```

Message: `Fold projections "editor.folds.syntax" and "editor.folds.fallback"
contain crossing fold ranges`. Worst-hit documents: `registry.ts` (671),
`mergeConflictPlugin.ts` (192), `semantic-token-controller.ts` (60).

Consequence is not cosmetic: the throw drives `syntaxStatus: "error"`, so
folding and everything reading enclosing scopes stays dead for that document
until it is reopened.

### Diagnosis to verify

Two paths register the syntax fold projection. The public one deletes the
fallback projection first, and carries a comment explaining that it must:

`packages/editor/src/editor/Editor.ts:777`

```ts
setSyntaxFolds(folds: readonly FoldRange[]): void {
  this.runInOperation(() => {
    if (folds.length > 0) this.grammarDescribedFolds = true
    // The fallback leaves the registry before the grammar's answer enters it: the registry
    // validates every fold projection against the whole set, and the two describe the same
    // blocks with geometry that may cross.
    this.syncFallbackFoldProjection()
    this.setSyntaxFoldProjection(folds)
```

The edit-projection path does the reverse and never sets `grammarDescribedFolds`:

`packages/editor/src/editor/Editor.ts:2972`

```ts
private applySyntaxFoldProjection(folds: readonly FoldRange[] | null): void {
  if (folds) this.setSyntaxFoldProjection(folds)   // fallback may still be registered
  this.scheduleFallbackFoldProjection()
}
```

`setSyntaxFoldProjection` (line 1929) sanitizes the incoming folds against
_themselves_ via `rejectCrossingFoldRanges`, but `displayProjections.set` then
runs `validateFoldProjectionSet`
(`packages/editor/src/editor/displayProjectionRegistry.ts:269`) across the
**union** of every registered fold projection — including a live
`editor.folds.fallback`. That union is what throws.

This is a hypothesis derived from reading, not from a reproduction. Confirm it
before fixing: instrument `validateFoldProjectionSet` to log the owners present
in the set at throw time, open `packages/contracts/src/settings/registry.ts` in
the app, and edit it until the throw fires.

### Task

1. Reproduce and confirm which owners are co-registered at the throw.
2. Make the ordering invariant hold on **every** path that registers a fold
   projection, not just the two known ones. Prefer making it structural — e.g.
   an atomic "replace the fold projection set" operation that cannot observe an
   intermediate state — over adding a third copy of the delete-then-set dance.
   A rule that has already been broken twice will be broken a third time.
3. Decide deliberately whether a crossing union should still `throw`. Killing
   the whole syntax session for a recoverable geometry conflict is a large
   blast radius; dropping the lower-priority projection and logging once may be
   the better contract. Whichever you choose, say why in the code.

### Done when

- Editing `registry.ts` for a minute produces zero `editor.syntax.structural_error`.
- A test in `packages/editor/test/displayProjectionRegistry.test.ts` covers the
  edit-projection path specifically, not just direct registry calls.
- `syntaxStatus` never latches to `error` from a fold conflict.

### Note

`plans/logseq-parity-implementation-plan.md:341`,
`docs/logseq-port-map.md:623` and `docs/logseq-parity-gap-matrix.md:229` in the
platform repo all list this as blocking outliner/collapse work. Update those
lines when it lands.

---

## P2 — WebAssembly OOM after ~217 editor instances

**Repo:** `/Users/shaul/Desktop/D/Editor` · **Severity:** high · **Size:** M

### Evidence

34 occurrences, all on 2026-08-20 within one session:

```bash
cat /Users/shaul/Desktop/D/platform/logs/*.jsonl \
  | jq -rc 'select(.action=="editor.syntax.highlight_request_failed")
            | [.timestamp, .editor.instanceId, (.error.message|.[0:60])] | @tsv'
```

`WebAssembly.instantiate(): Out of memory: Cannot allocate Wasm memory for new
instance`, at `editor.instanceId: "editor-token-217"`, on a 10KB TypeScript
file. The per-session ordinal reached **271** that day; every other day in the
corpus peaks between 11 and 61.

```bash
for f in /Users/shaul/Desktop/D/platform/logs/*.jsonl; do
  echo "$(basename $f) $(jq -rc '.editor.instanceId // empty' "$f" \
    | grep -oE '[0-9]+$' | sort -n | tail -1)"
done
```

The counter alone proves nothing — it is a module-level monotonic
(`packages/editor/src/editor/runtime.ts:11`,
`` `editor-token-${editorInstanceCount++}` ``) and 271 editor constructions
over a long session of opening files is plausible. The OOM is the real signal:
_"Cannot allocate for new instance"_ means memory from prior instantiations
was never released.

### Task

1. Establish ground truth before theorising. Two Wasm consumers exist —
   shiki/oniguruma (`packages/editor/src/shiki/`) and tree-sitter
   (`packages/tree-sitter/src/`), both worker-hosted. Determine which one
   instantiates per editor (or per language, or per document) rather than once
   per worker. Count live instances directly; do not infer from the log.
2. Confirm the lifetime is genuinely unbounded by driving it: open and close
   200+ editors in a single page session and watch the instance count and
   worker heap. If the count grows monotonically with editors, that is the leak.
3. Fix the ownership. A Wasm module should be instantiated once per worker and
   shared, or explicitly disposed when its owning editor disposes. Prefer
   sharing — disposal is a rule that gets forgotten, and the memory note on
   StrictMode (`activate()` disposing constructor-owned state) shows this
   codebase has been bitten by lifecycle asymmetry before.
4. Verify under `StrictMode`. The app mounts under it and dom tests do not, so
   a double-mount that leaks one instance per editor would pass every test.

### Done when

- 300 editor open/close cycles in one session hold a flat Wasm instance count.
- No `highlight_request_failed` with an OOM message under that load.
- A test asserts the instantiation count does not scale with editor count.

---

## P3 — Server stamps `error` on 404s and on HTTP 200

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** high · **Size:** S

### Evidence

Every server-side `level: "error"` line in the corpus, by HTTP status:

```bash
cat logs/*.jsonl | jq -rc 'select(.level=="error" and .source=="be")
  | [(.status//"none"|tostring), (.path//"-")] | @tsv' | sort | uniq -c | sort -rn
```

```
 251  404  /fs/read
  18  200  /fs/recents        <-- succeeded
  10  500  /wallpaper/still
   4  500  /wallpaper
   2  404  /
   1  504  /git/status
```

Only **17 of 286** server errors are actual server faults. Meanwhile 401/403
already log correctly at `warn`:

```bash
cat logs/*.jsonl | jq -rc 'select(.level=="warn" and .source=="be")
  | [(.status//"none"|tostring), (.path//"-")] | @tsv' | sort | uniq -c | sort -rn
```

The `/fs/recents` case is the clearest defect. HTTP 200, six recents returned
successfully, but two of the stat'd directories no longer exist on disk — an
entirely expected condition for a recents list — and a failed sub-operation
inside `fs.operations[]` escalates the level of the whole wide event. Inspect
one:

```bash
cat logs/*.jsonl | jq -c 'select(.level=="error" and .path=="/fs/recents")' \
  | head -1 | jq -S 'del(.error.stack)'
```

### Task

Find where the request-level `level` is derived (start from the wide-event
request wrapper — `observeRequestOperation` and whatever composes
`fs.operations[]`; `apps/server/src/observability/` is the likely home) and
make it a function of the request outcome, not of the worst sub-operation:

- HTTP 5xx → `error`
- HTTP 4xx → `warn` (the caller asked for something that isn't there; that is
  an answer, not a fault)
- HTTP 2xx → `info`, **even when a sub-operation inside it failed**

Keep the per-operation `status: "error"` and its error object inside
`fs.operations[]` — that detail is correct and useful, and this is exactly the
wide-event shape the house rules ask for. Only the envelope's level is wrong.

Do not special-case `/fs/recents` or `/fs/read`. Fix the rule.

### Done when

- A `/fs/recents` request where some recents no longer exist logs at `info`
  and still carries the per-entry NOT_FOUND detail.
- A `/fs/read` for a missing path logs at `warn` with status 404.
- A genuine 500 still logs at `error`.
- Server-side error count over a normal session drops from ~286 to ~17.
- Tests live near `apps/server/src/observability/tests/`; there is already a
  `log-reader.test.ts` there to model.

---

## P4 — `address.tabs_omitted` warns 161×/minute

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** high · **Size:** XS

### Evidence

4,828 warnings — the single most frequent warning in the corpus. 2,044 in one
day, peaking at 161 in one minute.

```bash
cat logs/*.jsonl | jq -rc 'select(.action=="address.tabs_omitted")
  | [.tabCount, .maxAppliedTabs, .bytes] | @tsv' | sort | uniq -c | sort -rn | head
```

Dominant payload (4,047 of them): `tabCount: 17`, `maxAppliedTabs: 64`,
`bytes: 1504`. The count ceiling is nowhere near hit — the 1500-byte budget is,
by 4 bytes.

### Diagnosis

`apps/web/src/features/address/utils/snapshot.ts:209`, inside `tabTokens()`.
The function runs on every address recompute. With ~17 tabs open the joined
token string sits 4 bytes over `TABS_BUDGET_BYTES`, so _every single recompute_
emits an identical warning. The condition is expected, recurring, and
non-actionable — dropping `tabs` from the URL is the designed behaviour, and
the comment above it says so.

### Task

Demote it and make it deduplicate. Either is acceptable, both is better:

- `log.warn` → `log.debug`. A designed, documented degradation is not a warning.
- Emit only when the decision _changes_ — key on a signature of the omitted tab
  set, and stay silent while that signature holds. Repeating an unchanged fact
  4,828 times is what buries the 23 warnings that mattered.

Do not raise `TABS_BUDGET_BYTES` to make it stop. The budget is a URL-length
constraint and the comment above it explains why partial truncation is unsafe.

### Done when

A session with 17+ tabs open produces at most one such line per change to the
tab set, at `debug`.

---

## P5 — 1,864 context-free client errors

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** high · **Size:** M

### Evidence

The largest single signal in the corpus — 1,864 byte-identical error lines:

```bash
cat logs/*.jsonl | jq -rc 'select(.area=="client-error-taxonomy")
  | [.category, .cause.name, (.cause.message//"-"), (.message|.[0:50])] | @tsv' \
  | sort | uniq -c | sort -rn
```

```
1864  unknown  TypeError  network error  Something went wrong while talking to the file server.
```

No operation. No path. No method. No status. **It is not possible to tell from
these 1,864 lines which request failed.** They arrive as a steady drip of a few
per minute across every day in the corpus:

```bash
jq -r 'select(.area=="client-error-taxonomy") | .timestamp[11:16]' \
  logs/2026-08-22.1.jsonl | uniq -c
```

CLAUDE.md is explicit that this is the bug to fix first: _"If the logs do not
explain the failure, that is itself the bug to fix first: add the missing log
events or fields, then debug with the better logs. Do not debug blind."_

### Diagnosis

Three compounding causes.

**No transport category.** `packages/contracts/src/error-category.ts` has eight
categories, all of them filesystem semantics. A `TypeError: network error` —
dev server restarting, connection reset, offline — has nowhere to go, so
`toClientError` (`apps/web/src/lib/client-error-taxonomy.ts:83`) drops it into
`unknown` alongside genuine unclassified bugs.

**The message is false.** `unknown` maps to _"Something went wrong while
talking to the file server"_ (line 21). We never reached the file server. A
`TypeError` from `fetch` means the request never got an HTTP response at all.

**No context is captured.** `reportError` (line 94) passes only
`area`/`category`/`cause`/`message`/`operation: 'report'`. The `context` field
that `reportClientError` accepts is never populated by this path.

Compare `workspace.events.summary`, which gets this right — same underlying
`TypeError: network error`, but logged with `path`, `durationMs`, subscription
counts and a plan summary, so it is actually diagnosable:

```bash
cat logs/2026-08-22.jsonl \
  | jq -c 'select(.action=="workspace.events.summary" and .level=="warn")' \
  | head -1 | jq -S 'del(.client)'
```

### Task

1. Add a transport/connectivity category to
   `packages/contracts/src/error-category.ts` and classify `TypeError` from
   `fetch` into it, with an honest message ("Could not reach the server") and a
   level below `error` — a dev-server restart is not an application fault.
   Check `apps/server/src/` for any consumer that switches on `ErrorCategory`
   exhaustively before adding the variant.
2. Give every `reportError` call site enough context to identify the request.
   Audit the callers:
   ```bash
   rg -n "reportError\(|toClientError\(|clientErrorMessage\(" apps/web/src
   ```
   `apps/web/src/lib/file-server.ts` is the highest-value one — it knows the
   method, route and path. Thread that through as `context`. Follow the
   wide-event rule: enrich the one event, do not add a second log line.
3. Note the interaction with P7 — `path` is currently redacted by
   `client-error-reporting.ts`, so adding a path to `context` achieves nothing
   until P7 is resolved. Do P7 first or in the same pass.

### Done when

- Every `client-error-taxonomy` line names the operation and route that failed.
- A dev-server restart produces connectivity-category lines below `error`, not
  1,800 false `error`s.
- Grepping `level=="error"` on a normal session returns only real faults.

---

## P6 — `AbortError` reported as an error

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** medium · **Size:** XS

### Diagnosis

`apps/web/src/lib/client-error-taxonomy.ts:58`:

```ts
export function toClientError(input: unknown): ClientError {
  if (isAbortError(input)) {
    return {
      category: 'unknown',
      message: messagesByCategory.unknown,
      cause: input,
    }
  }
```

The code goes to the trouble of detecting an abort (`isAbortError`, line 133)
and then hands it to `unknown` — which flows into `reportError` and out through
`reportClientError`, where the level is hardcoded to `log.error`
(`apps/web/src/lib/client-error-reporting.ts:33`).

A cancelled request is not a failure. Every superseded query, every navigation
away from an in-flight fetch, becomes an error line.

### Task

Return early for aborts without reporting, or report at `debug`. If some caller
genuinely needs to distinguish "aborted" from "unknown" for its own control
flow, give it a real category rather than routing it through the error path.

Cannot be measured in the current corpus — aborts are indistinguishable from
other `unknown` entries there, which is itself the point. Land this with P5.

### Done when

Rapidly switching files (superseding in-flight reads) produces no `error` lines.

---

## P7 — `path` redacted on client, plaintext on server

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** medium · **Size:** S

### Evidence

`apps/web/src/lib/client-error-reporting.ts:15`:

```ts
const sensitiveFields = new Set([
  'absolutePath',
  'authorization',
  'cwd',
  'dest',
  'destination',
  'fileName',
  'filename',
  'path',
  'stack',
  'token',
])
```

Client errors therefore report `"path": "[redacted]"` and `"stack":
"[redacted]"`. Meanwhile every server line in the same file prints the same
paths verbatim:

```bash
cat logs/*.jsonl | jq -rc 'select(.source=="be") | .fs.operations[]?.path' \
  | grep -c "^Users/shaul"
```

Even a redacted client error sits three lines away from a server event
containing the full path. Confirm the asymmetry directly:

```bash
cat logs/*.jsonl | jq -c 'select(.level=="error" and .area=="fs" and .source=="be")' \
  | head -1 | jq -S 'del(.error.stack)'
```

That sample shows `error.cause.path: "[redacted]"` inside a wide event whose
`fs.operations[]` lists `Users/shaul/Desktop/strello`,
`Users/shaul/Desktop/D/platform` and six more in the clear.

We pay the debuggability cost of redaction without getting any privacy benefit.

### Task

Decide the policy once and apply it to both sides.

Recommended: **stop redacting `path` and `stack`** in client reports. These are
workspace-relative paths already logged in full by the server, they are the
single most useful field for diagnosing a client error, and their absence is
what makes P5's 1,864 lines useless. Keep `authorization` and `token` redacted
— those are real secrets.

If instead the decision is that paths are sensitive, then the server must
redact them too, and the settings/secret-store boundary in CLAUDE.md is the
model to follow. Do not leave it split.

Whichever way it goes, write the reason in a comment above `sensitiveFields`.

### Done when

Client and server agree, and P5's added context survives to the log file.

---

## P8 — Theme re-resolves 303×/minute

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** medium · **Size:** M

### Evidence

Four correlated events dominate client log volume:

```bash
cat logs/*.jsonl | jq -rc 'select((.action//"")|test("theme|syntax.reloaded"))
  | .action' | sort | uniq -c | sort -rn | head
```

```
10637  editor.color-theme.shiki_resolved        (debug)
 4850  editor.syntax.provider_theme_changed     (debug)
 4706  editor.syntax.highlighter_theme_changed  (debug)
 4680  editor.syntax.reloaded                   (info)
```

Peak burst — find the worst minutes:

```bash
cat logs/*.jsonl | jq -rc '[.timestamp[0:16], .action] | @tsv' \
  | sort | uniq -c | sort -rn | head -20
```

Top row is `303  2026-08-12T18:05  editor.syntax.reloaded`, with
`shiki_resolved` at 302 in the same minute.

This is not primarily a logging problem. Resolving a theme 300 times in 60
seconds is redundant _work_ — the log is just where it becomes visible.

### Task

1. Instrument first: determine whether the theme _value_ actually changes on
   each resolve, or whether an unstable object identity is retriggering a
   subscription/effect. Log the resolved theme id and a cheap content hash
   alongside `shiki_resolved` — if the hash is constant across 300 resolves,
   it is identity churn, not real change.
2. Fix the cause. If it is identity churn, the fix is at the subscription
   boundary, not a `useMemo` — CLAUDE.md forbids reaching for manual
   memoization as a first move, and a memo would only hide it.
3. Note the ratio: 10,637 `shiki_resolved` against 3,147 `app.bootstrap` is
   ~3.4 per boot, which is _fine on average_. The problem is the burst shape.
   Whatever you change, verify against the peak minute, not the mean.
4. Reconsider `editor.syntax.reloaded` at `info` (4,680 lines). If it is a
   routine internal transition it belongs at `debug`.

### Relevant memory

`docs`-adjacent: a prior session found first-paint cost was 53 eager grammars,
not tokenization, and the highlighter cache keys on themes only. That cache
key is a good place to start looking.

### Done when

Switching themes resolves a bounded number of times, and no minute in a normal
session carries 300 theme events.

---

## P9 — Wallpaper endpoints: 10,700 requests

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** medium · **Size:** S

### Evidence

```bash
cat logs/*.jsonl | jq -rc 'select(.source=="be" and ((.path//"")|startswith("/wallpaper")))
  | .path' | sort | uniq -c | sort -rn
```

```
5931  /wallpaper/info
2905  /wallpaper
1863  /wallpaper/still
```

**10,699 requests — 6% of every line in the corpus** — for a value that
essentially never changes. The shape is a mount-time fan-out, not a poll:

```bash
jq -r 'select(.path=="/wallpaper/info" and (.timestamp[11:16]=="05:15"))
  | .timestamp[11:23]' logs/2026-08-22.jsonl | head -12
```

Six requests inside 250ms, then four more 12 seconds later. Multiple consumers
each fetching independently rather than sharing one query.

`/wallpaper` is the expensive one: `readExistingMedia`
(`apps/server/src/wallpaper/service.ts:254`) reads the entire file into an
`ArrayBuffer` per request, and the wallpaper source is a 2560×1440 video.

### Task

1. Collapse the client-side fan-out to a single shared query per endpoint.
   Find the consumers:
   ```bash
   rg -n "wallpaper" apps/web/src --glob '*.ts*' -l
   ```
2. Give the wallpaper query a long `staleTime`. It changes when the user
   changes their desktop wallpaper — that is not a per-mount question.
3. Consider whether `/wallpaper/info` and `/wallpaper` need to be separate
   round-trips for the common case.
4. Do not add a cache layer on the server as the first move. The structural
   fix is not asking 10,700 times; caching the answer to a question that should
   not be asked is the local minimum CLAUDE.md warns about.

### Done when

A cold boot issues one `/wallpaper/info` and at most one `/wallpaper`, and the
endpoints fall out of the top 20 by volume.

---

## P10 — Wallpaper reads never retry EINTR

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** medium · **Size:** S

### Evidence

14 hard HTTP 500s — 10 on `/wallpaper/still`, 4 on `/wallpaper`. These are the
only genuine server faults in the entire corpus besides one git timeout.

```bash
cat logs/*.jsonl | jq -rc 'select(.area=="wallpaper" and .level=="error")
  | (.error.message|.[0:130])' | sort | uniq -c
```

```
EINTR: interrupted system call, open '/Users/shaul/Library/Containers/com.zhou.dynamicwallpaper/Data/Documents/...'
```

The source files live inside another running app's container, and that app
rotates them. `EINTR` there is transient by definition.

### Diagnosis

`apps/server/src/wallpaper/service.ts:254`:

```ts
async function readExistingMedia(mediaSource) {
  const file = Bun.file(mediaSource.path)
  if (!(await file.exists())) return null
  const buffer = await file.arrayBuffer()
```

No retry. A single interrupted syscall becomes a 500. The same exposure exists
in `isAnimatedPng` (line 237) and `existingMediaSource` (line 245).

### Task

Add a small bounded retry on `EINTR` (and only `EINTR`) around these reads —
three attempts is plenty for an interrupted syscall. Keep it in one helper the
three call sites share; do not paste a loop three times.

Errors must be created with `createError` from `evlog` via the wallpaper
feature's `structured-errors.ts` wrapper, never `new Error` — carry `code`,
`why` and `fix`. If all retries fail, that is a genuine `error`.

Also check: is a 500 even the right answer here? A missing or unreadable
wallpaper is a cosmetic degradation, and `/wallpaper/still` already has an
"unavailable" branch (`apps/server/src/wallpaper/routes.ts:54`).

### Done when

Transient EINTR no longer surfaces as a 500, and `apps/server/src/wallpaper/tests/service.test.ts`
covers an EINTR-then-success sequence.

---

## P11 — Diff `row-count-mismatch` × 179

**Repo:** both · **Severity:** medium · **Size:** M

### Evidence

```bash
cat logs/*.jsonl | jq -rc 'select(.action=="editor.diff.document_mode_violation")
  | [.side, ((.violations//[])|join(","))] | @tsv' | sort | uniq -c | sort -rn
```

```
171  stacked  row-count-mismatch
  4  old      row-count-mismatch
  4  new      row-count-mismatch
```

### Why it matters

The invariant is load-bearing, and the code says so —
`/Users/shaul/Desktop/D/Editor/packages/diff/src/diffRows.ts:80`:

> `document` mode is built on one identity: projection row `i` is buffer row
> `i` is `data-editor-virtual-row="i"`. Platform's line-comment layer reads
> line numbers straight off that attribute […] anything that breaks it would
> otherwise show up as line comments quietly addressing the wrong line.

So a real violation means diff comments land on the wrong line.

### But verify before fixing

The check is `snapshot.lineCount !== rows.length`
(`diffRows.ts:99`), and it is called from a `useEffect` keyed on `[plugin, rows, side]`
(`apps/web/src/features/editor/components/diff-pane.tsx:131`). The editor's
text is set in a _layout_ effect just above (line 110). There is plausibly a
window where the editor still holds the previous document's `lineCount` while
`rows` already describe the new one — which would make these transient false
positives that resolve on the next frame.

That 171 of 179 are `stacked` — the unified view, where the two counts should
match most trivially — points the same way.

### Task

1. The log cannot currently distinguish transient from persistent, so fix the
   log first (house rule). Add `lineCount`, `rows.length` and the document id
   to the warning payload.
2. Re-run and classify. If the mismatch is gone by the next frame, the check is
   racing the layout effect — move it after the text settles, or gate it on a
   settled revision, rather than deleting it.
3. If it persists, it is a genuine violation: find which projection is switched
   on (word wrap, a fold map, block rows, or injected rows per the comment at
   `diffRows.ts:83`) and either turn it off for `document` mode or stop reading
   line numbers off the row attribute.
4. Whichever it is, `stacked` deserves its own test — it carries 96% of the
   occurrences.

### Done when

The warning fires only on real identity breaks, and a test in the diff package
covers the stacked case.

---

## P12 — Structural syntax failures log twice

**Repo:** `/Users/shaul/Desktop/D/Editor` · **Severity:** low · **Size:** XS

### Evidence

979 `structural_request_failed` and 998 `structural_error`, always ~1ms apart
with near-identical payloads:

```bash
jq -c 'select(.action=="editor.syntax.structural_error"
        or .action=="editor.syntax.structural_request_failed")' \
  /Users/shaul/Desktop/D/platform/logs/2026-08-22.1.jsonl | head -2 | jq -S .
```

Both carry the same `editor`, `syntax` and `scrollPosition` blocks; the only
additions on the second are `changeKind` and `startedAt`.

### Diagnosis

`packages/editor/src/editor/syntaxController.ts` — `recoverSyntaxError` logs
`structural_request_failed` at line 858, then `applySyntaxError` logs
`structural_error` at line 847 for the same failure.

This is exactly the narrow-line pattern CLAUDE.md rules out: _"Always prefer
wide logs: enrich the one event per operation/request with more fields instead
of emitting extra narrow log lines."_ It also doubles the apparent count of the
loudest error in the corpus.

### Task

Collapse to one wide event carrying both the error and the resulting status.
Land this **after P1** — P1 removes ~997 of these, and it is worth confirming
what remains before restructuring the event.

### Done when

One failure produces one log line.

---

## P13 — `fs.read` on literal path `settings:`

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** low · **Size:** S

### Evidence

251 NOT_FOUND reads against the literal path string `settings:`:

```bash
cat logs/*.jsonl | jq -rc 'select(.level=="error" and .area=="fs")
  | (.fs.operations//[])[] | select(.path=="settings:")
  | [.operation, .path] | @tsv' | wc -l
```

Distribution by day — 239 of 251 on a single day, none since 2026-08-19:

```bash
for f in logs/*.jsonl; do
  n=$(jq -rc 'select(.level=="error" and .area=="fs")
       | (.fs.operations//[])[] | select(.path=="settings:")' "$f" 2>/dev/null | wc -l)
  [ "$n" != "0" ] && echo "$(basename $f) $n"
done
```

```
2026-08-15.jsonl   5
2026-08-18.jsonl 239
2026-08-19.jsonl   7
```

### Task

**Verify it is fixed before touching anything.** The shape — a `settings:`
scheme document id routed into a filesystem read — suggests a settings
document being treated as a file path. Related code: `isSettingsDocumentId`
in `apps/web/src/features/address/utils/snapshot.ts`.

1. Reproduce on current `main`: open a settings tab, reload, restore from URL.
2. If it no longer reproduces, close this out — write a regression test that a
   `settings:` document id never reaches `fs.read`, and nothing else.
3. If it does reproduce, fix the routing at the boundary where document ids are
   resolved to filesystem paths, and reject scheme-prefixed ids there rather
   than letting them reach the server.

Do not write migration or healing code for stale persisted state — CLAUDE.md is
explicit that the project is greenfield: delete the bad state, or say what to
delete.

### Done when

Either a regression test exists, or the routing rejects scheme ids at the
boundary.

---

## P14 — HMR artifacts pollute the error log

**Repo:** `/Users/shaul/Desktop/D/platform` · **Severity:** low · **Size:** S

### Evidence

Roughly 200 error lines are Vite hot-reload artifacts, not defects.

**Bogus `ReferenceError`s** across ~20 unrelated symbols:

```bash
cat logs/*.jsonl | grep -oE '"[A-Za-z_$][A-Za-z0-9_$]* is not defined"' \
  | sort | uniq -c | sort -rn
```

`AutoCloseStore` (16), `updateRowInlineKindClasses` (12),
`EDITOR_SHIKI_PRELOAD_THEMES` (5), `$RefreshReg$`, `useEffect`, and a long
tail. Several are provably impossible at runtime — e.g.
`ReferenceError: requestedSpan is not defined`
(`lsp.semanticTokens.request_failed`, 2 occurrences) names a **hoisted function
declaration** at `apps/web/src/features/editor/state/semantic-token-controller.ts:729`
called from line 485 of the same module. That cannot throw in normal
execution; only a partial module replacement produces it.

**Bogus provider errors** — 141 of them:

```bash
cat logs/*.jsonl | jq -rc 'select(.area=="react")
  | [.cause.name, (.cause.message//"-"|.[0:60])] | @tsv' | sort | uniq -c | sort -rn | head
```

```
104  EvlogError  useEditorDocumentStoreApi must be used within EditorStateProvider
 29  EvlogError  useEditorWorkspaceStoreApi must be used within EditorStateProvider
  8  EvlogError  useFocus must be used within FocusProvider
```

The component stacks show `EditorStateProvider` **is** an ancestor, with `?t=`
cache-bust parameters on every frame — context identity broken by hot
replacement, not a misplaced provider. Zero occurrences on the most recent day.

### Task

These are dev-only and individually not worth chasing, but ~200 fake errors
make the log harder to read and cost real time when someone greps for `error`.

1. Confirm the classification before suppressing anything — verify at least one
   provider error by checking that the named provider is present in the stack.
   Do not suppress a category you have not confirmed is spurious.
2. Tag rather than delete. Add an `hmr: true` (or `devArtifact: true`) field
   when the client can tell — a `?t=` frame in the component stack, a
   `$RefreshReg$`/`$RefreshSig$` symbol, an HMR update in flight — so these
   stay greppable but filterable. Do not drop them silently; a real
   `ReferenceError` and an HMR one read identically, and suppressing the class
   would hide the real one.
3. Alternatively, if the app can detect an HMR update is mid-flight, downgrade
   errors caught in that window to `warn` with the reason recorded.

### Done when

`level=="error" and .hmr != true` over a dev session returns only real faults.
