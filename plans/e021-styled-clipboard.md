# E021: Complete styled copy for multiple selections and portable colors

- Status: In progress
- Kind: Implementation
- Owner: Editor
- Priority: P2
- Effort: M
- Dependencies: None
- Inspected baseline: `9abb944f3a2b8d6516953fdec75e8df5e1a94811`

Decided 2026-09-25: owner — keep steps 3–5 (portable colors, the policy wiring and browser proof), queued as future work. Unit 1 is done, so the status stays In progress.

## Outcome

Copy multiple code selections with syntax styling while keeping the existing plain-text payload and paste metadata correct.
Offer an explicit portable color policy for pasting into a light document, without changing the editor's displayed theme.
For example, two selected functions copied from a dark editor paste as two ordered code blocks with readable colors.
Plain-text copy continues to work when syntax is pending, the payload is too large, or the target ignores HTML.

## Unit 1 complete, 2026-09-25

Shared fragments preserve plain text and metadata while producing ordered styled HTML for multiple selections
and deduplicated caret lines. HTML omits only the final caret-line terminator. Limits cover the combined
65,536 source characters and 1 MiB of UTF-8 output. Missing tokens remain plain within a styled block.
Trusted Chromium copy/paste verifies rich and textarea receivers. Copy accepts only current-revision
syntax, and the cumulative token-visit budget prevents overlapping tokens from making fragment lookup
quadratic. A 65,536-character/65,536-token probe takes 16.3 ms and returns plain-only at the 1 MiB limit. Portable color policy (units 2 and 3) remains.

## Current code

- [richText.ts](../packages/editor/src/editor/richText.ts) already builds inline-styled HTML.
  It escapes text, filters unsafe style values, copies typography, and declines source text above 65,536 characters.
- [inputSelectionController.ts](../packages/editor/src/editor/inputSelectionController.ts) writes HTML synchronously
  through the trusted copy event's `clipboardData` after writing plain text and editor paste metadata.
  It currently handles one selection or one caret's line. Multiple selections deliberately receive no HTML.
- [clipboardMetadata.ts](../packages/editor/src/editor/clipboardMetadata.ts) carries per-caret paste information.
  Preserve its semantics when HTML is added. Styled export does not replace editor-to-editor plain-text behavior.
- [richTextCopy.test.ts](../packages/editor/test/richTextCopy.test.ts) covers escaping, overlap, styles, and size limits.
  [clipboard.test.ts](../packages/editor/test/clipboard.test.ts) covers actual controller event wiring in happy-dom.
- [tokens.ts](../packages/editor/src/tokens.ts) gives `EditorToken` resolved style values, not semantic token roles.
  Arbitrarily turning a dark token color into a light token color cannot recover its syntax meaning.
- The wishlist's basic feature is shipped. Remaining work is selection coverage, portable theme handling, and browser proof.

## Scope

Extend the existing clipboard exporter rather than creating another clipboard path.
Add HTML for multiple selections and a reusable configuration for current versus portable colors.
Keep native synchronous copy as the primary path. Add asynchronous clipboard APIs only for a separate host command if needed.
Editor owns serialization, bounds, syntax-style input, and its demo.
Platform owns any exposed settings or app command UI and must register those in its settings registry when integrated.
Rich cut and rich paste are outside this plan. HTML never changes the text inserted into Editor by normal paste.

## Design

Derive ordered copy fragments from the same normalized payload construction that produces `text/plain`.
Proposed fragment records contain source ranges, source text, and the exact separator after each fragment.
The HTML exporter consumes those fragments and syntax tokens for the captured text revision.
Preserve duplicate-line elimination for collapsed carets, selection ordering, tabs, newlines, and primary-caret metadata.
Specify the existing collapsed-line trailing-newline exception explicitly rather than inventing separators independently.
One HTML root contains escaped styled fragments. Its text content matches the defined plain payload semantics.

