# Markdown product direction

Owner direction, 2026-09-28. This is the target for Markdown work across the
Editor, Platform composer and chat renderer. Completing an individual migration
does not complete this direction.

## The experiences we want

Support all of these, chosen for the place the user is working:

| Experience                                                                           | Intended behavior                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual authoring, with Milkdown and rich-text Markdown editors as references         | Edit formatted prose directly. Formatting stays visual at the caret. Commands and controls handle marks, links, lists, tasks, code, images and tables.                                                        |
| Source-revealing authoring, with Obsidian as a reference                             | Keep Markdown source editable in place. Reveal the relevant syntax around the caret and render the surrounding document.                                                                                      |
| Rich prompt composition, with T3 Code as a reference                                 | Combine formatted Markdown with atomic mentions, attachments, paste, prompt history, draft restoration, spellcheck and reliable submit behavior.                                                              |
| Streaming conversation, with ChatGPT as a reference                                  | Render growing assistant messages, including incomplete Markdown, without losing selection, jumping scroll position or flashing whole blocks. Support completed messages through the same rendering contract. |
| Static formatted pages                                                               | Render a complete Markdown document as a readable page, with no editing or streaming requirement.                                                                                                             |
| Split editing, with [StackEdit](https://github.com/benweet/stackedit) as a reference | Show editable Markdown source on the left and the rendered document on the right, updating as the user types and synchronizing scroll in both directions.                                                     |
| Source editing                                                                       | Keep direct access to Markdown text.                                                                                                                                                                          |

The ambition is to exceed the reference products in correctness, interaction,
polish and speed. Treat the references as experience benchmarks, not a requirement
to clone their implementation or reproduce every unrelated product feature.

## Shared foundation

All experiences ultimately use our `tree-sitter-md` parser, including its C
resolver, through the existing `tree-sitter-x` integration. A single parser
implementation serves different document owners; this does not require sharing
one mutable parser instance between unrelated documents or workers.

Markdown source is the canonical content. Each host chooses its presentation and
interaction policy. Switching presentation preserves the exact document, selection
and undo history. A rich editing mode needs real editing semantics for hidden
syntax; merely hiding delimiters is not sufficient.

Keep the parser, editing operations, display layout and host policy separate.
File editing, prompt submission and streaming rendering have different lifecycle
and interaction requirements. Streaming chunks update a retained document and
its revision; incomplete input is an expected state. Apply Plan 198's ownership
and stale-result rules wherever analysis is asynchronous.

The current chat and split renderer use remark. Plan 176 deliberately retained
them for its release. Converging those consumers on our parser is now part of the
product direction and requires its own measured migration and acceptance gate.
Do not describe current parser integration as that migration being complete.

Static rendering and streaming rendering share completed-document semantics.
The same final Markdown should produce the same formatted content whether it
arrived as a file, one complete message or a stream. Split view reuses the page
renderer and follows source positions through parsed blocks, including long
fences and variable-height content.

## Existing baseline

As inspected on 2026-09-28, Platform already renders complete Markdown through
`packages/markdown`, and the file editor has a source/rendered split view with
workspace links, images, themed code fences and two-way scroll synchronization.
The UI is in `apps/web/src/features/workbench/components/markdown-preview-pane.tsx`;
`scripts/agent/scenarios/markdown-split-view.ts` exercises the split workflow.
This is source inspection and existing verification coverage, not a fresh live
verification of those behaviors.

[StackEdit's feature page](https://stackedit.io/), inspected 2026-09-28, documents
formatting buttons and shortcuts plus linked scrolling between editor and preview.
Use that workflow as a reference. Its unrelated cloud sync and publishing features
are outside this Markdown effort.

## What earns completion

- Both authoring modes handle formatting selections, editing links, nested lists,
  task interaction and code blocks with predictable caret movement, deletion,
  paste, composition and undo/redo. Include mixed formatted selections and mode
  switches, not just screenshots of already formatted text.
- Rendered images and tables have working layout, hit testing and editing
  controls. Verify scroll anchoring when their heights change.
- The composer preserves atomic mention behavior, attachments, serialization,
  draft restoration, prompt history, spelling, IME and mobile-width use. Test in
  the actual composer before removing Lexical.
- Streaming rendering handles incomplete fences, delimiters, links and tables;
  preserves user selection and scroll intent; and settles to the same result as
  parsing the final complete message. Include adversarial chunk boundaries.
- Static rendering and the split preview agree with the completed streaming
  output. Split editing updates from the live buffer, tracks scroll in both
  directions and preserves position through long fences and loaded images.
- Plain copy, rich copy and paste have explicit contracts in each host. Source
  text must not silently change when switching presentation.
- Accessibility, keyboard navigation, touch and reduced motion are verified in
  the real UI. Performance claims require measured input, parse, layout and
  first-paint evidence against recorded baselines.

## Plans that carry the work

- [Plan 171](../plans/171-composer-on-our-editor.md): authoring prerequisites and
  the composer integration, with Lexical removal behind composer acceptance.
- [Plan 108](../plans/108-markdown-modes.md): source, split, source-revealing and
  visual authoring behavior.
- [Plan 111](../plans/111-editor-decorations.md): decorations, variable-height
  blocks, caret geometry and scroll anchoring.
- [Plan 176](../plans/176-markdown-parser.md): parser integration and the future
  convergence of chat and split rendering onto that parser.
- [Plan 198](../plans/198-document-owned-editor-analysis.md): retained analysis
  ownership, revisions and disposal.

Start with reusable authoring operations and prove them in the file editor.
Build the two editing policies over those operations, then prove the composer.
Rendered blocks and streaming renderer convergence remain explicit work even
when the composer can replace its current plain-text implementation.
