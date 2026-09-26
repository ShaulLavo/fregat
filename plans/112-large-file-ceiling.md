# The large-file ceiling: what we can actually open, and who gets to decide

Status: **research done 2026-09-25; owner decided, phases proposed.** Requested
2026-09-13. Measurements: [docs/large-file-ceiling/](../docs/large-file-ceiling/README.md).

Decided 2026-09-25: owner — this plan and Editor
[E015 massive file loading](../../Editor/plans/e015-massive-file-loading.md) run as one lane, 112
first. The benchmark here (1–200 MiB) sets the ceiling that E015's scope and exit are written
against.

`DEFAULT_MAX_TEXT_FILE_BYTES` is 200 MiB and `MAX_TEXT_FILE_BYTES_UPPER_BOUND` is 2 GiB
([`apps/server/src/fs/limits.ts`](../apps/server/src/fs/limits.ts)). Neither number came from a
measurement. The upper bound is above what a V8 string can even hold, so raising
`MAX_TEXT_FILE_BYTES` toward it produces a crash in the browser rather than a refusal from the
server — the ceiling is written in the wrong place, in the wrong units, by the wrong process.

This plan replaces a guessed constant with a measured, negotiated one. It ends in a decision record,
a benchmark harness and a number, not in a bigger constant.

## Where the limit actually bites