Keep one total source-size bound across fragments and add an output-byte bound for span-heavy text.
Read only selected ranges, intersect the available token index, and merge adjacent identical styles where useful.
Retain existing overlap precedence and reject unsafe attribute/style content through the same serializer.
Tokens must belong to the captured document revision. Missing ranges remain plain text inside the HTML block.
Do not wait for syntax workers or trigger a full-document tokenization during the copy event.

Proposed formatting policy is a discriminated choice between current styles and portable styles.
Current style mode reuses today's ready token styles and theme.
Portable mode accepts an explicitly prepared light syntax-style source associated with a text revision and theme identity.
Inspect Shiki and Tree-sitter style ownership before choosing the smallest adapter that can supply this source.
The adapter may resolve existing semantic captures to a light palette, or prepare bounded selected-range styles before copying.
Do not reverse-map RGB values to token categories or retain an unconditional second full-document token cache.
If portable syntax styles are unavailable during native copy, emit a readable monochrome block using the configured light palette.
Keep the state explicit so the host can report that syntax colors were unavailable for this copy.

Resolve CSS variables into concrete colors against the source element before serializing portable HTML.
An external document has neither Editor's CSS variables nor its stylesheet.
Keep clipboard writes synchronous within the trusted event. The existing data-transfer channel already supports both flavors.
Document the exporter's fallback result so a host command can report copied/plain/limited without guessing from empty HTML.
Dispose any prepared alternate-theme work on document or theme changes and cancel results for obsolete revisions.

## Steps

1. Capture existing single-selection, caret-line, and multi-cursor plain-copy behavior as fixtures.
   Inspect syntax style ownership and choose the ready portable-style adapter with a concrete memory budget.
2. Extract the shared fragment description from existing payload assembly and add bounded multi-fragment HTML export.
   Demonstrate byte-for-byte plain payload preservation and HTML text ordering for the fixtures.
3. Add the proposed formatting policy and portable fallback without altering the displayed editor theme.
   Verify that asynchronous syntax preparation cannot delay or overwrite a newer copy request.
4. Wire the policy through Editor's option/public API and add a demo toggle.
   Keep Platform settings wiring as an explicit follow-up integration rather than adding localStorage keys.
5. Test trusted browser copy and paste into both a contenteditable receiver and a plain-text receiver.
   Measure event duration and output size for many short tokens at the source-size bound.

## Verification

- Extend `richTextCopy.test.ts` to catch fragment reordering, missing separators, double escaping, and output-cap overflow.
  Include overlapping tokens, Unicode, hostile font/theme strings, tabs, and partially highlighted selections.
- Update the explicit multi-selection exclusion case in `clipboard.test.ts` to the intended new behavior.
  Retain its per-caret paste metadata assertions and caret-line behavior checks.
- Add a browser test using trusted keyboard copy into an in-page receiver and inspect both clipboard flavors where permitted.
  A synthetic happy-dom event alone does not prove browser clipboard behavior.
- Compare current-theme and portable output on light and dark receivers. Record manual target compatibility where automation cannot prove it.
  Do not promise a third-party app preserves styles merely because the HTML string is valid.
- Run focused `bun run test --project dom test/richTextCopy.test.ts test/clipboard.test.ts` in `packages/editor`.
  Run the new browser file separately, build changed exports, and typecheck React/Solid consumers.
- Acceptance requires preserved plain-copy semantics, correctly ordered rich fragments, readable portable fallback,
  bounded synchronous work, and no stale syntax styles from another text revision.

## Risks and decisions

Alternate-theme syntax is the uncertain part. Resolved colors alone cannot supply a faithful light-theme equivalent.
If the syntax adapters cannot supply ready styles cheaply, ship multi-selection and the explicit monochrome portable fallback first.
Clipboard targets vary in CSS support. Keep supported style declarations small and verify actual pasted output.
The source cap does not bound HTML expansion, so acceptance includes the new output limit and span-heavy measurements.
