# Phase 0 Performance Baseline

Captured on 2026-05-24 with Bun 1.3.10 on the local macOS workspace.

These are not pass/fail budgets yet. They are the first checked-in measurements for the recovery plan
scenarios, plus the commands that reproduce them.

| Scenario | Command | Baseline |
|---|---|---|
| Typing into a small file | Not separately covered yet | Covered by the insertion bench below as a storage-path proxy; a DOM typing harness is still needed. |
| Typing into a large file | `cd packages/editor && bun run bench:piece-table` | 2,000 append insertions of 1 KiB each, 2,048,000 final chars, average 0.0048ms per insertion, growth ratio 0.64x. |
| Scrolling 100K lines | `cd packages/editor && bun run bench:virtualization` | Large document: 45.299ms, 44 mounted rows, 440 mounted chars. Large fold-marker scroll: 6.091ms, 44 mounted rows. Long line: 2.914ms, 2,048 mounted chars. |
| Syntax refresh after edit | `cd packages/tree-sitter && bun run bench:syntax` | TypeScript edit total: 145.33ms at 10K lines, 836.54ms at 50K lines, 1,732.89ms at 100K lines. |
| Fold toggle in a large file | `cd packages/editor && bun run bench:fold-map` | 100K lines, 100 folds: create map 6.8320ms, average point round trip 0.0884ms, p95 0.1229ms. |
| Minimap update after edit | `cd packages/minimap && bun run bench:update` | 100K lines, 50 edits: average update 0.7487ms, p95 2.0049ms, worst 3.1275ms. |

## Gaps

- The typing rows still need an editor-level browser harness that dispatches real input events and
  measures end-to-end perceived latency. The current insertion number is only the piece-table storage
  path.
- The minimap update bench covers worker-renderer document update work. It does not include real
  worker transfer, canvas drawing, or browser paint.
- Syntax timings are dominated by query work at larger sizes; Phase 4 should split parse/query
  ownership and budgets before setting hard thresholds.
