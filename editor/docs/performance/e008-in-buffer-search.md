# E008: In-buffer search

Implemented against Editor `21c17e8`, 2026-09-21. The production change is in
[`search.ts`](../../packages/find/src/search.ts) and
[`findController.ts`](../../packages/find/src/findController.ts), with one fast path in
[`textRanges.ts`](../../packages/editor/src/textRanges.ts).

## What was slow

The matcher was never the cost. A query that cannot match a line break was answered one line
at a time, and every line paid two line-index descents and one `readRange`. On the 500,000-line
fixture that is 500,000 reads to find 502 matches. Navigation was worse: Find Next walked lines
and called `findMatches` on each, which compiled a new `RegExp` per line, so a press with
nothing left to find cost 0.4 to 1.2 seconds. A query that matched nothing paid that twice per
keystroke in the find box, once ahead and once wrapped.

## Contract

`compileFindQuery` classifies a query once into a `FindQueryPlan`, and `findQueryPlan` reports it:

| Plan             | Queries                                                         | How the text is read                                                                               |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `lines`          | Literals without a break; line-safe patterns without `^` or `$` | Windows of whole lines, at least `FIND_WINDOW_UNITS` (65,536) units each, searched as one haystack |
| `anchored-lines` | Line-safe patterns with `^` or `$`                              | The same windows, then each line sliced out of the window and searched alone                       |
| `literal-lines`  | Literals holding `k` breaks                                     | Line-aligned windows overlapping by `k` lines, with one cursor carried across them                 |
| `range`          | Every other pattern, reason `pattern-may-match-line-break`      | The searched range as one window, as before                                                        |

Why a multi-line window gives the line-at-a-time answer for `lines`: no part of the pattern
can match `\n`, so no match or lookaround leaves its line; `\n` is not a word character, so
`\b` and the whole-word check see at a window's interior line end what they saw at a string
end; and a greedy scan cannot carry a non-overlap phase over a character no match can hold.
`^` and `$` are the exception. Without the multiline flag they mean the window's ends, and with
it `$` also stands before `\r`, which is inside a line here. So an anchored pattern keeps one
haystack per line and only loses the per-line tree reads.

A `literal-lines` match spans exactly `k + 1` lines, so a match starting `k` or more lines
before a window's end is whole inside it, and the next window starts `k` lines early to hold the
rest. The cursor moves past every raw match, including one the whole-word filter rejects, and
the next window resumes at the cursor rather than at its own first line. Restarting there would
pick the other of two overlapping candidates and shift every later match.

`range` is unchanged and still joins the searched range into one string. A general regex has
no bounded dependency range, and none is claimed.

One scanner serves every caller through a visitor: `findMatches` collects up to a limit,
`countMatches` counts without allocating a record, forward navigation stops at the first match
at or after the offset, and backward navigation walks windows back from the cursor keeping the
last two matches. Navigation compiles the query once per press.

Backward navigation for `range` and `literal-lines` plans no longer cuts the text at the
cursor's line. Cut there, `[^a]+$` ended on a match that no listing of the document holds.
The scan now sees the whole range and stops at the first match ending past the cursor.

### Counts

The widget count is exact. When the listing stops at `FIND_MATCHES_LIMIT` (19,999), the
controller counts the rest with `countMatches` and the position of a match past the cap is the
number of matches in front of it. `matchesTruncated` is now `highlightsTruncated`: the cap
bounds painting only, and the count's title says so. Replace All and Select All Matches were
already uncapped. A re-search that lists nothing skips the navigation scan.

## Measurements

`bun run --cwd packages/find bench:search` builds real piece-table snapshots from the
[E001 fixtures](../../examples/stress/README.md) and reports the median of at least five runs.
The fragmented document is `short-lines` after 20,000 seeded small edits. Milliseconds, Node
26.7 (V8), capped listing unless noted, same machine and same built core for both columns:

