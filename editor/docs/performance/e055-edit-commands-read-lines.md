# E055: Edit commands read the lines they touch

Implemented 2026-09-25 on Editor branch `lane/L7-edit`. Edit actions, reindent, trim trailing
whitespace and the four exact-occurrence commands read a `TextReadSnapshot`. None of them builds the
document as one string, and `commandDocumentText` is gone along with its entry in
[full-text-boundary-allow.json](../../scripts/full-text-boundary-allow.json), so
`bun run check:full-text` fails if a command reads the whole text again.

What each command reads:

- Line actions (comment toggles, indent, delete, copy, move, insert, join, sort, duplicate) read
  each run of selected rows plus one row on each side through `LineMap`
  ([lineMap.ts](../../packages/editor/src/editor/lineMap.ts)). Case transforms read the selected
  text.
- Word deletes and the word under a caret for Ctrl+D read the caret's row, with the break on each
  side, in a window that grows until the scan stops at least 4,096 units (the widest grapheme
  search) inside it ([rowWindow.ts](../../packages/editor/src/editor/rowWindow.ts)).
- Occurrence search ([occurrences.ts](../../packages/editor/src/editor/occurrences.ts)) reads
  windows forward from the selection, 1,024 units first and doubling to 262,144, then wraps once
  from the start. Each read runs `query.length + 1` units past its window, so a match that starts
  in it is found whole along with the code point after it. A whole-word search reads two units
  before each window, which settles a boundary beside a line feed or plain text. A match whose
  neighbours join into clusters (combining marks, emoji, surrogates) within 4,096 units of its
  window's start is judged on its own read reaching 4,096 units back, the widest grapheme search.
  Select-all-occurrences and change-all scan every window once.
- Trim trailing whitespace walks `forEachTextChunk` and carries a run of spaces and tabs across a
  chunk seam.
- Reindent scans for strings and comments from offset 0 to the end of the last row it rewrites,
  through 16K pages ([textCursor.ts](../../packages/editor/src/editor/textCursor.ts)) that jump
  from one possible opening unit to the next. It keeps the literal ranges it finds, masks only
  the rows it reads, and reads rows by index, finding each next row from the end of the one
  before. A literal that opens before the limit may be read past it, the way it always was. This
  includes an unclosed quote, which searches to the end of the document before falling back to its
  line break. `reindentEditsForRanges` keeps its string signature for `formatOnType`.

Still whole-document by nature: select-all and change-all occurrences, trim trailing whitespace
and reindent of the whole file read every unit, in windows, chunks or pages. Sort lines and join
lines read what is selected.

Tests: the step 1 table (`editCommandTable.test.ts`, 96 cases through a focused editor) passed
unchanged after every step. `commandChunks.node.test.ts` runs occurrence search over a piece table
where every match straddles two pieces and windows one piece wide. It checks whole-word matches next
to letters, astral letters, emoji, flags and a 20-mark combining run on both sides of a seam against
`indexOf` over one string. It also compares trim with the string algorithm on seeded documents, and
checks that reindent gives the same edits wherever a page seam cuts a delimiter.
`fullTextBoundary.test.ts` now also measures Ctrl+D at 64K and 1M, with the caret on row 200 (about
5,000 units in): 1,912 units with no full read at both sizes, reveal included. The two presses did
two full reads before. A 4,096-unit read before every whole-word window made it 6,006. A one-off
comparison against the previous string reindent agreed on 71,254 edits across 3,000 random documents
in five languages.

Measured in happy-dom on a 16M-unit document split into 128 pieces, with a fresh revision before
each press so no retained string answers a whole-document read. `bun run bench:edit-commands` in
`packages/editor` runs
[editCommandLatency.test.ts](../../packages/editor/test/editCommandLatency.test.ts) and prints the
median of 7 dispatches per command. Each figure is the median of three runs; before is the source
at `f947685`:

| Command                                         | Before   | After    |
| ----------------------------------------------- | -------- | -------- |
| Ctrl+D, second press (next match 31 units away) | 2.4 ms   | 0.7 ms   |
| Move selection to next find match               | 1.8 ms   | 0.3 ms   |
| Select all occurrences (2 matches, whole scan)  | 8.2 ms   | 8.7 ms   |
| Trim trailing whitespace (4 rows to trim)       | 31.1 ms  | 5.5 ms   |
| Reindent selected lines, caret on row 3         | 180.8 ms | 0.2 ms   |
| Reindent lines, whole document                  | 333.9 ms | 170.7 ms |

An earlier one-off run of the same setup measured step 2: comment toggle 55.5 → 5.0 ms, move line
down 77.2 → 5.4 ms, join lines 37.6 → 4.5 ms, delete word left 5.8 → 1.9 ms.

The [E033](e033-full-text-boundary.md) boundary workload (`examples/stress/boundary.mjs`,
contributions, 48M) times typing and undo, which never reach these commands. Four control and four
change runs, with builds alternated and a load average of 12–14, gave typing medians of 1.4–2.4 ms
(control) and 1.5–3.2 ms (change), and undo medians of 1.3–2.5 ms and 1.4–3.0 ms. Which side is
faster flips between adjacent pairs, so the spread is noise.
