# Session titles

LIFE-11 shipped in release `20260920T151610Z-b915d3e0-plan126-titles-files` and passed controlled native browser verification.

Titles record generated/manual provenance and a command version. Initial generation accepts a result only while the original title and version remain current. Manual rename clears pending regeneration and prevents late initial or regeneration results from replacing it. A newer regeneration owns its own completion. Provider failures clear pending state and retain an error for retry; restart clears interrupted requests.

The first prompt uses an application title model, with a project UUID override. Enabled explicit selections remain unchanged; disabled providers fall back to the first enabled default provider in pinned driver order and its default model. Defaults are Codex `gpt-5.6-luna` with low reasoning. Generated provisional titles refine after one completed user turn, once the runtime is ready. Regeneration uses persisted conversation history rather than the bounded client or command read model.

Context selection matches the pinned first-user/recent-user/assistant algorithm, bounded at 8,000 characters with four attachments total. System and reasoning messages are excluded. Validated citation links become plain text. The provider runs an isolated ephemeral conversation through the existing provider service and cleans up its runtime. Images and file references use the attachment store.

Verification:

- Seven real-engine/provider tests cover manual rename, stale request completion, initial generation and refinement, configured model dispatch, restart, empty context, provider failure/retry and disabled-provider fallback.
- Fourteen context/citation tests include 144 executions of the actual pinned context function.
- Nineteen migration tests pass, including replay and restart persistence.
- Server typecheck and changed-file lint pass.

Row/header/bulk title actions now pass 19 focused UI/menu/streaming tests. They show pending/error/retry, preserve failed bulk selections, and wait for canonical shell settlement before the mutation resolves.

The retained browser run at `/work/tmp/fregat-evidence/20260920T152237Z-scenario-session-titles/` completed in 4.649 seconds. Its seven recorded steps cover initial generation, regeneration, a pending request, manual rename surviving a late result and reload, visible failure, and retry. The 2026-09-23 reconciliation checked the stored summary, not a fresh run. The summary records graphics warnings and two application warn/error entries, so this is not a clean-log claim.

Linked-source policy and process tests are documented in `title-links-delivery.md`; their deployment and authenticated external lookup remain unconfirmed. Text-generation policy overrides, the full provider/source-control matrix, and paired upstream runtime comparison remain open. Fixture output does not establish provider title quality.
