# TypeScript worker backend

`lsp.typescript.backend` selects `server` (the default) or `worker` for TypeScript and JavaScript.
The setting and both preload limits are machine scoped. Other matched language servers keep
running. Each open editor owns its worker.

The server discovers the containing project, including project references, in a bounded child
process. It returns the compiler's file list plus module-resolution inputs and logical package
paths. The browser checks the file and byte limits before reading the program, then checks the
actual decoded payload again. Standard libraries come from the worker package. Canonical paths
make linked packages and their real files share symbols and unsaved text.

The defaults are 12,000 files and 64 MiB of source. A larger project reports the exceeded limit;
its owner can raise the limits or use the server backend. Limits cover source payload, not the
TypeScript heap. The discovery process also caps reads at 50,000 files and 256 MiB, output at
16 MiB and elapsed time at 60 seconds.

Filesystem events update the worker's program. Configuration, directory and membership changes
reload it; saved source changes refresh dependency discovery and send changed text. Reconnects
retry a failed preload. Closing the editor aborts its listing and batched read. Live buffers and
their edit provenance are synchronized before cross-file edits, so a rename preserves unsaved
changes in another tab.

## Verification, 2026-09-25

The `editor-typescript-worker` scenario passed cross-file rename, rename with another dirty tab,
preferred import fix and formatting. Screenshots were inspected. Evidence:
`/work/tmp/fregat-evidence/20260925T162341Z-scenario-editor-typescript-worker/`.

The same rename and dirty-tab workflow was traced on both backends on the same drive:

| Backend | Scenario elapsed | Main-thread scripting |   Layout |    Paint |
| ------- | ---------------: | --------------------: | -------: | -------: |
| Server  |          26.66 s |              1,857 ms | 186.7 ms | 376.7 ms |
| Worker  |          26.98 s |              1,856 ms | 183.4 ms | 380.6 ms |

The scenario includes fixed waits, so elapsed time is not a rename latency measurement. Traces
are under `/work/tmp/fregat-evidence/20260925T164349Z-trace-editor-typescript-worker/` and
`20260925T164446Z-trace-editor-typescript-worker/`. Run the comparable subset with
`L7_TYPESCRIPT_COMPARE=rename` and select the backend with `L7_TYPESCRIPT_BACKEND`.

The native TypeScript 7 baseline returned an import quick fix without `isPreferred`, so the
editor's preferred-fix command did not apply it. The worker marks its preferred import fix and
the complete worker scenario passed. This existing native-server behavior remains visible in
`/work/tmp/l7-worker-server-actions.log`.

`editor-typescript-worker-memory` opened `apps/web` and requested a semantic rename before
reading its worker heap: 864,898,088 bytes used, with 29,158,551 bytes backing storage. Discovery
returned 28,653 logical files (155,245,831 bytes), including package links, with zero missing or
outside files. This exceeds both default preload limits. The measurement temporarily raised
limits to 50,000 files / 256 MiB and restored them afterward. Evidence:
`/work/tmp/fregat-evidence/20260925T164256Z-scenario-editor-typescript-worker-memory/`.

Server/web typechecks, server production bundles, gates, focused regression suites and compiler
memo checks passed. The read-only review's eight findings have failing/passing regressions for
canonical identity, discovery bounds, compiler option paths, dirty-buffer provenance,
configuration and directory reloads, failure recovery and cancellation. The worker additionally
accepts native `tsx`/`jsx` syntax ids; its missing filter support was reproduced in the large
project scenario and covered by two unit regressions.
