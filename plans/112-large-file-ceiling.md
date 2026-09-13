# The large-file ceiling: what we can actually open, and who gets to decide

Status: **research — no implementation scope yet.** Requested 2026-09-13.

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
