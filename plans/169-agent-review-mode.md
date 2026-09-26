# Plan 169: Agent review mode

Split from Plan 139 on 2026-09-25 (its research answers 5 and 6). Depends on Plan 139 Phase 3,
the review draft that findings land in.

## Outcome

The user asks an agent, the one that wrote the change or a second model, to review uncommitted
changes, a turn, a branch or a commit. Findings arrive as comments on the diff lines they cite,
in the same review draft as the user's own comments, marked by author.

## What exists today

- Codex `review/start { threadId, target, delivery? }` with targets `UncommittedChanges`,
  `BaseBranch`, `Commit`, `Custom` (`references/codex/codex-rs/app-server-protocol/src/protocol/v2/review.rs:17-67`).
  It is missing from `CLIENT_REQUEST_METHODS` (`apps/server/src/provider/adapters/codex-protocol/generate.ts:34-48`),
  and the `enteredReviewMode` / `exitedReviewMode` items map to `unknown`
  (`adapters/utils/codex-item-type.ts`). Findings reach v2 as text lines
  `- Title — /abs/path:start-end` (`protocol/src/review_format.rs`).
- Checkpoint commits have no parent (`apps/server/src/git/checkpoint-store.ts:132`), so a turn
  review uses `Custom` instructions naming the two checkpoint refs.
- Claude's CLI registers `code-review` (alias `review`); its output has no contract.
- Both runtimes can force a JSON schema: Codex `turn/start.outputSchema`, Claude SDK
  `outputFormat: { type: 'json_schema' }`. Neither adapter plumbs it.
- `generateText` (`apps/server/src/provider/text-generation.ts`) runs an ephemeral turn in an
  empty directory; its patch budget truncates (200k, commit messages). Measured turn diffs: p90
  105 KB, max 154 KB; a 20-commit branch diff is 1.27 MB.

## Decisions

- **D1 — One findings contract.** Recommended: Codex's `ReviewOutputEvent` shape as a JSON schema,
  enforced through each runtime's output-schema option, so one parser serves both providers.
- **D2 — Second-model default.** Recommended: the user picks the reviewer per request; a remembered
  default becomes an application-scope setting only after the flow is used (Plan 139 D4).
- **D3 — Size.** Recommended: turn and uncommitted reviews through `generateText` with a `review`
  usage purpose and a ~600k budget that refuses an oversized patch; branch and commit reviews run
  as a read-only session turn in the workspace.

## Phases

1. Codex: add `review/start` to the generator, map the review items, handle the non-steerable
   review turn; findings parsed onto Plan 139's anchors.
2. Output-schema option through both adapters and `generateText`; Claude reviews with the
   contract.
3. Second-model review: reviewer and target picker, a keyed mutation, the `review` usage purpose.

## Verification

- Scenarios for a Codex and a Claude review of a turn on a real temp repo, findings on the cited
  lines. Server tests for the findings parser and the budget refusal.
- One wide event per review (provider, target kind, patch size, finding count, outcome); no diff
  text in logs.
