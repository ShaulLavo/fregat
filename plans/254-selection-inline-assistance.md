# Plan 254: Selection-based inline assistance

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-35, inline assistance. Size: L. Depends on Plans 207, 204, 206 and 252.
- Terminal-context coverage also depends on Plans 205 and 246, terminal input commands.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.json` and `206-zed-translation.json`.

## Outcome

Ask for an edit beside selected code, compare model-backed alternatives, keep or reject the
result and record feedback. In a terminal, request and review a command suggestion.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `assistant::InlineAssist` creates an inline prompt for selected editor lines, merging
  overlapping selections and handling folded ranges. Its terminal binding opens a prompt near
  the terminal cursor for command generation.
- `agent::CycleNextInlineAssist` and `agent::CyclePreviousInlineAssist` cycle generated
  alternatives from the primary and configured alternative models. Cycling applies the active
  alternative's preview. Terminal assistance has no alternative-cycle behavior.
- `inline_assistant::ThumbsUpResult` and `inline_assistant::ThumbsDownResult` rate a generated
  result; pending/already-rated results are guarded.

Sources: [inline_assistant.rs, range ownership](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/inline_assistant.rs#L331),
[buffer_codegen.rs, model alternatives](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/buffer_codegen.rs#L143),
[inline_prompt_editor.rs, cycling](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/inline_prompt_editor.rs#L970)
and [feedback](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/inline_prompt_editor.rs#L596),
[terminal_inline_assistant.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/terminal_inline_assistant.rs#L61).

## Existing Fregat and Editor behavior

`apps/web/src/features/editor/state/workspace-edit-service.ts` owns revision-checked edits,
preview and undo. `apps/web/src/features/chat/utils/turn-diff-view.ts` supplies turn-review data;
Plan 252 supplies agent edit dispositions. There is no inline assistant widget or request owner.
`apps/web/src/features/terminal/utils/commands.ts` already owns terminal input operations.

Editor `packages/editor/src/createPlugin.ts` provides selections, view-owned contributions and
one-undo-entry `applyEdits`; `plugins.ts` provides inline replacements and view geometry.
Those verified files currently live under `/work/projects/Editor/`. Implement reusable editor
work in `editor/packages/editor/` after Plan 207. Inline replacements alone do not establish a
revision-safe generated-edit preview.

## Design

Register `inlineAssist.open`, `nextAlternative`, `previousAlternative`, `ratePositive` and
`rateNegative` in the command table. Presets preserve full-editor, `Terminal`, `InlineAssistant`
and `InlineAssistant > Editor` contexts. Add Plan 251 favorite-model cycling to the inline
prompt node. Accept/cancel use shared review commands with the active assist identity.

A Fregat request owner captures document ID, revision, anchored range, model and candidate ID.
Use typed provider capabilities and registered alternative-model settings. Streaming may use
the transport exception; request, cancel, feedback and acceptance use scoped mutations and
cache settlement. Preview candidates without committing every stream chunk to undo history;
acceptance commits once through Plan 252. Candidate switching preserves unrelated edits.
Cancellation removes preview and leaves the document/undo stack intact. A changed base revision
invalidates the candidate. Feedback is stored locally by candidate ID.

The Editor package owns anchored preview rendering and lifecycle. Fregat owns provider calls,
the prompt, model selection and review UI. Terminal suggestions remain reviewable input;
acceptance inserts command text, and Enter executes it through the ordinary terminal path.

## Steps

- [ ] Add failing fixture tests for range capture, alternatives, cancellation and stale results.
- [ ] Implement the request/candidate owner and Editor preview contribution with disposal.
- [ ] Build the inline prompt and terminal suggestion view with shared UI primitives.
- [ ] Wire review/feedback, typed commands, contexts and preset bindings.
- [ ] Verify both hosts, gates and cache settlement, then commit and deploy.

## Acceptance

- Focused Editor preview and workspace-edit tests cover overlapping selections, folds, empty
  selection, Unicode, alternative switching, late chunks after cancel and one undo on accept.
  Cancellation preserves exact text/revision when no intervening edit occurred; human edits survive.
- Add `inline-assistance` under `scripts/agent/scenarios/` with deterministic fixture models.
  Exercise all five actions, model alternatives, accept/reject and terminal suggestion insertion.
  Read screenshots back and inspect mutation cache settlement.
- Run touched tests and `bun run gates`. Heavy commands use the wave slot wrapper, fixture
  providers and explicit free ports. Regenerate settings references for added knobs.

## Out of scope

Background predictions, remote feedback services, automatic terminal execution and TUI assistance.
