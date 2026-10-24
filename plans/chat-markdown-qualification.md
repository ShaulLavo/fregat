# Qualify tree-sitter Markdown for chat rendering

Status: Approved. Mixed-delimiter parity is Required by owner decision on 2026-10-24.
PR #1326's merge stands. Full chat qualification remains scheduled later and does not block
this follow-up's merge or the owner instance update.

[Plan 176](176-markdown-parser.md) owns parser migration, and
[Plan 189](189-tree-sitter-md-improvement.md) owns parser improvements. The
[Markdown product direction](../.internal/markdown-experiences.md) and
[shared consumer plan](bubli-markdown-consumer.md) retain the architecture contracts. The
[qualification guide](../.internal/markdown-parser/qualification.md) documents the existing
comparison tools for later use.

## Follow up on full chat qualification

When this work is scheduled, compare tree-sitter with remark for completed and streamed semantics,
safe rendering, browser appearance, and selection, clipboard, and scroll behavior. Pair cold, warm,
and streaming measurements of latency, CPU, and memory on the real chat path. These checks would
find behavior regressions that the merge benchmark does not cover and show where later parser or
renderer work would help.

## Required mixed-delimiter parity

PR #1326's merge stands. The owner made the mixed-delimiter follow-up Required on 2026-10-24.
For `~_~a_~`, preserve remark's `<p>~_<del>a_</del></p>` output. The shipped tree-sitter
output was `<p><del><em>~a</em></del></p>`. Two earlier bounded attempts found no safe fix;
one upstream candidate regressed `*~~a*~~` and `*~~*a~~*` and was discarded.

Acceptance:

- Fix resolver ordering and span ownership in `tree-sitter-md`, then update Fregat's pin.
  Keep the native parser as the source of delimiter allocation, with no fallback reparse or
  duplicated adapter resolver.
- Demonstrate failing-first regression tests for the original input and preserve both neighbors.
  Cover practical rendering parity with a meaningful nearby corpus, including closed spans,
  link labels, original run lengths, incremental edits, and both grammar profiles.
  Use micromark itself with Fregat's established extensions as the oracle in a small deterministic
  differential test generating nested `**`, `*`, `___`, intraword and punctuation-flanking inputs.
  Port the micromark attention rules into the native resolver and retain its MIT notice.
- Pass focused tests and required CI, then obtain one independent review of the actual code.
- The parent merges the upstream and consumer PRs and updates the owner instance. The
  implementation lane opens draft PRs and reports evidence without merging or deploying.

Use one bounded implementation attempt per lane. Report each failed approach when it happens.
After two new failed attempts, the coordinator lists options under Owner decisions before
continuing. Broad chat qualification above remains nonblocking and separately scheduled.