| Pinch point                                                                                    | Cost at size                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content: string` on `/fs/read` ([`file-result.ts`](../packages/contracts/src/file-result.ts)) | Hard engine wall. V8 caps a string at 2^29−24 (512 MiB); SpiderMonkey at 2^30−2; JSC higher (2^29 allocates fine in Bun, exact ceiling unmeasured). |
| JSON transport ([`routes.ts`](../apps/server/src/fs/routes.ts))                                | Measured 2.1x the document in peak memory and 6x the time of a raw-bytes body. See [§ The transport](#the-transport), which may be the whole plan.  |
| `textFileVersion` ([`version.ts`](../apps/server/src/fs/version.ts))                           | SHA-256 over the whole decoded string on every read and every guarded write.                                                                        |
| `assertByteExactTarget` ([`write.ts`](../apps/server/src/fs/write.ts))                         | Reads the target file on every write to prove the bytes round-trip. Deliberate, and currently bounded only by the same constant.                    |
| Git diff paths ([`git/service.ts`](../apps/server/src/git/service.ts))                         | Reuses `maxTextFileBytes` for a different decision — output truncation — so one number governs two unrelated budgets.                               |
| Singapore document                                                                             | Unmeasured. The editor's own ceiling is the one number nobody has.                                                                                  |

## The transport

`/fs/read` returns a JSON object whose only large field is `content`. Everything else — path,
mtime, size, version, encoding, lossy, seemsBinary — is a handful of bytes. We are paying a
whole-document serialization to carry a header.

Measured on this machine, Bun 1.4, a 50 MiB document of real source text, building the response
server-side:

| Shape                           | Peak RSS        | Serialize | Deserialize | Wire size |
| ------------------------------- | --------------- | --------- | ----------- | --------- |
| `JSON.stringify` / `JSON.parse` | +105 MiB (2.1x) | 60 ms     | 66 ms       | 1.03x     |
| Raw bytes body                  | +51 MiB (1.02x) | 6 ms      | 14 ms       | 1.00x     |

Two things that measurement settles. Escaping is **not** the problem — source text expands 1.03x,
not the multiple that was assumed here before it was measured. And the cost is **not** meaningful
at ordinary sizes: at 1 MiB the whole JSON round trip is 2 ms, so this is large-file work and
should not be sold as an everyday win. The client's own parse copy sits on top of these figures and
was not measured; the real end-to-end gap is wider than the table.

`/fs/blob` already carries metadata in `x-fs-*` headers and streams the body through `Bun.file`
without materializing it ([`routes.ts:149`](../apps/server/src/fs/routes.ts)). The shape we would
want for text already exists in the same file, for images.

### Candidate shapes

| Shape                                      | Cost                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep JSON                                  | Status quo. Ceiling is the engine string limit minus the 2.1x factor.                                                                                                                                                                                                                                                           |
| Metadata in headers, raw bytes in the body | The `/fs/blob` shape. Cheapest to build, precedented in the same file. Metadata degrades to strings — see below.                                                                                                                                                                                                                |
| **Streamed body**                          | The strongest option and the best typed. Eden maps a handler's `ReadableStream<A>` or `Generator<A>` to an `AsyncGenerator<A>` on the client, so a `function*` yielding `Uint8Array` arrives as typed chunks under `for await`. Never materializes bytes and string together at either end, which is where the 2.1x comes from. |
| Ranged reads                               | Only needed if the editor can open a document it does not yet hold in full. A Singapore question before it is a transport one.                                                                                                                                                                                                  |

### What sending bytes actually changes

This is not only a transport swap, and the plan should not pretend otherwise:

- **Decoding moves to the client.** [`text-encoding.ts`](../apps/server/src/fs/text-encoding.ts)
  would have to move into a shared package so web, TUI and desktop decode identically. That is
  arguably where it belongs — `lossy` and `seemsBinary` describe a string, and the string would now
  be made client-side — but it is a real relocation with its own parity tests.
- **`version` changes meaning.** `textFileVersion` hashes the decoded string. If the server never
  decodes, the natural version is a hash of the bytes: cheaper and more honest, but it is a
  different value, and [`write.ts`](../apps/server/src/fs/write.ts) compares against it for
  optimistic concurrency. Not a free swap.
- **Typing survives better than expected — this is not the obstacle.** Verified against the
  installed `@elysia/eden` 1.4.10: the treaty result carries `response: Response` on both branches
  (`dist/treaty2/types.d.ts:71,87`), and `ReplaceGeneratorWithAsyncGenerator` (`types.d.ts:5`) maps
  a streamed `ReadableStream<A>` or `Generator<A>` handler to a typed `AsyncGenerator<A>` on the
  client. Bytes need no schema to begin with. One caveat: `onResponse` is typed
  `(response: Response) => MaybePromise<unknown>` (`types.d.ts:53`), so decoding the body there
  changes `data` at runtime without narrowing its static type — a reason to prefer the streamed
  handler over an `onResponse` hook.
- **Only header-carried metadata actually degrades**, from a typed object to seven
  `string | null` lookups needing hand-written parsing. That is a smaller cost than it first looks:
  [`readServerPaths`](../packages/client-core/src/files/read.ts) already does
  `v.parse(serverPathsSchema, data)` in the very file that would change, so validating an untyped
  response at that chokepoint is an established pattern here, not a new burden. The streamed shape
  avoids the question entirely if the metadata rides as a first typed chunk.
- **`acceptTextOnly` gets stranger.** If the client decodes, the server can still sniff the first
  512 bytes and refuse, but `seemsBinary` on a successful read is now computed twice or trusted once.

## Why the runtime has to be asked

The server enforces the limit and the server is always Bun, so it is asking the wrong engine. The
process that breaks is the client, and the client is not one thing:

| Target         | Engine                                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| `apps/web`     | Whatever browser: V8, SpiderMonkey or JSC, with a 2× spread in string ceiling. |
| `apps/desktop` | Electrobun, so the system webview — JSC on macOS and Linux, V8 on Windows.     |
| `apps/tui`     | Bun, JSC.                                                                      |
| `apps/mac`     | Swift, no JS string limit at all.                                              |

So the ceiling is a property of a connection, not of the server, and it has to be negotiated the
way any other client capability would be. A single constant cannot be right for all four.

## Questions this plan must answer

1. **Detect or declare?** Probe the engine's real ceiling at startup, or map a `navigator`/build
   identity to a table? A probe is honest but allocates; a table is cheap but rots.
2. **Who owns the number?** Client declares to server on connect, server clamps, or both — and what
   happens to a limit that changes mid-session (a desktop webview update, a different browser).
3. **Is the string ceiling even the binding constraint?** The measured 2.1x JSON peak puts the
   practical limit at roughly half the engine limit before the client's own copy is counted. If the
   transport is fixed first, the engine ceiling may stop being the thing anyone hits.
4. **Which transport shape**, given the table above? Streaming leads on both cost and typing; the
   open question is whether Singapore and the write path can accept a document in chunks.
5. **Does a large file need a different read path entirely?** Streaming, ranged reads, or a
   virtualized document that never holds the whole text — the `/fs/blob` precedent, applied to text.
6. **What is Singapore's own ceiling**, and is it above or below the transport's?
7. **Should the git-diff budget be separated** from the open-a-file budget? They are one constant
   today for no stated reason.
8. **What does the user see at the ceiling?** Today it is `FILE_TOO_LARGE`. VS Code offers "Open
   Anyway" and degrades — no highlighting, no wrapping. Refusing and degrading are different products.

## Research steps

1. Measure the real string ceiling per engine, rather than citing it. One probe, run in V8,
   SpiderMonkey, JSC and the Electrobun webview.
2. Build the benchmark: open, edit and save at 1 / 10 / 50 / 100 / 200 MiB, recording peak RSS,
   time to first paint, keystroke latency and save time. Follow the
   [`bench:workspace-search`](../apps/server/scripts/workspace-search-benchmark.ts) precedent and
   [AGENTS.md § Optimization](../AGENTS.md#optimization-and-performance-work) — a number without a
   benchmark is a guess, which is exactly how 200 MiB got here.
3. Find where it actually falls over, and whether the first failure is memory, latency or a hard throw.
4. Extend the transport measurement above to the full round trip — client parse included, in a real
   browser rather than in Bun — and to the 100 and 200 MiB cases. The server-side half is done; it
   is half.
5. Answer the eight questions in a decision table.
6. Split into executable plans: negotiation mechanism, transport change and editor degradation are
   plausibly three, and they are not equally likely to be worth doing. On the numbers so far the
   transport is the strongest candidate and negotiation may be unnecessary if it lands.

Completion: a measured ceiling per engine, a benchmark that can be re-run, a decision on where the
limit is owned, and the executable plans this becomes.

## What this plan does not do

- No change to `DEFAULT_MAX_TEXT_FILE_BYTES` before the benchmark exists. Raising a guessed number
  to a different guessed number is the failure mode this plan is a reaction to.
- No change to the round-trip write guard. It tracks `maxTextFileBytes` by design, so it follows
  whatever this plan concludes without edits.
- It does not change the transport on the strength of the server-side measurement alone.
- It does not assume the answer is a bigger file. "200 MiB is already past the useful point, and the
  work is a better refusal" is a legitimate outcome.

## Research findings (2026-09-25)

Read from `origin/main` 9f3438258; no lane branch changes this plan. Method, tables and raw rows
are in [docs/large-file-ceiling/](../docs/large-file-ceiling/README.md). All app numbers come from
a production build of this tree in Chromium 153, one file per run, inside a 7 GB memory scope
covering browser, server and language servers.

### What fails first

In the order a user meets them:

1. **Typing latency, from 50 MiB.** Plain-text key p95 is 17 ms at 1 MiB, 133 ms at 50 MiB,
   261 ms at 100 MiB and 332 ms at 150 MiB. A CPU profile at 100 MiB puts 1.7 s of the 30-key
   window in the minimap's edit update, which materializes every fold marker in the document
   (Editor `secondaryViews.ts:147`, `minimap/src/workerClient.ts:674`). With syntax and the
   TypeScript server on, a 10 MiB `.ts` file already types at p50 118 ms.
2. **Save, above 128 MiB.** Bun's default `maxRequestBodySize` is 128 MiB (a 129 MiB POST returns
   413 on Bun 1.4.0) and `apps/server/src/index.ts:63` does not raise it. 150 and 200 MiB files
   open under the default 200 MiB limit, then every save returns 413 with "Something unexpected
   went wrong". That is a data-loss bug today, independent of the rest of this plan.
3. **Memory.** Plain text: 300 MiB opens in 2.2 s and the renderer crashes on save. TypeScript:
   100 MiB takes the renderer to 5.3 GB within 20 s of opening, with the server tree at up to
   1.8 GB, and the scope is killed. 50 MiB `.ts` survives, but its save took 65 s, 55 s of it
   inside the server's `fs.write` while the event loop relayed language-server symbol traffic
   (inferred from log timestamps).
4. **Server JSON serialization, between 300 and 400 MiB.** Elysia's `json` throws
   `RangeError: Out of memory` at 400 MiB.
5. **The engine string ceiling is never reached.** Every path above fails first.

### Answers

1. **Detect or declare?** Neither. The engine ceiling is not the binding limit, so a probe or a
   table would guard a number nobody reaches. The client must verify instead: past 512 MiB
   Chromium's `TextDecoder.decode` and `Response.text()` return `""` with no error, so a
   client-side decode compares its byte count with the size it was sent and refuses on a
   mismatch. **Recommendation:** no probe, no table; a length check in the shared decoder.
2. **Who owns the number?** The server, with two budgets it can defend: the largest file it sends
   and the largest body it accepts, the second at least the first. Negotiation buys nothing while
   the Editor's limits sit an order of magnitude below every engine ceiling.
   **Recommendation:** server-owned; revisit only if E015 ships paging.
3. **Is the string ceiling binding?** No. Measured: V8 536,870,888 units (Node 26.7, Chromium
   153), SpiderMonkey 1,073,741,822 (Firefox 155), JSC at least 2^31−1 in Bun 1.4.0 and in
   WebKitGTK 2.52.6, Electrobun's Linux engine. The app fails on latency at 50 MiB, on save at
   128 MiB and on memory at 100 MiB (TypeScript) or 300 MiB (plain text).
4. **Which transport?** Raw bytes with metadata in headers, the `/fs/blob` shape. In the browser
   it is 3.3–3.7x faster than JSON from 100 MiB up (200 MiB: 292 ms against 976 ms), answers
   headers in 2–7 ms against up to 800 ms, keeps server RSS flat (300 MiB: 167 MiB against
   1,399 MiB) and still works at 400 MiB, where JSON fails. At 1 MiB the difference is 5 ms.
   Chunked delivery into the Editor needs E015's streamed construction first; raw bytes do not.
   **Recommendation:** raw bytes for `/fs/read` with a byte-hash `version` and the decoder in a
   shared package; a raw body for `/fs/write` too, so the body limit and the JSON copy go together.
5. **A different read path for large files?** Not below 300 MiB: text opens in 1.6–2.6 s up to
   there. Editing features break, reading does not. **Recommendation:** a large-file mode first;
   E015's paged read-only view only for files past the memory ceiling.
6. **Singapore's own ceiling?** Below the transport's. With all features, about 10 MiB for
   TypeScript and 50 MiB for plain text. The main-thread heap is 2.8x the document at open and
   grows by one document on the first save, because the saved text stays in the query cache while
   the buffer keeps the original (`file-sync-service.ts:238`). The textbuffer is 116 of the
   281 MiB at 100 MiB; the rest is view and plugin state for E015 step 1 to attribute.
7. **Separate the git-diff budget?** Yes. `GitService` uses `maxTextFileBytes` as the `git show`
   output cap and the diff gate (`git/service.ts:418,1052,1104,1168,1245,1256`). A diff holds both
   sides plus its model; VS Code caps diffs at 50 MB (`diffEditor.maxFileSize`).
   **Recommendation:** its own setting, default 50 MiB.
8. **What does the user see at the ceiling?** Over the limit: an empty-looking line 1 with "The
   file is larger than the workspace size limit." and a Retry that cannot succeed. 128–200 MiB: a
   save that fails with a generic toast. 400 MiB with a raised limit: "The file server could not
   complete the filesystem operation." **Recommendation:** degrade before refusing (owner
   question 1).

### E011, E015, E016

- **Piece memory does not dominate.** At open the textbuffer adds 5.6 bytes per line (32 MiB at
  200 MiB); 10,000 typed keys make 3 pieces; 10,000 scattered edits add 5 MiB; retaining every
  snapshot costs 34 MiB per 20,000 edits. It rivals the text only after hundreds of thousands of
  scattered edits (200,000 on 50 MiB: +95 MiB). **Recommendation:** E011 stays parked.
- **E015:** text reads fine to 300 MiB; the costs are per-edit whole-document work and view and
  plugin state. Its step 1 should attribute the heap beyond the textbuffer and fix the minimap
  fold projection before designing paging.
- **E016** is justified by the TypeScript rows, but the 5.3 GB renderer peak covers Tree-sitter,
  Shiki, the minimap and the TypeScript client together. Attribute per worker before choosing a
  bounded parse. VS Code turns tokenization and folding off above 20 MB or 300K lines and stops
  syncing models to extensions above 50 MB (`textModel.ts:188–191`).

### Owner decisions (2026-09-25)

1. **Tiers, and the tier thresholds go up.** All features up to a size, then a large-file mode
   with syntax, folding, minimap and language-server sync off, then refusal. The measured
   thresholds (about 10 MiB for syntax and language server, 50 MiB for the rest) are today's
   floor, not the target. Like the RSC payload problem, the cost comes from moving and
   re-deriving whole documents, and it gets fixed: every phase below aims to raise a threshold,
   and `bench:large-file` shows whether it moved.
2. **The default open limit stays at 200 MiB**, and saving at that size gets fixed (Phase 1).

### Proposed phases

1. **Save and limit bugs.** Raise `maxRequestBodySize` above `maxTextFileBytes`, drop the
   `new Blob([content])` byte count from the write log (`file-server.ts:323,387`), stop the saved
   text outliving the save in the query cache, split the git-diff budget, and land the harness as
   `bench:large-file` with a 150 MiB save case.
   Partly landed 2026-09-26 (wave 2 lane B): `createApp` sets Bun's `maxRequestBodySize` to six
   times the open limit plus 1 MiB (a JSON character can take six bytes), so a 129–200 MiB file
   saves (`fs/tests/large-save.test.ts` posts 130 MiB over the wire: 413 before, 200 after); the
   client write log counts characters instead of copying the text into a `Blob`. Still open in
   this phase: the saved text outliving the save in the query cache, the git-diff budget, and
   `bench:large-file`.
2. **Raw-bytes transport** for read and write: shared decoder with the decoded-length check,
   byte-hash `version`, metadata in headers.
3. **Raise the thresholds.** Remove per-edit whole-document work, starting with the minimap
   fold projection (Editor), and attribute the heap beyond the textbuffer per worker (E015
   step 1, E016 step 1). Measured targets: typing p95 under one frame at 200 MiB plain text, and
   syntax plus language server usable well past 10 MiB. Re-run `bench:large-file` after each fix.
4. **Tiers.** Per-feature thresholds taken from the Phase 3 re-measurement, not from today's
   numbers.
5. **E015 paged read-only view**, for files past the resident-memory ceiling (about 300 MiB
   today).
