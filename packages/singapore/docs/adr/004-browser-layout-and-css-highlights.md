# 004. Let the browser lay out text and paint it with CSS highlights

Status: accepted
Date: 2026-10-24

The decision predates the 2026-09-29 monorepo import. This record is dated when it was written down from [Browser layout and virtualizer](../display/browser-virtualization.md) and [Known limits](../limitations.md).

## Context

An editor needs glyph positions for carets, selections and hit testing, and it needs to color ranges of text. A custom layout engine gives full control and has to reproduce kerning, ligatures, bidirectional text and wrapping for every font.

## Decision

The editor mounts only the rows near the viewport as ordinary DOM text, so the browser lays them out. It reads geometry from DOM ranges and `caretPositionFromPoint`. Syntax colors, selections and other marks are ranges painted through the CSS Custom Highlight API, not spans around each token. The editor has no independent text-layout engine.

## Alternatives considered

- **A custom layout engine with its own glyph measurement.** It would remove the browser's limits and take on all of its work, including bidirectional text, which needs the browser's visual ordering.

## Consequences

An intact text node keeps kerning, ligatures and native insertion positions. The cost is that browser limits become editor limits:

- `::highlight()` cannot set font weight or font style, so syntax colors cannot be bold or italic.
- A row with right-to-left text longer than 32,000 code units is refused, and proportional rows past 5,000 code units use approximate geometry. See [Known limits](../limitations.md).
- Engine bugs become workarounds. [Browser quirks](../display/browser-quirks.md) records each one with its symptom, cause, and upstream report.
- Text rows have a fixed height by default. Widgets, inline content and gutter markers are DOM contributions, because they need content or layout that a highlight cannot give.

See also [ADR 003](003-document-on-main-thread.md).
