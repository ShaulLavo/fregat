# Plan 178: where the tree leads

- Status: PROPOSED. Size M. After [parity-harness](parity-harness.md); runs beside the other
  sub-plans.
- Owns: finding what the tree does better than the rest of the app, and moving the app to it.

## Owner direction

2026-09-26: alignment runs both ways. Some things the file tree does better than the app, and there
the app should follow the tree. Truncation is one candidate, icon colours another.

## Outcome

Each candidate below has a side-by-side comparison, an owner verdict, and, where the tree wins, the
app changed to match, with the AGENTS.md rule rewritten in the same pass. Where the app wins, the
tree aligns in the sub-plan that owns that part.

## Candidates

1. **Truncation.** The tree cuts the middle of a name and keeps the extension
   (`component-file-na….tsx`). The app's rule bans middle truncation and puts the basename first,
   the directory second, muted (`components/file-label.tsx`, `git-file-row.tsx`). Compare both on
   editor tabs, git rows, quick open, search results, the file picker and chat file chips, with long
   names from real repos. If the tree wins, `FileLabel` makes it the default and the AGENTS.md
   truncation section changes.
2. **Scrollbar.** The tree's thumb shows only while the list is hovered, over a stable gutter.
   `.app-scrollbar-thin` shows it always. Plan 102 already calls the tree's recipe the better one;
   [chrome](chrome.md) lands it as the shared utility, and this confirms every scroller takes it.
3. **Pressed tint.** Tree rows have none; `ListRow` paints `bg-row-active` on press. Compare on the
   session rail, git changes and search results.
4. **Focus ring only while the list has focus.** The tree shows its cursor ring only while it holds
   focus. Check what other `useListbox` lists show when focus leaves them.
5. **Icon colours.** The tree's hues (`bun` in mauve) against `FileTypeIcon`'s elsewhere.
   [Plan 180](../180-file-icon-variants.md) researches variants and per-mode colours; this item
   records the verdict for the app.
6. **Indent guides in syntax colours and sticky headers.** Not a verdict: [rows](rows.md) and
   [virtualization](virtualization.md) already give them to the other trees and grouped lists.
   Recorded so each adopter's `look` gets a before and after.
7. **Anything else the harness shows.** Capturing the tree next to git changes and search results
   in the same matrix will surface more differences in row metrics, colours and motion. Each one gets
   a line here and a verdict.

## Work

1. A side-by-side capture per candidate with the harness matrix (compact and cozy, light and dark).
2. A short case per candidate: what differs, where it shows, which reads better and why.
3. Owner verdicts, recorded here with dates.
4. For each tree win: change the app primitive, update every call site in one pass, rewrite the
   AGENTS.md rule, re-run the affected surfaces' scenarios and `look`.

## Verification

`look` before and after on every surface a verdict changes; `design:census` with the rewritten rules.
