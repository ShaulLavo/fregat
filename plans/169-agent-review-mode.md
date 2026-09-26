# Plan 169: Agent review mode

Split from Plan 139 on 2026-09-25 (its research answers 5 and 6). Depends on Plan 139 Phase 3,
the review draft that findings land in.

Status: DONE 2026-09-26 (wave 2 lane A), except Phase 1's native `review/start` (see Phases).
Delete this plan once the owner has run one review.

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
  Decided 2026-09-26: recommendation (wave 2).
- **D2 — Second-model default.** Recommended: the user picks the reviewer per request; a remembered
  default becomes an application-scope setting only after the flow is used (Plan 139 D4).
  Decided 2026-09-26: recommendation (wave 2). No setting yet.
- **D3 — Size.** Recommended: turn and uncommitted reviews through `generateText` with a `review`
  usage purpose and a ~600k budget that refuses an oversized patch; branch and commit reviews run
  as a read-only session turn in the workspace.
  Decided 2026-09-26: recommendation (wave 2).

## Phases

1. Codex: add `review/start` to the generator, map the review items, handle the non-steerable
   review turn; findings parsed onto Plan 139's anchors.
2. Output-schema option through both adapters and `generateText`; Claude reviews with the
   contract.
3. Second-model review: reviewer and target picker, a keyed mutation, the `review` usage purpose.

Done 2026-09-26 (wave 2 lane A):

- Phase 1: not built. D1's output schema serves Codex through `turn/start.outputSchema`, so no
  review needs `review/start`; Platform's Codex catalog offers no `/review`, so the review items
  never reach a Platform thread.
- Phase 2: `outputSchema` on `ProviderTurnInput` / `ProviderRuntimeStartInput`; Claude sets
  `outputFormat` and reports `structured_output` as `turn.structured-output`; Codex passes
  `outputSchema` per turn; `generateText` takes `outputSchema`, `cwd` and `interactionMode` and
  returns `structured`.
- Phase 3: `POST /agent-review` (`apps/server/src/review/`): contract `AGENT_REVIEW_OUTPUT_SCHEMA`
  (Codex's `ReviewOutputEvent`); the working tree and a turn (latest by default) go in as a patch
  with a 600 KB refusal, in an empty directory; a branch or commit is read in the checkout in plan
  mode. Findings are placed on checkout paths; others are counted as `unplacedCount`. Usage
  purpose `review`. Web: the Review button in both chat headers (`SessionControls`) picks target
  and reviewer; findings join the review draft as `author: 'agent'` comments, shown with "Agent" and
  sent as "Reviewer finding". Scenario `chat-agent-review`.

## Verification

- Scenarios for a Codex and a Claude review of a turn on a real temp repo, findings on the cited
  lines. Server tests for the findings parser and the budget refusal.
- One wide event per review (provider, target kind, patch size, finding count, outcome); no diff
  text in logs.
