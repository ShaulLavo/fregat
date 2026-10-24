# Qualify tree-sitter Markdown for chat rendering

Status: Approved, scheduled later by owner decision on 2026-10-24. This work does not block PR
#1326. The PR's merge bar is green CI, independent actual-code review, and one queued PC
before/after streaming parsing benchmark on the existing corpus with numbers reported. After
those checks, merge the PR and update the owner instance. Neither step waits for this follow-up.

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

## Mixed delimiters if noticed in real chats

The owner accepted this difference for PR #1326 on 2026-10-24. For `~_~a_~`, remark renders
`<p>~_<del>a_</del></p>` while tree-sitter renders `<p><del><em>~a</em></del></p>`.
If the owner notices it in real chats, fix delimiter resolution in `tree-sitter-md` and cover
this input plus neighboring mixed emphasis/strikethrough cases. Two bounded attempts found no
safe fix; one upstream candidate changed `*~~a*~~` and `*~~*a~~*` incorrectly and was discarded.
This item does not block merge or deployment.
