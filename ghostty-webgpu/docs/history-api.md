# History API

`Terminal`, `TerminalSession`, and `GhosttyTerminal` expose synchronous text reads from the active terminal screen.
Reads use the current emulator state and are available before a DOM terminal opens or paints.
They leave the viewport and selection unchanged.

## `lineCount()`

Returns the number of retained scrollback rows plus visible rows on the active screen.
The count includes empty visible rows.
History eviction changes the oldest retained row, so indices identify the current snapshot.

## `readLines(start, end, options?)`

Returns `readonly TerminalLine[]` for the half-open interval `[start, end)`.
Index `0` identifies the oldest retained scrollback row.
Visible rows follow scrollback in order.

```ts
interface TerminalLine {
  text: string
  wrapped: boolean
}

interface ReadLinesOptions {
  trimRight?: boolean
}
```

`text` contains the row's Unicode grapheme clusters.
Wide-character spacer cells contribute no text.
Empty cells contribute spaces.
`trimRight` defaults to `true` and removes trailing U+0020 spaces.
It preserves graphemes formed from a space and combining marks, plus non-breaking, em, and ideographic spaces.
With `trimRight: false`, trailing grid padding remains in the string.

`wrapped` is `true` when the row soft-wraps into the next row.
It is the upstream `GHOSTTY_ROW_DATA_WRAP` flag.
Rows remain separate even when soft-wrapped.

Indices clamp to `[0, lineCount()]`.
Fractional indices truncate toward zero before clamping.
Infinite endpoints clamp to the corresponding boundary.
A reversed or empty interval returns an empty array.
An endpoint that is not a number, including `NaN`, raises `GhosttyError`.
Reads after disposal raise `GhosttyError`.

A call returns at most `TERMINAL_READ_LINES_MAX_ROWS`, currently `1024`.
The exported constant bounds decoded allocations and synchronous lookups through upstream history pages.
A larger interval returns its first capped batch.
Each subsequent batch starts after the previous batch's returned rows.

## Screens

Reads cover the currently active screen.
While the alternate screen is active, its rows and count are available.
Primary-screen history becomes available when the primary screen is active again.
The upstream grid-reference API has no inactive-screen selector.

## Selection and visible rows

Plain-text gesture selection uses the same core grid reader as history reads.
Selection retains upstream rules for partial columns, rectangular ranges, blank rows, and soft-wrap joining.
`unwrap: true` joins soft-wrapped rows in rectangular selections too.
Selection trimming follows upstream's grapheme rules.
For example, history preserves `"x ́"` and `" ́y"`, while trimmed selection returns `"x"` and `" y"`.

The shared reader preserves row separators and complete wide characters across upstream page boundaries.
The pinned native formatter drops a row separator at those boundaries for rectangles that start after column zero.
It also omits a wrapped wide character when the selected row ends at a page boundary.
These two cases deliberately produce different text.
VT and HTML selection formatting uses upstream's formatter.
The low-level `GhosttyTerminal.getSelection()` also uses upstream's formatter.

Screen-index lookups traverse upstream history pages for each row.
Large selections are uncapped and require work proportional to selected rows times the traversed page count.
The public history API limits each call to `TERMINAL_READ_LINES_MAX_ROWS`.

`visibleLines()` retains its existing behavior.
It reads the last rendered frame and returns strings for that frame's visible rows.