| Document                 | Query                          | Before | After | Reads before → after |
| ------------------------ | ------------------------------ | ------ | ----- | -------------------- |
| short-lines (500k lines) | literal sparse, match case     | 47.8   | 2.2   | 500,000 → 196        |
| short-lines              | literal sparse, ignore case    | 49.1   | 1.2   | 500,000 → 196        |
| short-lines              | literal absent                 | 47.8   | 0.19  | 500,000 → 196        |
| short-lines              | regex line-safe                | 47.4   | 1.2   | 500,000 → 196        |
| short-lines              | literal whole word (500k raw)  | 71.4   | 15.5  | 500,000 → 196        |
| short-lines              | literal dense, uncapped (500k) | 83.7   | 10.9  | 500,000 → 196        |
| short-lines              | Find Next, literal absent      | 521    | 0.38  |                      |
| short-lines              | Find Previous, regex absent    | 398    | 2.6   |                      |
| short-lines, 20k edits   | literal sparse, match case     | 171    | 5.6   | 499,372 → 197        |
| short-lines, 20k edits   | regex line-safe                | 172    | 4.7   | 499,372 → 197        |
| short-lines, 20k edits   | literal dense, uncapped        | 218    | 29.3  | 499,372 → 197        |
| short-lines, 20k edits   | Find Next, literal absent      | 1183   | 6.0   |                      |
| ordinary (200 lines)     | literal sparse                 | 0.020  | 0.001 | 200 → 1              |
| unicode (2049 lines)     | literal sparse                 | 0.244  | 0.038 | 2049 → 2             |
| long-line (1 MiB line)   | literal sparse                 | 0.008  | 0.007 | 1 → 1                |

No small-file regression. The one row that moved the wrong way is the `range` regex on the
single 1 MiB line, 0.19 ms to 0.24–0.38 ms across runs; its code path is the old one behind the
visitor, and it stays under half a millisecond. Whole-word before was 74 ms with the old core;
the ASCII fast path in `isWordCodePointAt` and the allocation-free `isWholeWordRange` are part
of the after column only in the Bun runs archived beside this file.

In Chromium, the E001 `find-all` scenario on `short-lines` types `needle` with trusted keys and
waits for the exact count: 205 ms before, 46 ms after (warm medians of three, 225 → 56 cold).

### Matcher

`bench:matchers` compares the literal matchers over the flat 12.8 MB text. Native `indexOf`
beats Boyer–Moore–Horspool written in JavaScript on every needle: 0.18 ms against 9.6 ms for an
absent six-character needle under V8, 4.5 against 18.3 for 500,000 matches. Native search
stays. Line-wise scanning, the third control, is the before column above.

## Decisions

**No incremental match index.** The plan allowed it only where a dependency range can be
proved, and asked for a measured improvement. After windowing, a full re-search of the largest
fixture costs 0.2 to 6 ms for sparse queries and 15 to 17 ms in the worst line-local case
measured, 500,000 raw whole-word candidates. That work already runs 100 to 400 ms after the
last keystroke, off the input path. An index would retain every match of a dense query, compose
dirty ranges through the edit chain and carry the resynchronization proof, to save a few
milliseconds per pause. Reopen it if a line-local re-search is measured above one frame on a
fixture that represents real use.

**No search slices.** For the same reason: the bounded plans finish inside a frame on 12.8 MB.
The unbounded case is one native `RegExp.exec` over a `range` window, which slicing cannot
interrupt. Isolating it is E014 work.

## Verification

- `bun run --cwd packages/find test`: 103 tests.
  [`searchWindows.test.ts`](../../packages/find/test/searchWindows.test.ts) compares 26 queries
  with an independent line-at-a-time oracle over three seeded 200,000-unit documents, each
  fragmented by 400 piece-table edits, for listing, counting and navigation from random offsets
  in both directions. It covers self-overlapping literals, whole-word filtering that rejects raw
  matches, empty matches, lookaround, anchors beside `\r`, surrogate pairs, `İ` under case
  folding, and multiline literals. A separate case runs the self-overlapping `a\na` across window
  seams at four phases.
- The five tests that pinned one read per line now pin the window contract: whole lines, bounded
  size, never the document, nothing in front of the cursor's line.
- `bun run --cwd packages/editor test textRanges`, typecheck, lint and format for both packages.
- Evidence: [`e008-evidence.tar.gz`](e008-evidence.tar.gz).
