# E007: Consumer text copies

Implemented against Editor `4c03e0d`, 2026-09-20. The production change is in
[`ShikiHighlighterSession`](../../packages/editor/src/shiki/workerClient.ts).
The full-document copy inventory found one justified change: catch-up after skipped
Shiki updates. Ordinary find, minimap, and incremental LSP updates already avoid flattening.

## Contract

An open Shiki session computes a missing edit with `diffPieceTableSnapshots` over the
last acknowledged snapshot and the next snapshot. It sends only the replacement range.
Identical snapshots send an empty edit batch, preserving the token store without a full
token response. The old string diff and the session's redundant text snapshot are removed.

An unopened session still sends the complete next text. A worker crash invalidates the
session's opened state using the owner's lifecycle and generation, including when another
consumer has already restarted the worker. Refresh and change then reopen the document.
Requests remain serialized, and the acknowledged snapshot advances only after success.
No worker transport format, public export, host save path, or settings contract changed.

## Call-site and retention inventory

| Consumer                                                                  | Normal path                                                          | Whole-text boundary and retention                                                                                                                                                                                  | Decision                                                                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [Text snapshots](../../packages/editor/src/documentTextSnapshot.ts)       | Piece-backed range and chunk reads                                   | Supplied strings can be reused. New materializations are not cached by the snapshot. E033 removed the lazy `fullText` properties.                                                                                       | Keep extraction explicit; E033 removed the getters.                                                              |
| [Shiki client](../../packages/editor/src/shiki/workerClient.ts)           | Valid edits and catch-up diffs send range edits                      | Initial open and worker replacement serialize one current document. The session retains its acknowledged piece snapshot and packed tokens.                                                                         | Remove the two catch-up materializations and the redundant whole-text payload.                                  |
| [Shiki tokenizer](../../packages/editor/src/shiki/tokenizer.ts)           | Applies edits to worker-owned line/token state                       | The worker retains its own flat `code` plus line states. Its string slicing and grammar cost remain. Owner disposal terminates the worker.                                                                         | Keep the existing tokenizer representation. This measurement does not justify a worker storage rewrite.         |
| [Find](../../packages/find/src/search.ts)                                 | Proven line-local searches read bounded line windows                 | Multiline literals and regexes not proven line-local need larger windows. Results retain offsets, not a private document copy.                                                                                     | No consumer rewrite. Matcher changes remain E008.                                                               |
| [Find adapter](../../packages/find/src/plugin.ts)                         | Uses `snapshot.textSnapshot`                                         | E033 made the text source required; no `fullText` fallback remains.                                                                                                                                                 | Done in E033.                                                                                                     |
| [Minimap](../../packages/minimap/src/workerClient.ts)                     | Snapshot ranges supply clipped line summaries; edits patch summaries | Initial summaries allocate a line-start array and clipped line strings. Missing-source fallbacks materialize text. Pending updates retain snapshots until consumed; worker document state is released on disposal. | Normal production path passed without full reads. Keep bounded summaries; implicit-source removal remains E033. |
| [Tree-sitter source](../../packages/tree-sitter/src/treeSitter/source.ts) | Piece descriptors and retained worker chunks                         | Shared chunks decode once; strings/chunks remain under the existing document-epoch retention protocol.                                                                                                             | No per-edit flattening found. Transport choices remain E009.                                                    |
| [LSP positions](../../packages/lsp/src/positions.ts)                      | Snapshot positions and incremental change arrays                     | Full sync, missing edits, invalid edits, and length mismatch serialize the authoritative next snapshot once.                                                                                                       | Preserve recovery; add diagnostics assertions for each reason.                                                  |
| [LSP document sync](../../packages/lsp-plugin/src/documentSync.ts)        | Composes changes from the retained edit chain                        | A gap or uncomposable chain sends full text. Active descriptors retain the current snapshot, not a newly cached string.                                                                                            | Verify the 128-entry retention boundary and logical revision count.                                             |

Initial-open reads are recorded separately from edit reads. A full read of an already
supplied string is not proof of an allocation. The combined fixture reports three full
reads while opening, then zero through typing, undo, and find. E033 owns the remaining
implicit attachment/provider getters; this change does not rename or remove those APIs.

## Reproduction

Build the core, find, minimap, and LSP packages before running these commands. The runner
loads built exports, starts no server, and serves a Vite build through Playwright routing.
Use an unchanged detached worktree's core package for `--core-directory`.

```sh
bun run stress:build
bun run --cwd packages/minimap build
bun run --cwd packages/lsp build
node examples/stress/copies.mjs --core-directory /path/to/control/packages/editor --repetitions 10 --output /work/tmp/editor-e007/control.json
node examples/stress/copies.mjs --repetitions 10 --output /work/tmp/editor-e007/candidate.json
node examples/stress/copies.mjs --diagnostics --output /work/tmp/editor-e007/diagnostic.json
node examples/stress/copies.mjs --consumers --diagnostics --output /work/tmp/editor-e007/consumers.json
```

