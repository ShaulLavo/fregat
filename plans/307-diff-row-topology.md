# Plan 307: Keep one displayed diff row per git line

Status: APPROVED, 2026-10-03.

Owner: `ShaulLavo/fregat`, `editor/packages/diff/` and Platform diff position, clipboard, comment, and git-action consumers. Source: [Fregat #342](https://github.com/ShaulLavo/fregat/issues/342). Editor packages are mirrored read-only; implementation stays in Fregat. Inspected baseline: `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`.

Dependencies: None. Preserve the CRLF/BOM fixes shipped in #231 and normal-file save round-tripping shipped in #287.

## Outcome

An embedded lone CR, U+2028, or U+2029 stays inside its git diff row. The rows below it retain the correct tint, gutter number, comment target, selection, and language-service position. Displaying or copying the diff never rewrites the original file or patch bytes.

For `first\nkeep\rmore\nlast`, git has three LF-delimited lines. The middle display row shows the embedded terminator visibly and the final row still corresponds to git line three.

## Evidence and current code

The issue retains a confirmed 2026-10-01 observation of four editor lines for three diff rows. It also documents exact token offsets despite the row mismatch. No fresh browser reproduction ran during issue filing or this planning pass.

[lines.ts](../editor/packages/diff/src/lines.ts) still splits full source text on LF, then normalizes embedded CR/U+2028/U+2029 through `editorLineText`. `joinRenderLines` joins rows by LF. [textbuffer lineEndings.ts](../editor/packages/textbuffer/src/lineEndings.ts) normalizes those embedded characters into line breaks at normal editor ingestion. That normal-editor contract remains valid and must stay intact.

[types.ts](../editor/packages/diff/src/types.ts), [model.ts](../editor/packages/diff/src/model.ts), and [projection.ts](../editor/packages/diff/src/projection.ts) currently conflate source line text and row text. [diffSyntax.ts](../editor/packages/diff/src/diffSyntax.ts) projects tokens from parsed source sides. Platform's [diff-position-map.ts](../apps/web/src/features/editor/utils/diff-position-map.ts) accounts for normalized internal breaks and requires a row to match a source line verbatim before mapping it. A glyph substitution without updating these owners would disable or misdirect language-service positions.

The real app [DiffPane](../apps/web/src/features/editor/components/diff-pane.tsx) is a read-only Editor holding the synthetic projected-row buffer. [diff-documents.ts](../apps/web/src/features/editor/utils/diff-documents.ts) separately constructs language-service side documents. This gives the fix a bounded display owner.

Existing [lineEndings.test.ts](../editor/packages/diff/test/lineEndings.test.ts) and [diff-line-endings.browser.test.ts](../editor/packages/highlighting/test/diff-line-endings.browser.test.ts) verify text/token-offset contracts, including lone CR. They do not establish one rendered row per git line, so keep their useful checks and update assumptions explicitly.

## Raw text, display text, and position ownership

Preserve original source/patch text before normalization. Represent each projected row with its git line identity, source side, display text, and an explicit mapping to the source text. Label new types and fields as proposed until implemented. Distinguish raw UTF-16 offsets, displayed offsets, and positions in the normalized document the language server actually receives.

At the diff projection boundary, replace each embedded terminator with a visible glyph that neither editor ingestion nor browser text layout treats as a line break. Prefer one UTF-16 unit per glyph. Probe the chosen font's advance and fallback in the real editor before fixing glyph choices. The map remains explicit even if raw/display lengths match; normalized language-service lines can still differ.

Do not use display text to build git patches, stage/revert/apply payloads, or clipboard content. Copy selections through the raw source mapping, preserving CR, U+2028/U+2029, existing CRLF policy, and BOM bytes as the established copy contract requires. Show the embedded terminator meaning through the existing Unicode-character affordance where useful.

Keep normalized side documents for syntax and language services. Map their tokens, diagnostic ranges, pointer positions, and returned locations through the row projection. Retain the explicit `none` answer for placeholders, separators, hidden lines, and partial patch rows lacking a complete source document. Replace the current equality check with verified projection identity; do not relax it into best-effort guessing.

Comment targets use git line identity. Raw write actions use the original payload or object-backed source. Normal file editors keep their ingestion/save behavior. No global line-ending change or silent diff-payload rewrite belongs here.

## Execution checklist

- [ ] Reproduce the three-line example on the real stacked and split diff views. Record rendered row count, final-row gutter/tint, comment target, and offset controls for lone CR, U+2028, and U+2029. Use LF, CRLF, leading BOM, repeated BOM, and an embedded CR before CRLF as controls.
- [ ] Probe display glyphs and source/display/LSP position mapping. Verify one visual row per git line in Chromium, Firefox, and WebKit. Record the chosen representation before changing source contracts.
- [ ] Add portable regressions for model/projection row count and bidirectional position mapping. Cover positions before, on, and after each embedded terminator, both source sides, additions/deletions/context, hidden regions, placeholders, and repeated expansion.
- [ ] Preserve raw input at the diff parsing/full-source boundary and implement the chosen display projection. Update row joining, inline ranges, syntax token projection, gutters, and the Platform language-service map together. Keep raw text independent of paint buffers.
- [ ] Update clipboard selection and line-comment consumers to use the appropriate mapping. Cover a selection crossing an embedded terminator and a selection spanning rows, including old-side deletions and stacked context.
- [ ] Verify stage, revert, and apply with the real in-process server and temporary git repositories. Assert exact resulting blob/file bytes and patch semantics. Use one meaningful operation per action rather than testing a display helper as a proxy for write safety.
- [ ] Extend the real diff browser regression to assert row geometry, tints, gutters, comment targets, copy content, and language-service lookup on the row below the embedded terminator. Protect both Tree-sitter and Shiki syntax projection where the map is shared.
- [ ] Run existing narrow diff line-ending, syntax projection, clipboard, and position-map checks. Update invalidated topology assumptions while retaining CRLF/BOM and normal-save regressions. Build affected workspaces before Platform consumer checks.
- [ ] Verify the actual diff scenario and inspect screenshots. Run browser checks through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill. Commit by path, push, deploy, and attach the byte-preservation and visual evidence to this plan.

## Acceptance and delivery

Exactly one rendered row represents each git line, apart from intentional separator/padding rows. Embedded terminators are visible without breaking row geometry. Source/display/language-service positions round-trip, synthetic rows remain unmappable, comments retain git line identity, and clipboard/git actions preserve original data.

Use the existing diff package Vitest script with the relevant files and Platform fixture-backed tests. New git fixtures derive paths from temporary directories and run without fixed usernames, hostnames, or `/work` paths. Add a `scripts/agent/scenarios/` diff scenario if the current scenarios do not exercise the defect, and return remotely reachable evidence for the owner.
