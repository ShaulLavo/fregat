# Bounded title context comparison

`apps/server/src/orchestration/title-context.ts` ports the selection and truncation policy from pinned `ThreadTitleContext.ts` at `7445aa733ada33e45289e5aa5055f79142556513`. The resulting text stays within 8,000 characters, excludes system/reasoning messages, preserves initial user intent and recent user constraints, and keeps conversation order. Long messages preserve their head and tail. Attachment output holds four total: the first user's first attachment followed by the latest three retained attachments, or the latest four when that initial attachment is absent.

Fourteen focused tests pass. One executes the actual pinned module over 144 conversations (24 message counts × six lengths) and compares complete results. That paired corpus has no citation links and replaces only citation normalization with identity; it does not claim paired citation-parser equivalence. The local citation helper has separate positive and negative boundary tests for validated links, comments, selector lengths, offsets, duplicate/extra parameters, malformed encoding and wrong authority. Invalid links remain literal. Full server typecheck and changed-file lint pass.

The pinned text-generation model map specifies Codex `gpt-5.6-luna`, Antigravity `antigravity-default`, Claude `claude-haiku-4-5`, Cursor `composer-2`, and OpenCode `openai/gpt-5`. Grok is absent from that map; the pinned server-settings fallback then uses the ordinary provider default `grok-build`. Default text-generation reasoning effort is `low`. These values were read from the pinned Git object, not the reference checkout's working files.

This evidence covers pure context construction, not the complete title generation lifecycle or real provider output quality.
