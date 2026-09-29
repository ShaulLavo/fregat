# Plan 255: Edit-prediction controls and partial acceptance

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-36, edit predictions. Size: L. Scheduled after Plans 207, 204, 206 and 254.
  Later scheduling remains approved work.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.json` and `206-zed-translation.json`.

## Outcome

Request and preview predicted edits, enable or disable predictions, inspect available
candidates and accept the next suggested line with ordinary undo.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `edit_prediction::ToggleMenu` opens prediction-provider/settings controls.
  `editor::ShowEditPrediction` requests a prediction when none is active, otherwise refreshes
  its visible preview. `editor::ToggleEditPrediction` switches a per-editor override and clears
  or refreshes the prediction.
- `editor::AcceptNextLineEditPrediction` accepts through the next newline, including that
  newline, for an insertion at the caret. A non-insertion edit falls back to full acceptance.
  Partial acceptance requires one selection and a writable buffer. Predictions can also
  describe source-location moves.
- `editor::NextEditPrediction` and `editor::PreviousEditPrediction` are declared as navigation
  actions and appear in the pinned keymaps. A `git grep` across pinned `crates/` finds declarations,
  agent filtering, migration records and an old evaluation fixture, but no live handlers.
  Fregat will navigate its provider's ordered candidates; this is a product contract to implement.

Sources: [editor/edit_prediction.rs, toggle/show/accept](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/edit_prediction.rs#L195),
[partial acceptance](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/edit_prediction.rs#L356),
[actions.rs, navigation declarations](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/actions.rs#L712),
[edit_prediction_button.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/edit_prediction_ui/src/edit_prediction_button.rs).

## Existing Fregat and Editor behavior

There is no prediction owner in the checked `apps/web/src`, `apps/server/src` or contracts.
Plan 254 supplies inline request/preview contracts. Fregat document mutations live in
`apps/web/src/features/editor/state/workspace-edit-service.ts`.
Editor `packages/lsp-plugin/src/keyCommands.ts` owns completion commands; its
`packages/editor/src/plugins.ts` has inline replacements and injected rows, and
`packages/editor/src/createPlugin.ts` has view-scoped command/edit contributions. These are
adjacent rendering and transaction hooks, not a predictor. They currently live under
`/work/projects/Editor/`; implement Editor work in `editor/packages/` after Plan 207.

## Design

Add typed `prediction.openMenu`, `request`, `toggle`, `next`, `previous`, `acceptNextLine`
commands. Plan 206 presets retain `Editor`, full-mode and `edit_prediction` conditions.
Publish candidate readiness from the focused Editor node. Bindings remain preset data;
completion/snippet/modal contexts retain their deeper precedence.

Define a provider-neutral prediction request/result contract with document/revision, caret,
candidate IDs, ordered edit candidates or source-location moves, and cancellation. Fregat owns
provider selection and transport; Editor owns anchored previews and one-transaction acceptance.
Start with an injectable deterministic fixture predictor and a provider adapter contract.
Register capability-driven provider/enabled settings in application/machine scope; per-view
toggle state may override them. Requests and acceptance use scoped mutations, settled caches
and stale-result rejection. Streaming remains an explicit transport exception.

Next/previous cycle the current ordered candidate set without requesting again. One candidate
remains selected; an empty set declines. Match Zed's insertion-line and full-fallback behavior,
then request a revision-matched continuation. Resolve movement candidates through host source
navigation. Full acceptance and cancellation reuse the Editor/Plan 254 command contracts.

## Steps

- [ ] Add failing fixture prediction tests for stale revisions and next-line acceptance.
- [ ] Define provider contracts, settings and request/candidate ownership.
- [ ] Add Editor preview/acceptance support, candidate navigation and host source moves.
- [ ] Register commands, focused contexts, menu and preset rows; regenerate settings references.
- [ ] Verify, commit and deploy the implementation.

## Acceptance

- Focused Editor tests cover multiline/CRLF insertion, replacement full-fallback, deletion,
  source moves, read-only/multiple selections, undo and stale arrivals after edit/cancel.
  Provider fixtures cover zero/one/multiple candidates and reordered responses.
- Add `edit-predictions` in `scripts/agent/scenarios/`: request, menu, toggle, both navigation
  commands, next-line acceptance and undo. Read screenshots and cache evidence back.
- Run touched tests, settings reference checks and `bun run gates`. Heavy commands use the
  wave slot wrapper and fixture predictors. Any performance claim requires `trace --compare`
  and before/after `renders` evidence.

## Out of scope

Training a predictor, Zed/Zeta services, prediction-rating UI in Plan 256 and TUI UX.
