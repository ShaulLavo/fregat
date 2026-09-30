# E015 bounded read-only proof

## Contracts and decision

The resident Editor remains the editing implementation. Streaming construction reduces peak text
copies but retains the complete buffer and indexes. The new `@singapore-editor/paged` controller
supports a separate read-only range view with stable global positions. It never impersonates a
complete `TextSnapshot`.

| Capability           | Resident Editor             | Streamed resident construction            | Paged read-only                      |
| -------------------- | --------------------------- | ----------------------------------------- | ------------------------------------ |
| Text retained        | Complete                    | Complete, appended from decoded chunks    | 8 MiB raw page cache                 |
| First usable content | After complete construction | After complete construction in this proof | First range during indexing          |
| Edit, undo, save     | Yes                         | Same complete buffer after construction   | Unavailable                          |
| Syntax and LSP       | Subject to host tiers       | Same host tiers                           | Unavailable                          |
| Global line jump     | Indexed complete buffer     | Indexed complete buffer                   | Sparse index; discovery may wait     |
| Copy                 | Complete document           | Complete document                         | Up to 1 MiB of UTF-16 text           |
| Revision safety      | Host owns reads/writes      | Host owns stream revision                 | Every range repeats opening revision |

Go for the read-only capability envelope. Keep resident editing at its measured supported limit.
Editable paging needs a separate dirty-page/history/save design. Streaming is useful for lowering
construction copies; it does not solve steady-state residency.

## Reproduction

```sh
bun run stress:build
node examples/stress/paged.ts --sizes 52428800,209715200 --modes resident,streamed --output /work/tmp/editor-paged/resident.json
node examples/stress/paged.ts --sizes 314572800,629145600 --modes paged --output /work/tmp/editor-paged/paged.json
```

The range source generates deterministic repeated UTF-8 containing a surrogate pair, a combining
sequence, CJK and CRLF. It allocates requested byte ranges only. All modes read the same source.
Resident and streamed paths create real Editor buffers; the stream publishes a complete buffer
only after all chunks are appended. CRLF split across chunks carries a trailing CR forward.
Resident offsets normalize line endings; paged positions preserve raw decoded text, including BOM.
The browser proof compares each visited line and a UTF-16 copy range with the generator oracle,
uses real line controls for a distant jump, captures screenshots, verifies visible pending state,
and rejects a changed file revision. A sweep visits every page-sized region and checks every row.

The controller's unit tests additionally compare all rows and copied text with a complete decoder
for split multibyte UTF-8, combining text, CRLF, UTF-8 BOM, malformed/truncated UTF-8, no final newline,
and long lines. They exercise two readers, checkpoint compaction, small-cache eviction, delayed
cancellation despite a source ignoring abort, and changed-revision invalidation. UTF-16 is refused.

## Measurements, 2026-09-28

Chromium 153, one browser context per configuration. Main-renderer CDP reports after GC; backing
storage is separate from JS heap. Peak JS heap is sampled every 100ms and may miss brief peaks.
The source generator is part of construction CPU and does not represent disk/network throughput.
First-range time ends at decoded DOM update, not physical display paint. Jump time includes
Playwright UI dispatch and DOM observation.

| Mode/input       | Construction/index | Steady JS heap | Backing storage | Sampled JS peak |
| ---------------- | -----------------: | -------------: | --------------: | --------------: |
| Resident 50 MiB  |             446 ms |       76.8 MiB |         8.1 MiB |       196.8 MiB |
| Streamed 50 MiB  |             217 ms |       77.6 MiB |        0.16 MiB |        82.5 MiB |
| Resident 200 MiB |            1776 ms |      304.8 MiB |        32.1 MiB |       784.8 MiB |
| Streamed 200 MiB |             832 ms |      307.1 MiB |        0.16 MiB |       318.9 MiB |
| Paged 300 MiB    |      2104 ms index |       2.26 MiB |        8.16 MiB |        7.10 MiB |
| Paged 600 MiB    |      4292 ms index |       2.30 MiB |        8.16 MiB |        9.95 MiB |

Paged first ranges took 2.4/2.3ms and distant UI jumps 39.7/39.9ms. The 300/600 MiB sweeps retained
exactly 8 MiB cached pages with at most two reads in flight and 1200/2400 checkpoints. The index
cap is verified with a smaller limit in unit tests; those document sizes do not yet need compaction.
Index plus full sweep fetched about twice the file size. Paging bounds residency, not total I/O.

Raw evidence is in `docs/performance/e015-results/`; browser screenshots and complete captures are
in `/work/tmp/editor-112-performance/`. Paged disposal drops backing storage from 8.16 MiB to about
0.11 MiB. The streamed 200 MiB sample still retained its buffer at the immediate disposal GC;
that is recorded, not reported as successful collection. Closing its isolated browser context
releases it. No general buffer-reclamation claim follows from this construction experiment.

Platform owns the live filesystem range session, stable identity, authorization, expiry and
external-change checks. This standalone proof does not substitute for verifying that real boundary.