The dedicated catch-up fixture uses 64 KiB, 4 MiB, and 48 MiB documents, each fragmented
by 32 real piece-table replacements. A real Shiki Worker uses a trivial grammar to isolate
transport and diffing from regex grammar cost. Each cycle skips one edit, changes back to
the previous history snapshot, then applies a normal incremental edit. Diagnostic runs
count actual snapshot reads and string payload lengths separately from timing runs.
The runner checks final tokens against a fresh full tokenization and observes session and
snapshot collection after disposal. Browser tests separately exercise TypeScript tokens,
Unicode, queued requests, worker replacement, no-ops, and changes before the first refresh.

The combined fixture mounts an Editor with Shiki, find, and minimap, and feeds real
buffer changes through LSP snapshot change construction. It types 20 trusted keys, undoes
them, opens find, searches `needle`, captures the rendered result, and closes everything.
This is a local LSP encoder check; protocol capability negotiation is covered by the LspClient
tests, not by a live language server inside this fixture.

## Measurements

Chromium 153 on this machine. Ten samples per operation and size in the timing run.
Durations include the worker round trip and token adoption; they are not input-to-paint.

| Size   | Skipped-edit median before |   After | Before p95 | After p95 |
| ------ | -------------------------: | ------: | ---------: | --------: |
| 64 KiB |                    0.30 ms | 0.10 ms |     1.2 ms |    1.1 ms |
| 4 MiB  |                   10.45 ms | 0.80 ms |    11.1 ms |    1.4 ms |
| 48 MiB |                  112.75 ms | 9.00 ms |   119.4 ms |   11.9 ms |

At 48 MiB, history catch-up falls from 112.95 ms to 8.9 ms median. Normal incremental
updates remain range-based.
These are local observations, not a portable latency guarantee.

Each catch-up previously read 100,663,298 or more UTF-16 units across two materializations
and sent 50,331,653 or more units. It now makes zero full reads and sends three units for
the skipped-edit case, one for the reverse edit. Initial opens still send 50,331,648 units.

With Chromium's precise memory counter enabled, the maximum main-renderer heap observed
at request submission was 808,550,754 bytes before and 53,928,227 after. This is a sampled
high-water value, not an allocation total or guaranteed absolute peak. Forced-GC live heap
was effectively unchanged, about 51.3 MB. The change removes transient strings and their
transfer cost; it does not claim smaller steady-state storage or measured worker heap.

The combined 48 MiB fixture has about 58.5 MB live renderer heap in both builds. It records
20 incremental LSP changes during typing and one during undo, with zero whole-document reads
after opening. Both builds collect the Editor and buffer after disposal. The 48 MiB find
capture shows 12,288 matches and a painted minimap.

The [saved evidence](../../examples/stress/results/e007/README.md) includes the final
`verified-control-copies.json` and `verified-candidate-copies.json` timing runs,
read counters, combined consumers, and E001 results. Screenshots and exploratory runs
remain in `/work/tmp/editor-e007/`. The first matching timing pair independently observed
114.45 ms to 8.25 ms catch-up and 708 MB to 54 MB sampled request heap.

## Verification and remaining boundaries

Focused snapshot, edit-chain, real-worker, LSP position/client, and document-sync checks passed
96 tests. A separate rerun passed the queued-request test after its gate was tightened.
Core, LSP, LSP-plugin, and stress typechecks passed, as did focused lint and formatting.
The backlog verifier reports two pre-existing missing links, in E030 and E036, and no E007 errors.

E001 passed all 72 samples per build for ordinary and 500,000-line documents through open,
jump, typing, find, scroll, and shared-view churn. Its next-frame p95 stayed at 15–16 ms,
slightly lower in every candidate group. Cold input-to-applied p95 rose by 0.1 ms on ordinary
text and 0.2 ms on short lines; warm values were unchanged or lower. This is not a calibrated
whole-editor speedup claim. E001's typing path has no Shiki plugin; the catch-up benchmark
provides the evidence for the changed code. One warm churn sample in each build retained one
weakly tracked object at E001's observation point; the dedicated disposal checks retained none.

The development API was down. The mesh browser drive typed 300 characters and undid them,
and its screenshot was inspected. Evidence is
`/work/tmp/fregat-evidence/20260920T124010Z-trace-editor-type-burst/`, compared with
`20260920T121934Z-trace-editor-type-burst`. A concurrent archive-lifecycle release changed
Platform between those captures, so the app trace is functional evidence, not causal timing
evidence for E007. Neither drive reported page errors or warn/error application logs.

Release `20260920T123935Z-02885149-editor-e007` passed the production live check. It preserves
the previously deployed archive-lifecycle web changes and reuses that release's server bundle,
without a server restart. An earlier isolated build briefly omitted those web changes and was
rolled back before this final deployment. Platform source was not changed by the deployment;
its sole documentation edit redirects the completed E007 backlink in Plan 099.

No claim is made about worker heap size, other browsers, regex speed, or live remote-LSP
behavior. The original hypothesis that every ordinary consumer flattens on each edit is
rejected by the combined read counters. E033 can now continue with its explicit API boundary;
E008 and E009 retain their separate matcher and transport scope.
