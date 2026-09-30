# Plan 256: Local prediction inspection and rating

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-37, prediction feedback. Size: M. Scheduled after Plans 206 and 255.
  Later scheduling remains approved work.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.json` and `206-zed-translation.json`.

## Outcome

Inspect captured prediction runs and candidate diffs, walk their context history, and save
positive or negative ratings with feedback for local evaluation.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `edit_prediction::RatePredictions` opens a feature-gated rating modal.
  `zeta::FocusPredictions` returns focus to its prediction list.
- `zeta::NextEdit` and `zeta::PreviousEdit` select the next/previous prediction with a nonempty
  edit list, stopping at the ends. `zeta::PreviewPrediction` previews the selected prediction.
- `zeta::ThumbsUpActivePrediction` and `zeta::ThumbsDownActivePrediction` record a rating and
  advance to the next edit. Negative ratings require feedback text. Zed can include an expected
  patch in the rating record.
- `dev::EditPredictionContextGoBack` and `dev::EditPredictionContextGoForward` navigate the
  captured retrieval-run history with clamped indices and restore focus to its viewer.

Sources: [edit_prediction_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/edit_prediction_ui/src/edit_prediction_ui.rs#L43),
[rate_prediction_modal.rs, edit navigation and ratings](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/edit_prediction_ui/src/rate_prediction_modal.rs#L159),
[preview](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/edit_prediction_ui/src/rate_prediction_modal.rs#L280),
[edit_prediction_context_view.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/edit_prediction_ui/src/edit_prediction_context_view.rs#L246).

## Existing Fregat behavior

`apps/web/src/features/dev/` supplies a component gallery; it has no prediction evaluator.
`apps/web/src/features/editor/utils/diff-documents.ts` and the hosted diff pane supply document
comparison. Plan 255 establishes candidate IDs, revisions and previews. Its ordered records
are the inspection input. `packages/contracts/src/settings/keys.ts` owns settings and
`apps/web/src/lib/mutations/run.ts` owns imperative mutation execution. No Editor package
changes are required beyond Plan 255's read-only preview API.

## Design

Create a local evaluation feature with `predictionReview.open`, `focusList`, `nextEdit`,
`previousEdit`, `preview`, `ratePositive`, `rateNegative`, `contextBack`, `contextForward`
commands. Map the nine Zed action names at the translation boundary. Presets preserve
`RatePredictionsModal`, its nested Editor and `EditPredictionContext > Editor` focus contexts.
Commands consume current candidate/run IDs, and empty history safely declines.

Persist opt-in local evaluation records through a scoped server owner, with candidate/revision,
provider descriptor, rating, feedback and optional expected patch. Register capture enablement,
retention and location in the settings registry. Captured source/context belongs to the local
evaluation record; structured operation logs carry IDs and constraints. Secrets never enter
records. Preview uses a retained read-only document and cannot mutate the working file.

Use queries for record/history reads and serialized mutations for ratings, settling the list
before advancing. UI uses `ToolPane`, `ListRow`, `VirtualList` and an opaque dialog. Hold the
complete previous preview until the next candidate is ready. Zeta names express local behavior;
the implementation requires no Zed account, feature service or remote rating upload.

## Steps

- [ ] Add failing fixture tests for history bounds, edit-only navigation and rating identity.
- [ ] Implement local record persistence, opt-in capture and retention settings.
- [ ] Build the list, read-only preview, feedback field and context-history viewer.
- [ ] Wire commands and preset contexts; regenerate settings references.
- [ ] Verify local-only requests, gates and cache settlement; commit and deploy.

## Acceptance

- Focused evaluator tests cover empty runs, skipped empty edits, last-record ratings, required
  negative feedback, duplicate rating calls and candidate changes during save. Check persisted IDs.
- Add `prediction-rating` under `scripts/agent/scenarios/` with seeded local records.
  Exercise all nine actions, expected-patch editing, focus return and read-only preview.
  Assert no external evaluator request; read screenshots and `agent:browser caches` evidence.
- Run touched tests, settings reference checks and `bun run gates`. Heavy checks use the wave
  slot wrapper, fixture providers and explicit free ports.

## Out of scope

Training/export pipelines, remote feedback upload, Zeta authentication and TUI evaluation UX.
